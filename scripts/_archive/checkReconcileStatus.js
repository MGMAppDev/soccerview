/**
 * Quick check of reconciliation status
 */
import 'dotenv/config';
import pg from 'pg';

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function check() {
  await client.connect();

  console.log('='.repeat(60));
  console.log('RECONCILIATION STATUS CHECK');
  console.log('='.repeat(60));

  // Teams needing reconciliation (have rank but 0 matches)
  const needReconcile = await client.query(`
    SELECT COUNT(*) as count FROM teams
    WHERE gotsport_ranking IS NOT NULL AND matches_played = 0
  `);

  // Also check via team_elo view
  const needReconcileView = await client.query(`
    SELECT COUNT(*) as count FROM team_elo
    WHERE national_rank IS NOT NULL AND matches_played = 0
  `);

  // Total teams with rankings
  const totalRanked = await client.query(`
    SELECT COUNT(*) as count FROM teams
    WHERE gotsport_ranking IS NOT NULL
  `);

  // Teams with matches
  const withMatches = await client.query(`
    SELECT COUNT(*) as count FROM teams
    WHERE matches_played > 0
  `);

  // Unlinked matches
  const unlinked = await client.query(`
    SELECT COUNT(*) as count FROM match_results
    WHERE home_team_id IS NULL OR away_team_id IS NULL
  `);

  console.log(`\nTeams with Official Rank:        ${parseInt(totalRanked.rows[0].count).toLocaleString()}`);
  console.log(`Teams needing reconciliation:    ${parseInt(needReconcile.rows[0].count).toLocaleString()}`);
  console.log(`  (via team_elo view):           ${parseInt(needReconcileView.rows[0].count).toLocaleString()}`);
  console.log(`Teams with match history:        ${parseInt(withMatches.rows[0].count).toLocaleString()}`);
  console.log(`Unlinked matches:                ${parseInt(unlinked.rows[0].count).toLocaleString()}`);

  await client.end();
}

check().catch(console.error);
