/**
 * BATCHED Fuzzy Team Linking via Direct PostgreSQL
 * 
 * Processes fuzzy matches in small batches to avoid timeouts.
 * Run AFTER bulkLinkTeams.js has done exact matches.
 * 
 * Usage: node scripts/batchFuzzyLink.js
 */

import "dotenv/config";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ Missing DATABASE_URL environment variable");
  process.exit(1);
}

const BATCH_SIZE = 500; // Process 500 unique names at a time
const SIMILARITY_THRESHOLD = 0.5;

async function main() {
  console.log("=".repeat(60));
  console.log("🔗 BATCHED FUZZY TEAM LINKING");
  console.log("=".repeat(60));
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(`Similarity threshold: ${SIMILARITY_THRESHOLD}`);
  console.log(`Started at: ${new Date().toISOString()}\n`);

  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 120000, // 2 minutes per query
  });

  try {
    await client.connect();
    console.log("✅ Connected to PostgreSQL\n");

    // Get initial status
    const initialStatus = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL) as fully_linked,
        COUNT(*) FILTER (WHERE home_team_id IS NOT NULL) as home_linked,
        COUNT(*) FILTER (WHERE away_team_id IS NOT NULL) as away_linked
      FROM match_results
    `);
    
    const initial = initialStatus.rows[0];
    console.log("📊 INITIAL STATUS:");
    console.log(`   Total matches: ${parseInt(initial.total).toLocaleString()}`);
    console.log(`   Fully linked: ${parseInt(initial.fully_linked).toLocaleString()} (${(initial.fully_linked / initial.total * 100).toFixed(1)}%)`);
    console.log(`   Home linked: ${parseInt(initial.home_linked).toLocaleString()}`);
    console.log(`   Away linked: ${parseInt(initial.away_linked).toLocaleString()}`);
    console.log("");

    // ============================================================
    // Process HOME teams in batches
    // ============================================================
    console.log("🏠 Processing HOME teams in batches...\n");
    
    let homeOffset = 0;
    let homeTotalLinked = 0;
    let homeHasMore = true;
    
    while (homeHasMore) {
      // Get batch of unique unlinked home names
      const batchResult = await client.query(`
        SELECT DISTINCT home_team_name as name
        FROM match_results
        WHERE home_team_id IS NULL
          AND home_team_name IS NOT NULL
        ORDER BY home_team_name
        LIMIT ${BATCH_SIZE}
        OFFSET ${homeOffset}
      `);
      
      if (batchResult.rows.length === 0) {
        homeHasMore = false;
        break;
      }
      
      const names = batchResult.rows.map(r => r.name);
      
      // Find best matches for this batch
      const updateResult = await client.query(`
        WITH batch_names AS (
          SELECT unnest($1::text[]) as name
        ),
        best_matches AS (
          SELECT DISTINCT ON (bn.name)
            bn.name,
            te.id as team_id,
            similarity(LOWER(bn.name), LOWER(te.team_name)) as sim
          FROM batch_names bn
          CROSS JOIN LATERAL (
            SELECT id, team_name
            FROM team_elo
            WHERE similarity(LOWER(bn.name), LOWER(team_elo.team_name)) >= ${SIMILARITY_THRESHOLD}
            ORDER BY similarity(LOWER(bn.name), LOWER(team_elo.team_name)) DESC
            LIMIT 1
          ) te
          ORDER BY bn.name, sim DESC
        )
        UPDATE match_results mr
        SET home_team_id = bm.team_id
        FROM best_matches bm
        WHERE mr.home_team_name = bm.name
          AND mr.home_team_id IS NULL
      `, [names]);
      
      homeTotalLinked += updateResult.rowCount;
      homeOffset += BATCH_SIZE;
      
      const pct = homeOffset > 0 ? homeOffset : BATCH_SIZE;
      process.stdout.write(`   Processed ${pct.toLocaleString()} names | Linked: ${homeTotalLinked.toLocaleString()} matches\r`);
      
      if (batchResult.rows.length < BATCH_SIZE) {
        homeHasMore = false;
      }
    }
    
    console.log(`\n   ✅ Home complete: ${homeTotalLinked.toLocaleString()} matches linked\n`);

    // ============================================================
    // Process AWAY teams in batches
    // ============================================================
    console.log("🚗 Processing AWAY teams in batches...\n");
    
    let awayOffset = 0;
    let awayTotalLinked = 0;
    let awayHasMore = true;
    
    while (awayHasMore) {
      // Get batch of unique unlinked away names
      const batchResult = await client.query(`
        SELECT DISTINCT away_team_name as name
        FROM match_results
        WHERE away_team_id IS NULL
          AND away_team_name IS NOT NULL
        ORDER BY away_team_name
        LIMIT ${BATCH_SIZE}
        OFFSET ${awayOffset}
      `);
      
      if (batchResult.rows.length === 0) {
        awayHasMore = false;
        break;
      }
      
      const names = batchResult.rows.map(r => r.name);
      
      // Find best matches for this batch
      const updateResult = await client.query(`
        WITH batch_names AS (
          SELECT unnest($1::text[]) as name
        ),
        best_matches AS (
          SELECT DISTINCT ON (bn.name)
            bn.name,
            te.id as team_id,
            similarity(LOWER(bn.name), LOWER(te.team_name)) as sim
          FROM batch_names bn
          CROSS JOIN LATERAL (
            SELECT id, team_name
            FROM team_elo
            WHERE similarity(LOWER(bn.name), LOWER(team_elo.team_name)) >= ${SIMILARITY_THRESHOLD}
            ORDER BY similarity(LOWER(bn.name), LOWER(team_elo.team_name)) DESC
            LIMIT 1
          ) te
          ORDER BY bn.name, sim DESC
        )
        UPDATE match_results mr
        SET away_team_id = bm.team_id
        FROM best_matches bm
        WHERE mr.away_team_name = bm.name
          AND mr.away_team_id IS NULL
      `, [names]);
      
      awayTotalLinked += updateResult.rowCount;
      awayOffset += BATCH_SIZE;
      
      process.stdout.write(`   Processed ${awayOffset.toLocaleString()} names | Linked: ${awayTotalLinked.toLocaleString()} matches\r`);
      
      if (batchResult.rows.length < BATCH_SIZE) {
        awayHasMore = false;
      }
    }
    
    console.log(`\n   ✅ Away complete: ${awayTotalLinked.toLocaleString()} matches linked\n`);

    // ============================================================
    // FINAL STATUS
    // ============================================================
    const finalStatus = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL) as fully_linked,
        COUNT(*) FILTER (WHERE home_team_id IS NOT NULL) as home_linked,
        COUNT(*) FILTER (WHERE away_team_id IS NOT NULL) as away_linked
      FROM match_results
    `);
    
    const final = finalStatus.rows[0];
    
    console.log("=".repeat(60));
    console.log("📊 FINAL STATUS:");
    console.log("=".repeat(60));
    console.log(`   Total matches: ${parseInt(final.total).toLocaleString()}`);
    console.log(`   Fully linked: ${parseInt(final.fully_linked).toLocaleString()} (${(final.fully_linked / final.total * 100).toFixed(1)}%)`);
    console.log(`   Home linked: ${parseInt(final.home_linked).toLocaleString()} (${(final.home_linked / final.total * 100).toFixed(1)}%)`);
    console.log(`   Away linked: ${parseInt(final.away_linked).toLocaleString()} (${(final.away_linked / final.total * 100).toFixed(1)}%)`);
    console.log("");
    console.log("📈 IMPROVEMENT:");
    console.log(`   Fully linked: +${(parseInt(final.fully_linked) - parseInt(initial.fully_linked)).toLocaleString()}`);
    console.log(`   Home: +${(parseInt(final.home_linked) - parseInt(initial.home_linked)).toLocaleString()}`);
    console.log(`   Away: +${(parseInt(final.away_linked) - parseInt(initial.away_linked)).toLocaleString()}`);

  } catch (err) {
    console.error("\n❌ Error:", err.message);
    process.exit(1);
  } finally {
    await client.end();
  }

  console.log(`\n✅ Completed at: ${new Date().toISOString()}`);
}

main();
