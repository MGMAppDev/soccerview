/**
 * fixNullMetadataAndMerge.cjs
 * Session 77 - February 2, 2026
 *
 * Fixes teams with NULL birth_year/gender by running the V2 normalizer,
 * then merges orphan teams (GS points, no matches) with their counterparts
 * (matches, no GS points).
 *
 * Root cause: Teams created before normalizer integration have NULL metadata,
 * preventing deduplication from matching them to GotSport-imported orphans.
 *
 * Per GUARDRAILS.md:
 * - Uses pg Pool for bulk operations (NOT Supabase client)
 * - Bulk SQL with CASE statements (NOT row-by-row)
 * - Speed target: 1000+ records/second
 */

require('dotenv').config();
const { Pool } = require('pg');
const { authorizePipelineWrite } = require('../universal/pipelineAuthCJS.cjs');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Import normalizer (ESM module)
let normalizeTeam;

// Global client for authorized writes (set in run())
let authorizedClient = null;

async function loadNormalizer() {
  const module = await import('../universal/normalizers/teamNormalizer.js');
  normalizeTeam = module.normalizeTeam;
}

async function run() {
  await loadNormalizer();

  const dryRun = process.argv.includes('--dry-run');
  const phase = process.argv.includes('--phase') ?
    parseInt(process.argv[process.argv.indexOf('--phase') + 1]) : 0;

  console.log('='.repeat(60));
  console.log('FIX NULL METADATA AND MERGE ORPHANS');
  console.log('Session 77 - February 2, 2026');
  console.log('='.repeat(60));
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'EXECUTE'}`);
  console.log(`Phase: ${phase || 'ALL'}`);
  console.log();

  // V2 ARCHITECTURE ENFORCEMENT: Authorize pipeline writes (Session 79)
  // Must use a dedicated client - authorization is connection-scoped
  if (!dryRun) {
    console.log('🔐 Authorizing pipeline writes...');
    authorizedClient = await pool.connect();
    await authorizePipelineWrite(authorizedClient);
    console.log('✅ Pipeline write authorization granted\n');
  }

  // Phase 1: Fix NULL birth_year/gender using normalizer
  if (!phase || phase === 1) {
    await fixNullMetadata(dryRun);
  }

  // Phase 2: Merge orphans with their match-having counterparts
  if (!phase || phase === 2) {
    await mergeOrphans(dryRun);
  }

  // Phase 3: Recalculate stats for merged teams
  if (!phase || phase === 3) {
    await recalculateStats(dryRun);
  }

  await printSummary(pool);

  // Release authorized client if used
  if (authorizedClient) {
    authorizedClient.release();
  }
}

async function fixNullMetadata(dryRun) {
  console.log('\n' + '='.repeat(60));
  console.log('PHASE 1: Fix NULL birth_year/gender using V2 normalizer');
  console.log('='.repeat(60));

  // Get teams with NULL birth_year or NULL gender (include canonical_name and state for conflict check)
  const { rows: teams } = await pool.query(`
    SELECT id, display_name, birth_year, gender, canonical_name, state
    FROM teams_v2
    WHERE birth_year IS NULL OR gender IS NULL
  `);

  console.log(`Found ${teams.length} teams with NULL birth_year or gender`);

  if (teams.length === 0) {
    console.log('No teams need fixing.');
    return;
  }

  // Run normalizer on each team
  const updates = [];
  let fixedBirthYear = 0;
  let fixedGender = 0;

  for (const team of teams) {
    const result = normalizeTeam({ raw_name: team.display_name, source_platform: 'fix' });

    const newBirthYear = team.birth_year === null && result.birth_year ? result.birth_year : null;
    const newGender = team.gender === null && result.gender ? result.gender : null;

    if (newBirthYear || newGender) {
      updates.push({
        id: team.id,
        birth_year: newBirthYear || team.birth_year,
        gender: newGender || team.gender,
      });

      if (newBirthYear) fixedBirthYear++;
      if (newGender) fixedGender++;
    }
  }

  console.log(`\nNormalizer extracted:`);
  console.log(`  - ${fixedBirthYear} new birth_year values`);
  console.log(`  - ${fixedGender} new gender values`);
  console.log(`  - ${updates.length} total teams to update`);

  if (dryRun) {
    console.log('\nDRY RUN - No changes made');
    // Show samples
    console.log('\nSample updates:');
    updates.slice(0, 5).forEach(u => {
      const team = teams.find(t => t.id === u.id);
      console.log(`  ${team.display_name}`);
      console.log(`    birth_year: ${team.birth_year} → ${u.birth_year}`);
      console.log(`    gender: ${team.gender} → ${u.gender}`);
    });
    return;
  }

  if (updates.length === 0) {
    console.log('No updates to apply.');
    return;
  }

  // Pre-identify conflicts: teams that would violate unique constraint after update
  // Constraint: unique(canonical_name, birth_year, gender, state)
  console.log('  Checking for potential conflicts...');

  // Get ALL existing keys (not just teams being updated)
  const { rows: allTeams } = await pool.query(`
    SELECT canonical_name, birth_year, gender, state
    FROM teams_v2
    WHERE birth_year IS NOT NULL AND gender IS NOT NULL
  `);

  // Build a set of (canonical_name, birth_year, gender, state) that already exist
  const existingKeys = new Set();
  for (const team of allTeams) {
    const key = `${team.canonical_name}|${team.birth_year}|${team.gender}|${team.state}`;
    existingKeys.add(key);
  }
  console.log(`  ${existingKeys.size} existing unique keys loaded`);

  // Check which updates would create conflicts
  const safeUpdates = [];
  const conflictUpdates = [];

  for (const u of updates) {
    const team = teams.find(t => t.id === u.id);
    if (!team) continue;

    // What would the new key be?
    const newBirthYear = u.birth_year ?? team.birth_year;
    const newGender = u.gender ?? team.gender;
    const newKey = `${team.canonical_name}|${newBirthYear}|${newGender}|${team.state}`;

    // If new key already exists (and it's not this team), it's a conflict
    const oldKey = `${team.canonical_name}|${team.birth_year}|${team.gender}|${team.state}`;
    if (newKey !== oldKey && existingKeys.has(newKey)) {
      conflictUpdates.push({ ...u, team, newKey });
    } else {
      safeUpdates.push(u);
      // Add new key to set to detect intra-batch conflicts
      existingKeys.add(newKey);
    }
  }

  console.log(`  ${safeUpdates.length} safe updates, ${conflictUpdates.length} would cause conflicts`);

  if (dryRun) {
    console.log('\nDRY RUN - No changes made');
    if (conflictUpdates.length > 0) {
      console.log('\nSample conflicts (would be duplicates after update):');
      conflictUpdates.slice(0, 5).forEach(c => {
        console.log(`  - ${c.team.display_name}`);
        console.log(`    Would become: birth_year=${c.birth_year ?? c.team.birth_year}, gender=${c.gender ?? c.team.gender}`);
      });
    }
    return;
  }

  if (safeUpdates.length === 0) {
    console.log('No safe updates to apply.');
    return;
  }

  // Bulk update using CASE statements (per GUARDRAILS)
  const batchSize = 1000;
  let updated = 0;
  const startTime = Date.now();

  for (let i = 0; i < safeUpdates.length; i += batchSize) {
    const batch = safeUpdates.slice(i, i + batchSize);

    // Build CASE statement for birth_year
    const birthYearCases = batch
      .filter(u => u.birth_year !== null)
      .map(u => `WHEN id = '${u.id}' THEN ${u.birth_year}`)
      .join(' ');

    // Build CASE statement for gender
    const genderCases = batch
      .filter(u => u.gender !== null)
      .map(u => `WHEN id = '${u.id}' THEN '${u.gender}'`)
      .join(' ');

    const ids = batch.map(u => `'${u.id}'`).join(',');

    let sql = `UPDATE teams_v2 SET `;
    const setClauses = [];

    if (birthYearCases) {
      setClauses.push(`birth_year = CASE ${birthYearCases} ELSE birth_year END`);
    }
    if (genderCases) {
      setClauses.push(`gender = CASE ${genderCases} ELSE gender END`);
    }

    if (setClauses.length > 0) {
      sql += setClauses.join(', ');
      sql += ` WHERE id IN (${ids})`;

      // Use authorized client for writes (authorization is connection-scoped)
      await authorizedClient.query(sql);
      updated += batch.length;
    }

    if ((i + batchSize) % 5000 === 0 || i + batchSize >= safeUpdates.length) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = Math.round(updated / elapsed);
      console.log(`  Updated ${updated}/${safeUpdates.length} (${rate}/sec)`);
    }
  }

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`\n✅ Phase 1 complete: ${updated} teams updated in ${elapsed.toFixed(1)}s`);

  if (conflictUpdates.length > 0) {
    console.log(`\n⚠️  ${conflictUpdates.length} teams skipped (would create duplicates)`);
    console.log('These need merging in Phase 2.');
  }
}

async function mergeOrphans(dryRun) {
  console.log('\n' + '='.repeat(60));
  console.log('PHASE 2: Merge orphans with match-having counterparts');
  console.log('='.repeat(60));

  // OPTIMIZED: Get orphans and teams separately, then match in JS
  // SIMILARITY() on JOIN is O(n*m) and extremely slow
  console.log('Loading orphans...');
  const { rows: orphans } = await pool.query(`
    SELECT id, canonical_name, display_name, gotsport_points, gotsport_rank,
           birth_year, gender, state
    FROM teams_v2
    WHERE matches_played = 0 AND gotsport_points > 0
      AND birth_year IS NOT NULL AND gender IS NOT NULL
  `);
  console.log(`  ${orphans.length} orphans loaded`);

  console.log('Loading teams with matches...');
  const { rows: teamsWithMatches } = await pool.query(`
    SELECT id, canonical_name, display_name, matches_played, wins, losses, draws, elo_rating,
           birth_year, gender
    FROM teams_v2
    WHERE matches_played > 0
      AND birth_year IS NOT NULL AND gender IS NOT NULL
  `);
  console.log(`  ${teamsWithMatches.length} teams with matches loaded`);

  // Index teams by birth_year + gender for fast lookup
  const teamIndex = new Map();
  for (const team of teamsWithMatches) {
    const key = `${team.birth_year}-${team.gender}`;
    if (!teamIndex.has(key)) teamIndex.set(key, []);
    teamIndex.get(key).push(team);
  }

  // Find matches using normalized name contains (not SIMILARITY)
  const candidates = [];
  const startTime = Date.now();

  for (const orphan of orphans) {
    const key = `${orphan.birth_year}-${orphan.gender}`;
    const potentialMatches = teamIndex.get(key) || [];

    // Normalize names - remove age/gender suffix for matching
    const stripSuffix = (name) => name
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/\s*\(u\d+\s*(boys|girls)\)$/i, '')  // Remove (U11 Boys) suffix
      .replace(/\s*u\d+\s*(boys|girls)$/i, '')      // Remove U11 Boys suffix
      .trim();

    const orphanNorm = stripSuffix(orphan.canonical_name);

    for (const team of potentialMatches) {
      if (orphan.id === team.id) continue;

      const teamNorm = stripSuffix(team.canonical_name);

      // Check if names match via duplicate prefix removal pattern
      // "sporting blue valley sporting bv pre-mls next 15" → "sporting bv pre-mls next 15"
      // The team name should be a SUFFIX of the orphan name (orphan has duplicate prefix)

      const isMatch = (() => {
        // Case 1: Orphan name ends with team name (duplicate prefix case)
        // "Mo Soccer Academy Mo Soccer Academy Xtreme" ends with "Mo Soccer Academy Xtreme"
        if (orphanNorm.endsWith(teamNorm)) return true;

        // Case 2: Team name ends with orphan name (unlikely but check both)
        if (teamNorm.endsWith(orphanNorm)) return true;

        // Case 3: Both names are very similar after normalizing
        // Remove common prefixes and compare cores
        const orphanWords = orphanNorm.split(' ');
        const teamWords = teamNorm.split(' ');

        // Check if orphan has duplicate prefix pattern
        // "club club team name" vs "club team name"
        if (orphanWords.length >= 2 && teamWords.length >= 1) {
          // Find where team name starts in orphan name
          const teamFirst = teamWords[0];
          let startIdx = -1;
          for (let i = 0; i < orphanWords.length; i++) {
            if (orphanWords[i] === teamFirst) {
              // Check if rest matches
              const orphanRest = orphanWords.slice(i).join(' ');
              if (orphanRest === teamNorm) {
                startIdx = i;
                break;
              }
            }
          }
          if (startIdx > 0) {
            // Orphan has prefix that team doesn't have
            // Verify the prefix is duplicated (e.g., "Club Club" or "FC FC")
            const prefix = orphanWords.slice(0, startIdx).join(' ').toLowerCase();
            const mainPart = orphanWords.slice(startIdx).join(' ').toLowerCase();
            // The prefix should be a prefix of the main part (duplicate)
            if (mainPart.startsWith(prefix.split(' ')[0])) {
              return true;
            }
          }
        }

        return false;
      })();

      if (isMatch) {
        candidates.push({
          orphan_id: orphan.id,
          orphan_canonical: orphan.canonical_name,
          orphan_name: orphan.display_name,
          gotsport_points: orphan.gotsport_points,
          gotsport_rank: orphan.gotsport_rank,
          keep_id: team.id,
          keep_canonical: team.canonical_name,
          keep_name: team.display_name,
          matches_played: team.matches_played,
          elo_rating: team.elo_rating,
          similarity: 1.0, // Contains match
        });
        break; // Found a match, move to next orphan
      }
    }
  }

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`  Matching completed in ${elapsed.toFixed(1)}s`);

  // Filter out false positives (different colors, levels, etc.)
  const colorPattern = /\b(red|blue|white|black|gold|silver|green|orange|purple|yellow|navy|teal|gray|grey)\b/i;
  const levelPattern = /\b(elite|premier|academy|select|reserve|gold|silver|bronze|platinum|i{1,3}|1|2|3|a|b|c)\s*$/i;

  const validCandidates = candidates.filter(c => {
    const orphanName = c.orphan_canonical.toLowerCase();
    const keepName = c.keep_canonical.toLowerCase();

    // Check if names differ only by duplicate prefix removal
    // "club club team" vs "club team" - these should merge
    if (keepName.includes(orphanName) || orphanName.includes(keepName)) {
      return true;
    }

    // Extract trailing identifiers (color/level)
    const orphanColorMatch = orphanName.match(colorPattern);
    const keepColorMatch = keepName.match(colorPattern);
    const orphanLevelMatch = orphanName.match(levelPattern);
    const keepLevelMatch = keepName.match(levelPattern);

    // If both have colors and they're different, don't merge
    if (orphanColorMatch && keepColorMatch &&
        orphanColorMatch[1].toLowerCase() !== keepColorMatch[1].toLowerCase()) {
      return false;
    }

    // If both have levels and they're different, don't merge
    if (orphanLevelMatch && keepLevelMatch &&
        orphanLevelMatch[1].toLowerCase() !== keepLevelMatch[1].toLowerCase()) {
      return false;
    }

    // Similarity is high enough and no conflicting identifiers
    return c.similarity >= 0.85;
  });

  console.log(`Found ${candidates.length} raw candidates, ${validCandidates.length} after filtering`);

  if (validCandidates.length === 0) {
    console.log('No valid merge candidates found.');
    return;
  }

  // Deduplicate: one orphan should only merge with ONE team
  const seenOrphans = new Set();
  const finalCandidates = validCandidates.filter(c => {
    if (seenOrphans.has(c.orphan_id)) return false;
    seenOrphans.add(c.orphan_id);
    return true;
  });

  console.log(`After deduplication: ${finalCandidates.length} merges`);

  // Show samples
  console.log('\nTop merge candidates:');
  finalCandidates.slice(0, 10).forEach(c => {
    console.log(`\n  Orphan: ${c.orphan_name}`);
    console.log(`    GS pts: ${c.gotsport_points}`);
    console.log(`  → Keep: ${c.keep_name}`);
    console.log(`    MP: ${c.matches_played}, ELO: ${c.elo_rating}`);
    console.log(`    Similarity: ${(c.similarity * 100).toFixed(1)}%`);
  });

  if (dryRun) {
    console.log('\nDRY RUN - No merges performed');
    return;
  }

  // Perform merges
  let merged = 0;
  const mergeStartTime = Date.now();

  for (const c of finalCandidates) {
    try {
      // Transfer GS points/rank to the team with matches (use authorized client)
      await authorizedClient.query(`
        UPDATE teams_v2
        SET gotsport_points = COALESCE($1, gotsport_points),
            gotsport_rank = COALESCE($2, gotsport_rank),
            national_rank = COALESCE($2, national_rank),
            updated_at = NOW()
        WHERE id = $3
      `, [c.gotsport_points, c.gotsport_rank, c.keep_id]);

      // Delete the orphan (use authorized client)
      await authorizedClient.query(`DELETE FROM teams_v2 WHERE id = $1`, [c.orphan_id]);

      merged++;

      if (merged % 100 === 0) {
        const mergeElapsed = (Date.now() - mergeStartTime) / 1000;
        const rate = Math.round(merged / mergeElapsed);
        console.log(`  Merged ${merged}/${finalCandidates.length} (${rate}/sec)`);
      }
    } catch (err) {
      console.error(`  Error merging ${c.orphan_id}: ${err.message}`);
    }
  }

  const mergeElapsed = (Date.now() - mergeStartTime) / 1000;
  console.log(`\n✅ Phase 2 complete: ${merged} orphans merged in ${mergeElapsed.toFixed(1)}s`);
}

async function recalculateStats(dryRun) {
  console.log('\n' + '='.repeat(60));
  console.log('PHASE 3: Recalculate stats for teams with matches');
  console.log('='.repeat(60));

  if (dryRun) {
    console.log('DRY RUN - Skipping stats recalculation');
    return;
  }

  // Recalculate matches_played, wins, losses, draws for all teams (use authorized client)
  const result = await authorizedClient.query(`
    WITH match_stats AS (
      SELECT
        team_id,
        COUNT(*) as matches_played,
        SUM(CASE WHEN won THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN lost THEN 1 ELSE 0 END) as losses,
        SUM(CASE WHEN draw THEN 1 ELSE 0 END) as draws
      FROM (
        SELECT home_team_id as team_id,
               home_score > away_score as won,
               home_score < away_score as lost,
               home_score = away_score as draw
        FROM matches_v2
        WHERE home_score IS NOT NULL AND away_score IS NOT NULL
        UNION ALL
        SELECT away_team_id as team_id,
               away_score > home_score as won,
               away_score < home_score as lost,
               away_score = home_score as draw
        FROM matches_v2
        WHERE home_score IS NOT NULL AND away_score IS NOT NULL
      ) m
      GROUP BY team_id
    )
    UPDATE teams_v2 t
    SET matches_played = COALESCE(ms.matches_played, 0),
        wins = COALESCE(ms.wins, 0),
        losses = COALESCE(ms.losses, 0),
        draws = COALESCE(ms.draws, 0),
        updated_at = NOW()
    FROM match_stats ms
    WHERE t.id = ms.team_id
      AND (t.matches_played != ms.matches_played
           OR t.wins != ms.wins
           OR t.losses != ms.losses
           OR t.draws != ms.draws)
  `);

  console.log(`✅ Phase 3 complete: ${result.rowCount} teams stats updated`);
}

// Summary
async function printSummary(pool) {
  const { rows } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM teams_v2) as total_teams,
      (SELECT COUNT(*) FROM teams_v2 WHERE birth_year IS NULL) as null_birth_year,
      (SELECT COUNT(*) FROM teams_v2 WHERE gender IS NULL) as null_gender,
      (SELECT COUNT(*) FROM teams_v2 WHERE gotsport_points > 0 AND matches_played = 0) as orphans
  `);

  console.log('\n' + '='.repeat(60));
  console.log('FINAL STATE');
  console.log('='.repeat(60));
  console.log(`Total teams: ${rows[0].total_teams}`);
  console.log(`NULL birth_year: ${rows[0].null_birth_year}`);
  console.log(`NULL gender: ${rows[0].null_gender}`);
  console.log(`Orphans (GS pts, no matches): ${rows[0].orphans}`);

  pool.end();
}

run().catch(console.error);
