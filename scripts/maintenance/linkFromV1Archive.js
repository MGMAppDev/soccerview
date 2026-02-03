/**
 * linkFromV1Archive.js
 *
 * Links legacy gotsport matches in matches_v2 by joining to V1 archived data.
 *
 * APPROACH:
 * 1. Load V1 match_results_deprecated (has event_id, event_name)
 * 2. Load V2 legacy matches (no league/tournament linkage)
 * 3. Join by: match_date + home_team_id + away_team_id (or swapped)
 * 4. Get event_id and event_name from V1
 * 5. Create/lookup league or tournament in V2
 * 6. Update matches_v2 with the linkage
 *
 * Usage: node scripts/maintenance/linkFromV1Archive.js [--dry-run]
 *
 * V2 ARCHITECTURE: Uses pg Pool with proper authorization for write protection.
 */

import pg from 'pg';
import 'dotenv/config';
import { authorizePipelineWrite } from '../universal/pipelineAuth.js';

const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log('='.repeat(60));
  console.log('LINK LEGACY MATCHES FROM V1 ARCHIVE');
  console.log('='.repeat(60));
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log('');

  const startTime = Date.now();
  const client = await pool.connect();

  // Authorize writes to protected tables
  await authorizePipelineWrite(client);

  try {
    // ============================================================
    // STEP 1: Load V1 archived matches
    // ============================================================
    console.log('Step 1: Loading V1 archived matches...');

    const { rows: v1Data } = await client.query(`
      SELECT match_date, home_team_id, away_team_id, event_id, event_name, source_type
      FROM match_results_deprecated
      WHERE match_date IS NOT NULL
        AND home_team_id IS NOT NULL
        AND away_team_id IS NOT NULL
        AND event_id IS NOT NULL
    `);

    // Build lookup map
    const v1Matches = new Map(); // Key: "date|home|away" -> {eventId, eventName, sourceType}
    for (const m of v1Data) {
      // Create both key variants (in case teams are swapped)
      const key1 = `${m.match_date}|${m.home_team_id}|${m.away_team_id}`;
      const key2 = `${m.match_date}|${m.away_team_id}|${m.home_team_id}`;

      if (!v1Matches.has(key1)) {
        v1Matches.set(key1, {
          eventId: m.event_id,
          eventName: m.event_name,
          sourceType: m.source_type
        });
      }
      if (!v1Matches.has(key2)) {
        v1Matches.set(key2, {
          eventId: m.event_id,
          eventName: m.event_name,
          sourceType: m.source_type
        });
      }
    }

    console.log(`  Total V1 matches indexed: ${v1Matches.size / 2} (both key variants)`);

    // ============================================================
    // STEP 2: Load V2 legacy matches
    // ============================================================
    console.log('\nStep 2: Loading V2 legacy gotsport matches...');

    const { rows: v2Matches } = await client.query(`
      SELECT id, match_date, home_team_id, away_team_id
      FROM matches_v2
      WHERE league_id IS NULL
        AND tournament_id IS NULL
        AND source_platform = 'gotsport'
        AND source_match_key IS NULL
    `);

    console.log(`  Total V2 legacy matches: ${v2Matches.length}`);

    // ============================================================
    // STEP 3: Match V2 to V1 and collect event info
    // ============================================================
    console.log('\nStep 3: Matching V2 to V1...');

    const matchedMatches = []; // {matchId, eventId, eventName, sourceType}
    let notFound = 0;

    for (const m of v2Matches) {
      const key = `${m.match_date}|${m.home_team_id}|${m.away_team_id}`;
      const v1Info = v1Matches.get(key);

      if (v1Info) {
        matchedMatches.push({
          matchId: m.id,
          eventId: v1Info.eventId,
          eventName: v1Info.eventName,
          sourceType: v1Info.sourceType
        });
      } else {
        notFound++;
      }
    }

    console.log(`  Matched: ${matchedMatches.length}`);
    console.log(`  Not found in V1: ${notFound}`);

    if (matchedMatches.length === 0) {
      console.log('\n⚠️ No matches could be linked.');
      return;
    }

    // ============================================================
    // STEP 4: Group by event and create/lookup events
    // ============================================================
    console.log('\nStep 4: Grouping by event...');

    const byEvent = new Map(); // eventId -> {eventName, sourceType, matchIds[]}
    for (const m of matchedMatches) {
      if (!byEvent.has(m.eventId)) {
        byEvent.set(m.eventId, {
          eventName: m.eventName,
          sourceType: m.sourceType,
          matchIds: []
        });
      }
      byEvent.get(m.eventId).matchIds.push(m.matchId);
    }

    console.log(`  Unique events: ${byEvent.size}`);

    // Show top events
    const sortedEvents = [...byEvent.entries()].sort((a, b) => b[1].matchIds.length - a[1].matchIds.length);
    console.log('\n  Top 10 events by match count:');
    sortedEvents.slice(0, 10).forEach(([id, data]) => {
      console.log(`    ${id}: "${data.eventName}" (${data.matchIds.length} matches)`);
    });

    // ============================================================
    // STEP 5: Create/lookup events in V2 and update matches
    // ============================================================
    console.log('\nStep 5: Creating/looking up events and updating matches...');

    // Load existing leagues and tournaments
    const { rows: existingLeagues } = await client.query(`SELECT id, name FROM leagues`);
    const { rows: existingTournaments } = await client.query(`SELECT id, name, source_event_id FROM tournaments`);

    const leagueByName = new Map();
    const tournamentByEventId = new Map();
    const tournamentByName = new Map();

    for (const l of existingLeagues || []) {
      leagueByName.set(l.name?.toLowerCase().trim(), l.id);
    }
    for (const t of existingTournaments || []) {
      if (t.source_event_id) tournamentByEventId.set(t.source_event_id, t.id);
      tournamentByName.set(t.name?.toLowerCase().trim(), t.id);
    }

    let updatedCount = 0;
    let createdEvents = 0;

    for (const [eventId, eventData] of byEvent) {
      // Clean up event name - use event ID if null/empty/generic
      let eventName = eventData.eventName;
      if (!eventName || eventName === 'null' || eventName === 'GotSport' || eventName.trim() === '') {
        eventName = `GotSport Event ${eventId}`;
      }

      // Determine if league or tournament based on source_type or name
      const isLeague = /league|season|fall|spring|winter|summer/i.test(eventName) &&
                       !/cup|invitational|classic|showcase|tournament|memorial|challenge/i.test(eventName);

      let targetId = null;
      let targetType = null;

      // Try to find existing event
      if (isLeague) {
        targetId = leagueByName.get(eventName?.toLowerCase().trim());
        targetType = 'league';
      } else {
        targetId = tournamentByEventId.get(eventId) || tournamentByName.get(eventName?.toLowerCase().trim());
        targetType = 'tournament';
      }

      // Create if not found
      if (!targetId && !DRY_RUN) {
        if (isLeague) {
          const { rows } = await client.query(`
            INSERT INTO leagues (name, source_platform)
            VALUES ($1, 'gotsport')
            RETURNING id
          `, [eventName]);

          if (rows.length > 0) {
            targetId = rows[0].id;
            leagueByName.set(eventName?.toLowerCase().trim(), targetId);
            createdEvents++;
          }
        } else {
          const { rows } = await client.query(`
            INSERT INTO tournaments (name, source_platform, source_event_id, start_date, end_date)
            VALUES ($1, 'gotsport', $2, '2024-01-01', '2024-12-31')
            RETURNING id
          `, [eventName, eventId]);

          if (rows.length > 0) {
            targetId = rows[0].id;
            tournamentByEventId.set(eventId, targetId);
            createdEvents++;
          }
        }
      }

      if (!targetId) {
        if (DRY_RUN) {
          console.log(`  [DRY RUN] Would create ${targetType}: "${eventName}" and link ${eventData.matchIds.length} matches`);
          updatedCount += eventData.matchIds.length;
        }
        continue;
      }

      // Update matches
      if (!DRY_RUN) {
        const field = targetType === 'league' ? 'league_id' : 'tournament_id';

        const result = await client.query(`
          UPDATE matches_v2
          SET ${field} = $1, updated_at = NOW()
          WHERE id = ANY($2)
        `, [targetId, eventData.matchIds]);

        updatedCount += result.rowCount;
      }
    }

    // ============================================================
    // STEP 6: Refresh views
    // ============================================================
    if (!DRY_RUN && updatedCount > 0) {
      console.log('\nStep 6: Refreshing views...');
      try {
        await client.query('SELECT refresh_app_views()');
        console.log('  ✓ Views refreshed');
      } catch (err) {
        console.log('  ⚠️ Could not refresh:', err.message);
      }
    }

    // ============================================================
    // Summary
    // ============================================================
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log(`V1 matches indexed:     ${v1Matches.size / 2}`);
    console.log(`V2 legacy matches:      ${v2Matches.length}`);
    console.log(`Matched to V1:          ${matchedMatches.length} (${(matchedMatches.length / v2Matches.length * 100).toFixed(1)}%)`);
    console.log(`Unique events:          ${byEvent.size}`);
    console.log(`Events created:         ${createdEvents}`);
    console.log(`Matches updated:        ${updatedCount}`);
    console.log(`Still unlinked:         ${v2Matches.length - updatedCount}`);
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
