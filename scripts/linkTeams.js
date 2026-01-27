/**
 * Team Linking Script v5.0 - BIRTH YEAR VALIDATION
 * =================================================
 *
 * FIXES THE ROOT CAUSE:
 * - team_elo has names like "Club Name 2013 (U13 Boys)"
 * - match_results has names like "Club Name 2013" (no suffix)
 * - This script strips the suffix before matching
 *
 * v5.0 FIX: Validates birth years match to prevent linking
 * "Pre-NAL 14" matches to "Pre-NAL 15" teams
 *
 * RUNS NIGHTLY via GitHub Actions daily-data-sync.yml
 *
 * Usage:
 *   node scripts/linkTeams.js              # Default (45 min timeout)
 *   node scripts/linkTeams.js --timeout=90 # Custom timeout
 */

import "dotenv/config";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Parse CLI args
const args = process.argv.slice(2);
const timeoutArg = args.find((a) => a.startsWith("--timeout="));
const TIMEOUT_MINUTES = timeoutArg ? parseInt(timeoutArg.split("=")[1]) : 45;

// If we have DATABASE_URL, use direct Postgres (faster, no timeout issues)
// Otherwise fall back to Supabase client
const USE_DIRECT_PG = !!DATABASE_URL;

async function main() {
  console.log("=".repeat(60));
  console.log("🔗 TEAM LINKING v4.0 - PRODUCTION");
  console.log("=".repeat(60));
  console.log(`Mode: ${USE_DIRECT_PG ? 'Direct PostgreSQL' : 'Supabase API'}`);
  console.log(`Timeout: ${TIMEOUT_MINUTES} minutes`);
  console.log(`Started at: ${new Date().toISOString()}\n`);

  if (!USE_DIRECT_PG) {
    console.error("❌ DATABASE_URL required for production linking");
    console.error("   Set DATABASE_URL environment variable");
    process.exit(1);
  }

  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: (TIMEOUT_MINUTES - 5) * 60 * 1000, // Leave 5 min buffer
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

    const chunks = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');
    
    // ============================================================
    // STRATEGY 1: Exact match (case-insensitive, no suffix strip)
    // For matches where names already match perfectly
    // ============================================================
    console.log("🎯 STRATEGY 1: Exact match (case-insensitive)...\n");
    
    let s1Home = 0, s1Away = 0;
    
    for (const letter of chunks) {
      const homeResult = await client.query(`
        UPDATE match_results mr
        SET home_team_id = te.id
        FROM team_elo te
        WHERE mr.home_team_id IS NULL
          AND mr.home_team_name IS NOT NULL
          AND UPPER(LEFT(mr.home_team_name, 1)) = $1
          AND LOWER(TRIM(mr.home_team_name)) = LOWER(TRIM(te.team_name))
      `, [letter]);
      
      const awayResult = await client.query(`
        UPDATE match_results mr
        SET away_team_id = te.id
        FROM team_elo te
        WHERE mr.away_team_id IS NULL
          AND mr.away_team_name IS NOT NULL
          AND UPPER(LEFT(mr.away_team_name, 1)) = $1
          AND LOWER(TRIM(mr.away_team_name)) = LOWER(TRIM(te.team_name))
      `, [letter]);
      
      s1Home += homeResult.rowCount;
      s1Away += awayResult.rowCount;
    }
    
    console.log(`   ✅ Exact: Home +${s1Home.toLocaleString()}, Away +${s1Away.toLocaleString()}\n`);

    // ============================================================
    // STRATEGY 2: Match after stripping (Uxx Boys/Girls) suffix
    // ROOT CAUSE FIX: team_elo has suffix, match_results doesn't
    // ============================================================
    console.log("🎯 STRATEGY 2: Match after stripping (Uxx Boys/Girls) suffix...\n");
    
    let s2Home = 0, s2Away = 0;
    
    for (const letter of chunks) {
      const homeResult = await client.query(`
        UPDATE match_results mr
        SET home_team_id = te.id
        FROM team_elo te
        WHERE mr.home_team_id IS NULL
          AND mr.home_team_name IS NOT NULL
          AND UPPER(LEFT(mr.home_team_name, 1)) = $1
          AND LOWER(TRIM(mr.home_team_name)) = LOWER(TRIM(REGEXP_REPLACE(te.team_name, '\\s*\\([^)]*\\)\\s*$', '')))
      `, [letter]);
      
      const awayResult = await client.query(`
        UPDATE match_results mr
        SET away_team_id = te.id
        FROM team_elo te
        WHERE mr.away_team_id IS NULL
          AND mr.away_team_name IS NOT NULL
          AND UPPER(LEFT(mr.away_team_name, 1)) = $1
          AND LOWER(TRIM(mr.away_team_name)) = LOWER(TRIM(REGEXP_REPLACE(te.team_name, '\\s*\\([^)]*\\)\\s*$', '')))
      `, [letter]);
      
      s2Home += homeResult.rowCount;
      s2Away += awayResult.rowCount;
      
      if (homeResult.rowCount > 0 || awayResult.rowCount > 0) {
        process.stdout.write(`   ${letter}: +${homeResult.rowCount + awayResult.rowCount} `);
      }
    }
    
    console.log(`\n   ✅ Suffix-stripped: Home +${s2Home.toLocaleString()}, Away +${s2Away.toLocaleString()}\n`);

    // ============================================================
    // STRATEGY 3: Prefix match (30 chars) WITH BIRTH YEAR VALIDATION
    // v5.0 FIX: Extract birth year from both names and require match
    // ============================================================
    console.log("🎯 STRATEGY 3: Prefix match (30 chars) + birth year validation...\n");

    let s3Home = 0, s3Away = 0;

    // Helper: Extract birth year from name (matches 2009-2019, or "Pre-NAL 14" style)
    const BIRTH_YEAR_REGEX = "(20[0-1][0-9])|(Pre-?NAL\\s*([0-9]{2}))";

    for (const letter of chunks) {
      // Strategy 3a: Both have birth years - must match
      const homeResult = await client.query(`
        WITH team_prefixes AS (
          SELECT DISTINCT ON (LEFT(LOWER(TRIM(REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', ''))), 30))
            id,
            LEFT(LOWER(TRIM(REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', ''))), 30) as prefix,
            COALESCE(
              (regexp_match(team_name, '(20[0-1][0-9])'))[1],
              '20' || (regexp_match(team_name, 'Pre-?NAL\\s*([0-9]{2})', 'i'))[1]
            ) as birth_year
          FROM team_elo
          WHERE UPPER(LEFT(team_name, 1)) = $1
          ORDER BY LEFT(LOWER(TRIM(REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', ''))), 30), elo_rating DESC
        )
        UPDATE match_results mr
        SET home_team_id = tp.id
        FROM team_prefixes tp
        WHERE mr.home_team_id IS NULL
          AND mr.home_team_name IS NOT NULL
          AND UPPER(LEFT(mr.home_team_name, 1)) = $1
          AND LEFT(LOWER(TRIM(mr.home_team_name)), 30) = tp.prefix
          AND (
            -- Either both have matching birth years
            (tp.birth_year IS NOT NULL AND (
              mr.home_team_name ~ ('(^|\\D)' || tp.birth_year || '(\\D|$)')
              OR mr.home_team_name ~* ('Pre-?NAL\\s*' || RIGHT(tp.birth_year, 2))
            ))
            -- Or neither has a birth year
            OR (tp.birth_year IS NULL AND mr.home_team_name !~ '20[0-1][0-9]' AND mr.home_team_name !~* 'Pre-?NAL\\s*[0-9]{2}')
          )
      `, [letter]);

      const awayResult = await client.query(`
        WITH team_prefixes AS (
          SELECT DISTINCT ON (LEFT(LOWER(TRIM(REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', ''))), 30))
            id,
            LEFT(LOWER(TRIM(REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', ''))), 30) as prefix,
            COALESCE(
              (regexp_match(team_name, '(20[0-1][0-9])'))[1],
              '20' || (regexp_match(team_name, 'Pre-?NAL\\s*([0-9]{2})', 'i'))[1]
            ) as birth_year
          FROM team_elo
          WHERE UPPER(LEFT(team_name, 1)) = $1
          ORDER BY LEFT(LOWER(TRIM(REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', ''))), 30), elo_rating DESC
        )
        UPDATE match_results mr
        SET away_team_id = tp.id
        FROM team_prefixes tp
        WHERE mr.away_team_id IS NULL
          AND mr.away_team_name IS NOT NULL
          AND UPPER(LEFT(mr.away_team_name, 1)) = $1
          AND LEFT(LOWER(TRIM(mr.away_team_name)), 30) = tp.prefix
          AND (
            -- Either both have matching birth years
            (tp.birth_year IS NOT NULL AND (
              mr.away_team_name ~ ('(^|\\D)' || tp.birth_year || '(\\D|$)')
              OR mr.away_team_name ~* ('Pre-?NAL\\s*' || RIGHT(tp.birth_year, 2))
            ))
            -- Or neither has a birth year
            OR (tp.birth_year IS NULL AND mr.away_team_name !~ '20[0-1][0-9]' AND mr.away_team_name !~* 'Pre-?NAL\\s*[0-9]{2}')
          )
      `, [letter]);

      s3Home += homeResult.rowCount;
      s3Away += awayResult.rowCount;
    }

    console.log(`   ✅ 30-char prefix + year: Home +${s3Home.toLocaleString()}, Away +${s3Away.toLocaleString()}\n`);

    // ============================================================
    // STRATEGY 4: Shorter prefix (20 chars) WITH BIRTH YEAR VALIDATION
    // v5.0 FIX: Must validate birth years to prevent cross-age linking
    // ============================================================
    console.log("🎯 STRATEGY 4: Prefix match (20 chars) + birth year validation...\n");

    let s4Home = 0, s4Away = 0;

    for (const letter of chunks) {
      const homeResult = await client.query(`
        WITH team_prefixes AS (
          SELECT DISTINCT ON (LEFT(LOWER(TRIM(REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', ''))), 20))
            id,
            LEFT(LOWER(TRIM(REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', ''))), 20) as prefix,
            COALESCE(
              (regexp_match(team_name, '(20[0-1][0-9])'))[1],
              '20' || (regexp_match(team_name, 'Pre-?NAL\\s*([0-9]{2})', 'i'))[1]
            ) as birth_year
          FROM team_elo
          WHERE UPPER(LEFT(team_name, 1)) = $1
          ORDER BY LEFT(LOWER(TRIM(REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', ''))), 20), elo_rating DESC
        )
        UPDATE match_results mr
        SET home_team_id = tp.id
        FROM team_prefixes tp
        WHERE mr.home_team_id IS NULL
          AND mr.home_team_name IS NOT NULL
          AND UPPER(LEFT(mr.home_team_name, 1)) = $1
          AND LEFT(LOWER(TRIM(mr.home_team_name)), 20) = tp.prefix
          AND (
            -- Either both have matching birth years
            (tp.birth_year IS NOT NULL AND (
              mr.home_team_name ~ ('(^|\\D)' || tp.birth_year || '(\\D|$)')
              OR mr.home_team_name ~* ('Pre-?NAL\\s*' || RIGHT(tp.birth_year, 2))
            ))
            -- Or neither has a birth year
            OR (tp.birth_year IS NULL AND mr.home_team_name !~ '20[0-1][0-9]' AND mr.home_team_name !~* 'Pre-?NAL\\s*[0-9]{2}')
          )
      `, [letter]);

      const awayResult = await client.query(`
        WITH team_prefixes AS (
          SELECT DISTINCT ON (LEFT(LOWER(TRIM(REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', ''))), 20))
            id,
            LEFT(LOWER(TRIM(REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', ''))), 20) as prefix,
            COALESCE(
              (regexp_match(team_name, '(20[0-1][0-9])'))[1],
              '20' || (regexp_match(team_name, 'Pre-?NAL\\s*([0-9]{2})', 'i'))[1]
            ) as birth_year
          FROM team_elo
          WHERE UPPER(LEFT(team_name, 1)) = $1
          ORDER BY LEFT(LOWER(TRIM(REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', ''))), 20), elo_rating DESC
        )
        UPDATE match_results mr
        SET away_team_id = tp.id
        FROM team_prefixes tp
        WHERE mr.away_team_id IS NULL
          AND mr.away_team_name IS NOT NULL
          AND UPPER(LEFT(mr.away_team_name, 1)) = $1
          AND LEFT(LOWER(TRIM(mr.away_team_name)), 20) = tp.prefix
          AND (
            -- Either both have matching birth years
            (tp.birth_year IS NOT NULL AND (
              mr.away_team_name ~ ('(^|\\D)' || tp.birth_year || '(\\D|$)')
              OR mr.away_team_name ~* ('Pre-?NAL\\s*' || RIGHT(tp.birth_year, 2))
            ))
            -- Or neither has a birth year
            OR (tp.birth_year IS NULL AND mr.away_team_name !~ '20[0-1][0-9]' AND mr.away_team_name !~* 'Pre-?NAL\\s*[0-9]{2}')
          )
      `, [letter]);

      s4Home += homeResult.rowCount;
      s4Away += awayResult.rowCount;
    }

    console.log(`   ✅ 20-char prefix + year: Home +${s4Home.toLocaleString()}, Away +${s4Away.toLocaleString()}\n`);

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
