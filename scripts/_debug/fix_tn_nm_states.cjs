#!/usr/bin/env node
/**
 * Fix state metadata for TN and NM teams created by Session 115 scrapes.
 * Teams playing in TN/NM leagues get state='TN'/'NM'.
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  try {
    await pool.query('SELECT authorize_pipeline_write()');

    // Get TN league + tournament IDs
    const { rows: tnLeagues } = await pool.query("SELECT id FROM leagues WHERE state = 'TN'");
    const { rows: tnTourneys } = await pool.query("SELECT id FROM tournaments WHERE state = 'TN'");
    const tnEventIds = [...tnLeagues.map(l => l.id), ...tnTourneys.map(t => t.id)];
    console.log('TN events:', tnEventIds.length);

    // Fix TN teams
    const { rowCount: tnFix } = await pool.query(`
      UPDATE teams_v2 SET state = 'TN'
      WHERE (state = 'unknown' OR state IS NULL)
      AND id IN (
        SELECT DISTINCT unnest(ARRAY[home_team_id, away_team_id])
        FROM matches_v2
        WHERE deleted_at IS NULL
        AND (league_id = ANY($1) OR tournament_id = ANY($1))
      )
    `, [tnEventIds]);
    console.log('Fixed TN team states:', tnFix);

    // Get NM league IDs
    const { rows: nmLeagues } = await pool.query("SELECT id FROM leagues WHERE state = 'NM'");
    if (nmLeagues.length > 0) {
      const nmIds = nmLeagues.map(l => l.id);
      const { rowCount: nmFix } = await pool.query(`
        UPDATE teams_v2 SET state = 'NM'
        WHERE (state = 'unknown' OR state IS NULL)
        AND id IN (
          SELECT DISTINCT unnest(ARRAY[home_team_id, away_team_id])
          FROM matches_v2
          WHERE deleted_at IS NULL
          AND league_id = ANY($1)
        )
      `, [nmIds]);
      console.log('Fixed NM team states:', nmFix);
    }

    // Verify
    const { rows: [tn] } = await pool.query("SELECT COUNT(*) as cnt FROM teams_v2 WHERE state = 'TN'");
    const { rows: [nm] } = await pool.query("SELECT COUNT(*) as cnt FROM teams_v2 WHERE state = 'NM'");
    console.log('\nFinal: TN teams:', tn.cnt, '| NM teams:', nm.cnt);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
})();
