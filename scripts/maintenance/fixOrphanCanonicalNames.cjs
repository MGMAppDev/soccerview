/**
 * fixOrphanCanonicalNames.cjs
 *
 * FIX: Run orphaned team names through normalizer logic to fix canonical_name.
 *
 * ROOT CAUSE: GotSport rankings import bypassed the V2 normalizers,
 * creating teams with duplicate club prefixes like "One FC One FC"
 * instead of "One FC".
 *
 * This script applies the same normalization as teamNormalizer.js
 * using pure SQL for SPEED.
 *
 * Usage:
 *   node scripts/maintenance/fixOrphanCanonicalNames.cjs --dry-run
 *   node scripts/maintenance/fixOrphanCanonicalNames.cjs --execute
 */

require('dotenv').config();
const { Pool } = require('pg');
const { authorizePipelineWrite } = require('../universal/pipelineAuthCJS.cjs');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--execute');

async function main() {
  // Get a client and authorize it for writes
  const client = await pool.connect();
  await authorizePipelineWrite(client);

  // Use client instead of pool for all queries
  const query = client.query.bind(client);
  console.log('='.repeat(70));
  console.log('FIX ORPHAN CANONICAL NAMES');
  console.log('Applying V2 normalizer logic to remove duplicate prefixes');
  console.log('='.repeat(70));
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'EXECUTE'}`);
  console.log('');

  // Step 1: Find teams with duplicate prefixes in canonical_name
  // Pattern: "word word word word" where word[0]==word[2] and word[1]==word[3]
  // Or: "word word" where word[0]==word[1]
  console.log('Step 1: Finding teams with duplicate prefixes...');
  const startTime = Date.now();

  const { rows: duplicates } = await query(`
    SELECT
      t.id,
      t.display_name,
      t.canonical_name,
      t.birth_year,
      t.gender,
      -- Calculate fixed canonical_name
      CASE
        -- 2-word duplicate: "word word xyz" -> "word xyz"
        WHEN split_part(t.canonical_name, ' ', 1) = split_part(t.canonical_name, ' ', 2)
        THEN regexp_replace(t.canonical_name, '^([^ ]+) ', '')
        -- 4-word duplicate: "word1 word2 word1 word2 xyz" -> "word1 word2 xyz"
        WHEN split_part(t.canonical_name, ' ', 1) = split_part(t.canonical_name, ' ', 3)
             AND split_part(t.canonical_name, ' ', 2) = split_part(t.canonical_name, ' ', 4)
        THEN regexp_replace(t.canonical_name, '^([^ ]+ [^ ]+) ', '')
        ELSE NULL
      END as fixed_name
    FROM teams_v2 t
    WHERE t.national_rank IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM matches_v2 m WHERE m.home_team_id = t.id OR m.away_team_id = t.id LIMIT 1)
      AND (
        -- 2-word duplicate
        split_part(t.canonical_name, ' ', 1) = split_part(t.canonical_name, ' ', 2)
        OR
        -- 4-word duplicate
        (split_part(t.canonical_name, ' ', 1) = split_part(t.canonical_name, ' ', 3)
         AND split_part(t.canonical_name, ' ', 2) = split_part(t.canonical_name, ' ', 4))
      )
  `);

  console.log(`Found ${duplicates.length.toLocaleString()} teams with duplicate prefixes`);

  if (duplicates.length === 0) {
    console.log('No duplicates to fix!');
    client.release();
  await pool.end();
    return;
  }

  // Show samples
  console.log('\nSample fixes (first 10):');
  for (const d of duplicates.slice(0, 10)) {
    console.log(`  ${d.canonical_name?.substring(0, 50)}`);
    console.log(`    → ${d.fixed_name?.substring(0, 50)}`);
  }

  if (DRY_RUN) {
    console.log(`\n[DRY RUN] Would fix ${duplicates.length.toLocaleString()} canonical_names`);
    client.release();
  await pool.end();
    return;
  }

  // Step 2: Apply fixes
  console.log('\nStep 2: Applying fixes...');

  const result = await query(`
    UPDATE teams_v2 t
    SET canonical_name = CASE
      -- 2-word duplicate: "word word xyz" -> "word xyz"
      WHEN split_part(t.canonical_name, ' ', 1) = split_part(t.canonical_name, ' ', 2)
      THEN regexp_replace(t.canonical_name, '^([^ ]+) ', '')
      -- 4-word duplicate: "word1 word2 word1 word2 xyz" -> "word1 word2 xyz"
      WHEN split_part(t.canonical_name, ' ', 1) = split_part(t.canonical_name, ' ', 3)
           AND split_part(t.canonical_name, ' ', 2) = split_part(t.canonical_name, ' ', 4)
      THEN regexp_replace(t.canonical_name, '^([^ ]+ [^ ]+) ', '')
      ELSE t.canonical_name
    END,
    updated_at = NOW()
    WHERE t.national_rank IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM matches_v2 m WHERE m.home_team_id = t.id OR m.away_team_id = t.id LIMIT 1)
      AND (
        split_part(t.canonical_name, ' ', 1) = split_part(t.canonical_name, ' ', 2)
        OR
        (split_part(t.canonical_name, ' ', 1) = split_part(t.canonical_name, ' ', 3)
         AND split_part(t.canonical_name, ' ', 2) = split_part(t.canonical_name, ' ', 4))
      )
  `);

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`✅ Fixed ${result.rowCount} canonical_names in ${duration}s`);

  // Step 3: Now check how many can be matched
  console.log('\nStep 3: Checking match potential...');
  const { rows: [{ count: matchable }] } = await query(`
    SELECT COUNT(DISTINCT o.id)
    FROM teams_v2 o
    JOIN teams_v2 m ON
      o.canonical_name = m.canonical_name
      AND o.birth_year = m.birth_year
      AND o.gender = m.gender
      AND o.id != m.id
    WHERE o.national_rank IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM matches_v2 WHERE home_team_id = o.id OR away_team_id = o.id LIMIT 1)
      AND EXISTS (SELECT 1 FROM matches_v2 WHERE home_team_id = m.id OR away_team_id = m.id LIMIT 1)
  `);

  console.log(`Teams now matchable by canonical_name: ${parseInt(matchable).toLocaleString()}`);

  client.release();
  await pool.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  pool.end();
  process.exit(1);
});
