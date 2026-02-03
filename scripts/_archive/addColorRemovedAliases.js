/**
 * Add Color-Removed Aliases
 * 
 * Many team_elo names have color identifiers (Red, Blue, Black) that
 * match_results names don't have. Add aliases with colors stripped.
 * 
 * Usage: node scripts/addColorRemovedAliases.js
 */

import "dotenv/config";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ Missing DATABASE_URL");
  process.exit(1);
}

async function main() {
  console.log("🔧 Add Color-Removed Aliases");
  console.log("=".repeat(60));
  console.log(`Started: ${new Date().toISOString()}\n`);

  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 600000,
  });

  try {
    await client.connect();
    console.log("✅ Connected\n");

    const colorPattern = '\\s+(red|blue|black|white|gold|silver|green|orange|navy|royal|gray|grey|purple|yellow|maroon|crimson|scarlet|teal|pink|brown|bronze|copper|platinum)\\s+';
    
    const chunks = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');

    // ================================================================
    // ALIAS TYPE 7: Full stripped with color removed
    // ================================================================
    console.log("📝 ALIAS TYPE 7: Full Stripped + Color Removed");
    let type7Count = 0;
    for (const letter of chunks) {
      const result = await client.query(`
        INSERT INTO team_name_aliases (id, team_id, alias_name, source, created_at)
        SELECT 
          gen_random_uuid(),
          id,
          LOWER(TRIM(REGEXP_REPLACE(
            REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', ''),
            '${colorPattern}', ' ', 'gi'
          ))),
          'full_no_color',
          NOW()
        FROM team_elo
        WHERE team_name IS NOT NULL
          AND UPPER(LEFT(team_name, 1)) = $1
          AND team_name ~* '${colorPattern}'
        ON CONFLICT DO NOTHING
      `, [letter]);
      type7Count += result.rowCount;
      if (result.rowCount > 0) process.stdout.write(`${letter}:${result.rowCount} `);
    }
    console.log(`\n   Created ${type7Count.toLocaleString()} aliases\n`);

    // ================================================================
    // ALIAS TYPE 8: Short form with color removed
    // ================================================================
    console.log("📝 ALIAS TYPE 8: Short Form + Color Removed");
    let type8Count = 0;
    for (const letter of chunks) {
      const result = await client.query(`
        INSERT INTO team_name_aliases (id, team_id, alias_name, source, created_at)
        SELECT 
          gen_random_uuid(),
          id,
          LOWER(TRIM(REGEXP_REPLACE(
            CASE 
              WHEN club_name IS NOT NULL 
                AND club_name != ''
                AND LOWER(REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', '')) LIKE LOWER(club_name) || ' %'
              THEN SUBSTRING(
                REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', ''),
                LENGTH(club_name) + 2
              )
              ELSE NULL
            END,
            '${colorPattern}', ' ', 'gi'
          ))),
          'short_no_color',
          NOW()
        FROM team_elo
        WHERE team_name IS NOT NULL
          AND UPPER(LEFT(team_name, 1)) = $1
          AND club_name IS NOT NULL
          AND club_name != ''
          AND LOWER(REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', '')) LIKE LOWER(club_name) || ' %'
          AND team_name ~* '${colorPattern}'
        ON CONFLICT DO NOTHING
      `, [letter]);
      type8Count += result.rowCount;
      if (result.rowCount > 0) process.stdout.write(`${letter}:${result.rowCount} `);
    }
    console.log(`\n   Created ${type8Count.toLocaleString()} aliases\n`);

    // ================================================================
    // ALIAS TYPE 9: Split year normalized (2007/08 → 2007)
    // ================================================================
    console.log("📝 ALIAS TYPE 9: Split Year Normalized");
    let type9Count = 0;
    for (const letter of chunks) {
      const result = await client.query(`
        INSERT INTO team_name_aliases (id, team_id, alias_name, source, created_at)
        SELECT 
          gen_random_uuid(),
          id,
          LOWER(TRIM(REGEXP_REPLACE(
            REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', ''),
            '(\\d{4})/\\d{2}', '\\1', 'g'
          ))),
          'year_normalized',
          NOW()
        FROM team_elo
        WHERE team_name IS NOT NULL
          AND UPPER(LEFT(team_name, 1)) = $1
          AND team_name ~ '\\d{4}/\\d{2}'
        ON CONFLICT DO NOTHING
      `, [letter]);
      type9Count += result.rowCount;
      if (result.rowCount > 0) process.stdout.write(`${letter}:${result.rowCount} `);
    }
    console.log(`\n   Created ${type9Count.toLocaleString()} aliases\n`);

    // ================================================================
    // ALIAS TYPE 10: Short form + year normalized
    // ================================================================
    console.log("📝 ALIAS TYPE 10: Short Form + Year Normalized");
    let type10Count = 0;
    for (const letter of chunks) {
      const result = await client.query(`
        INSERT INTO team_name_aliases (id, team_id, alias_name, source, created_at)
        SELECT 
          gen_random_uuid(),
          id,
          LOWER(TRIM(REGEXP_REPLACE(
            CASE 
              WHEN club_name IS NOT NULL 
                AND club_name != ''
                AND LOWER(REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', '')) LIKE LOWER(club_name) || ' %'
              THEN SUBSTRING(
                REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', ''),
                LENGTH(club_name) + 2
              )
              ELSE NULL
            END,
            '(\\d{4})/\\d{2}', '\\1', 'g'
          ))),
          'short_year_norm',
          NOW()
        FROM team_elo
        WHERE team_name IS NOT NULL
          AND UPPER(LEFT(team_name, 1)) = $1
          AND club_name IS NOT NULL
          AND club_name != ''
          AND LOWER(REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', '')) LIKE LOWER(club_name) || ' %'
          AND team_name ~ '\\d{4}/\\d{2}'
        ON CONFLICT DO NOTHING
      `, [letter]);
      type10Count += result.rowCount;
      if (result.rowCount > 0) process.stdout.write(`${letter}:${result.rowCount} `);
    }
    console.log(`\n   Created ${type10Count.toLocaleString()} aliases\n`);

    // ================================================================
    // ALIAS TYPE 11: Color + year both normalized
    // ================================================================
    console.log("📝 ALIAS TYPE 11: Color + Year Both Normalized");
    let type11Count = 0;
    for (const letter of chunks) {
      const result = await client.query(`
        INSERT INTO team_name_aliases (id, team_id, alias_name, source, created_at)
        SELECT 
          gen_random_uuid(),
          id,
          LOWER(TRIM(REGEXP_REPLACE(
            REGEXP_REPLACE(
              REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', ''),
              '${colorPattern}', ' ', 'gi'
            ),
            '(\\d{4})/\\d{2}', '\\1', 'g'
          ))),
          'full_no_color_year_norm',
          NOW()
        FROM team_elo
        WHERE team_name IS NOT NULL
          AND UPPER(LEFT(team_name, 1)) = $1
          AND (team_name ~* '${colorPattern}' OR team_name ~ '\\d{4}/\\d{2}')
        ON CONFLICT DO NOTHING
      `, [letter]);
      type11Count += result.rowCount;
      if (result.rowCount > 0) process.stdout.write(`${letter}:${result.rowCount} `);
    }
    console.log(`\n   Created ${type11Count.toLocaleString()} aliases\n`);

    // ================================================================
    // ALIAS TYPE 12: Short form + Color + year normalized
    // ================================================================
    console.log("📝 ALIAS TYPE 12: Short + Color + Year Normalized");
    let type12Count = 0;
    for (const letter of chunks) {
      const result = await client.query(`
        INSERT INTO team_name_aliases (id, team_id, alias_name, source, created_at)
        SELECT 
          gen_random_uuid(),
          id,
          LOWER(TRIM(REGEXP_REPLACE(
            REGEXP_REPLACE(
              CASE 
                WHEN club_name IS NOT NULL 
                  AND club_name != ''
                  AND LOWER(REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', '')) LIKE LOWER(club_name) || ' %'
                THEN SUBSTRING(
                  REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', ''),
                  LENGTH(club_name) + 2
                )
                ELSE NULL
              END,
              '${colorPattern}', ' ', 'gi'
            ),
            '(\\d{4})/\\d{2}', '\\1', 'g'
          ))),
          'short_no_color_year_norm',
          NOW()
        FROM team_elo
        WHERE team_name IS NOT NULL
          AND UPPER(LEFT(team_name, 1)) = $1
          AND club_name IS NOT NULL
          AND club_name != ''
          AND LOWER(REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', '')) LIKE LOWER(club_name) || ' %'
          AND (team_name ~* '${colorPattern}' OR team_name ~ '\\d{4}/\\d{2}')
        ON CONFLICT DO NOTHING
      `, [letter]);
      type12Count += result.rowCount;
      if (result.rowCount > 0) process.stdout.write(`${letter}:${result.rowCount} `);
    }
    console.log(`\n   Created ${type12Count.toLocaleString()} aliases\n`);

    // Update statistics
    console.log("Analyzing table for query optimization...");
    await client.query(`ANALYZE team_name_aliases`);

    // Final stats
    const stats = await client.query(`
      SELECT 
        COUNT(*) as total_aliases,
        COUNT(DISTINCT team_id) as teams_covered,
        COUNT(DISTINCT alias_name) as unique_aliases
      FROM team_name_aliases
    `);
    
    console.log("═".repeat(60));
    console.log("📊 UPDATED ALIAS TABLE:");
    console.log(`   Total aliases:    ${parseInt(stats.rows[0].total_aliases).toLocaleString()}`);
    console.log(`   Unique aliases:   ${parseInt(stats.rows[0].unique_aliases).toLocaleString()}`);
    console.log(`   Teams covered:    ${parseInt(stats.rows[0].teams_covered).toLocaleString()}`);

  } catch (err) {
    console.error("❌ Error:", err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await client.end();
  }

  console.log("\n✅ Step 4 Complete!");
  console.log("Next: node scripts/linkViaAliases.js (run again)");
}

main();
