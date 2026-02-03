/**
 * linkUnlinkedMatches.js
 *
 * Fixes data quality issue where matches in matches_v2 have NULL league_id AND tournament_id.
 * Uses source_match_key to join back to staging_games and recover event linkage.
 *
 * APPROACH (optimized for speed + accuracy):
 * 1. Single join: matches_v2.source_match_key → staging_games.source_match_key
 * 2. Get event_name from staging_games
 * 3. Lookup event UUID from leagues/tournaments tables (or create if missing)
 * 4. Batch UPDATE for maximum speed
 * 5. Refresh materialized views
 *
 * Usage: node scripts/maintenance/linkUnlinkedMatches.js [--dry-run]
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
  console.log('LINK UNLINKED MATCHES - Data Quality Fix');
  console.log('='.repeat(60));
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE'}`);
  console.log('');

  const startTime = Date.now();
  const client = await pool.connect();

  // Authorize writes to protected tables
  await authorizePipelineWrite(client);

  try {
    // ============================================================
    // STEP 1: Find unlinked matches with source_match_key
    // ============================================================
    console.log('Step 1: Finding unlinked matches with source_match_key...');

    const { rows: unlinkedMatches } = await client.query(`
      SELECT id, source_match_key
      FROM matches_v2
      WHERE league_id IS NULL
        AND tournament_id IS NULL
        AND source_match_key IS NOT NULL
      ORDER BY id
    `);

    console.log(`  Found ${unlinkedMatches.length} unlinked matches with source_match_key`);

    if (unlinkedMatches.length === 0) {
      console.log('\n✅ No unlinked matches found!');
      return;
    }

    // ============================================================
    // STEP 2: Load all staging_games with event info
    // ============================================================
    console.log('\nStep 2: Loading staging_games with event info...');

    const { rows: stagingGames } = await client.query(`
      SELECT source_match_key, event_name, event_id
      FROM staging_games
      WHERE event_name IS NOT NULL
        AND source_match_key IS NOT NULL
    `);

    const stagingMap = new Map();
    for (const sg of stagingGames) {
      stagingMap.set(sg.source_match_key, sg);
    }

    console.log(`  Total staging games with event info: ${stagingMap.size}`);

    // Count how many unlinked matches have staging records
    const uniqueKeys = [...new Set(unlinkedMatches.map(m => m.source_match_key))];
    const matchedKeys = uniqueKeys.filter(k => stagingMap.has(k));
    console.log(`  Unlinked matches in staging: ${matchedKeys.length} of ${uniqueKeys.length}`);

    // ============================================================
    // STEP 3: Build event lookup and create missing events
    // ============================================================
    console.log('\nStep 3: Building event lookup...');

    const { rows: leagues } = await client.query(`SELECT id, name FROM leagues`);
    const { rows: tournaments } = await client.query(`SELECT id, name FROM tournaments`);

    // Build name -> UUID lookup maps (case-insensitive, trimmed)
    const leagueNameToId = new Map();
    const tournamentNameToId = new Map();

    for (const l of leagues || []) {
      leagueNameToId.set(l.name?.toLowerCase().trim(), l.id);
    }
    for (const t of tournaments || []) {
      tournamentNameToId.set(t.name?.toLowerCase().trim(), t.id);
    }

    console.log(`  ${leagueNameToId.size} leagues, ${tournamentNameToId.size} tournaments in database`);

    // Find unique event names from staging that need lookup
    const eventNames = new Set();
    for (const sg of stagingMap.values()) {
      if (sg.event_name) {
        eventNames.add(sg.event_name);
      }
    }

    // Find missing events
    const missingEvents = [];
    for (const name of eventNames) {
      const nameLower = name.toLowerCase().trim();
      if (!leagueNameToId.has(nameLower) && !tournamentNameToId.has(nameLower)) {
        missingEvents.push(name);
      }
    }

    if (missingEvents.length > 0) {
      console.log(`  ⚠️  Found ${missingEvents.length} events not in leagues/tournaments`);

      if (!DRY_RUN) {
        console.log('  Creating missing events...');
        let created = 0;

        for (const eventName of missingEvents) {
          // Determine if it's likely a league or tournament based on name
          const isLeague = /league|season|fall|spring|winter|division/i.test(eventName) &&
                           !/cup|invitational|classic|showcase|tournament|memorial|challenge/i.test(eventName);

          if (isLeague) {
            const { rows } = await client.query(`
              INSERT INTO leagues (name, source_platform)
              VALUES ($1, 'data_fix')
              RETURNING id, name
            `, [eventName]);

            if (rows.length > 0) {
              leagueNameToId.set(eventName.toLowerCase().trim(), rows[0].id);
              created++;
            }
          } else {
            const { rows } = await client.query(`
              INSERT INTO tournaments (name, source_platform)
              VALUES ($1, 'data_fix')
              RETURNING id, name
            `, [eventName]);

            if (rows.length > 0) {
              tournamentNameToId.set(eventName.toLowerCase().trim(), rows[0].id);
              created++;
            }
          }
        }

        console.log(`  ✅ Created ${created} new events`);
      } else {
        console.log('  [DRY RUN] Would create these events:');
        missingEvents.slice(0, 5).forEach(name => {
          const isLeague = /league|season|fall|spring|winter|division/i.test(name) &&
                           !/cup|invitational|classic|showcase|tournament|memorial|challenge/i.test(name);
          console.log(`    - ${name} (as ${isLeague ? 'league' : 'tournament'})`);
        });
        if (missingEvents.length > 5) {
          console.log(`    ... and ${missingEvents.length - 5} more`);
        }
      }
    }

    // ============================================================
    // STEP 4: Build update list
    // ============================================================
    console.log('\nStep 4: Building update list...');

    const matchesToUpdate = [];

    for (const match of unlinkedMatches) {
      const staging = stagingMap.get(match.source_match_key);

      if (!staging || !staging.event_name) {
        continue;
      }

      const eventNameLower = staging.event_name.toLowerCase().trim();
      const leagueUuid = leagueNameToId.get(eventNameLower);
      const tournamentUuid = tournamentNameToId.get(eventNameLower);

      if (leagueUuid || tournamentUuid) {
        matchesToUpdate.push({
          match_id: match.id,
          event_id: leagueUuid || tournamentUuid,
          event_type: leagueUuid ? 'league' : 'tournament',
          event_name: staging.event_name
        });
      }
    }

    const leagueUpdates = matchesToUpdate.filter(m => m.event_type === 'league');
    const tournamentUpdates = matchesToUpdate.filter(m => m.event_type === 'tournament');

    console.log(`  Matched ${matchesToUpdate.length} of ${unlinkedMatches.length} matches`);
    console.log(`    - To leagues: ${leagueUpdates.length}`);
    console.log(`    - To tournaments: ${tournamentUpdates.length}`);

    if (matchesToUpdate.length === 0) {
      console.log('\n⚠️  No matches could be linked to events.');
      return;
    }

    // ============================================================
    // STEP 5: Batch update matches_v2
    // ============================================================
    console.log('\nStep 5: Updating matches_v2...');

    if (DRY_RUN) {
      console.log('\n[DRY RUN] Would update:');
      leagueUpdates.slice(0, 5).forEach(u => {
        console.log(`    League: ${u.event_name} -> match ${u.match_id.slice(0, 8)}...`);
      });
      if (leagueUpdates.length > 5) console.log(`    ... and ${leagueUpdates.length - 5} more`);

      tournamentUpdates.slice(0, 5).forEach(u => {
        console.log(`    Tournament: ${u.event_name} -> match ${u.match_id.slice(0, 8)}...`);
      });
      if (tournamentUpdates.length > 5) console.log(`    ... and ${tournamentUpdates.length - 5} more`);
    } else {
      let updatedCount = 0;

      // Update leagues in batches using CASE statement for speed
      if (leagueUpdates.length > 0) {
        const BATCH_SIZE = 1000;
        for (let i = 0; i < leagueUpdates.length; i += BATCH_SIZE) {
          const batch = leagueUpdates.slice(i, i + BATCH_SIZE);
          const ids = batch.map(u => u.match_id);

          // Group by event_id for more efficient updates
          const byEvent = new Map();
          for (const u of batch) {
            if (!byEvent.has(u.event_id)) byEvent.set(u.event_id, []);
            byEvent.get(u.event_id).push(u.match_id);
          }

          for (const [eventId, matchIds] of byEvent) {
            const result = await client.query(`
              UPDATE matches_v2
              SET league_id = $1, updated_at = NOW()
              WHERE id = ANY($2)
            `, [eventId, matchIds]);
            updatedCount += result.rowCount;
          }

          console.log(`    Leagues: ${Math.min(i + BATCH_SIZE, leagueUpdates.length)}/${leagueUpdates.length}`);
        }
      }

      // Update tournaments in batches
      if (tournamentUpdates.length > 0) {
        const BATCH_SIZE = 1000;
        for (let i = 0; i < tournamentUpdates.length; i += BATCH_SIZE) {
          const batch = tournamentUpdates.slice(i, i + BATCH_SIZE);

          // Group by event_id for more efficient updates
          const byEvent = new Map();
          for (const u of batch) {
            if (!byEvent.has(u.event_id)) byEvent.set(u.event_id, []);
            byEvent.get(u.event_id).push(u.match_id);
          }

          for (const [eventId, matchIds] of byEvent) {
            const result = await client.query(`
              UPDATE matches_v2
              SET tournament_id = $1, updated_at = NOW()
              WHERE id = ANY($2)
            `, [eventId, matchIds]);
            updatedCount += result.rowCount;
          }

          console.log(`    Tournaments: ${Math.min(i + BATCH_SIZE, tournamentUpdates.length)}/${tournamentUpdates.length}`);
        }
      }

      console.log(`  ✅ Updated ${updatedCount} matches`);
    }

    // ============================================================
    // STEP 6: Refresh materialized views
    // ============================================================
    if (!DRY_RUN && matchesToUpdate.length > 0) {
      console.log('\nStep 6: Refreshing materialized views...');

      try {
        await client.query('SELECT refresh_app_views()');
        console.log('  ✅ Materialized views refreshed');
      } catch (err) {
        console.log('  ⚠️  Could not refresh views:', err.message);
        console.log('     Run: SELECT refresh_app_views();');
      }
    }

    // ============================================================
    // Summary
    // ============================================================
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total unlinked matches:       ${unlinkedMatches.length}`);
    console.log(`Found in staging_games:       ${stagingMap.size}`);
    console.log(`Successfully matched:         ${matchesToUpdate.length}`);
    console.log(`  - To leagues:               ${leagueUpdates.length}`);
    console.log(`  - To tournaments:           ${tournamentUpdates.length}`);
    console.log(`Still unlinked:               ${unlinkedMatches.length - matchesToUpdate.length}`);
    console.log(`Execution time:               ${elapsed}s`);
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
