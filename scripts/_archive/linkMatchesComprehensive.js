/**
 * Link Matches Comprehensive - Full Pipeline with Self-Healing
 * 
 * STRATEGY ORDER:
 * 1. Exact alias lookup (instant, indexed)
 * 2. Normalized lookups (punct, whitespace, color removed from input)
 * 3. pg_trgm fuzzy match with validation (year + gender)
 * 4. Self-healing: Store new aliases for fuzzy matches
 * 5. Queue ambiguous matches for manual review
 * 6. Report unlinkables with categorization
 * 
 * SAFEGUARDS:
 * - Year validation: Birth years must match
 * - Gender validation: B/G indicators must match
 * - Similarity threshold: 0.75 minimum
 * - Ambiguity check: Top-2 gap must be >0.05
 * 
 * Usage: node scripts/linkMatchesComprehensive.js
 */

import "dotenv/config";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ Missing DATABASE_URL");
  process.exit(1);
}

// Configuration
const SIMILARITY_THRESHOLD = 0.70;  // Minimum similarity for fuzzy match
const AMBIGUITY_GAP = 0.05;         // Minimum gap between top-2 candidates
const BATCH_SIZE = 500;             // Process unlinked names in batches

// Extract birth year from team name (returns null if not found)
function extractYearSQL(column) {
  return `(regexp_match(${column}, '(20[0-2][0-9])'))[1]`;
}

// Extract gender indicator from team name
function extractGenderSQL(column) {
  return `CASE 
    WHEN ${column} ~* '\\b(boys|boy|b20|b19|b18|b17|b16|b15|b14|b13|b12|b11|b10)\\b' THEN 'B'
    WHEN ${column} ~* '\\b(girls|girl|g20|g19|g18|g17|g16|g15|g14|g13|g12|g11|g10)\\b' THEN 'G'
    ELSE NULL
  END`;
}

async function main() {
  console.log("🔗 Link Matches Comprehensive - Full Pipeline");
  console.log("═".repeat(65));
  console.log(`Started: ${new Date().toISOString()}`);
  console.log(`Similarity threshold: ${SIMILARITY_THRESHOLD}`);
  console.log(`Ambiguity gap: ${AMBIGUITY_GAP}\n`);

  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 600000, // 10 minutes
  });

  try {
    await client.connect();
    console.log("✅ Connected\n");

    // ================================================================
    // BASELINE
    // ================================================================
    const baseline = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL) as fully_linked,
        COUNT(*) FILTER (WHERE home_team_id IS NULL) as home_null,
        COUNT(*) FILTER (WHERE away_team_id IS NULL) as away_null
      FROM match_results
    `);
    const b = baseline.rows[0];
    console.log("📊 BASELINE:");
    console.log(`   Total matches:  ${parseInt(b.total).toLocaleString()}`);
    console.log(`   Fully linked:   ${parseInt(b.fully_linked).toLocaleString()} (${(b.fully_linked / b.total * 100).toFixed(1)}%)`);
    console.log(`   Home unlinked:  ${parseInt(b.home_null).toLocaleString()}`);
    console.log(`   Away unlinked:  ${parseInt(b.away_null).toLocaleString()}\n`);

    const chunks = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');
    let stats = {
      exactHome: 0, exactAway: 0,
      normHome: 0, normAway: 0,
      fuzzyHome: 0, fuzzyAway: 0,
      ambiguousHome: 0, ambiguousAway: 0,
      aliasesCreated: 0
    };

    // ================================================================
    // PHASE 1: Exact Alias Lookup
    // ================================================================
    console.log("🎯 PHASE 1: Exact Alias Lookup");
    
    console.log("   HOME teams...");
    for (const letter of chunks) {
      const result = await client.query(`
        UPDATE match_results mr
        SET home_team_id = ta.team_id
        FROM team_name_aliases ta
        WHERE mr.home_team_id IS NULL
          AND mr.home_team_name IS NOT NULL
          AND UPPER(LEFT(mr.home_team_name, 1)) = $1
          AND LOWER(TRIM(mr.home_team_name)) = ta.alias_name
      `, [letter]);
      stats.exactHome += result.rowCount;
    }
    console.log(`   Linked: +${stats.exactHome.toLocaleString()}`);

    console.log("   AWAY teams...");
    for (const letter of chunks) {
      const result = await client.query(`
        UPDATE match_results mr
        SET away_team_id = ta.team_id
        FROM team_name_aliases ta
        WHERE mr.away_team_id IS NULL
          AND mr.away_team_name IS NOT NULL
          AND UPPER(LEFT(mr.away_team_name, 1)) = $1
          AND LOWER(TRIM(mr.away_team_name)) = ta.alias_name
      `, [letter]);
      stats.exactAway += result.rowCount;
    }
    console.log(`   Linked: +${stats.exactAway.toLocaleString()}\n`);

    // ================================================================
    // PHASE 2: Normalized Input Lookup (apply same transforms to input)
    // ================================================================
    console.log("🎯 PHASE 2: Normalized Input Lookup");
    
    // 2a: Punctuation removed from input
    console.log("   2a: Punctuation normalized...");
    for (const letter of chunks) {
      let result = await client.query(`
        UPDATE match_results mr
        SET home_team_id = ta.team_id
        FROM team_name_aliases ta
        WHERE mr.home_team_id IS NULL
          AND mr.home_team_name IS NOT NULL
          AND UPPER(LEFT(mr.home_team_name, 1)) = $1
          AND LOWER(TRIM(REGEXP_REPLACE(
                REGEXP_REPLACE(mr.home_team_name, '[.''\"\\-]', '', 'g'),
                '\\s+', ' ', 'g'
              ))) = ta.alias_name
      `, [letter]);
      stats.normHome += result.rowCount;

      result = await client.query(`
        UPDATE match_results mr
        SET away_team_id = ta.team_id
        FROM team_name_aliases ta
        WHERE mr.away_team_id IS NULL
          AND mr.away_team_name IS NOT NULL
          AND UPPER(LEFT(mr.away_team_name, 1)) = $1
          AND LOWER(TRIM(REGEXP_REPLACE(
                REGEXP_REPLACE(mr.away_team_name, '[.''\"\\-]', '', 'g'),
                '\\s+', ' ', 'g'
              ))) = ta.alias_name
      `, [letter]);
      stats.normAway += result.rowCount;
    }

    // 2b: Color words removed from input
    console.log("   2b: Color words removed from input...");
    const colorPattern = `\\s+(red|blue|black|white|gold|silver|green|orange|navy|royal|gray|grey|purple|yellow|maroon|crimson|teal|pink)\\s*`;
    for (const letter of chunks) {
      let result = await client.query(`
        UPDATE match_results mr
        SET home_team_id = ta.team_id
        FROM team_name_aliases ta
        WHERE mr.home_team_id IS NULL
          AND mr.home_team_name IS NOT NULL
          AND UPPER(LEFT(mr.home_team_name, 1)) = $1
          AND LOWER(TRIM(REGEXP_REPLACE(
                REGEXP_REPLACE(mr.home_team_name, '${colorPattern}', ' ', 'gi'),
                '\\s+', ' ', 'g'
              ))) = ta.alias_name
      `, [letter]);
      stats.normHome += result.rowCount;

      result = await client.query(`
        UPDATE match_results mr
        SET away_team_id = ta.team_id
        FROM team_name_aliases ta
        WHERE mr.away_team_id IS NULL
          AND mr.away_team_name IS NOT NULL
          AND UPPER(LEFT(mr.away_team_name, 1)) = $1
          AND LOWER(TRIM(REGEXP_REPLACE(
                REGEXP_REPLACE(mr.away_team_name, '${colorPattern}', ' ', 'gi'),
                '\\s+', ' ', 'g'
              ))) = ta.alias_name
      `, [letter]);
      stats.normAway += result.rowCount;
    }

    // 2c: Suffix stripped from input (handles cases where match has suffix but alias doesn't)
    console.log("   2c: Suffix stripped from input...");
    for (const letter of chunks) {
      let result = await client.query(`
        UPDATE match_results mr
        SET home_team_id = ta.team_id
        FROM team_name_aliases ta
        WHERE mr.home_team_id IS NULL
          AND mr.home_team_name IS NOT NULL
          AND UPPER(LEFT(mr.home_team_name, 1)) = $1
          AND LOWER(TRIM(REGEXP_REPLACE(mr.home_team_name, '\\s*\\([^)]*\\)\\s*$', ''))) = ta.alias_name
      `, [letter]);
      stats.normHome += result.rowCount;

      result = await client.query(`
        UPDATE match_results mr
        SET away_team_id = ta.team_id
        FROM team_name_aliases ta
        WHERE mr.away_team_id IS NULL
          AND mr.away_team_name IS NOT NULL
          AND UPPER(LEFT(mr.away_team_name, 1)) = $1
          AND LOWER(TRIM(REGEXP_REPLACE(mr.away_team_name, '\\s*\\([^)]*\\)\\s*$', ''))) = ta.alias_name
      `, [letter]);
      stats.normAway += result.rowCount;
    }

    console.log(`   Total normalized: Home +${stats.normHome.toLocaleString()}, Away +${stats.normAway.toLocaleString()}\n`);

    // ================================================================
    // PHASE 3: pg_trgm Fuzzy Matching with Validation
    // ================================================================
    console.log("🎯 PHASE 3: Fuzzy Matching (pg_trgm)");
    console.log("   Processing unlinked names in batches...\n");

    // Process HOME teams
    console.log("   HOME teams:");
    let homeProcessed = 0;
    while (true) {
      // Get batch of unlinked home team names
      const unlinked = await client.query(`
        SELECT DISTINCT home_team_name as name
        FROM match_results 
        WHERE home_team_id IS NULL
          AND home_team_name IS NOT NULL
          AND LENGTH(home_team_name) >= 10
          AND home_team_name ~ '^[A-Za-z]'
          AND home_team_name NOT ILIKE '%***%'
          AND home_team_name NOT ILIKE '%dropped%'
          AND home_team_name NOT ILIKE '%bye%'
          AND home_team_name NOT ILIKE '%tbd%'
          AND home_team_name NOT ILIKE '%tba%'
          AND home_team_name NOT ILIKE '%forfeit%'
          AND home_team_name NOT ILIKE '%wildcard%'
          AND home_team_name NOT ILIKE '%no game%'
        LIMIT ${BATCH_SIZE}
      `);

      if (unlinked.rows.length === 0) break;
      homeProcessed += unlinked.rows.length;

      for (const row of unlinked.rows) {
        const name = row.name;
        const nameLower = name.toLowerCase().trim();
        
        // Find top 2 fuzzy matches with validation
        const matches = await client.query(`
          WITH candidates AS (
            SELECT 
              ta.team_id,
              ta.alias_name,
              te.team_name as full_name,
              similarity(ta.alias_name, $1) as sim,
              ${extractYearSQL('ta.alias_name')} as alias_year,
              ${extractGenderSQL('ta.alias_name')} as alias_gender
            FROM team_name_aliases ta
            JOIN team_elo te ON te.id = ta.team_id
            WHERE ta.alias_name % $1
              AND similarity(ta.alias_name, $1) >= $2
            ORDER BY sim DESC
            LIMIT 10
          )
          SELECT 
            team_id, alias_name, full_name, sim,
            alias_year, alias_gender
          FROM candidates
          WHERE 
            -- Year validation: if both have years, they must match
            (alias_year IS NULL OR ${extractYearSQL('$1::text')} IS NULL 
             OR alias_year = ${extractYearSQL('$1::text')})
            -- Gender validation: if both have gender, they must match
            AND (alias_gender IS NULL OR ${extractGenderSQL('$1::text')} IS NULL 
                 OR alias_gender = ${extractGenderSQL('$1::text')})
          ORDER BY sim DESC
          LIMIT 2
        `, [nameLower, SIMILARITY_THRESHOLD]);

        if (matches.rows.length === 0) continue;

        const top = matches.rows[0];
        const second = matches.rows[1];

        // Check for ambiguity
        if (second && (top.sim - second.sim) < AMBIGUITY_GAP) {
          // Queue for review
          await client.query(`
            INSERT INTO ambiguous_match_queue 
              (match_result_id, field_type, team_name_from_match,
               candidate_1_team_id, candidate_1_name, candidate_1_similarity,
               candidate_2_team_id, candidate_2_name, candidate_2_similarity)
            SELECT 
              mr.id, 'home', $1,
              $2, $3, $4,
              $5, $6, $7
            FROM match_results mr
            WHERE mr.home_team_name = $1
              AND mr.home_team_id IS NULL
            LIMIT 1
            ON CONFLICT DO NOTHING
          `, [name, top.team_id, top.full_name, top.sim, 
              second.team_id, second.full_name, second.sim]);
          stats.ambiguousHome++;
          continue;
        }

        // High confidence match - link and store alias
        const updated = await client.query(`
          UPDATE match_results
          SET home_team_id = $1
          WHERE home_team_name = $2
            AND home_team_id IS NULL
        `, [top.team_id, name]);

        if (updated.rowCount > 0) {
          stats.fuzzyHome += updated.rowCount;
          
          // Self-healing: Store this as a new alias
          await client.query(`
            INSERT INTO team_name_aliases (id, team_id, alias_name, source, created_at)
            VALUES (gen_random_uuid(), $1, $2, 'fuzzy_learned', NOW())
            ON CONFLICT DO NOTHING
          `, [top.team_id, nameLower]);
          stats.aliasesCreated++;
        }
      }

      process.stdout.write(`   Processed ${homeProcessed} unique names, linked ${stats.fuzzyHome}, queued ${stats.ambiguousHome}\r`);
    }
    console.log(`\n   HOME complete: +${stats.fuzzyHome.toLocaleString()} linked, ${stats.ambiguousHome} queued\n`);

    // Process AWAY teams
    console.log("   AWAY teams:");
    let awayProcessed = 0;
    while (true) {
      const unlinked = await client.query(`
        SELECT DISTINCT away_team_name as name
        FROM match_results 
        WHERE away_team_id IS NULL
          AND away_team_name IS NOT NULL
          AND LENGTH(away_team_name) >= 10
          AND away_team_name ~ '^[A-Za-z]'
          AND away_team_name NOT ILIKE '%***%'
          AND away_team_name NOT ILIKE '%dropped%'
          AND away_team_name NOT ILIKE '%bye%'
          AND away_team_name NOT ILIKE '%tbd%'
          AND away_team_name NOT ILIKE '%tba%'
          AND away_team_name NOT ILIKE '%forfeit%'
          AND away_team_name NOT ILIKE '%wildcard%'
          AND away_team_name NOT ILIKE '%no game%'
        LIMIT ${BATCH_SIZE}
      `);

      if (unlinked.rows.length === 0) break;
      awayProcessed += unlinked.rows.length;

      for (const row of unlinked.rows) {
        const name = row.name;
        const nameLower = name.toLowerCase().trim();
        
        const matches = await client.query(`
          WITH candidates AS (
            SELECT 
              ta.team_id,
              ta.alias_name,
              te.team_name as full_name,
              similarity(ta.alias_name, $1) as sim,
              ${extractYearSQL('ta.alias_name')} as alias_year,
              ${extractGenderSQL('ta.alias_name')} as alias_gender
            FROM team_name_aliases ta
            JOIN team_elo te ON te.id = ta.team_id
            WHERE ta.alias_name % $1
              AND similarity(ta.alias_name, $1) >= $2
            ORDER BY sim DESC
            LIMIT 10
          )
          SELECT 
            team_id, alias_name, full_name, sim,
            alias_year, alias_gender
          FROM candidates
          WHERE 
            (alias_year IS NULL OR ${extractYearSQL('$1::text')} IS NULL 
             OR alias_year = ${extractYearSQL('$1::text')})
            AND (alias_gender IS NULL OR ${extractGenderSQL('$1::text')} IS NULL 
                 OR alias_gender = ${extractGenderSQL('$1::text')})
          ORDER BY sim DESC
          LIMIT 2
        `, [nameLower, SIMILARITY_THRESHOLD]);

        if (matches.rows.length === 0) continue;

        const top = matches.rows[0];
        const second = matches.rows[1];

        if (second && (top.sim - second.sim) < AMBIGUITY_GAP) {
          await client.query(`
            INSERT INTO ambiguous_match_queue 
              (match_result_id, field_type, team_name_from_match,
               candidate_1_team_id, candidate_1_name, candidate_1_similarity,
               candidate_2_team_id, candidate_2_name, candidate_2_similarity)
            SELECT 
              mr.id, 'away', $1,
              $2, $3, $4,
              $5, $6, $7
            FROM match_results mr
            WHERE mr.away_team_name = $1
              AND mr.away_team_id IS NULL
            LIMIT 1
            ON CONFLICT DO NOTHING
          `, [name, top.team_id, top.full_name, top.sim, 
              second.team_id, second.full_name, second.sim]);
          stats.ambiguousAway++;
          continue;
        }

        const updated = await client.query(`
          UPDATE match_results
          SET away_team_id = $1
          WHERE away_team_name = $2
            AND away_team_id IS NULL
        `, [top.team_id, name]);

        if (updated.rowCount > 0) {
          stats.fuzzyAway += updated.rowCount;
          
          await client.query(`
            INSERT INTO team_name_aliases (id, team_id, alias_name, source, created_at)
            VALUES (gen_random_uuid(), $1, $2, 'fuzzy_learned', NOW())
            ON CONFLICT DO NOTHING
          `, [top.team_id, nameLower]);
          stats.aliasesCreated++;
        }
      }

      process.stdout.write(`   Processed ${awayProcessed} unique names, linked ${stats.fuzzyAway}, queued ${stats.ambiguousAway}\r`);
    }
    console.log(`\n   AWAY complete: +${stats.fuzzyAway.toLocaleString()} linked, ${stats.ambiguousAway} queued\n`);

    // ================================================================
    // FINAL RESULTS
    // ================================================================
    const final = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL) as fully_linked,
        COUNT(*) FILTER (WHERE home_team_id IS NOT NULL) as home_linked,
        COUNT(*) FILTER (WHERE away_team_id IS NOT NULL) as away_linked,
        COUNT(*) FILTER (WHERE home_team_id IS NULL AND home_team_name IS NOT NULL) as home_unlinked,
        COUNT(*) FILTER (WHERE away_team_id IS NULL AND away_team_name IS NOT NULL) as away_unlinked
      FROM match_results
    `);
    const f = final.rows[0];

    // Categorize remaining unlinked
    const unlinkedAnalysis = await client.query(`
      SELECT 
        COUNT(DISTINCT home_team_name) FILTER (WHERE home_team_id IS NULL 
          AND (home_team_name ILIKE '%***%' OR home_team_name ILIKE '%dropped%' 
               OR home_team_name ILIKE '%bye%' OR home_team_name ILIKE '%tbd%'
               OR home_team_name ILIKE '%tba%' OR home_team_name ILIKE '%forfeit%'
               OR home_team_name ILIKE '%wildcard%' OR home_team_name ILIKE '%no game%'
               OR home_team_name ~ '^[^A-Za-z]' OR LENGTH(home_team_name) < 10)) as garbage_names,
        COUNT(DISTINCT home_team_name) FILTER (WHERE home_team_id IS NULL
          AND home_team_name ~ '^[A-Za-z]' AND LENGTH(home_team_name) >= 10
          AND home_team_name NOT ILIKE '%***%' AND home_team_name NOT ILIKE '%dropped%'
          AND home_team_name NOT ILIKE '%bye%' AND home_team_name NOT ILIKE '%tbd%'
          AND home_team_name NOT ILIKE '%tba%') as valid_unlinked
      FROM match_results
    `);
    const ua = unlinkedAnalysis.rows[0];

    // Queue stats
    const queueStats = await client.query(`
      SELECT COUNT(*) as pending FROM ambiguous_match_queue WHERE status = 'pending'
    `);

    // Alias stats
    const aliasStats = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE source = 'fuzzy_learned') as learned
      FROM team_name_aliases
    `);

    console.log("═".repeat(65));
    console.log("📊 FINAL RESULTS:");
    console.log("═".repeat(65));
    console.log(`   Total matches:        ${parseInt(f.total).toLocaleString()}`);
    console.log(`   Fully linked:         ${parseInt(f.fully_linked).toLocaleString()} (${(f.fully_linked / f.total * 100).toFixed(1)}%)`);
    console.log(`   Home linked:          ${parseInt(f.home_linked).toLocaleString()} (${(f.home_linked / f.total * 100).toFixed(1)}%)`);
    console.log(`   Away linked:          ${parseInt(f.away_linked).toLocaleString()} (${(f.away_linked / f.total * 100).toFixed(1)}%)`);
    console.log("");
    console.log(`   ✨ IMPROVEMENT:       +${(f.fully_linked - b.fully_linked).toLocaleString()} fully linked`);
    console.log("");
    console.log("   By Phase:");
    console.log(`     1. Exact lookup:    Home +${stats.exactHome.toLocaleString()}, Away +${stats.exactAway.toLocaleString()}`);
    console.log(`     2. Normalized:      Home +${stats.normHome.toLocaleString()}, Away +${stats.normAway.toLocaleString()}`);
    console.log(`     3. Fuzzy match:     Home +${stats.fuzzyHome.toLocaleString()}, Away +${stats.fuzzyAway.toLocaleString()}`);
    console.log("");
    console.log("   Self-Healing:");
    console.log(`     New aliases:        ${stats.aliasesCreated.toLocaleString()}`);
    console.log(`     Total aliases:      ${parseInt(aliasStats.rows[0].total).toLocaleString()}`);
    console.log("");
    console.log("   Review Queue:");
    console.log(`     Pending:            ${queueStats.rows[0].pending}`);
    console.log("");
    console.log("   Remaining Unlinked:");
    console.log(`     Garbage/Invalid:    ${parseInt(ua.garbage_names).toLocaleString()} unique names`);
    console.log(`     Valid (no match):   ${parseInt(ua.valid_unlinked).toLocaleString()} unique names`);

  } catch (err) {
    console.error("❌ Error:", err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await client.end();
  }

  console.log("\n✅ Linking Complete!");
}

main();
