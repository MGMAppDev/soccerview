/**
 * mergeOrphansByNormalizedName.cjs
 *
 * UNIVERSAL V2 ARCHITECTURE FIX:
 * Merge orphaned teams with duplicate prefixes to their normalized counterparts.
 *
 * ROOT CAUSE: GotSport rankings created teams like "UC Premier UC Premier 2012B"
 * when the V2 normalizer would create "UC Premier 2012B". These are duplicates.
 *
 * FAST: Pure SQL operations - processes thousands per second.
 *
 * Usage:
 *   node scripts/maintenance/mergeOrphansByNormalizedName.cjs --stats
 *   node scripts/maintenance/mergeOrphansByNormalizedName.cjs --dry-run
 *   node scripts/maintenance/mergeOrphansByNormalizedName.cjs --execute
 */

require('dotenv').config();
const { Pool } = require('pg');
const { authorizePipelineWrite } = require('../universal/pipelineAuthCJS.cjs');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--execute');
const STATS_ONLY = args.includes('--stats');

// Normalize canonical_name by removing duplicate prefixes
// Same logic as teamNormalizer.js
function getNormalizedName(canonical_name) {
  if (!canonical_name) return canonical_name;
  const words = canonical_name.split(' ');

  // 4-word duplicate: "word1 word2 word1 word2 xyz" -> "word1 word2 xyz"
  if (words.length >= 4 &&
      words[0] === words[2] &&
      words[1] === words[3]) {
    return words.slice(2).join(' ');
  }

  // 2-word duplicate: "word word xyz" -> "word xyz"
  if (words.length >= 2 && words[0] === words[1]) {
    return words.slice(1).join(' ');
  }

  return canonical_name;
}

async function showStats() {
  console.log('='.repeat(70));
  console.log('ORPHAN MERGE STATISTICS');
  console.log('='.repeat(70));

  const startTime = Date.now();

  // Count orphaned teams with duplicate prefixes
  const { rows: [{ count: orphanDupes }] } = await pool.query(`
    SELECT COUNT(*) FROM teams_v2 t
    WHERE t.national_rank IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM matches_v2 m WHERE m.home_team_id = t.id OR m.away_team_id = t.id LIMIT 1)
      AND (
        split_part(t.canonical_name, ' ', 1) = split_part(t.canonical_name, ' ', 2)
        OR
        (split_part(t.canonical_name, ' ', 1) = split_part(t.canonical_name, ' ', 3)
         AND split_part(t.canonical_name, ' ', 2) = split_part(t.canonical_name, ' ', 4))
      )
  `);

  // Count total orphans
  const { rows: [{ count: totalOrphans }] } = await pool.query(`
    SELECT COUNT(*) FROM teams_v2 t
    WHERE t.national_rank IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM matches_v2 m WHERE m.home_team_id = t.id OR m.away_team_id = t.id LIMIT 1)
  `);

  console.log(`
Total orphaned teams:       ${parseInt(totalOrphans).toLocaleString()}
With duplicate prefixes:    ${parseInt(orphanDupes).toLocaleString()} (mergeable)
Query time: ${((Date.now() - startTime) / 1000).toFixed(1)}s
`);
  return parseInt(orphanDupes);
}

async function findMergeCandidates() {
  console.log('='.repeat(70));
  console.log('FINDING MERGE CANDIDATES');
  console.log('='.repeat(70));

  const startTime = Date.now();

  // Find orphans with duplicate prefixes and their matching targets
  const { rows: candidates } = await pool.query(`
    WITH orphans_with_normalized AS (
      SELECT
        t.id as orphan_id,
        t.display_name as orphan_name,
        t.canonical_name as orphan_canonical,
        t.national_rank,
        t.state_rank,
        t.birth_year,
        t.gender,
        t.state,
        -- Calculate normalized name
        CASE
          WHEN split_part(t.canonical_name, ' ', 1) = split_part(t.canonical_name, ' ', 2)
          THEN regexp_replace(t.canonical_name, '^([^ ]+) ', '')
          WHEN split_part(t.canonical_name, ' ', 1) = split_part(t.canonical_name, ' ', 3)
               AND split_part(t.canonical_name, ' ', 2) = split_part(t.canonical_name, ' ', 4)
          THEN regexp_replace(t.canonical_name, '^([^ ]+ [^ ]+) ', '')
          ELSE t.canonical_name
        END as normalized_name
      FROM teams_v2 t
      WHERE t.national_rank IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM matches_v2 m WHERE m.home_team_id = t.id OR m.away_team_id = t.id LIMIT 1)
        AND (
          split_part(t.canonical_name, ' ', 1) = split_part(t.canonical_name, ' ', 2)
          OR
          (split_part(t.canonical_name, ' ', 1) = split_part(t.canonical_name, ' ', 3)
           AND split_part(t.canonical_name, ' ', 2) = split_part(t.canonical_name, ' ', 4))
        )
    )
    SELECT
      o.orphan_id,
      o.orphan_name,
      o.orphan_canonical,
      o.normalized_name,
      o.national_rank,
      o.state_rank,
      t.id as target_id,
      t.display_name as target_name,
      t.canonical_name as target_canonical
    FROM orphans_with_normalized o
    JOIN teams_v2 t ON
      t.canonical_name = o.normalized_name
      AND t.birth_year = o.birth_year
      AND t.gender = o.gender
      AND (t.state = o.state OR t.state IS NULL OR o.state IS NULL)
      AND t.id != o.orphan_id
    WHERE EXISTS (SELECT 1 FROM matches_v2 m WHERE m.home_team_id = t.id OR m.away_team_id = t.id LIMIT 1)
    ORDER BY o.national_rank ASC
  `);

  console.log(`Found ${candidates.length.toLocaleString()} merge candidates in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  return candidates;
}

async function executeMerges(candidates, dryRun) {
  console.log('\n' + '='.repeat(70));
  console.log(dryRun ? 'MERGE PREVIEW (DRY RUN)' : 'EXECUTING MERGES');
  console.log('='.repeat(70));

  if (candidates.length === 0) {
    console.log('No candidates to merge.');
    return { merged: 0 };
  }

  // Sample output
  console.log('\nSample merges (first 10):');
  for (const c of candidates.slice(0, 10)) {
    console.log(`  #${c.national_rank}: ${c.orphan_name?.substring(0, 50)}`);
    console.log(`    orphan canonical: ${c.orphan_canonical?.substring(0, 45)}`);
    console.log(`    target canonical: ${c.target_canonical?.substring(0, 45)}`);
    console.log('');
  }

  // Dedupe - one orphan may match multiple targets
  const seenOrphans = new Set();
  const unique = candidates.filter(c => {
    if (seenOrphans.has(c.orphan_id)) return false;
    seenOrphans.add(c.orphan_id);
    return true;
  });

  console.log(`Unique merge candidates: ${unique.length.toLocaleString()}`);

  if (dryRun) {
    console.log(`\n[DRY RUN] Would merge ${unique.length.toLocaleString()} orphaned teams`);
    return { wouldMerge: unique.length };
  }

  const startTime = Date.now();

  const orphanIds = unique.map(c => c.orphan_id);
  const targetIds = unique.map(c => c.target_id);
  const gsRanks = unique.map(c => c.national_rank);
  const stateRanks = unique.map(c => c.state_rank);

  // Step 1: Transfer GotSport ranks to targets (only if target doesn't have one)
  console.log('\nStep 1: Transferring GotSport ranks to target teams...');
  await pool.query(`
    WITH merge_data AS (
      SELECT
        unnest($1::uuid[]) as target_id,
        unnest($2::int[]) as gs_rank,
        unnest($3::int[]) as state_rank
    )
    UPDATE teams_v2 t
    SET
      national_rank = COALESCE(t.national_rank, md.gs_rank),
      state_rank = COALESCE(t.state_rank, md.state_rank),
      updated_at = NOW()
    FROM merge_data md
    WHERE t.id = md.target_id
  `, [targetIds, gsRanks, stateRanks]);

  // Step 2: Update canonical_teams registry
  console.log('Step 2: Updating canonical_teams registry...');
  await pool.query(`
    WITH merge_data AS (
      SELECT
        unnest($1::uuid[]) as orphan_id,
        unnest($2::uuid[]) as target_id
    )
    UPDATE canonical_teams ct
    SET team_v2_id = md.target_id
    FROM merge_data md
    WHERE ct.team_v2_id = md.orphan_id
  `, [orphanIds, targetIds]);

  // Step 3: Delete orphaned teams
  console.log('Step 3: Deleting orphaned teams...');
  const deleteResult = await pool.query(`
    DELETE FROM teams_v2 WHERE id = ANY($1::uuid[])
  `, [orphanIds]);

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Merged ${deleteResult.rowCount} orphaned teams in ${duration}s`);

  return { merged: deleteResult.rowCount };
}

async function main() {
  console.log('='.repeat(70));
  console.log('MERGE ORPHANS BY NORMALIZED NAME');
  console.log('V2 Architecture: Using normalizer logic to fix duplicate prefixes');
  console.log('='.repeat(70));
  console.log(`Mode: ${STATS_ONLY ? 'STATS ONLY' : (DRY_RUN ? 'DRY RUN' : 'EXECUTE')}`);
  console.log('');

  // V2 ARCHITECTURE ENFORCEMENT: Authorize pipeline writes (Session 79)
  if (!DRY_RUN && !STATS_ONLY) {
    console.log('🔐 Authorizing pipeline writes...');
    await authorizePipelineWrite(pool);
    console.log('✅ Pipeline write authorization granted\n');
  }

  try {
    const orphanCount = await showStats();

    if (STATS_ONLY) {
      await pool.end();
      return;
    }

    const candidates = await findMergeCandidates();
    const result = await executeMerges(candidates, DRY_RUN);

    console.log('\n' + '='.repeat(70));
    console.log('SUMMARY');
    console.log('='.repeat(70));
    console.log(JSON.stringify(result, null, 2));

    if (!DRY_RUN) {
      console.log('\nAfter merge:');
      await showStats();
    } else {
      console.log('\n⚠️  DRY RUN - No changes made. Use --execute to apply.');
    }

  } catch (err) {
    console.error('Error:', err);
    throw err;
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
