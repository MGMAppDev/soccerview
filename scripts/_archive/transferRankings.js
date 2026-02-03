/**
 * Transfer Rankings - Moves ranking data from duplicate ranked records to
 * their matching counterparts that have match history.
 *
 * Problem: GotSport creates two team records:
 * 1. "Club Team 2009 Elite (U17 Boys)" - has ranking, 0 matches
 * 2. "Club Team 2009 Elite" - has matches, no ranking
 *
 * Solution: Transfer ranking data from #1 to #2 (exact match minus suffix)
 *
 * Usage: node scripts/transferRankings.js
 */

import "dotenv/config";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ Missing DATABASE_URL environment variable");
  process.exit(1);
}

// Strip (Uxx Gender) suffix from team name
function stripSuffix(name) {
  return name.replace(/\s*\([^)]+\)\s*$/, '').trim();
}

async function main() {
  console.log("=".repeat(60));
  console.log("🔄 TRANSFER RANKINGS - Link Ranked to Matched Teams");
  console.log("=".repeat(60));
  console.log(`Started at: ${new Date().toISOString()}\n`);

  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 1800000,
  });

  try {
    await client.connect();
    console.log("✅ Connected to PostgreSQL\n");

    // Get before stats
    const beforeStats = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE national_rank > 0 AND matches_played = 0) as ranked_no_match,
        COUNT(*) FILTER (WHERE national_rank > 0 AND matches_played > 0) as ranked_with_match
      FROM teams
    `);
    console.log("📊 BEFORE:");
    console.log(`   Ranked with matches: ${parseInt(beforeStats.rows[0].ranked_with_match).toLocaleString()}`);
    console.log(`   Ranked without matches: ${parseInt(beforeStats.rows[0].ranked_no_match).toLocaleString()}`);
    console.log("");

    // Get all ranked teams with 0 matches
    console.log("🔍 Finding ranked teams without match data...");
    const rankedNoMatch = await client.query(`
      SELECT id, team_name, national_rank, regional_rank, state_rank,
             gotsport_points, state, age_group, gender, ranking_date,
             national_award, regional_award, state_cup_award
      FROM teams
      WHERE national_rank > 0 AND matches_played = 0
      ORDER BY national_rank
    `);
    console.log(`   Found ${rankedNoMatch.rows.length.toLocaleString()} teams\n`);

    // Build lookup index of teams with matches
    console.log("📚 Building index of teams with matches...");
    const teamsWithMatches = await client.query(`
      SELECT id, team_name, matches_played, national_rank
      FROM teams
      WHERE matches_played > 0
    `);

    // Create normalized name -> team mapping
    const matchIndex = new Map();
    for (const team of teamsWithMatches.rows) {
      const normalized = team.team_name.toLowerCase().trim();
      if (!matchIndex.has(normalized) || matchIndex.get(normalized).matches_played < team.matches_played) {
        matchIndex.set(normalized, team);
      }
    }
    console.log(`   Indexed ${matchIndex.size.toLocaleString()} unique team names\n`);

    // Find exact matches (ranked team name minus suffix = team with matches)
    console.log("🔗 Finding exact matches...");
    const transfers = [];
    let exactMatches = 0;

    for (const ranked of rankedNoMatch.rows) {
      const baseName = stripSuffix(ranked.team_name).toLowerCase().trim();

      // Try exact match first
      if (matchIndex.has(baseName)) {
        const match = matchIndex.get(baseName);
        // Only transfer if matched team doesn't already have a rank
        if (!match.national_rank || match.national_rank === 0) {
          transfers.push({
            fromId: ranked.id,
            toId: match.id,
            fromName: ranked.team_name,
            toName: match.team_name,
            rank: ranked.national_rank,
            ...ranked
          });
          exactMatches++;
        }
      }
    }

    console.log(`   Found ${exactMatches.toLocaleString()} exact matches\n`);

    if (transfers.length === 0) {
      console.log("⚠️  No transfers to perform.");
      return;
    }

    // Show sample of transfers
    console.log("📋 SAMPLE TRANSFERS (first 10):");
    transfers.slice(0, 10).forEach(t => {
      console.log(`   #${t.rank}: "${t.fromName}" → "${t.toName}"`);
    });
    console.log("");

    // Perform transfers in batches
    console.log("💾 Transferring rankings (batched)...");
    const BATCH_SIZE = 500;
    let transferred = 0;

    for (let i = 0; i < transfers.length; i += BATCH_SIZE) {
      const batch = transfers.slice(i, i + BATCH_SIZE);
      const ids = batch.map(t => `'${t.toId}'`).join(',');

      // Build CASE statements for each field
      let natRankCase = 'CASE id ';
      let regRankCase = 'CASE id ';
      let stRankCase = 'CASE id ';
      let pointsCase = 'CASE id ';
      let natAwardCase = 'CASE id ';
      let regAwardCase = 'CASE id ';
      let stCupCase = 'CASE id ';
      let rankDateCase = 'CASE id ';

      for (const t of batch) {
        natRankCase += `WHEN '${t.toId}' THEN ${t.national_rank || 'NULL'} `;
        regRankCase += `WHEN '${t.toId}' THEN ${t.regional_rank || 'NULL'} `;
        stRankCase += `WHEN '${t.toId}' THEN ${t.state_rank || 'NULL'} `;
        pointsCase += `WHEN '${t.toId}' THEN ${t.gotsport_points || 'NULL'} `;
        natAwardCase += `WHEN '${t.toId}' THEN ${t.national_award ? `'${t.national_award}'` : 'NULL'} `;
        regAwardCase += `WHEN '${t.toId}' THEN ${t.regional_award ? `'${t.regional_award}'` : 'NULL'} `;
        stCupCase += `WHEN '${t.toId}' THEN ${t.state_cup_award ? `'${t.state_cup_award}'` : 'NULL'} `;
        const dateVal = t.ranking_date ? `'${new Date(t.ranking_date).toISOString().split('T')[0]}'` : 'NULL';
        rankDateCase += `WHEN '${t.toId}' THEN ${dateVal} `;
      }

      natRankCase += 'END';
      regRankCase += 'END';
      stRankCase += 'END';
      pointsCase += 'END';
      natAwardCase += 'END';
      regAwardCase += 'END';
      stCupCase += 'END';
      rankDateCase += 'END';

      await client.query(`
        UPDATE teams SET
          national_rank = ${natRankCase},
          regional_rank = ${regRankCase},
          state_rank = ${stRankCase},
          gotsport_points = ${pointsCase},
          national_award = ${natAwardCase},
          regional_award = ${regAwardCase},
          state_cup_award = ${stCupCase},
          ranking_date = (${rankDateCase})::date
        WHERE id IN (${ids})
      `);

      // Clear ranks from source records (optional - to avoid confusion)
      const fromIds = batch.map(t => `'${t.fromId}'`).join(',');
      await client.query(`
        UPDATE teams SET
          national_rank = NULL,
          regional_rank = NULL,
          state_rank = NULL
        WHERE id IN (${fromIds})
      `);

      transferred += batch.length;
      process.stdout.write(`   Transferred: ${transferred.toLocaleString()}/${transfers.length.toLocaleString()}\r`);
    }

    console.log(`\n   ✅ Transferred ${transferred.toLocaleString()} rankings\n`);

    // Get after stats
    const afterStats = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE national_rank > 0 AND matches_played = 0) as ranked_no_match,
        COUNT(*) FILTER (WHERE national_rank > 0 AND matches_played > 0) as ranked_with_match
      FROM teams
    `);

    console.log("📊 AFTER:");
    console.log(`   Ranked with matches: ${parseInt(afterStats.rows[0].ranked_with_match).toLocaleString()}`);
    console.log(`   Ranked without matches: ${parseInt(afterStats.rows[0].ranked_no_match).toLocaleString()}`);

    const improvement = parseInt(afterStats.rows[0].ranked_with_match) - parseInt(beforeStats.rows[0].ranked_with_match);
    console.log("");
    console.log("=".repeat(60));
    console.log(`🎯 TRANSFERRED: ${improvement.toLocaleString()} rankings to teams with match data`);
    console.log("=".repeat(60));

    // Show top ranked teams now with match data
    const topTeams = await client.query(`
      SELECT team_name, national_rank, matches_played, elo_rating
      FROM teams
      WHERE national_rank > 0 AND matches_played > 0
      ORDER BY national_rank
      LIMIT 15
    `);

    console.log("\n🏆 TOP 15 RANKED TEAMS (now with match data):");
    topTeams.rows.forEach(t => {
      console.log(`   #${t.national_rank}: ${t.team_name.substring(0, 45)} | ${t.matches_played} matches`);
    });

  } catch (err) {
    console.error("\n❌ Error:", err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await client.end();
  }

  console.log(`\n✅ Completed at: ${new Date().toISOString()}`);
}

main();
