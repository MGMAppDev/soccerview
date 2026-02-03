/**
 * Match Migration - SQL-based approach
 *
 * Handles v2 schema constraints by filtering invalid records:
 * 1. home_team_id != away_team_id (different_teams_match)
 * 2. match_date IS NOT NULL
 * 3. Avoids duplicates with ON CONFLICT DO UPDATE
 */

import 'dotenv/config';
import pg from 'pg';
import { authorizePipelineWrite } from '../universal/pipelineAuth.js';

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function runMatchMigration() {
  console.log('\n' + '='.repeat(60));
  console.log('MATCH MIGRATION - SQL-BASED APPROACH');
  console.log('='.repeat(60));
  console.log(`Time: ${new Date().toISOString()}\n`);

  const client = await pool.connect();

  // Authorize writes to protected tables
  await authorizePipelineWrite(client);

  try {
    // Check counts before
    const beforeCount = await client.query('SELECT COUNT(*) as total FROM matches_v2');
    console.log(`Matches in v2 BEFORE: ${Number(beforeCount.rows[0].total).toLocaleString()}`);

    // Check how many valid matches we can migrate
    const validMatchesCheck = await client.query(`
      SELECT COUNT(*) as total
      FROM match_results mr
      WHERE mr.home_team_id IS NOT NULL
        AND mr.away_team_id IS NOT NULL
        AND mr.home_team_id != mr.away_team_id  -- different teams
        AND mr.match_date IS NOT NULL            -- has date
        AND EXISTS (SELECT 1 FROM teams_v2 t WHERE t.id = mr.home_team_id)
        AND EXISTS (SELECT 1 FROM teams_v2 t WHERE t.id = mr.away_team_id)
    `);
    console.log(`Valid matches to migrate: ${Number(validMatchesCheck.rows[0].total).toLocaleString()}\n`);

    // Check data quality issues in v1
    const issueCheck = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE home_team_id = away_team_id) as same_team,
        COUNT(*) FILTER (WHERE match_date IS NULL) as null_date,
        COUNT(*) FILTER (WHERE home_team_id IS NULL OR away_team_id IS NULL) as missing_team
      FROM match_results
    `);
    console.log('V1 Data Quality Issues:');
    console.log(`  Same team (home=away): ${issueCheck.rows[0].same_team}`);
    console.log(`  Missing date: ${issueCheck.rows[0].null_date}`);
    console.log(`  Missing team IDs: ${issueCheck.rows[0].missing_team}\n`);

    console.log('Running SQL migration (this may take a few minutes)...\n');
    const startTime = Date.now();

    // Run the migration with proper conflict handling
    const result = await client.query(`
      INSERT INTO matches_v2 (
        id,
        match_date,
        match_time,
        home_team_id,
        away_team_id,
        home_score,
        away_score,
        league_id,
        tournament_id,
        source_platform,
        source_match_key,
        link_status,
        created_at
      )
      SELECT DISTINCT ON (mr.match_date, mr.home_team_id, mr.away_team_id, COALESCE(mr.home_score, 0), COALESCE(mr.away_score, 0))
        mr.id,
        mr.match_date,
        mr.match_time::time,
        mr.home_team_id,
        mr.away_team_id,
        COALESCE(mr.home_score, 0),
        COALESCE(mr.away_score, 0),
        l.id as league_id,
        t.id as tournament_id,
        mr.source_platform,
        mr.source_match_key,
        'full' as link_status,
        COALESCE(mr.created_at, NOW())
      FROM match_results mr
      LEFT JOIN leagues l ON mr.event_id = l.source_event_id
      LEFT JOIN tournaments t ON mr.event_id = t.source_event_id
      WHERE mr.home_team_id IS NOT NULL
        AND mr.away_team_id IS NOT NULL
        AND mr.home_team_id != mr.away_team_id  -- constraint: different teams
        AND mr.match_date IS NOT NULL            -- constraint: has date
        AND EXISTS (SELECT 1 FROM teams_v2 WHERE id = mr.home_team_id)
        AND EXISTS (SELECT 1 FROM teams_v2 WHERE id = mr.away_team_id)
      ORDER BY mr.match_date, mr.home_team_id, mr.away_team_id, COALESCE(mr.home_score, 0), COALESCE(mr.away_score, 0), mr.created_at DESC
      ON CONFLICT (match_date, home_team_id, away_team_id, home_score, away_score) DO UPDATE SET
        link_status = 'full'
    `);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ Migration completed in ${duration}s`);
    console.log(`   Rows affected: ${result.rowCount.toLocaleString()}\n`);

    // Check counts after
    const afterCount = await client.query('SELECT COUNT(*) as total FROM matches_v2');
    console.log(`Matches in v2 AFTER: ${Number(afterCount.rows[0].total).toLocaleString()}`);
    console.log(`Net change: +${(afterCount.rows[0].total - beforeCount.rows[0].total).toLocaleString()}`);

    // Coverage check
    const v1Total = await client.query(`
      SELECT COUNT(*) as total FROM match_results
      WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL
    `);
    console.log(`\nCoverage: ${(afterCount.rows[0].total / v1Total.rows[0].total * 100).toFixed(1)}%`);

    // Link status distribution
    const linkStatus = await client.query(`
      SELECT link_status, COUNT(*) as cnt
      FROM matches_v2
      GROUP BY link_status
      ORDER BY cnt DESC
    `);
    console.log('\nLink Status Distribution:');
    linkStatus.rows.forEach(r => console.log(`  ${r.link_status}: ${Number(r.cnt).toLocaleString()}`));

    console.log('\n' + '='.repeat(60));
    console.log('✅ MATCH MIGRATION COMPLETE');
    console.log('='.repeat(60));

  } catch (error) {
    console.error(`\n❌ Migration failed: ${error.message}`);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runMatchMigration()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
