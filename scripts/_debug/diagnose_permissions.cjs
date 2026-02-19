#!/usr/bin/env node
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  // Check real permissions on materialized views (pg_class, not information_schema)
  const { rows } = await pool.query(
    "SELECT relname, relacl::text FROM pg_class WHERE relname LIKE 'app_%' AND relkind = 'm' ORDER BY relname"
  );
  console.log('Materialized view permissions (pg_class):');
  rows.forEach(r => console.log(' ', r.relname, ':', r.relacl || 'NO ACL (uses default)'));

  // Check when teams_v2 was last updated
  const { rows: lastElo } = await pool.query(
    "SELECT MAX(updated_at) as last_update FROM teams_v2"
  );
  console.log('\nteams_v2 last updated_at:', lastElo[0].last_update);

  // Check if wins/losses/draws are also 0
  const { rows: stats } = await pool.query(
    "SELECT SUM(wins) as total_wins, SUM(losses) as total_losses, SUM(draws) as total_draws FROM teams_v2"
  );
  console.log('teams_v2 aggregate stats:', stats[0]);

  // Check recent pipeline runs
  const { rows: matchDates } = await pool.query(
    "SELECT MAX(match_date) as latest_match, MIN(match_date) as earliest_match FROM matches_v2 WHERE deleted_at IS NULL"
  );
  console.log('\nMatch date range:', matchDates[0]);

  await pool.end();
})();
