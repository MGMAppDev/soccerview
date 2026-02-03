/**
 * Populate Team Name Aliases - COMPREHENSIVE ALIAS BUILDER v2
 * 
 * Creates ALL known name variations for robust matching:
 * 
 * 1. full_stripped - Suffix (Uxx Boys/Girls) removed
 * 2. short_form - Club prefix + suffix removed  
 * 3. double_club_stripped - When club appears twice, remove duplicate
 * 4. full_punct_norm - #1 with punctuation normalized
 * 5. short_punct_norm - #2 with punctuation normalized
 * 6. double_punct_norm - #3 with punctuation normalized
 * 
 * CHUNKED by first letter to avoid timeouts.
 * 
 * Usage: node scripts/populateAliases.js
 */

import "dotenv/config";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ Missing DATABASE_URL");
  process.exit(1);
}

// Normalize punctuation: remove dots, normalize dashes/apostrophes to spaces, collapse whitespace
function normalizeSQL(column) {
  return `LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(${column}, '[.''"]', '', 'g'), '[-]', ' ', 'g')))`;
}

async function main() {
  console.log("🔧 Populate Team Name Aliases - COMPREHENSIVE v2");
  console.log("=".repeat(60));
  console.log(`Started: ${new Date().toISOString()}\n`);

  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 600000, // 10 minutes total
  });

  try {
    await client.connect();
    console.log("✅ Connected\n");

    // Step 0: Clear existing aliases (fresh start)
    console.log("Step 0: Clearing existing aliases...");
    const cleared = await client.query(`DELETE FROM team_name_aliases`);
    console.log(`   Cleared ${cleared.rowCount} existing aliases\n`);

    const chunks = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');
    let totalAliases = 0;

    // ================================================================
    // ALIAS TYPE 1: full_stripped (suffix removed)
    // ================================================================
    console.log("📝 ALIAS TYPE 1: Full Stripped (suffix removed)");
    let type1Count = 0;
    for (const letter of chunks) {
      const result = await client.query(`
        INSERT INTO team_name_aliases (id, team_id, alias_name, source, created_at)
        SELECT 
          gen_random_uuid(),
          id,
          LOWER(TRIM(REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', ''))),
          'full_stripped',
          NOW()
        FROM team_elo
        WHERE team_name IS NOT NULL
          AND UPPER(LEFT(team_name, 1)) = $1
        ON CONFLICT DO NOTHING
      `, [letter]);
      type1Count += result.rowCount;
      process.stdout.write(`${letter} `);
    }
    console.log(`\n   Created ${type1Count.toLocaleString()} aliases\n`);
    totalAliases += type1Count;

    // ================================================================
    // ALIAS TYPE 2: short_form (club prefix + suffix removed)
    // ================================================================
    console.log("📝 ALIAS TYPE 2: Short Form (club prefix removed)");
    let type2Count = 0;
    for (const letter of chunks) {
      const result = await client.query(`
        INSERT INTO team_name_aliases (id, team_id, alias_name, source, created_at)
        SELECT 
          gen_random_uuid(),
          id,
          LOWER(TRIM(
            CASE 
              WHEN club_name IS NOT NULL 
                AND club_name != ''
                AND LOWER(REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', '')) LIKE LOWER(club_name) || ' %'
              THEN SUBSTRING(
                REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', ''),
                LENGTH(club_name) + 2
              )
              ELSE NULL
            END
          )),
          'short_form',
          NOW()
        FROM team_elo
        WHERE team_name IS NOT NULL
          AND UPPER(LEFT(team_name, 1)) = $1
          AND club_name IS NOT NULL
          AND club_name != ''
          AND LOWER(REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', '')) LIKE LOWER(club_name) || ' %'
          -- Ensure short form is different and not empty
          AND LENGTH(TRIM(SUBSTRING(
                REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', ''),
                LENGTH(club_name) + 2
              ))) > 3
        ON CONFLICT DO NOTHING
      `, [letter]);
      type2Count += result.rowCount;
      process.stdout.write(`${letter} `);
    }
    console.log(`\n   Created ${type2Count.toLocaleString()} aliases\n`);
    totalAliases += type2Count;

    // ================================================================
    // ALIAS TYPE 3: double_club_stripped (remove duplicate club name)
    // Example: "ALBION SC San Diego ALBION SC San Diego B14" -> "ALBION SC San Diego B14"
    // ================================================================
    console.log("📝 ALIAS TYPE 3: Double Club Stripped");
    let type3Count = 0;
    for (const letter of chunks) {
      const result = await client.query(`
        INSERT INTO team_name_aliases (id, team_id, alias_name, source, created_at)
        SELECT 
          gen_random_uuid(),
          id,
          LOWER(TRIM(
            REGEXP_REPLACE(
              REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', ''),  -- Strip suffix
              '^(' || REGEXP_REPLACE(club_name, '([.\\[\\]{}()*+?^$|\\\\])', '\\\\\\1', 'g') || ')\\s+\\1\\s*',  -- Remove doubled club
              '\\1 ',
              'i'
            )
          )),
          'double_club_stripped',
          NOW()
        FROM team_elo
        WHERE team_name IS NOT NULL
          AND UPPER(LEFT(team_name, 1)) = $1
          AND club_name IS NOT NULL
          AND LENGTH(club_name) > 3
          -- Only where club appears twice
          AND LOWER(REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', '')) 
              LIKE LOWER(club_name) || ' ' || LOWER(club_name) || '%'
        ON CONFLICT DO NOTHING
      `, [letter]);
      type3Count += result.rowCount;
      if (result.rowCount > 0) process.stdout.write(`${letter}:${result.rowCount} `);
    }
    console.log(`\n   Created ${type3Count.toLocaleString()} aliases\n`);
    totalAliases += type3Count;

    // ================================================================
    // ALIAS TYPE 4: full_punct_norm (punctuation normalized)
    // Removes dots, normalizes dashes
    // ================================================================
    console.log("📝 ALIAS TYPE 4: Full Punct Normalized");
    let type4Count = 0;
    for (const letter of chunks) {
      const result = await client.query(`
        INSERT INTO team_name_aliases (id, team_id, alias_name, source, created_at)
        SELECT 
          gen_random_uuid(),
          id,
          LOWER(TRIM(REGEXP_REPLACE(
            REGEXP_REPLACE(
              REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', ''),  -- Strip suffix
              '[.''\"]', '', 'g'  -- Remove dots, apostrophes, quotes
            ),
            '[-]', ' ', 'g'  -- Dashes to spaces
          ))),
          'full_punct_norm',
          NOW()
        FROM team_elo
        WHERE team_name IS NOT NULL
          AND UPPER(LEFT(team_name, 1)) = $1
          -- Only if it differs from full_stripped (has punctuation)
          AND team_name ~ '[.''\"\\-]'
        ON CONFLICT DO NOTHING
      `, [letter]);
      type4Count += result.rowCount;
      process.stdout.write(`${letter} `);
    }
    console.log(`\n   Created ${type4Count.toLocaleString()} aliases\n`);
    totalAliases += type4Count;

    // ================================================================
    // ALIAS TYPE 5: short_punct_norm (short form + punctuation normalized)
    // ================================================================
    console.log("📝 ALIAS TYPE 5: Short Form Punct Normalized");
    let type5Count = 0;
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
              '[.''\"]', '', 'g'
            ),
            '[-]', ' ', 'g'
          ))),
          'short_punct_norm',
          NOW()
        FROM team_elo
        WHERE team_name IS NOT NULL
          AND UPPER(LEFT(team_name, 1)) = $1
          AND club_name IS NOT NULL
          AND club_name != ''
          AND LOWER(REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', '')) LIKE LOWER(club_name) || ' %'
          AND team_name ~ '[.''\"\\-]'
          AND LENGTH(TRIM(SUBSTRING(
                REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', ''),
                LENGTH(club_name) + 2
              ))) > 3
        ON CONFLICT DO NOTHING
      `, [letter]);
      type5Count += result.rowCount;
      process.stdout.write(`${letter} `);
    }
    console.log(`\n   Created ${type5Count.toLocaleString()} aliases\n`);
    totalAliases += type5Count;

    // ================================================================
    // ALIAS TYPE 6: Whitespace collapsed (multiple spaces to single)
    // ================================================================
    console.log("📝 ALIAS TYPE 6: Whitespace Collapsed");
    let type6Count = 0;
    for (const letter of chunks) {
      const result = await client.query(`
        INSERT INTO team_name_aliases (id, team_id, alias_name, source, created_at)
        SELECT 
          gen_random_uuid(),
          id,
          LOWER(REGEXP_REPLACE(
            TRIM(REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', '')),
            '\\s+', ' ', 'g'  -- Collapse multiple spaces
          )),
          'whitespace_collapsed',
          NOW()
        FROM team_elo
        WHERE team_name IS NOT NULL
          AND UPPER(LEFT(team_name, 1)) = $1
          -- Only if it has multiple spaces
          AND team_name ~ '\\s{2,}'
        ON CONFLICT DO NOTHING
      `, [letter]);
      type6Count += result.rowCount;
      if (result.rowCount > 0) process.stdout.write(`${letter}:${result.rowCount} `);
    }
    console.log(`\n   Created ${type6Count.toLocaleString()} aliases\n`);
    totalAliases += type6Count;

    // ================================================================
    // FINAL STATS
    // ================================================================
    const stats = await client.query(`
      SELECT 
        COUNT(*) as total_aliases,
        COUNT(DISTINCT team_id) as teams_with_aliases,
        COUNT(DISTINCT alias_name) as unique_aliases,
        COUNT(*) FILTER (WHERE source = 'full_stripped') as full_stripped,
        COUNT(*) FILTER (WHERE source = 'short_form') as short_form,
        COUNT(*) FILTER (WHERE source = 'double_club_stripped') as double_club,
        COUNT(*) FILTER (WHERE source = 'full_punct_norm') as full_punct,
        COUNT(*) FILTER (WHERE source = 'short_punct_norm') as short_punct,
        COUNT(*) FILTER (WHERE source = 'whitespace_collapsed') as whitespace
      FROM team_name_aliases
    `);
    
    const s = stats.rows[0];
    console.log("═".repeat(60));
    console.log("📊 FINAL ALIAS TABLE STATS:");
    console.log("═".repeat(60));
    console.log(`   Total aliases created:     ${parseInt(s.total_aliases).toLocaleString()}`);
    console.log(`   Unique alias strings:      ${parseInt(s.unique_aliases).toLocaleString()}`);
    console.log(`   Teams covered:             ${parseInt(s.teams_with_aliases).toLocaleString()}`);
    console.log("");
    console.log("   By Type:");
    console.log(`     1. Full Stripped:        ${parseInt(s.full_stripped).toLocaleString()}`);
    console.log(`     2. Short Form:           ${parseInt(s.short_form).toLocaleString()}`);
    console.log(`     3. Double Club:          ${parseInt(s.double_club).toLocaleString()}`);
    console.log(`     4. Full Punct Norm:      ${parseInt(s.full_punct).toLocaleString()}`);
    console.log(`     5. Short Punct Norm:     ${parseInt(s.short_punct).toLocaleString()}`);
    console.log(`     6. Whitespace Collapsed: ${parseInt(s.whitespace).toLocaleString()}`);

  } catch (err) {
    console.error("❌ Error:", err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await client.end();
  }

  console.log("\n✅ Step 1 Complete!");
  console.log("Next: node scripts/createAliasIndex.js");
}

main();
