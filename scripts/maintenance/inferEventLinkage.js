/**
 * inferEventLinkage.js
 *
 * Links orphaned matches by inferring their event from team activity patterns.
 *
 * LOGIC:
 * 1. For each unlinked match, get home_team and away_team
 * 2. Find what events these teams play in (from their LINKED matches)
 * 3. If both teams share a common event, AND the match date fits, link it
 *
 * This can run nightly to incrementally fix orphaned matches as we learn
 * more about team-event relationships from new data.
 *
 * Usage: node scripts/maintenance/inferEventLinkage.js [--dry-run]
 */

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 100;

async function main() {
  console.log('='.repeat(60));
  console.log('INFER EVENT LINKAGE FOR ORPHANED MATCHES');
  console.log('='.repeat(60));
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log('');

  const startTime = Date.now();

  // ============================================================
  // STEP 1: Load all unlinked matches
  // ============================================================
  console.log('Step 1: Loading unlinked matches...');

  const unlinkedMatches = [];
  let offset = 0;

  while (true) {
    const { data: batch, error } = await supabase
      .from('matches_v2')
      .select('id, match_date, home_team_id, away_team_id')
      .is('league_id', null)
      .is('tournament_id', null)
      .not('home_team_id', 'is', null)
      .not('away_team_id', 'is', null)
      .range(offset, offset + 999);

    if (error) {
      console.error('Error loading matches:', error.message);
      break;
    }

    if (!batch || batch.length === 0) break;
    unlinkedMatches.push(...batch);
    if (batch.length < 1000) break;
    offset += 1000;
  }

  console.log(`  Found ${unlinkedMatches.length} unlinked matches`);

  if (unlinkedMatches.length === 0) {
    console.log('\nNo unlinked matches to process!');
    return;
  }

  // ============================================================
  // STEP 2: Build team -> events mapping from linked matches
  // ============================================================
  console.log('\nStep 2: Building team-event relationships...');

  // Get unique team IDs from unlinked matches
  const teamIds = new Set();
  unlinkedMatches.forEach(m => {
    teamIds.add(m.home_team_id);
    teamIds.add(m.away_team_id);
  });

  console.log(`  Unique teams in unlinked matches: ${teamIds.size}`);

  // For each team, find what events they play in
  const teamEvents = new Map(); // teamId -> [{eventType, eventId, minDate, maxDate}]

  let teamsProcessed = 0;
  for (const teamId of teamIds) {
    // Get this team's linked matches (both home and away)
    const { data: linkedMatches } = await supabase
      .from('matches_v2')
      .select('league_id, tournament_id, match_date')
      .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
      .or('league_id.not.is.null,tournament_id.not.is.null')
      .limit(100);

    if (linkedMatches && linkedMatches.length > 0) {
      const events = [];

      // Group by event
      const eventMap = new Map();
      for (const m of linkedMatches) {
        const eventKey = m.league_id ? `league:${m.league_id}` : `tournament:${m.tournament_id}`;
        if (!eventMap.has(eventKey)) {
          eventMap.set(eventKey, {
            type: m.league_id ? 'league' : 'tournament',
            id: m.league_id || m.tournament_id,
            dates: []
          });
        }
        if (m.match_date) {
          eventMap.get(eventKey).dates.push(m.match_date);
        }
      }

      // Calculate date ranges for each event
      for (const [key, eventData] of eventMap) {
        if (eventData.dates.length > 0) {
          eventData.dates.sort();
          events.push({
            type: eventData.type,
            id: eventData.id,
            minDate: eventData.dates[0],
            maxDate: eventData.dates[eventData.dates.length - 1]
          });
        }
      }

      if (events.length > 0) {
        teamEvents.set(teamId, events);
      }
    }

    teamsProcessed++;
    if (teamsProcessed % 500 === 0) {
      console.log(`  Processed ${teamsProcessed}/${teamIds.size} teams...`);
    }
  }

  console.log(`  Teams with event history: ${teamEvents.size}`);

  // ============================================================
  // STEP 3: Infer event for each unlinked match
  // ============================================================
  console.log('\nStep 3: Inferring events for unlinked matches...');

  const toLink = []; // {matchId, eventType, eventId}
  let noCommonEvent = 0;
  let noEventHistory = 0;
  let dateOutOfRange = 0;

  for (const match of unlinkedMatches) {
    const homeEvents = teamEvents.get(match.home_team_id) || [];
    const awayEvents = teamEvents.get(match.away_team_id) || [];

    if (homeEvents.length === 0 && awayEvents.length === 0) {
      noEventHistory++;
      continue;
    }

    // Find common events between home and away team
    const commonEvents = [];
    for (const homeEvent of homeEvents) {
      for (const awayEvent of awayEvents) {
        if (homeEvent.type === awayEvent.type && homeEvent.id === awayEvent.id) {
          // They share this event - check if match date fits
          const minDate = homeEvent.minDate < awayEvent.minDate ? homeEvent.minDate : awayEvent.minDate;
          const maxDate = homeEvent.maxDate > awayEvent.maxDate ? homeEvent.maxDate : awayEvent.maxDate;

          // Extend range by 30 days on each side to account for season variability
          const extendedMin = new Date(new Date(minDate).getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
          const extendedMax = new Date(new Date(maxDate).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

          if (match.match_date >= extendedMin && match.match_date <= extendedMax) {
            commonEvents.push({
              type: homeEvent.type,
              id: homeEvent.id,
              matchCount: homeEvents.filter(e => e.id === homeEvent.id).length +
                          awayEvents.filter(e => e.id === awayEvent.id).length
            });
          }
        }
      }
    }

    if (commonEvents.length === 0) {
      // Try single-team inference: if only ONE team has event history, use that
      const singleTeamEvents = homeEvents.length > 0 ? homeEvents : awayEvents;
      if (singleTeamEvents.length === 1) {
        // Team only plays in ONE event - high confidence this match belongs there
        const event = singleTeamEvents[0];
        const extendedMin = new Date(new Date(event.minDate).getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const extendedMax = new Date(new Date(event.maxDate).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        if (match.match_date >= extendedMin && match.match_date <= extendedMax) {
          toLink.push({
            matchId: match.id,
            eventType: event.type,
            eventId: event.id
          });
          continue;
        }
      }

      noCommonEvent++;
      continue;
    }

    // If multiple common events, pick the one with most matches (strongest association)
    commonEvents.sort((a, b) => b.matchCount - a.matchCount);
    toLink.push({
      matchId: match.id,
      eventType: commonEvents[0].type,
      eventId: commonEvents[0].id
    });
  }

  console.log(`  Can infer: ${toLink.length}`);
  console.log(`  No common event: ${noCommonEvent}`);
  console.log(`  No event history: ${noEventHistory}`);

  if (toLink.length === 0) {
    console.log('\nNo matches could be inferred.');
    return;
  }

  // ============================================================
  // STEP 4: Apply updates
  // ============================================================
  console.log('\nStep 4: Applying updates...');

  // Group by event type for batch updates
  const leagueUpdates = toLink.filter(l => l.eventType === 'league');
  const tournamentUpdates = toLink.filter(l => l.eventType === 'tournament');

  console.log(`  League updates: ${leagueUpdates.length}`);
  console.log(`  Tournament updates: ${tournamentUpdates.length}`);

  let updated = 0;

  if (!DRY_RUN) {
    // Update league matches
    for (let i = 0; i < leagueUpdates.length; i += BATCH_SIZE) {
      const batch = leagueUpdates.slice(i, i + BATCH_SIZE);

      // Group by league_id for efficient updates
      const byLeague = new Map();
      for (const u of batch) {
        if (!byLeague.has(u.eventId)) byLeague.set(u.eventId, []);
        byLeague.get(u.eventId).push(u.matchId);
      }

      for (const [leagueId, matchIds] of byLeague) {
        const { error } = await supabase
          .from('matches_v2')
          .update({ league_id: leagueId })
          .in('id', matchIds);

        if (!error) {
          updated += matchIds.length;
        }
      }
    }

    // Update tournament matches
    for (let i = 0; i < tournamentUpdates.length; i += BATCH_SIZE) {
      const batch = tournamentUpdates.slice(i, i + BATCH_SIZE);

      const byTournament = new Map();
      for (const u of batch) {
        if (!byTournament.has(u.eventId)) byTournament.set(u.eventId, []);
        byTournament.get(u.eventId).push(u.matchId);
      }

      for (const [tournamentId, matchIds] of byTournament) {
        const { error } = await supabase
          .from('matches_v2')
          .update({ tournament_id: tournamentId })
          .in('id', matchIds);

        if (!error) {
          updated += matchIds.length;
        }
      }
    }

    console.log(`  Updated: ${updated} matches`);

    // Refresh views if we made updates
    if (updated > 0) {
      console.log('\nRefreshing views...');
      const { error: refreshError } = await supabase.rpc('refresh_app_views');
      if (refreshError) {
        console.log(`  Warning: Could not refresh views: ${refreshError.message}`);
      } else {
        console.log('  Views refreshed');
      }
    }
  } else {
    console.log(`  [DRY RUN] Would update ${toLink.length} matches`);

    // Show sample of what would be linked
    console.log('\n  Sample inferences:');
    const sample = toLink.slice(0, 10);
    for (const s of sample) {
      console.log(`    Match ${s.matchId.slice(0, 8)}... -> ${s.eventType} ${s.eventId.slice(0, 8)}...`);
    }
  }

  // ============================================================
  // Summary
  // ============================================================
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Unlinked matches:       ${unlinkedMatches.length}`);
  console.log(`Teams analyzed:         ${teamIds.size}`);
  console.log(`Teams with history:     ${teamEvents.size}`);
  console.log(`Matches inferred:       ${toLink.length}`);
  console.log(`Matches updated:        ${DRY_RUN ? '(dry run)' : updated}`);
  console.log(`Still unlinked:         ${unlinkedMatches.length - (DRY_RUN ? toLink.length : updated)}`);
  console.log(`Execution time:         ${elapsed}s`);
  console.log('='.repeat(60));

  if (toLink.length > 0) {
    console.log('\nThis script can be added to the nightly pipeline to');
    console.log('incrementally fix orphaned matches as more data is collected.');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
