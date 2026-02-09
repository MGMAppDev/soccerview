/**
 * reconcileOrphanedTeams.cjs
 *
 * UNIVERSAL Layer 2 reconciliation using V2 normalizers and canonical registries.
 *
 * This is the PROPER fix for orphaned GotSport-ranked teams:
 * 1. Run orphaned teams through teamNormalizer to get canonical_name
 * 2. Check canonical_teams registry for existing team_v2_id
 * 3. If found → transfer rank to existing team, delete orphan
 * 4. If not found → register in canonical_teams for future matching
 *
 * UNIVERSAL: Works for ANY data source, not just GotSport.
 * Uses V2 architecture: Normalizers → Canonical Registries → Production
 *
 * Usage:
 *   node scripts/maintenance/reconcileOrphanedTeams.cjs --stats
 *   node scripts/maintenance/reconcileOrphanedTeams.cjs --dry-run
 *   node scripts/maintenance/reconcileOrphanedTeams.cjs --execute
 */

require('dotenv').config();
const { Pool } = require('pg');
const { authorizePipelineWrite } = require('../universal/pipelineAuthCJS.cjs');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--execute');
const STATS_ONLY = args.includes('--stats');
const VERBOSE = args.includes('--verbose');

// Module-level client for session variable persistence
let client = null;
const query = async (...args) => {
  if (client) return client.query(...args);
  return pool.query(...args);
};

// Season year for age calculations (same as normalizer)
const SEASON_YEAR = 2026;

// ===========================================
// NORMALIZER FUNCTIONS (Inline - same as teamNormalizer.js)
// Using CommonJS for pg compatibility
// ===========================================

function normalizeTeamName(rawName) {
  if (!rawName || typeof rawName !== 'string') {
    return { canonical_name: null, birth_year: null, gender: null };
  }

  let name = rawName.trim();

  // Step 1: Remove duplicate club prefix
  const words = name.split(/\s+/);
  if (words.length >= 4 &&
      words[0].toLowerCase() === words[2].toLowerCase() &&
      words[1].toLowerCase() === words[3].toLowerCase()) {
    name = words.slice(2).join(' ');
  } else if (words.length >= 2 && words[0].toLowerCase() === words[1].toLowerCase()) {
    name = words.slice(1).join(' ');
  }

  // Step 2: Extract age/gender suffix (e.g., "(U11 Boys)")
  let suffix = null;
  const suffixMatch = name.match(/\(([^)]+)\)\s*$/);
  if (suffixMatch) {
    suffix = suffixMatch[1];
    name = name.replace(/\([^)]+\)\s*$/, '').trim();
  }

  // Step 3: Extract birth year from name patterns
  let birthYear = null;

  // Pattern 1: 4-digit year (2014, 2015, etc.)
  const yearMatch = name.match(/\b(20[01]\d)\b/);
  if (yearMatch) {
    birthYear = parseInt(yearMatch[1], 10);
  }

  // Pattern 2: 2-digit year (14B, 15G, etc.)
  if (!birthYear) {
    const shortYearMatch = name.match(/\b(\d{2})[BG]\b/i);
    if (shortYearMatch) {
      const shortYear = parseInt(shortYearMatch[1], 10);
      birthYear = shortYear < 30 ? 2000 + shortYear : 1900 + shortYear;
    }
  }

  // Pattern 3: From suffix "U11 Boys" → birth_year = 2026 - 11 = 2015
  if (!birthYear && suffix) {
    const ageMatch = suffix.match(/U(\d+)/i);
    if (ageMatch) {
      const age = parseInt(ageMatch[1], 10);
      if (age >= 7 && age <= 19) {
        birthYear = SEASON_YEAR - age;
      }
    }
  }

  // Step 4: Extract gender
  let gender = null;

  // From suffix
  if (suffix) {
    if (/\bboys?\b/i.test(suffix)) gender = 'M';
    else if (/\bgirls?\b/i.test(suffix)) gender = 'F';
  }

  // From name patterns
  if (!gender) {
    if (/\d{2,4}[BM]\b/i.test(name)) gender = 'M';
    else if (/\d{2,4}[GF]\b/i.test(name)) gender = 'F';
    else if (/\bboys?\b/i.test(name)) gender = 'M';
    else if (/\bgirls?\b/i.test(name)) gender = 'F';
  }

  // Step 5: Create canonical name (lowercase, normalized whitespace)
  const canonicalName = name.toLowerCase().replace(/\s+/g, ' ').trim();

  return { canonical_name: canonicalName, birth_year: birthYear, gender };
}

// ===========================================
// STATISTICS
// ===========================================

async function showStats() {
  console.log('='.repeat(70));
  console.log('ORPHANED TEAMS STATISTICS');
  console.log('='.repeat(70));

  const stats = await query(`
    WITH team_status AS (
      SELECT
        t.id,
        t.display_name,
        t.birth_year,
        t.gender,
        t.national_rank,
        EXISTS (SELECT 1 FROM matches_v2 WHERE home_team_id = t.id OR away_team_id = t.id) as has_matches,
        EXISTS (SELECT 1 FROM canonical_teams WHERE team_v2_id = t.id) as in_registry
      FROM teams_v2 t
    )
    SELECT
      COUNT(*) as total_teams,
      COUNT(*) FILTER (WHERE national_rank IS NOT NULL) as gs_ranked,
      COUNT(*) FILTER (WHERE has_matches) as with_matches,
      COUNT(*) FILTER (WHERE in_registry) as in_registry,
      COUNT(*) FILTER (WHERE national_rank IS NOT NULL AND has_matches) as gs_rank_with_matches,
      COUNT(*) FILTER (WHERE national_rank IS NOT NULL AND NOT has_matches) as orphaned,
      COUNT(*) FILTER (WHERE national_rank IS NOT NULL AND NOT has_matches AND in_registry) as orphaned_in_registry
    FROM team_status
  `);

  const s = stats.rows[0];
  console.log(`
Total teams:                    ${parseInt(s.total_teams).toLocaleString()}
Teams with GotSport rank:       ${parseInt(s.gs_ranked).toLocaleString()}
Teams with matches:             ${parseInt(s.with_matches).toLocaleString()}
Teams in canonical_teams:       ${parseInt(s.in_registry).toLocaleString()}

GS rank WITH matches:           ${parseInt(s.gs_rank_with_matches).toLocaleString()} ✅
GS rank WITHOUT matches:        ${parseInt(s.orphaned).toLocaleString()} ⚠️  (orphaned)
Orphaned in registry:           ${parseInt(s.orphaned_in_registry).toLocaleString()}
`);

  // Check canonical_teams coverage
  const registryCoverage = await query(`
    SELECT
      COUNT(*) as total_canonical,
      COUNT(ct.team_v2_id) FILTER (WHERE t.id IS NOT NULL) as linked_to_teams,
      COUNT(*) FILTER (WHERE array_length(ct.aliases, 1) > 0) as with_aliases
    FROM canonical_teams ct
    LEFT JOIN teams_v2 t ON t.id = ct.team_v2_id
  `);

  const rc = registryCoverage.rows[0];
  console.log('Canonical Teams Registry:');
  console.log(`  Total entries:        ${parseInt(rc.total_canonical).toLocaleString()}`);
  console.log(`  Linked to teams_v2:   ${parseInt(rc.linked_to_teams).toLocaleString()}`);
  console.log(`  With aliases:         ${parseInt(rc.with_aliases).toLocaleString()}`);

  return s;
}

// ===========================================
// STEP 1: FIND ORPHANED TEAMS
// ===========================================

async function findOrphanedTeams() {
  console.log('\n' + '='.repeat(70));
  console.log('STEP 1: FINDING ORPHANED TEAMS');
  console.log('='.repeat(70));

  const { rows: orphaned } = await query(`
    SELECT
      t.id,
      t.display_name,
      t.canonical_name,
      t.birth_year,
      t.gender,
      t.state,
      t.national_rank,
      t.state_rank,
      t.elo_rating
    FROM teams_v2 t
    WHERE t.national_rank IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM matches_v2 WHERE home_team_id = t.id OR away_team_id = t.id)
    ORDER BY t.national_rank ASC
  `);

  console.log(`Found ${orphaned.length.toLocaleString()} orphaned teams`);
  return orphaned;
}

// ===========================================
// STEP 2: NORMALIZE AND MATCH
// ===========================================

async function normalizeAndMatch(orphanedTeams) {
  console.log('\n' + '='.repeat(70));
  console.log('STEP 2: NORMALIZING AND MATCHING VIA CANONICAL REGISTRY');
  console.log('='.repeat(70));

  const startTime = Date.now();

  // Load canonical_teams registry
  const { rows: canonicalTeams } = await query(`
    SELECT id, canonical_name, birth_year, gender, team_v2_id, aliases
    FROM canonical_teams
  `);

  console.log(`Loaded ${canonicalTeams.length.toLocaleString()} canonical team entries`);

  // Build lookup map: canonical_name|birth_year|gender → team_v2_id
  const canonicalMap = new Map();
  for (const ct of canonicalTeams) {
    const key = `${ct.canonical_name}|${ct.birth_year || ''}|${ct.gender || ''}`;
    canonicalMap.set(key, ct.team_v2_id);

    // Also add aliases
    if (ct.aliases) {
      for (const alias of ct.aliases) {
        const aliasKey = `${alias.toLowerCase()}|${ct.birth_year || ''}|${ct.gender || ''}`;
        canonicalMap.set(aliasKey, ct.team_v2_id);
      }
    }
  }

  // Also build a map of teams with matches for direct matching
  const { rows: teamsWithMatches } = await query(`
    SELECT DISTINCT t.id, t.canonical_name, t.birth_year, t.gender
    FROM teams_v2 t
    WHERE EXISTS (SELECT 1 FROM matches_v2 WHERE home_team_id = t.id OR away_team_id = t.id)
  `);

  const matchTeamMap = new Map();
  for (const t of teamsWithMatches) {
    const key = `${t.canonical_name}|${t.birth_year || ''}|${t.gender || ''}`;
    matchTeamMap.set(key, t.id);
  }

  console.log(`Loaded ${teamsWithMatches.length.toLocaleString()} teams with matches`);

  // Process orphaned teams
  const matches = [];
  const noMatch = [];
  const skipped = [];

  for (const orphan of orphanedTeams) {
    // Normalize the orphan's name
    const normalized = normalizeTeamName(orphan.display_name);

    // Use orphan's existing birth_year/gender if normalizer couldn't extract
    const birthYear = normalized.birth_year || orphan.birth_year;
    const gender = normalized.gender || orphan.gender;

    if (!birthYear || !gender) {
      skipped.push({ orphan, reason: 'missing birth_year or gender' });
      continue;
    }

    // Build lookup key
    const key = `${normalized.canonical_name}|${birthYear}|${gender}`;

    // First check canonical registry
    let targetId = canonicalMap.get(key);

    // If not in registry, check teams with matches directly
    if (!targetId) {
      targetId = matchTeamMap.get(key);
    }

    if (targetId && targetId !== orphan.id) {
      matches.push({
        orphan_id: orphan.id,
        orphan_name: orphan.display_name,
        orphan_gs_rank: orphan.national_rank,
        orphan_state_rank: orphan.state_rank,
        target_id: targetId,
        normalized_name: normalized.canonical_name,
        match_type: canonicalMap.has(key) ? 'canonical_registry' : 'direct_match',
      });
    } else {
      noMatch.push({
        orphan,
        normalized,
        key,
      });
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nProcessed ${orphanedTeams.length.toLocaleString()} orphaned teams in ${duration}s`);
  console.log(`  Matched via normalizers:  ${matches.length.toLocaleString()}`);
  console.log(`  No match found:           ${noMatch.length.toLocaleString()}`);
  console.log(`  Skipped (missing data):   ${skipped.length.toLocaleString()}`);

  return { matches, noMatch, skipped };
}

// ===========================================
// STEP 3: EXECUTE MERGES
// ===========================================

async function executeMerges(matches, dryRun) {
  console.log('\n' + '='.repeat(70));
  console.log(dryRun ? 'STEP 3: MERGE PREVIEW (DRY RUN)' : 'STEP 3: EXECUTING MERGES');
  console.log('='.repeat(70));

  if (matches.length === 0) {
    console.log('No matches to merge.');
    return { merged: 0 };
  }

  // Sample output
  console.log('\nSample merges (first 10):');
  for (const m of matches.slice(0, 10)) {
    console.log(`  ORPHAN #${m.orphan_gs_rank}: ${m.orphan_name.substring(0, 50)}`);
    console.log(`    → TARGET ID: ${m.target_id}`);
    console.log(`    Match type: ${m.match_type}`);
    console.log('');
  }

  // Count by match type
  const byType = {};
  for (const m of matches) {
    byType[m.match_type] = (byType[m.match_type] || 0) + 1;
  }
  console.log('Matches by type:');
  for (const [type, count] of Object.entries(byType)) {
    console.log(`  ${type}: ${count.toLocaleString()}`);
  }

  if (dryRun) {
    console.log(`\n[DRY RUN] Would merge ${matches.length.toLocaleString()} orphaned teams`);
    return { wouldMerge: matches.length };
  }

  const startTime = Date.now();

  // Prepare bulk arrays
  const orphanIds = matches.map(m => m.orphan_id);
  const targetIds = matches.map(m => m.target_id);
  const gsRanks = matches.map(m => m.orphan_gs_rank);
  const stateRanks = matches.map(m => m.orphan_state_rank);

  // Step 1: Transfer GotSport ranks to target teams
  console.log('\nStep 1: Transferring GotSport ranks to target teams...');
  await query(`
    WITH merge_data AS (
      SELECT
        unnest($1::uuid[]) as target_id,
        unnest($2::int[]) as gs_rank,
        unnest($3::int[]) as state_rank
    )
    UPDATE teams_v2 t
    SET
      national_rank = LEAST(t.national_rank, md.gs_rank),
      state_rank = LEAST(t.state_rank, md.state_rank),
      updated_at = NOW()
    FROM merge_data md
    WHERE t.id = md.target_id
  `, [targetIds, gsRanks, stateRanks]);

  // Step 2: Delete orphaned teams
  console.log('Step 2: Deleting orphaned teams...');
  const deleteResult = await query(`
    DELETE FROM teams_v2
    WHERE id = ANY($1::uuid[])
  `, [orphanIds]);

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Merged ${deleteResult.rowCount} orphaned teams in ${duration}s`);

  return { merged: deleteResult.rowCount };
}

// ===========================================
// STEP 4: REGISTER UNMATCHED IN CANONICAL
// ===========================================

async function registerUnmatched(noMatch, dryRun) {
  console.log('\n' + '='.repeat(70));
  console.log(dryRun ? 'STEP 4: CANONICAL REGISTRATION PREVIEW (DRY RUN)' : 'STEP 4: REGISTERING UNMATCHED IN CANONICAL_TEAMS');
  console.log('='.repeat(70));

  // Filter to only those with complete data
  const toRegister = noMatch.filter(n =>
    n.normalized.canonical_name && n.orphan.birth_year && n.orphan.gender
  );

  console.log(`Unmatched teams to register: ${toRegister.length.toLocaleString()}`);

  if (toRegister.length === 0) {
    console.log('No teams to register.');
    return { registered: 0 };
  }

  if (dryRun) {
    console.log('\nSample registrations (first 10):');
    for (const n of toRegister.slice(0, 10)) {
      console.log(`  ${n.orphan.display_name.substring(0, 50)}`);
      console.log(`    canonical: ${n.normalized.canonical_name}`);
      console.log(`    birth_year=${n.orphan.birth_year}, gender=${n.orphan.gender}`);
      console.log('');
    }
    console.log(`[DRY RUN] Would register ${toRegister.length.toLocaleString()} teams`);
    return { wouldRegister: toRegister.length };
  }

  const startTime = Date.now();

  // Build CASE statements for bulk insert
  const values = toRegister.map((n, i) =>
    `($${i*5+1}, $${i*5+2}, $${i*5+3}, $${i*5+4}, $${i*5+5})`
  ).join(',\n');

  const params = toRegister.flatMap(n => [
    n.normalized.canonical_name,
    n.orphan.birth_year,
    n.orphan.gender,
    n.orphan.id,
    n.orphan.display_name,  // Original name as alias
  ]);

  // Use batches for large inserts
  const BATCH_SIZE = 1000;
  let registered = 0;

  for (let i = 0; i < toRegister.length; i += BATCH_SIZE) {
    const batch = toRegister.slice(i, i + BATCH_SIZE);
    const batchValues = batch.map((n, j) =>
      `($${j*5+1}, $${j*5+2}, $${j*5+3}, $${j*5+4}, ARRAY[$${j*5+5}])`
    ).join(',\n');

    const batchParams = batch.flatMap(n => [
      n.normalized.canonical_name,
      n.orphan.birth_year,
      n.orphan.gender,
      n.orphan.id,
      n.orphan.display_name,
    ]);

    try {
      const result = await query(`
        INSERT INTO canonical_teams (canonical_name, birth_year, gender, team_v2_id, aliases)
        VALUES ${batchValues}
        ON CONFLICT (canonical_name, birth_year, gender)
        DO UPDATE SET
          team_v2_id = COALESCE(canonical_teams.team_v2_id, EXCLUDED.team_v2_id),
          aliases = array_cat(canonical_teams.aliases, EXCLUDED.aliases)
      `, batchParams);
      registered += result.rowCount;
    } catch (err) {
      console.log(`  Batch ${Math.floor(i/BATCH_SIZE) + 1} error: ${err.message}`);
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Registered ${registered} teams in canonical_teams in ${duration}s`);

  return { registered };
}

// ===========================================
// MAIN
// ===========================================

async function main() {
  console.log('='.repeat(70));
  console.log('UNIVERSAL ORPHANED TEAMS RECONCILIATION');
  console.log('Using V2 Architecture: Normalizers → Canonical Registries');
  console.log('='.repeat(70));
  console.log(`Mode: ${STATS_ONLY ? 'STATS ONLY' : (DRY_RUN ? 'DRY RUN' : 'EXECUTE')}`);
  console.log('');

  const startTime = Date.now();

  // Acquire client and authorize for writes
  client = await pool.connect();
  await authorizePipelineWrite(client);

  try {
    // Always show stats first
    await showStats();

    if (STATS_ONLY) {
      return;
    }

    // Step 1: Find orphaned teams
    const orphanedTeams = await findOrphanedTeams();

    // Step 2: Normalize and match
    const { matches, noMatch, skipped } = await normalizeAndMatch(orphanedTeams);

    // Step 3: Execute merges
    const mergeResult = await executeMerges(matches, DRY_RUN);

    // Step 4: Register unmatched in canonical_teams
    const registerResult = await registerUnmatched(noMatch, DRY_RUN);

    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('RECONCILIATION SUMMARY');
    console.log('='.repeat(70));
    console.log(`Duration: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
    console.log(JSON.stringify({
      orphanedTeams: orphanedTeams.length,
      matched: matches.length,
      noMatch: noMatch.length,
      skipped: skipped.length,
      merged: mergeResult.merged || mergeResult.wouldMerge,
      registered: registerResult.registered || registerResult.wouldRegister,
    }, null, 2));

    if (DRY_RUN) {
      console.log('\n⚠️  DRY RUN - No changes made. Use --execute to apply.');
    } else {
      console.log('\n✅ Reconciliation complete!');

      // Show updated stats
      await showStats();
    }

  } catch (err) {
    console.error('Error:', err);
    throw err;
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
