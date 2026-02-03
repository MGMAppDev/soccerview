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
 * Updated Session 79: Converted to pg Pool for V2 architecture compliance
 *
 * Usage: node scripts/maintenance/inferEventLinkage.js [--dry-run]
 */

import pg from 'pg';
import 'dotenv/config';
import { authorizePipelineWrite } from '../universal/pipelineAuth.js';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 100;

async function main() {
  console.log('='.repeat(60));
  console.log('INFER EVENT LINKAGE FOR ORPHANED MATCHES');
  console.log('='.repeat(60));
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log('');

  const startTime = Date.now();
  const client = await pool.connect();

  try {
    // V2 ARCHITECTURE ENFORCEMENT: Authorize pipeline writes (Session 79)
    await authorizePipelineWrite(client);

    // ============================================================
    // STEP 1: Load all unlinked matches
    // ============================================================
    console.log('Step 1: Loading unlinked matches...');

    const { rows: unlinkedMatches } = await client.query(`
      SELECT id, match_date, home_team_id, away_team_id
      FROM matches_v2
      WHERE league_id IS NULL
        AND tournament_id IS NULL
        AND home_team_id IS NOT NULL
        AND away_team_id IS NOT NULL
    `);

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

    // Bulk load all linked matches for these teams
    const { rows: linkedMatches } = await client.query(`
      SELECT
        CASE WHEN home_team_id = ANY($1::uuid[]) THEN home_team_id ELSE away_team_id END as team_id,
        league_id, tournament_id, match_date
      FROM matches_v2
      WHERE (home_team_id = ANY($1::uuid[]) OR away_team_id = ANY($1::uuid[]))
        AND (league_id IS NOT NULL OR tournament_id IS NOT NULL)
    `, [Array.from(teamIds)]);

    // Build team -> events map
    const teamEvents = new Map();

    for (const m of linkedMatches) {
      if (!teamEvents.has(m.team_id)) {
        teamEvents.set(m.team_id, new Map());
      }

      const eventKey = m.league_id ? `league:${m.league_id}` : `tournament:${m.tournament_id}`;
      const events = teamEvents.get(m.team_id);

      if (!events.has(eventKey)) {
        events.set(eventKey, {
          type: m.league_id ? 'league' : 'tournament',
          id: m.league_id || m.tournament_id,
          dates: []
        });
      }

      if (m.match_date) {
        events.get(eventKey).dates.push(m.match_date);
      }
    }

    // Convert to final format with date ranges
    const teamEventsFormatted = new Map();
    for (const [teamId, events] of teamEvents) {
      const eventList = [];
      for (const [key, eventData] of events) {
        if (eventData.dates.length > 0) {
          eventData.dates.sort();
          eventList.push({
            type: eventData.type,
            id: eventData.id,
            minDate: eventData.dates[0],
            maxDate: eventData.dates[eventData.dates.length - 1]
          });
        }
      }
      if (eventList.length > 0) {
        teamEventsFormatted.set(teamId, eventList);
      }
    }

    console.log(`  Teams with event history: ${teamEventsFormatted.size}`);

    // ============================================================
    // STEP 3: Infer event for each unlinked match
    // ============================================================
    console.log('\nStep 3: Inferring events for unlinked matches...');

    const toLink = [];
    let noCommonEvent = 0;
    let noEventHistory = 0;

    for (const match of unlinkedMatches) {
      const homeEvents = teamEventsFormatted.get(match.home_team_id) || [];
      const awayEvents = teamEventsFormatted.get(match.away_team_id) || [];

      if (homeEvents.length === 0 && awayEvents.length === 0) {
        noEventHistory++;
        continue;
      }

      // Find common events between home and away team
      const commonEvents = [];
      for (const homeEvent of homeEvents) {
        for (const awayEvent of awayEvents) {
          if (homeEvent.type === awayEvent.type && homeEvent.id === awayEvent.id) {
            const minDate = homeEvent.minDate < awayEvent.minDate ? homeEvent.minDate : awayEvent.minDate;
            const maxDate = homeEvent.maxDate > awayEvent.maxDate ? homeEvent.maxDate : awayEvent.maxDate;

            // Extend range by 30 days on each side
            const extendedMin = new Date(new Date(minDate).getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
            const extendedMax = new Date(new Date(maxDate).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

            const matchDate = match.match_date instanceof Date
              ? match.match_date.toISOString().slice(0, 10)
              : match.match_date;

            if (matchDate >= extendedMin && matchDate <= extendedMax) {
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
        // Try single-team inference
        const singleTeamEvents = homeEvents.length > 0 ? homeEvents : awayEvents;
        if (singleTeamEvents.length === 1) {
          const event = singleTeamEvents[0];
          const extendedMin = new Date(new Date(event.minDate).getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
          const extendedMax = new Date(new Date(event.maxDate).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

          const matchDate = match.match_date instanceof Date
            ? match.match_date.toISOString().slice(0, 10)
            : match.match_date;

          if (matchDate >= extendedMin && matchDate <= extendedMax) {
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

      // Pick event with most matches
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

    const leagueUpdates = toLink.filter(l => l.eventType === 'league');
    const tournamentUpdates = toLink.filter(l => l.eventType === 'tournament');

    console.log(`  League updates: ${leagueUpdates.length}`);
    console.log(`  Tournament updates: ${tournamentUpdates.length}`);

    let updated = 0;

    if (!DRY_RUN) {
      // Bulk update league matches
      if (leagueUpdates.length > 0) {
        const caseStatements = leagueUpdates.map(u =>
          `WHEN '${u.matchId}'::uuid THEN '${u.eventId}'::uuid`
        ).join('\n          ');

        const matchIds = leagueUpdates.map(u => `'${u.matchId}'::uuid`).join(', ');

        await client.query(`
          UPDATE matches_v2
          SET league_id = CASE id
          ${caseStatements}
          END
          WHERE id IN (${matchIds})
        `);

        updated += leagueUpdates.length;
      }

      // Bulk update tournament matches
      if (tournamentUpdates.length > 0) {
        const caseStatements = tournamentUpdates.map(u =>
          `WHEN '${u.matchId}'::uuid THEN '${u.eventId}'::uuid`
        ).join('\n          ');

        const matchIds = tournamentUpdates.map(u => `'${u.matchId}'::uuid`).join(', ');

        await client.query(`
          UPDATE matches_v2
          SET tournament_id = CASE id
          ${caseStatements}
          END
          WHERE id IN (${matchIds})
        `);

        updated += tournamentUpdates.length;
      }

      console.log(`  Updated: ${updated} matches`);

      // Refresh views if we made updates
      if (updated > 0) {
        console.log('\nRefreshing views...');
        try {
          await client.query('SELECT refresh_app_views()');
          console.log('  Views refreshed');
        } catch (err) {
          console.log(`  Warning: Could not refresh views: ${err.message}`);
        }
      }
    } else {
      console.log(`  [DRY RUN] Would update ${toLink.length} matches`);

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
    console.log(`Teams with history:     ${teamEventsFormatted.size}`);
    console.log(`Matches inferred:       ${toLink.length}`);
    console.log(`Matches updated:        ${DRY_RUN ? '(dry run)' : updated}`);
    console.log(`Still unlinked:         ${unlinkedMatches.length - (DRY_RUN ? toLink.length : updated)}`);
    console.log(`Execution time:         ${elapsed}s`);
    console.log('='.repeat(60));

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
