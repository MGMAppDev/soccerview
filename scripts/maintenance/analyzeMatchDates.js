import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function analyzeMatchDates() {
  try {
    await client.connect();
    console.log('📅 Analyzing Match Date Distribution\n');

    // Total matches
    const totalQuery = await client.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE home_team_id IS NULL OR away_team_id IS NULL) as unlinked
      FROM match_results
    `);

    const total = parseInt(totalQuery.rows[0].total);
    const unlinked = parseInt(totalQuery.rows[0].unlinked);
    console.log(`Total Matches: ${total.toLocaleString()}`);
    console.log(`Unlinked: ${unlinked.toLocaleString()} (${(unlinked/total*100).toFixed(1)}%)\n`);

    // Last 3 seasons (Aug 1, 2023+)
    const last3Query = await client.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE home_team_id IS NULL OR away_team_id IS NULL) as unlinked
      FROM match_results
      WHERE match_date >= '2023-08-01'
    `);

    const last3Total = parseInt(last3Query.rows[0].total);
    const last3Unlinked = parseInt(last3Query.rows[0].unlinked);
    console.log(`Last 3 Seasons (Aug 2023+):`);
    console.log(`  Total: ${last3Total.toLocaleString()} (${(last3Total/total*100).toFixed(1)}% of all matches)`);
    console.log(`  Unlinked: ${last3Unlinked.toLocaleString()} (${(last3Unlinked/last3Total*100).toFixed(1)}%)`);
    console.log(`  Reduction: ${(total - last3Total).toLocaleString()} fewer matches to process\n`);

    // Current season (Aug 1, 2025+)
    const currentQuery = await client.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE home_team_id IS NULL OR away_team_id IS NULL) as unlinked
      FROM match_results
      WHERE match_date >= '2025-08-01'
    `);

    const currentTotal = parseInt(currentQuery.rows[0].total);
    const currentUnlinked = parseInt(currentQuery.rows[0].unlinked);
    console.log(`Current Season (Aug 2025+):`);
    console.log(`  Total: ${currentTotal.toLocaleString()} (${(currentTotal/total*100).toFixed(1)}% of all matches)`);
    console.log(`  Unlinked: ${currentUnlinked.toLocaleString()} (${(currentUnlinked/currentTotal*100).toFixed(1)}%)`);
    console.log(`  Reduction: ${(total - currentTotal).toLocaleString()} fewer matches to process\n`);

    // Older matches (before Aug 2023)
    const oldQuery = await client.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE home_team_id IS NULL OR away_team_id IS NULL) as unlinked
      FROM match_results
      WHERE match_date < '2023-08-01'
    `);

    const oldTotal = parseInt(oldQuery.rows[0].total);
    const oldUnlinked = parseInt(oldQuery.rows[0].unlinked);
    console.log(`Older Matches (before Aug 2023):`);
    console.log(`  Total: ${oldTotal.toLocaleString()} (${(oldTotal/total*100).toFixed(1)}% of all matches)`);
    console.log(`  Unlinked: ${oldUnlinked.toLocaleString()} (${(oldUnlinked/oldTotal*100).toFixed(1)}%)\n`);

    console.log('💡 RECOMMENDATION:');
    if (last3Unlinked < unlinked * 0.5) {
      console.log(`Focus on last 3 seasons only. This reduces unlinked matches from ${unlinked.toLocaleString()} to ${last3Unlinked.toLocaleString()}.`);
      console.log(`Savings: ${(unlinked - last3Unlinked).toLocaleString()} fewer matches to process (${((1 - last3Unlinked/unlinked)*100).toFixed(1)}% reduction)`);
    } else {
      console.log('Most unlinked matches are recent. Date filtering provides minimal benefit.');
    }

    await client.end();
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

analyzeMatchDates();
