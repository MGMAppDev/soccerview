/**
 * Setup Comprehensive Linking Infrastructure
 * 
 * Creates all required database objects:
 * 1. ambiguous_match_queue table
 * 2. GIN trigram index on team_name_aliases
 * 3. All remaining alias types (color, year, punct combinations)
 * 
 * Usage: node scripts/setupLinkingInfrastructure.js
 */

import "dotenv/config";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ Missing DATABASE_URL");
  process.exit(1);
}

async function main() {
  console.log("🔧 Setup Comprehensive Linking Infrastructure");
  console.log("═".repeat(60));
  console.log(`Started: ${new Date().toISOString()}\n`);

  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 600000, // 10 minutes
  });

  try {
    await client.connect();
    console.log("✅ Connected\n");

    // ================================================================
    // STEP 1: Create ambiguous_match_queue table
    // ================================================================
    console.log("📦 STEP 1: Creating ambiguous_match_queue table...");
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS ambiguous_match_queue (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        match_result_id UUID NOT NULL,
        field_type TEXT NOT NULL CHECK (field_type IN ('home', 'away')),
        team_name_from_match TEXT NOT NULL,
        candidate_1_team_id UUID,
        candidate_1_name TEXT,
        candidate_1_similarity NUMERIC(5,4),
        candidate_2_team_id UUID,
        candidate_2_name TEXT,
        candidate_2_similarity NUMERIC(5,4),
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'dismissed')),
        resolved_team_id UUID,
        resolved_by TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        resolved_at TIMESTAMPTZ
      )
    `);
    
    // Add foreign key if not exists (may fail if already exists, that's ok)
    try {
      await client.query(`
        ALTER TABLE ambiguous_match_queue 
        ADD CONSTRAINT fk_match_result 
        FOREIGN KEY (match_result_id) REFERENCES match_results(id) ON DELETE CASCADE
      `);
    } catch (e) {
      if (!e.message.includes('already exists')) throw e;
    }
    
    // Create indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ambiguous_queue_status ON ambiguous_match_queue(status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ambiguous_queue_created ON ambiguous_match_queue(created_at DESC)`);
    
    console.log("   ✅ ambiguous_match_queue table ready\n");

    // ================================================================
    // STEP 2: Create GIN trigram index for fuzzy matching
    // ================================================================
    console.log("📦 STEP 2: Creating GIN trigram index...");
    
    // Check if pg_trgm extension exists
    await client.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    
    // Drop old index if exists and create new one
    await client.query(`DROP INDEX IF EXISTS idx_alias_name_trgm`);
    await client.query(`
      CREATE INDEX idx_alias_name_trgm 
      ON team_name_aliases 
      USING gin (alias_name gin_trgm_ops)
    `);
    
    console.log("   ✅ GIN trigram index created\n");

    // ================================================================
    // STEP 3: Add ALL remaining alias types
    // ================================================================
    console.log("📦 STEP 3: Adding comprehensive alias types...\n");
    
    const chunks = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');
    const colorPattern = `\\s+(red|blue|black|white|gold|silver|green|orange|navy|royal|gray|grey|purple|yellow|maroon|crimson|scarlet|teal|pink|brown|bronze|copper|platinum)\\s*`;
    
    // Track totals
    let totalAdded = 0;

    // ----- ALIAS TYPE 7: Full stripped with color removed -----
    console.log("   Type 7: Full + Color Removed");
    let type7 = 0;
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
            '\\s+', ' ', 'g'
          ))),
          'full_no_color',
          NOW()
        FROM team_elo
        WHERE team_name IS NOT NULL
          AND UPPER(LEFT(team_name, 1)) = $1
          AND team_name ~* '${colorPattern}'
        ON CONFLICT DO NOTHING
      `, [letter]);
      type7 += result.rowCount;
    }
    console.log(`      Created ${type7.toLocaleString()} aliases`);
    totalAdded += type7;

    // ----- ALIAS TYPE 8: Short form with color removed -----
    console.log("   Type 8: Short + Color Removed");
    let type8 = 0;
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
            '\\s+', ' ', 'g'
          ))),
          'short_no_color',
          NOW()
        FROM team_elo
        WHERE team_name IS NOT NULL
          AND UPPER(LEFT(team_name, 1)) = $1
          AND club_name IS NOT NULL AND club_name != ''
          AND LOWER(REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', '')) LIKE LOWER(club_name) || ' %'
          AND team_name ~* '${colorPattern}'
        ON CONFLICT DO NOTHING
      `, [letter]);
      type8 += result.rowCount;
    }
    console.log(`      Created ${type8.toLocaleString()} aliases`);
    totalAdded += type8;

    // ----- ALIAS TYPE 9: Split year normalized (2007/08 → 2007) -----
    console.log("   Type 9: Year Normalized (2007/08 → 2007)");
    let type9 = 0;
    for (const letter of chunks) {
      const result = await client.query(`
        INSERT INTO team_name_aliases (id, team_id, alias_name, source, created_at)
        SELECT 
          gen_random_uuid(),
          id,
          LOWER(TRIM(REGEXP_REPLACE(
            REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', ''),
            '(\\d{4})/\\d{2,4}', '\\1', 'g'
          ))),
          'year_normalized',
          NOW()
        FROM team_elo
        WHERE team_name IS NOT NULL
          AND UPPER(LEFT(team_name, 1)) = $1
          AND team_name ~ '\\d{4}/\\d{2}'
        ON CONFLICT DO NOTHING
      `, [letter]);
      type9 += result.rowCount;
    }
    console.log(`      Created ${type9.toLocaleString()} aliases`);
    totalAdded += type9;

    // ----- ALIAS TYPE 10: Short form + year normalized -----
    console.log("   Type 10: Short + Year Normalized");
    let type10 = 0;
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
            '(\\d{4})/\\d{2,4}', '\\1', 'g'
          ))),
          'short_year_norm',
          NOW()
        FROM team_elo
        WHERE team_name IS NOT NULL
          AND UPPER(LEFT(team_name, 1)) = $1
          AND club_name IS NOT NULL AND club_name != ''
          AND LOWER(REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', '')) LIKE LOWER(club_name) || ' %'
          AND team_name ~ '\\d{4}/\\d{2}'
        ON CONFLICT DO NOTHING
      `, [letter]);
      type10 += result.rowCount;
    }
    console.log(`      Created ${type10.toLocaleString()} aliases`);
    totalAdded += type10;

    // ----- ALIAS TYPE 11: Full + Color + Year normalized -----
    console.log("   Type 11: Full + Color + Year Normalized");
    let type11 = 0;
    for (const letter of chunks) {
      const result = await client.query(`
        INSERT INTO team_name_aliases (id, team_id, alias_name, source, created_at)
        SELECT 
          gen_random_uuid(),
          id,
          LOWER(TRIM(REGEXP_REPLACE(
            REGEXP_REPLACE(
              REGEXP_REPLACE(
                REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', ''),
                '${colorPattern}', ' ', 'gi'
              ),
              '(\\d{4})/\\d{2,4}', '\\1', 'g'
            ),
            '\\s+', ' ', 'g'
          ))),
          'full_no_color_year',
          NOW()
        FROM team_elo
        WHERE team_name IS NOT NULL
          AND UPPER(LEFT(team_name, 1)) = $1
          AND (team_name ~* '${colorPattern}' OR team_name ~ '\\d{4}/\\d{2}')
        ON CONFLICT DO NOTHING
      `, [letter]);
      type11 += result.rowCount;
    }
    console.log(`      Created ${type11.toLocaleString()} aliases`);
    totalAdded += type11;

    // ----- ALIAS TYPE 12: Short + Color + Year normalized -----
    console.log("   Type 12: Short + Color + Year Normalized");
    let type12 = 0;
    for (const letter of chunks) {
      const result = await client.query(`
        INSERT INTO team_name_aliases (id, team_id, alias_name, source, created_at)
        SELECT 
          gen_random_uuid(),
          id,
          LOWER(TRIM(REGEXP_REPLACE(
            REGEXP_REPLACE(
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
              '(\\d{4})/\\d{2,4}', '\\1', 'g'
            ),
            '\\s+', ' ', 'g'
          ))),
          'short_no_color_year',
          NOW()
        FROM team_elo
        WHERE team_name IS NOT NULL
          AND UPPER(LEFT(team_name, 1)) = $1
          AND club_name IS NOT NULL AND club_name != ''
          AND LOWER(REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', '')) LIKE LOWER(club_name) || ' %'
          AND (team_name ~* '${colorPattern}' OR team_name ~ '\\d{4}/\\d{2}')
        ON CONFLICT DO NOTHING
      `, [letter]);
      type12 += result.rowCount;
    }
    console.log(`      Created ${type12.toLocaleString()} aliases`);
    totalAdded += type12;

    // ----- ALIAS TYPE 13: Punctuation fully normalized -----
    console.log("   Type 13: Full Punctuation Normalized (dots, dashes, apostrophes)");
    let type13 = 0;
    for (const letter of chunks) {
      const result = await client.query(`
        INSERT INTO team_name_aliases (id, team_id, alias_name, source, created_at)
        SELECT 
          gen_random_uuid(),
          id,
          LOWER(TRIM(REGEXP_REPLACE(
            REGEXP_REPLACE(
              REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', ''),
              '[.''\"\\-]', '', 'g'
            ),
            '\\s+', ' ', 'g'
          ))),
          'full_punct_clean',
          NOW()
        FROM team_elo
        WHERE team_name IS NOT NULL
          AND UPPER(LEFT(team_name, 1)) = $1
          AND team_name ~ '[.''\"\\-]'
        ON CONFLICT DO NOTHING
      `, [letter]);
      type13 += result.rowCount;
    }
    console.log(`      Created ${type13.toLocaleString()} aliases`);
    totalAdded += type13;

    // ----- ALIAS TYPE 14: Short + Punctuation normalized -----
    console.log("   Type 14: Short + Punctuation Normalized");
    let type14 = 0;
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
              '[.''\"\\-]', '', 'g'
            ),
            '\\s+', ' ', 'g'
          ))),
          'short_punct_clean',
          NOW()
        FROM team_elo
        WHERE team_name IS NOT NULL
          AND UPPER(LEFT(team_name, 1)) = $1
          AND club_name IS NOT NULL AND club_name != ''
          AND LOWER(REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', '')) LIKE LOWER(club_name) || ' %'
          AND team_name ~ '[.''\"\\-]'
        ON CONFLICT DO NOTHING
      `, [letter]);
      type14 += result.rowCount;
    }
    console.log(`      Created ${type14.toLocaleString()} aliases`);
    totalAdded += type14;

    // ----- ALIAS TYPE 15: Everything combined (color + year + punct) -----
    console.log("   Type 15: Full + Color + Year + Punct Normalized");
    let type15 = 0;
    for (const letter of chunks) {
      const result = await client.query(`
        INSERT INTO team_name_aliases (id, team_id, alias_name, source, created_at)
        SELECT 
          gen_random_uuid(),
          id,
          LOWER(TRIM(REGEXP_REPLACE(
            REGEXP_REPLACE(
              REGEXP_REPLACE(
                REGEXP_REPLACE(
                  REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', ''),
                  '${colorPattern}', ' ', 'gi'
                ),
                '(\\d{4})/\\d{2,4}', '\\1', 'g'
              ),
              '[.''\"\\-]', '', 'g'
            ),
            '\\s+', ' ', 'g'
          ))),
          'full_all_norm',
          NOW()
        FROM team_elo
        WHERE team_name IS NOT NULL
          AND UPPER(LEFT(team_name, 1)) = $1
          AND (team_name ~* '${colorPattern}' OR team_name ~ '\\d{4}/\\d{2}' OR team_name ~ '[.''\"\\-]')
        ON CONFLICT DO NOTHING
      `, [letter]);
      type15 += result.rowCount;
    }
    console.log(`      Created ${type15.toLocaleString()} aliases`);
    totalAdded += type15;

    // ----- ALIAS TYPE 16: Short + Everything combined -----
    console.log("   Type 16: Short + Color + Year + Punct Normalized");
    let type16 = 0;
    for (const letter of chunks) {
      const result = await client.query(`
        INSERT INTO team_name_aliases (id, team_id, alias_name, source, created_at)
        SELECT 
          gen_random_uuid(),
          id,
          LOWER(TRIM(REGEXP_REPLACE(
            REGEXP_REPLACE(
              REGEXP_REPLACE(
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
                '(\\d{4})/\\d{2,4}', '\\1', 'g'
              ),
              '[.''\"\\-]', '', 'g'
            ),
            '\\s+', ' ', 'g'
          ))),
          'short_all_norm',
          NOW()
        FROM team_elo
        WHERE team_name IS NOT NULL
          AND UPPER(LEFT(team_name, 1)) = $1
          AND club_name IS NOT NULL AND club_name != ''
          AND LOWER(REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', '')) LIKE LOWER(club_name) || ' %'
          AND (team_name ~* '${colorPattern}' OR team_name ~ '\\d{4}/\\d{2}' OR team_name ~ '[.''\"\\-]')
        ON CONFLICT DO NOTHING
      `, [letter]);
      type16 += result.rowCount;
    }
    console.log(`      Created ${type16.toLocaleString()} aliases`);
    totalAdded += type16;

    // Update statistics
    console.log("\n   Analyzing table for query optimization...");
    await client.query(`ANALYZE team_name_aliases`);

    // ================================================================
    // FINAL STATS
    // ================================================================
    const stats = await client.query(`
      SELECT 
        COUNT(*) as total_aliases,
        COUNT(DISTINCT team_id) as teams_covered,
        COUNT(DISTINCT alias_name) as unique_aliases,
        COUNT(*) FILTER (WHERE source = 'full_stripped') as full_stripped,
        COUNT(*) FILTER (WHERE source = 'short_form') as short_form,
        COUNT(*) FILTER (WHERE source LIKE '%color%') as color_variants,
        COUNT(*) FILTER (WHERE source LIKE '%year%') as year_variants,
        COUNT(*) FILTER (WHERE source LIKE '%punct%' OR source LIKE '%all_norm%') as punct_variants
      FROM team_name_aliases
    `);
    
    const s = stats.rows[0];
    console.log("\n" + "═".repeat(60));
    console.log("📊 FINAL ALIAS TABLE STATS:");
    console.log("═".repeat(60));
    console.log(`   Total aliases:        ${parseInt(s.total_aliases).toLocaleString()}`);
    console.log(`   Unique aliases:       ${parseInt(s.unique_aliases).toLocaleString()}`);
    console.log(`   Teams covered:        ${parseInt(s.teams_covered).toLocaleString()}`);
    console.log(`   New aliases added:    ${totalAdded.toLocaleString()}`);
    console.log("");
    console.log("   By Category:");
    console.log(`     Base (stripped):    ${parseInt(s.full_stripped).toLocaleString()}`);
    console.log(`     Short form:         ${parseInt(s.short_form).toLocaleString()}`);
    console.log(`     Color variants:     ${parseInt(s.color_variants).toLocaleString()}`);
    console.log(`     Year variants:      ${parseInt(s.year_variants).toLocaleString()}`);
    console.log(`     Punct variants:     ${parseInt(s.punct_variants).toLocaleString()}`);

    // Check queue table
    const queueCheck = await client.query(`SELECT COUNT(*) as cnt FROM ambiguous_match_queue`);
    console.log(`\n   Review queue:         ${queueCheck.rows[0].cnt} items`);

  } catch (err) {
    console.error("❌ Error:", err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await client.end();
  }

  console.log("\n✅ Infrastructure Setup Complete!");
  console.log("Next: node scripts/linkMatchesComprehensive.js");
}

main();
