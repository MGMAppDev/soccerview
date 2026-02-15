/**
 * Fix NC League Records
 * =====================
 * fastProcessStaging.cjs created NC events as tournaments instead of leagues.
 * This script:
 * 1. Creates proper league records with correct source_event_id
 * 2. Moves matches from tournament_id to league_id
 * 3. Registers in source_entity_map (both match scraper + standings scraper formats)
 * 4. Cleans up orphaned tournament records
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const NCFL_TOURNAMENT_ID = '47a0ea10-9c9a-4d36-9d1d-59367b937cb3';
const NCCSL_TOURNAMENT_ID = '7d454092-3de7-421c-aa17-5df5b97c87c3';
const DUP_LEAGUE_ID = '74e64d45-9347-4f47-a7cb-c97ddd2fc3d6'; // NC Classic Spring with NULL source_event_id

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Authorize pipeline write (bypass write protection trigger)
    await client.query('SELECT authorize_pipeline_write()');
    console.log('Pipeline write authorized');

    // Get current season
    const { rows: [season] } = await client.query("SELECT id FROM seasons WHERE is_current = true");
    const seasonId = season ? season.id : null;
    console.log('Current season:', seasonId);

    // ================================================
    // STEP 1: Create proper league records
    // ================================================
    console.log('\n=== STEP 1: Create league records ===');

    const { rows: [ncflLeague] } = await client.query(
      `INSERT INTO leagues (name, source_event_id, source_platform, state, season_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (name, season_id) DO UPDATE SET
         source_event_id = EXCLUDED.source_event_id,
         source_platform = EXCLUDED.source_platform,
         state = EXCLUDED.state
       RETURNING id`,
      ['NCYSA Fall Classic League', 'sincsports-ncfl-2025', 'sincsports', 'NC', seasonId]
    );
    console.log('NCFL league created/updated:', ncflLeague.id);

    const { rows: [nccslLeague] } = await client.query(
      `INSERT INTO leagues (name, source_event_id, source_platform, state, season_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (name, season_id) DO UPDATE SET
         source_event_id = EXCLUDED.source_event_id,
         source_platform = EXCLUDED.source_platform,
         state = EXCLUDED.state
       RETURNING id`,
      ['NC Classic Spring League', 'sincsports-nccsl-2025', 'sincsports', 'NC', seasonId]
    );
    console.log('NCCSL league created/updated:', nccslLeague.id);

    // ================================================
    // STEP 2: Move matches from tournament_id to league_id
    // ================================================
    console.log('\n=== STEP 2: Reassign matches ===');

    const { rowCount: ncflCount } = await client.query(
      `UPDATE matches_v2 SET league_id = $1, tournament_id = NULL
       WHERE tournament_id = $2 AND deleted_at IS NULL`,
      [ncflLeague.id, NCFL_TOURNAMENT_ID]
    );
    console.log('NCFL matches reassigned:', ncflCount);

    const { rowCount: nccslCount } = await client.query(
      `UPDATE matches_v2 SET league_id = $1, tournament_id = NULL
       WHERE tournament_id = $2 AND deleted_at IS NULL`,
      [nccslLeague.id, NCCSL_TOURNAMENT_ID]
    );
    console.log('NCCSL matches reassigned:', nccslCount);

    // ================================================
    // STEP 3: Register in source_entity_map
    // ================================================
    console.log('\n=== STEP 3: Register source_entity_map ===');

    const registrations = [
      // NCFL: match scraper uses 'NCFL', standings uses 'sincsports-ncfl-2025'
      ['league', 'sincsports', 'NCFL', ncflLeague.id],
      ['league', 'sincsports', 'sincsports-ncfl-2025', ncflLeague.id],
      // NCCSL: match scraper uses 'NCCSL', standings uses 'sincsports-nccsl-2025'
      ['league', 'sincsports', 'NCCSL', nccslLeague.id],
      ['league', 'sincsports', 'sincsports-nccsl-2025', nccslLeague.id],
    ];

    for (const [entityType, platform, sourceId, svId] of registrations) {
      await client.query(
        `INSERT INTO source_entity_map (entity_type, source_platform, source_entity_id, sv_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (entity_type, source_platform, source_entity_id) DO UPDATE SET sv_id = EXCLUDED.sv_id`,
        [entityType, platform, sourceId, svId]
      );
      console.log('  Registered:', sourceId, '→', svId);
    }

    // ================================================
    // STEP 4: Clean up orphaned records
    // ================================================
    console.log('\n=== STEP 4: Cleanup ===');

    // Check if tournaments still have any matches (including soft-deleted)
    for (const [name, tId] of [['NCFL', NCFL_TOURNAMENT_ID], ['NCCSL', NCCSL_TOURNAMENT_ID]]) {
      const { rows: [remain] } = await client.query(
        'SELECT COUNT(*) as cnt FROM matches_v2 WHERE tournament_id = $1', [tId]
      );
      console.log(name + ' tournament remaining matches:', remain.cnt);
      if (parseInt(remain.cnt) === 0) {
        await client.query('DELETE FROM tournaments WHERE id = $1', [tId]);
        console.log('  Deleted orphaned tournament');
      }
    }

    // Delete duplicate league (NC Classic Spring with NULL source_event_id)
    if (DUP_LEAGUE_ID !== nccslLeague.id) {
      const { rows: [dupCheck] } = await client.query(
        'SELECT COUNT(*) as cnt FROM matches_v2 WHERE league_id = $1', [DUP_LEAGUE_ID]
      );
      console.log('Duplicate league matches:', dupCheck.cnt);
      if (parseInt(dupCheck.cnt) === 0) {
        await client.query('DELETE FROM leagues WHERE id = $1', [DUP_LEAGUE_ID]);
        console.log('  Deleted duplicate league');
      }
    } else {
      console.log('NCCSL league reused the existing record - no deletion needed');
    }

    // ================================================
    // VERIFY
    // ================================================
    console.log('\n=== VERIFICATION ===');

    const { rows: verifyLeagues } = await client.query(
      "SELECT id, name, source_event_id, source_platform, state FROM leagues WHERE source_platform = 'sincsports'"
    );
    console.log('Sincsports leagues:', JSON.stringify(verifyLeagues, null, 2));

    const { rows: verifyMatches } = await client.query(
      "SELECT league_id, tournament_id, COUNT(*) as cnt FROM matches_v2 WHERE source_platform = 'sincsports' AND deleted_at IS NULL GROUP BY league_id, tournament_id"
    );
    console.log('Match assignments:', JSON.stringify(verifyMatches, null, 2));

    const { rows: verifySEM } = await client.query(
      "SELECT * FROM source_entity_map WHERE source_platform = 'sincsports' AND entity_type = 'league'"
    );
    console.log('source_entity_map:', JSON.stringify(verifySEM, null, 2));

    await client.query('COMMIT');
    console.log('\n✅ All changes committed successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error - rolled back:', err.message);
    console.error(err.stack);
  } finally {
    client.release();
    await pool.end();
  }
})();
