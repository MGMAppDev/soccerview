/**
 * INDEXED Fuzzy Team Linking
 * 
 * Creates a GIN trigram index first (makes fuzzy search 100x faster),
 * then processes in small batches with the % operator.
 * 
 * Usage: node scripts/indexedFuzzyLink.js
 */

import "dotenv/config";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ Missing DATABASE_URL environment variable");
  process.exit(1);
}

const BATCH_SIZE = 100; // Smaller batches
const SIMILARITY_THRESHOLD = 0.5;

async function main() {
  console.log("=".repeat(60));
  console.log("🔗 INDEXED FUZZY TEAM LINKING");
  console.log("=".repeat(60));
  console.log(`Started at: ${new Date().toISOString()}\n`);

  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 300000, // 5 minutes for index creation
  });

  try {
    await client.connect();
    console.log("✅ Connected to PostgreSQL\n");

    // ============================================================
    // STEP 0: Create trigram index (if not exists)
    // ============================================================
    console.log("📇 Creating trigram index on team_elo.team_name...");
    try {
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_team_elo_name_trgm 
        ON team_elo USING gin (LOWER(team_name) gin_trgm_ops)
      `);
      console.log("   ✅ Index ready\n");
    } catch (indexErr) {
      console.log("   Index may already exist, continuing...\n");
    }

    // Set lower timeout for queries
    await client.query("SET statement_timeout = '60000'"); // 60 seconds

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
    
    // Count unlinked
    const unlinkedCount = await client.query(`
      SELECT 
        COUNT(DISTINCT home_team_name) FILTER (WHERE home_team_id IS NULL) as home_names,
        COUNT(DISTINCT away_team_name) FILTER (WHERE away_team_id IS NULL) as away_names
      FROM match_results
    `);
    const totalHomeNames = parseInt(unlinkedCount.rows[0].home_names);
    const totalAwayNames = parseInt(unlinkedCount.rows[0].away_names);
    console.log(`   Unlinked home names: ${totalHomeNames.toLocaleString()}`);
    console.log(`   Unlinked away names: ${totalAwayNames.toLocaleString()}`);
    console.log("");

    // Set similarity threshold
    await client.query(`SET pg_trgm.similarity_threshold = ${SIMILARITY_THRESHOLD}`);

    // ============================================================
    // Process HOME teams
    // ============================================================
    console.log("🏠 Processing HOME teams...\n");
    
    let homeProcessed = 0;
    let homeLinked = 0;
    let homeNotFound = 0;
    let consecutiveEmpty = 0;
    
    while (consecutiveEmpty < 3) {
      // Get batch of unlinked names
      const batchResult = await client.query(`
        SELECT DISTINCT home_team_name as name
        FROM match_results
        WHERE home_team_id IS NULL
          AND home_team_name IS NOT NULL
        LIMIT ${BATCH_SIZE}
      `);
      
      if (batchResult.rows.length === 0) {
        consecutiveEmpty++;
        continue;
      }
      consecutiveEmpty = 0;
      
      for (const row of batchResult.rows) {
        const name = row.name;
        
        // Find best match using the % operator (uses index!)
        const matchResult = await client.query(`
          SELECT id, team_name, similarity(LOWER($1), LOWER(team_name)) as sim
          FROM team_elo
          WHERE LOWER(team_name) % LOWER($1)
          ORDER BY similarity(LOWER($1), LOWER(team_name)) DESC
          LIMIT 1
        `, [name]);
        
        if (matchResult.rows.length > 0) {
          const match = matchResult.rows[0];
          
          // Update all matches with this name
          const updateResult = await client.query(`
            UPDATE match_results
            SET home_team_id = $1
            WHERE home_team_name = $2
              AND home_team_id IS NULL
          `, [match.id, name]);
          
          homeLinked += updateResult.rowCount;
        } else {
          homeNotFound++;
        }
        
        homeProcessed++;
      }
      
      const pct = totalHomeNames > 0 ? ((homeProcessed / totalHomeNames) * 100).toFixed(1) : 0;
      process.stdout.write(`   Processed: ${homeProcessed.toLocaleString()}/${totalHomeNames.toLocaleString()} (${pct}%) | Linked: ${homeLinked.toLocaleString()} | Not found: ${homeNotFound.toLocaleString()}\r`);
    }
    
    console.log(`\n   ✅ Home complete\n`);

    // ============================================================
    // Process AWAY teams
    // ============================================================
    console.log("🚗 Processing AWAY teams...\n");
    
    let awayProcessed = 0;
    let awayLinked = 0;
    let awayNotFound = 0;
    consecutiveEmpty = 0;
    
    while (consecutiveEmpty < 3) {
      // Get batch of unlinked names
      const batchResult = await client.query(`
        SELECT DISTINCT away_team_name as name
        FROM match_results
        WHERE away_team_id IS NULL
          AND away_team_name IS NOT NULL
        LIMIT ${BATCH_SIZE}
      `);
      
      if (batchResult.rows.length === 0) {
        consecutiveEmpty++;
        continue;
      }
      consecutiveEmpty = 0;
      
      for (const row of batchResult.rows) {
        const name = row.name;
        
        // Find best match using the % operator (uses index!)
        const matchResult = await client.query(`
          SELECT id, team_name, similarity(LOWER($1), LOWER(team_name)) as sim
          FROM team_elo
          WHERE LOWER(team_name) % LOWER($1)
          ORDER BY similarity(LOWER($1), LOWER(team_name)) DESC
          LIMIT 1
        `, [name]);
        
        if (matchResult.rows.length > 0) {
          const match = matchResult.rows[0];
          
          // Update all matches with this name
          const updateResult = await client.query(`
            UPDATE match_results
            SET away_team_id = $1
            WHERE away_team_name = $2
              AND away_team_id IS NULL
          `, [match.id, name]);
          
          awayLinked += updateResult.rowCount;
        } else {
          awayNotFound++;
        }
        
        awayProcessed++;
      }
      
      const pct = totalAwayNames > 0 ? ((awayProcessed / totalAwayNames) * 100).toFixed(1) : 0;
      process.stdout.write(`   Processed: ${awayProcessed.toLocaleString()}/${totalAwayNames.toLocaleString()} (${pct}%) | Linked: ${awayLinked.toLocaleString()} | Not found: ${awayNotFound.toLocaleString()}\r`);
    }
    
    console.log(`\n   ✅ Away complete\n`);

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
    console.log("📈 SESSION IMPROVEMENT:");
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
