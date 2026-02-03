/**
 * linkByEventPattern.js
 *
 * Links unlinked matches by extracting event info from source_match_key patterns.
 * Works differently than linkUnlinkedMatches.js - doesn't require exact key match in staging.
 *
 * APPROACH:
 * 1. HTGSports: Extract event_id from key (htg-{event_id}-{match_id})
 *    - Look up or create tournament by source_event_id
 *    - Link all matches with that event_id pattern
 *
 * 2. Heartland: Extract league type and year from key (heartland-{type}-...-{date}-...)
 *    - Match to "Heartland {Type} League {year}" in leagues table
 *    - Link all matches with that pattern
 *
 * Usage: node scripts/maintenance/linkByEventPattern.js [--dry-run]
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log('='.repeat(60));
  console.log('LINK MATCHES BY EVENT PATTERN');
  console.log('='.repeat(60));
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE'}`);
  console.log('');

  const startTime = Date.now();

  // ============================================================
  // STEP 1: Get all unlinked matches with source_match_key
  // ============================================================
  console.log('Step 1: Loading unlinked matches...');

  const unlinkedMatches = [];
  let offset = 0;
  const PAGE_SIZE = 1000;

  while (true) {
    const { data: batch, error } = await supabase
      .from('matches_v2')
      .select('id, source_match_key, source_platform, match_date')
      .is('league_id', null)
      .is('tournament_id', null)
      .not('source_match_key', 'is', null)
      .order('id')
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error('Error fetching matches:', error);
      process.exit(1);
    }

    if (!batch || batch.length === 0) break;
    unlinkedMatches.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  console.log(`  Found ${unlinkedMatches.length} unlinked matches with source_match_key`);

  // Separate by platform
  const htgMatches = unlinkedMatches.filter(m => m.source_platform === 'htgsports');
  const heartlandMatches = unlinkedMatches.filter(m => m.source_platform === 'heartland');

  console.log(`    HTGSports: ${htgMatches.length}`);
  console.log(`    Heartland: ${heartlandMatches.length}`);

  // ============================================================
  // STEP 2: Process HTGSports matches
  // ============================================================
  console.log('\nStep 2: Processing HTGSports matches...');

  // Extract event IDs, match IDs, and track dates for each event
  const htgEventData = new Map();
  for (const m of htgMatches) {
    const match = m.source_match_key?.match(/^htg-(\d+)-/);
    if (match) {
      const eventId = match[1];
      if (!htgEventData.has(eventId)) {
        htgEventData.set(eventId, { matchIds: [], dates: [] });
      }
      htgEventData.get(eventId).matchIds.push(m.id);
      if (m.match_date) {
        htgEventData.get(eventId).dates.push(m.match_date);
      }
    }
  }

  // Alias for backward compatibility
  const htgEventCounts = new Map();
  for (const [eventId, data] of htgEventData) {
    htgEventCounts.set(eventId, data.matchIds);
  }

  console.log(`  Found ${htgEventCounts.size} distinct HTGSports events`);

  // Load existing tournaments with htgsports source
  const { data: existingTournaments } = await supabase
    .from('tournaments')
    .select('id, name, source_event_id')
    .eq('source_platform', 'htgsports');

  const tournamentByEventId = new Map();
  for (const t of existingTournaments || []) {
    if (t.source_event_id) {
      tournamentByEventId.set(t.source_event_id, t);
    }
  }

  console.log(`  ${tournamentByEventId.size} existing htgsports tournaments in DB`);

  // Get event names from staging_games for events we need
  const eventNamesFromStaging = new Map();
  for (const eventId of htgEventCounts.keys()) {
    if (!tournamentByEventId.has(eventId)) {
      // Need to find name from staging
      const { data: stagingSample } = await supabase
        .from('staging_games')
        .select('event_name')
        .like('source_match_key', `htg-${eventId}-%`)
        .not('event_name', 'is', null)
        .limit(1);

      if (stagingSample?.[0]?.event_name) {
        eventNamesFromStaging.set(eventId, stagingSample[0].event_name);
      }
    }
  }

  console.log(`  Found ${eventNamesFromStaging.size} event names from staging`);

  // Create missing tournaments
  const eventsNeedingCreation = [];
  for (const [eventId, matchIds] of htgEventCounts) {
    if (!tournamentByEventId.has(eventId)) {
      const name = eventNamesFromStaging.get(eventId) || `HTGSports Event ${eventId}`;
      const eventData = htgEventData.get(eventId);
      const sortedDates = eventData.dates.sort();
      const startDate = sortedDates[0] || '2024-01-01';
      const endDate = sortedDates[sortedDates.length - 1] || startDate;

      eventsNeedingCreation.push({
        eventId,
        name,
        matchCount: matchIds.length,
        startDate,
        endDate
      });
    }
  }

  if (eventsNeedingCreation.length > 0) {
    console.log(`\n  Creating ${eventsNeedingCreation.length} missing tournaments:`);

    for (const evt of eventsNeedingCreation) {
      console.log(`    - ${evt.eventId}: "${evt.name}" (${evt.matchCount} matches, ${evt.startDate} to ${evt.endDate})`);

      if (!DRY_RUN) {
        const { data: newTournament, error } = await supabase
          .from('tournaments')
          .insert({
            name: evt.name,
            source_platform: 'htgsports',
            source_event_id: evt.eventId,
            start_date: evt.startDate,
            end_date: evt.endDate
          })
          .select('id, name, source_event_id')
          .single();

        if (error) {
          console.error(`      Error creating: ${error.message}`);
        } else {
          tournamentByEventId.set(evt.eventId, newTournament);
          console.log(`      ✓ Created: ${newTournament.id}`);
        }
      }
    }
  }

  // Link HTGSports matches
  let htgLinked = 0;
  console.log('\n  Linking HTGSports matches to tournaments...');

  for (const [eventId, matchIds] of htgEventCounts) {
    const tournament = tournamentByEventId.get(eventId);
    if (!tournament) {
      console.log(`    Skipping event ${eventId} - no tournament found`);
      continue;
    }

    if (DRY_RUN) {
      console.log(`    [DRY RUN] Would link ${matchIds.length} matches to "${tournament.name}"`);
      htgLinked += matchIds.length;
    } else {
      // Batch update
      const BATCH_SIZE = 100;
      for (let i = 0; i < matchIds.length; i += BATCH_SIZE) {
        const batch = matchIds.slice(i, i + BATCH_SIZE);
        const { error } = await supabase
          .from('matches_v2')
          .update({ tournament_id: tournament.id })
          .in('id', batch);

        if (error) {
          console.error(`    Error updating batch: ${error.message}`);
        } else {
          htgLinked += batch.length;
        }
      }
      console.log(`    ✓ Linked ${matchIds.length} matches to "${tournament.name}"`);
    }
  }

  // ============================================================
  // STEP 3: Process Heartland matches
  // ============================================================
  console.log('\nStep 3: Processing Heartland matches...');

  // Extract league type and year from keys
  // Format: heartland-{type}-{team1}-{team2}-{YYYY-MM-DD}-{hash}
  const heartlandGroups = new Map();

  for (const m of heartlandMatches) {
    // Extract type (premier/recreational) from key
    const typeMatch = m.source_match_key?.match(/^heartland-(\w+)-/);
    if (!typeMatch) continue;

    const type = typeMatch[1]; // "premier" or "recreational"
    const year = m.match_date?.split('-')[0]; // Get year from match_date

    if (!type || !year) continue;

    const groupKey = `${type}-${year}`;
    if (!heartlandGroups.has(groupKey)) {
      heartlandGroups.set(groupKey, { type, year, matchIds: [] });
    }
    heartlandGroups.get(groupKey).matchIds.push(m.id);
  }

  console.log(`  Found ${heartlandGroups.size} distinct Heartland league groups`);

  // Load Heartland leagues
  const { data: heartlandLeagues } = await supabase
    .from('leagues')
    .select('id, name')
    .ilike('name', '%heartland%');

  // Build name -> id map
  const heartlandLeagueMap = new Map();
  for (const l of heartlandLeagues || []) {
    heartlandLeagueMap.set(l.name.toLowerCase(), l.id);
  }

  console.log(`  ${heartlandLeagueMap.size} Heartland leagues in DB`);

  // Link Heartland matches
  let heartlandLinked = 0;

  for (const [groupKey, group] of heartlandGroups) {
    // Try to find matching league
    // Possible names: "Heartland Premier League 2026", "Heartland Recreational League 2026"
    const typeCapitalized = group.type.charAt(0).toUpperCase() + group.type.slice(1);
    const expectedName = `Heartland ${typeCapitalized} League ${group.year}`;
    const leagueId = heartlandLeagueMap.get(expectedName.toLowerCase());

    if (!leagueId) {
      console.log(`    ⚠ No league found for "${expectedName}" (${group.matchIds.length} matches)`);

      // Try to create it
      if (!DRY_RUN) {
        const { data: newLeague, error } = await supabase
          .from('leagues')
          .insert({
            name: expectedName,
            source_platform: 'heartland'
          })
          .select('id, name')
          .single();

        if (!error && newLeague) {
          console.log(`      ✓ Created league: ${expectedName}`);
          heartlandLeagueMap.set(expectedName.toLowerCase(), newLeague.id);

          // Now link the matches
          const BATCH_SIZE = 100;
          for (let i = 0; i < group.matchIds.length; i += BATCH_SIZE) {
            const batch = group.matchIds.slice(i, i + BATCH_SIZE);
            await supabase
              .from('matches_v2')
              .update({ league_id: newLeague.id })
              .in('id', batch);
            heartlandLinked += batch.length;
          }
          console.log(`      ✓ Linked ${group.matchIds.length} matches`);
        }
      }
      continue;
    }

    if (DRY_RUN) {
      console.log(`    [DRY RUN] Would link ${group.matchIds.length} matches to "${expectedName}"`);
      heartlandLinked += group.matchIds.length;
    } else {
      // Batch update
      const BATCH_SIZE = 100;
      for (let i = 0; i < group.matchIds.length; i += BATCH_SIZE) {
        const batch = group.matchIds.slice(i, i + BATCH_SIZE);
        const { error } = await supabase
          .from('matches_v2')
          .update({ league_id: leagueId })
          .in('id', batch);

        if (error) {
          console.error(`    Error updating batch: ${error.message}`);
        } else {
          heartlandLinked += batch.length;
        }
      }
      console.log(`    ✓ Linked ${group.matchIds.length} matches to "${expectedName}"`);
    }
  }

  // ============================================================
  // STEP 4: Refresh views
  // ============================================================
  if (!DRY_RUN && (htgLinked > 0 || heartlandLinked > 0)) {
    console.log('\nStep 4: Refreshing materialized views...');
    const { error: refreshError } = await supabase.rpc('refresh_app_views');
    if (refreshError) {
      console.log('  ⚠ Could not refresh views:', refreshError.message);
    } else {
      console.log('  ✓ Views refreshed');
    }
  }

  // ============================================================
  // Summary
  // ============================================================
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`HTGSports events:     ${htgEventCounts.size}`);
  console.log(`HTGSports linked:     ${htgLinked}`);
  console.log(`Heartland groups:     ${heartlandGroups.size}`);
  console.log(`Heartland linked:     ${heartlandLinked}`);
  console.log(`Total linked:         ${htgLinked + heartlandLinked}`);
  console.log(`Execution time:       ${elapsed}s`);
  console.log('='.repeat(60));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
