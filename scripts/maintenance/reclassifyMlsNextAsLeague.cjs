/**
 * reclassifyMlsNextAsLeague.cjs
 *
 * Reclassifies "MLS NEXT 2025-26" from tournaments table to leagues table.
 * MLS Next is a season-long premier league (364 days, 9,795 matches), not a tournament.
 *
 * Steps:
 * 1. Create leagues record with metadata from tournament
 * 2. UPDATE all matches: SET league_id = new, tournament_id = NULL
 * 3. UPDATE source_entity_map entries
 * 4. UPDATE canonical_events entries
 * 5. DELETE old tournament record
 *
 * Usage: node scripts/maintenance/reclassifyMlsNextAsLeague.cjs [--dry-run]
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const DRY_RUN = process.argv.includes('--dry-run');
const TOURNAMENT_ID = 'a1a75f9c-5feb-43af-b6ee-75bf98235c71';

(async () => {
  const client = await pool.connect();
  try {
    console.log(`=== Reclassify MLS NEXT 2025-26: Tournament → League ===`);
    console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n`);

    // Step 0: Verify tournament exists and get metadata
    const { rows: [tourn] } = await client.query(
      'SELECT * FROM tournaments WHERE id = $1', [TOURNAMENT_ID]
    );
    if (!tourn) {
      console.log('❌ Tournament not found. Already reclassified?');
      return;
    }
    console.log(`Tournament: ${tourn.name}`);
    console.log(`  source_platform: ${tourn.source_platform}`);
    console.log(`  source_event_id: ${tourn.source_event_id}`);
    console.log(`  dates: ${tourn.start_date} to ${tourn.end_date}`);

    // Count matches
    const { rows: [{ cnt: matchCount }] } = await client.query(
      'SELECT COUNT(*) as cnt FROM matches_v2 WHERE tournament_id = $1 AND deleted_at IS NULL',
      [TOURNAMENT_ID]
    );
    console.log(`  matches: ${matchCount}\n`);

    if (DRY_RUN) {
      console.log('🔍 DRY RUN — no changes made.');
      return;
    }

    await client.query('BEGIN');

    // Authorize pipeline write (bypass write protection trigger)
    await client.query('SELECT authorize_pipeline_write()');

    // Step 1: Get current season
    const { rows: [season] } = await client.query(
      "SELECT id FROM seasons WHERE is_current = true LIMIT 1"
    );

    // Step 2: Create league record (use same UUID so FKs work without re-pointing)
    // Actually we can't reuse UUID since leagues/tournaments are different tables.
    // Create new league, then update matches.
    const { rows: [newLeague] } = await client.query(`
      INSERT INTO leagues (name, season_id, state, source_platform, source_event_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, name
    `, [tourn.name, season?.id || null, tourn.state, tourn.source_platform, tourn.source_event_id]);

    console.log(`✅ Created league: ${newLeague.name} (${newLeague.id})`);

    // Step 3: Update all matches
    const { rowCount: matchesUpdated } = await client.query(`
      UPDATE matches_v2
      SET league_id = $1, tournament_id = NULL
      WHERE tournament_id = $2 AND deleted_at IS NULL
    `, [newLeague.id, TOURNAMENT_ID]);
    console.log(`✅ Updated ${matchesUpdated} matches: tournament_id → league_id`);

    // Step 4: Update source_entity_map (change entity_type from tournament to league)
    const { rowCount: semUpdated } = await client.query(`
      UPDATE source_entity_map
      SET entity_type = 'league', sv_id = $1
      WHERE sv_id = $2 AND entity_type = 'tournament'
    `, [newLeague.id, TOURNAMENT_ID]);
    console.log(`✅ Updated ${semUpdated} source_entity_map entries`);

    // Step 5: Update canonical_events if any reference this tournament
    const { rowCount: ceUpdated } = await client.query(`
      UPDATE canonical_events
      SET tournament_id = NULL
      WHERE tournament_id = $1
    `, [TOURNAMENT_ID]);
    if (ceUpdated > 0) console.log(`✅ Updated ${ceUpdated} canonical_events entries`);

    // Step 6: Delete old tournament record
    const { rowCount: deleted } = await client.query(
      'DELETE FROM tournaments WHERE id = $1', [TOURNAMENT_ID]
    );
    console.log(`✅ Deleted tournament record (${deleted} row)`);

    await client.query('COMMIT');

    console.log(`\n=== DONE ===`);
    console.log(`MLS NEXT 2025-26 is now a league (${newLeague.id})`);
    console.log(`${matchesUpdated} matches reclassified`);
    console.log(`\nNext: Refresh views with node scripts/maintenance/refresh_views_manual.js`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
})();
