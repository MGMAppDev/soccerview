/**
 * Link Heartland Matches V2 - Maximum Coverage Edition
 * =====================================================
 *
 * This script aggressively links remaining Heartland matches by:
 * 1. Expanding abbreviations (KC, TISC, KRSC, etc.)
 * 2. Searching team_name_aliases AND teams table directly
 * 3. Using multiple fuzzy thresholds (0.65, 0.55, 0.45)
 * 4. Stripping common suffixes (FC, SC, etc.)
 * 5. Skipping placeholder names (TBD, numbers, etc.)
 *
 * Usage: node scripts/linkHeartlandMatchesV2.js
 */

import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
});

// Expanded abbreviation mappings for KC area clubs
const ABBREVIATION_MAP = {
  // City abbreviations
  'kc': 'kansas city',
  'op': 'overland park',
  'joco': 'johnson county',
  'ks': 'kansas',
  'mo': 'missouri',
  'stl': 'st louis',
  'slc': 'salt lake city',

  // Club name abbreviations
  'sporting kc': 'sporting kansas city',
  'kc fusion': 'kansas city fusion',
  'kc athletics': 'kansas city athletics',
  'kc fire': 'kansas city fire',
  'kc rangers': 'kansas city rangers',

  // Common KC area club abbreviations
  'tisc': 'topeka indoor soccer club',
  'krsc': 'kansas rush soccer club',
  'gkfc': 'great kansas football club',
  'kcl': 'kansas city legends',
  'lfc': 'legends fc',
  'bssa': 'blue springs soccer association',
  'sporting bv': 'sporting blue valley',

  // Generic abbreviations
  'fc': 'football club',
  'sc': 'soccer club',
  'utd': 'united',
};

// Names to skip (placeholders, invalid entries)
const SKIP_NAMES = new Set([
  'tbd', 'to be determined', 'bye',
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
  '1st a', '1st b', '2nd a', '2nd b',
  'a', 'b', 'c', 'd',
  'home', 'away', 'winner', 'loser',
  '#teamlet\'sgetit', // Social media hashtag
]);

function shouldSkip(name) {
  const lower = name.toLowerCase().trim();
  if (SKIP_NAMES.has(lower)) return true;
  if (/^\d+$/.test(lower)) return true; // Pure numbers
  if (/^(1st|2nd|3rd|4th)\s*[a-d]?$/i.test(lower)) return true; // Bracket positions
  if (lower.length < 4) return true; // Too short
  return false;
}

function expandAbbreviations(name) {
  let expanded = name.toLowerCase();
  for (const [abbr, full] of Object.entries(ABBREVIATION_MAP)) {
    const regex = new RegExp(`\\b${abbr}\\b`, 'gi');
    expanded = expanded.replace(regex, full);
  }
  return expanded;
}

function normalizeForMatching(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '') // Remove special chars
    .replace(/\s+/g, ' ')        // Normalize spaces
    .trim();
}

async function main() {
  console.log('='.repeat(70));
  console.log('🏆 HEARTLAND MATCH LINKING V2 - Maximum Coverage');
  console.log('='.repeat(70));
  console.log(`Started: ${new Date().toISOString()}\n`);

  const client = await pool.connect();

  try {
    // Set initial fuzzy match threshold
    await client.query(`SET pg_trgm.similarity_threshold = 0.65`);

    // ========================================
    // STEP 1: Get baseline
    // ========================================
    console.log('📊 BASELINE:');
    const baseline = await client.query(`
      SELECT
        source_platform,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL) as linked
      FROM match_results
      WHERE source_platform IN ('htgsports', 'heartland')
      GROUP BY source_platform
    `);

    for (const row of baseline.rows) {
      const pct = (row.linked / row.total * 100).toFixed(1);
      console.log(`   ${row.source_platform}: ${row.linked}/${row.total} linked (${pct}%)`);
    }
    console.log('');

    // ========================================
    // STEP 2: Get unlinked Heartland team names
    // ========================================
    console.log('🔍 STEP 1: Getting unlinked Heartland team names...');

    const unlinkedHome = await client.query(`
      SELECT DISTINCT home_team_name as name
      FROM match_results
      WHERE source_platform IN ('htgsports', 'heartland')
        AND home_team_id IS NULL
        AND home_team_name IS NOT NULL
        AND LENGTH(home_team_name) >= 3
    `);

    const unlinkedAway = await client.query(`
      SELECT DISTINCT away_team_name as name
      FROM match_results
      WHERE source_platform IN ('htgsports', 'heartland')
        AND away_team_id IS NULL
        AND away_team_name IS NOT NULL
        AND LENGTH(away_team_name) >= 3
    `);

    // Combine unique names, filtering out placeholders
    const allNames = [
      ...unlinkedHome.rows.map(r => r.name),
      ...unlinkedAway.rows.map(r => r.name)
    ];

    const validNames = [...new Set(allNames)].filter(name => !shouldSkip(name));
    const skippedCount = allNames.length - validNames.length;

    console.log(`   Found ${allNames.length} names total`);
    console.log(`   Skipped ${skippedCount} placeholder names`);
    console.log(`   Processing ${validNames.length} valid team names\n`);

    // ========================================
    // STEP 3: Multi-strategy matching
    // ========================================
    let totalLinked = 0;
    let aliasesCreated = 0;
    const startTime = Date.now();

    // Strategy 1: High-confidence alias matching (0.65)
    console.log('🔄 STEP 2a: High-confidence alias matching (threshold 0.65)...');
    const pass1 = await matchNames(client, validNames, 0.65, 'alias');
    totalLinked += pass1.linked;
    aliasesCreated += pass1.aliases;
    console.log(`   ✅ Pass 1: +${pass1.linked} linked\n`);

    // Get names still unlinked
    const stillUnlinked1 = await getStillUnlinkedNames(client);

    // Strategy 2: Direct team name matching (0.65)
    console.log('🔄 STEP 2b: Direct team name matching (threshold 0.65)...');
    const pass2 = await matchNames(client, stillUnlinked1.filter(n => !shouldSkip(n)), 0.65, 'team');
    totalLinked += pass2.linked;
    aliasesCreated += pass2.aliases;
    console.log(`   ✅ Pass 2: +${pass2.linked} linked\n`);

    // Strategy 3: Expanded abbreviation matching (0.55)
    console.log('🔄 STEP 2c: Expanded abbreviations with lower threshold (0.55)...');
    await client.query(`SET pg_trgm.similarity_threshold = 0.55`);
    const stillUnlinked2 = await getStillUnlinkedNames(client);
    const pass3 = await matchNamesWithExpansion(client, stillUnlinked2.filter(n => !shouldSkip(n)), 0.55);
    totalLinked += pass3.linked;
    aliasesCreated += pass3.aliases;
    console.log(`   ✅ Pass 3: +${pass3.linked} linked\n`);

    // Strategy 4: Very aggressive matching (0.45) - only for high match count names
    console.log('🔄 STEP 2d: Aggressive matching for remaining high-value names (0.45)...');
    await client.query(`SET pg_trgm.similarity_threshold = 0.45`);
    const stillUnlinked3 = await getStillUnlinkedNames(client);
    const highValueNames = stillUnlinked3.filter(n => !shouldSkip(n)).slice(0, 100); // Top 100 only
    const pass4 = await matchNamesAggressive(client, highValueNames);
    totalLinked += pass4.linked;
    aliasesCreated += pass4.aliases;
    console.log(`   ✅ Pass 4: +${pass4.linked} linked\n`);

    // ========================================
    // STEP 4: Final stats
    // ========================================
    console.log('='.repeat(70));
    console.log('📊 FINAL RESULTS:');
    console.log('='.repeat(70));

    const final = await client.query(`
      SELECT
        source_platform,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL) as linked
      FROM match_results
      WHERE source_platform IN ('htgsports', 'heartland')
      GROUP BY source_platform
    `);

    for (const row of final.rows) {
      const before = baseline.rows.find(b => b.source_platform === row.source_platform);
      const beforePct = before ? (before.linked / before.total * 100).toFixed(1) : '?';
      const afterPct = (row.linked / row.total * 100).toFixed(1);
      const improvement = row.linked - (before?.linked || 0);
      console.log(`   ${row.source_platform}: ${row.linked}/${row.total} (${afterPct}%) [was ${beforePct}%, +${improvement}]`);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    console.log(`\n   Aliases created: ${aliasesCreated}`);
    console.log(`   Total matches linked: ${totalLinked}`);
    console.log(`   Time elapsed: ${elapsed}s`);
    console.log(`\n✅ Completed: ${new Date().toISOString()}`);

    // Show remaining unlinked sample
    console.log('\n📋 REMAINING UNLINKED (top 15):');
    const remaining = await client.query(`
      SELECT
        CASE WHEN home_team_id IS NULL THEN home_team_name ELSE away_team_name END as name,
        COUNT(*) as matches
      FROM match_results
      WHERE source_platform IN ('htgsports', 'heartland')
        AND (home_team_id IS NULL OR away_team_id IS NULL)
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 15
    `);
    for (const row of remaining.rows) {
      console.log(`   ${row.matches.toString().padStart(3)} matches: ${row.name}`);
    }

  } finally {
    client.release();
    await pool.end();
  }
}

async function getStillUnlinkedNames(client) {
  const result = await client.query(`
    SELECT DISTINCT
      CASE
        WHEN home_team_id IS NULL THEN home_team_name
        ELSE away_team_name
      END as name
    FROM match_results
    WHERE source_platform IN ('htgsports', 'heartland')
      AND (home_team_id IS NULL OR away_team_id IS NULL)
      AND (home_team_name IS NOT NULL OR away_team_name IS NOT NULL)
  `);
  return result.rows.map(r => r.name).filter(Boolean);
}

async function matchNames(client, names, threshold, source) {
  let linked = 0;
  let aliases = 0;

  for (const originalName of names) {
    const normalizedName = normalizeForMatching(originalName);

    let match = null;

    if (source === 'alias') {
      // Search aliases
      const result = await client.query(`
        SELECT a.team_id, a.alias_name, similarity(a.alias_name, $1) as sim
        FROM team_name_aliases a
        WHERE a.alias_name % $1
        ORDER BY sim DESC
        LIMIT 1
      `, [normalizedName]);

      if (result.rows.length > 0 && result.rows[0].sim >= threshold - 0.05) {
        match = { team_id: result.rows[0].team_id, similarity: result.rows[0].sim };
      }
    } else {
      // Search teams directly
      const result = await client.query(`
        SELECT t.id, t.team_name, similarity(LOWER(t.team_name), $1) as sim
        FROM teams t
        WHERE LOWER(t.team_name) % $1
        ORDER BY sim DESC
        LIMIT 1
      `, [normalizedName]);

      if (result.rows.length > 0 && result.rows[0].sim >= threshold - 0.05) {
        match = { team_id: result.rows[0].id, similarity: result.rows[0].sim };
      }
    }

    if (match) {
      const result = await updateMatchTeams(client, originalName, match.team_id);
      linked += result.count;
      if (result.count > 0) {
        aliases += await createAlias(client, match.team_id, originalName);
      }
    }
  }

  return { linked, aliases };
}

async function matchNamesWithExpansion(client, names, threshold) {
  let linked = 0;
  let aliases = 0;

  for (const originalName of names) {
    const expandedName = expandAbbreviations(originalName);
    const normalizedExpanded = normalizeForMatching(expandedName);

    // Try expanded name against aliases
    let result = await client.query(`
      SELECT a.team_id, a.alias_name, similarity(a.alias_name, $1) as sim
      FROM team_name_aliases a
      WHERE a.alias_name % $1
      ORDER BY sim DESC
      LIMIT 1
    `, [normalizedExpanded]);

    let match = null;
    if (result.rows.length > 0 && result.rows[0].sim >= threshold - 0.05) {
      match = { team_id: result.rows[0].team_id, similarity: result.rows[0].sim };
    }

    // Try expanded name against teams
    if (!match) {
      result = await client.query(`
        SELECT t.id, t.team_name, similarity(LOWER(t.team_name), $1) as sim
        FROM teams t
        WHERE LOWER(t.team_name) % $1
        ORDER BY sim DESC
        LIMIT 1
      `, [normalizedExpanded]);

      if (result.rows.length > 0 && result.rows[0].sim >= threshold - 0.05) {
        match = { team_id: result.rows[0].id, similarity: result.rows[0].sim };
      }
    }

    if (match) {
      const updateResult = await updateMatchTeams(client, originalName, match.team_id);
      linked += updateResult.count;
      if (updateResult.count > 0) {
        aliases += await createAlias(client, match.team_id, originalName);
      }
    }
  }

  return { linked, aliases };
}

async function matchNamesAggressive(client, names) {
  let linked = 0;
  let aliases = 0;

  for (const originalName of names) {
    // Extract core team name (remove age/gender suffixes)
    const coreName = originalName
      .replace(/\s*\d{2,4}\s*(g|b|boys?|girls?)?$/i, '')
      .replace(/\s*(u\d+|under\s*\d+).*$/i, '')
      .trim();

    if (coreName.length < 5) continue;

    const normalizedCore = normalizeForMatching(coreName);

    // Search with core name
    const result = await client.query(`
      SELECT t.id, t.team_name, similarity(LOWER(t.team_name), $1) as sim
      FROM teams t
      WHERE LOWER(t.team_name) % $1
        AND t.state IN ('KS', 'MO') -- Only KC area teams
      ORDER BY sim DESC
      LIMIT 1
    `, [normalizedCore]);

    if (result.rows.length > 0 && result.rows[0].sim >= 0.5) {
      const updateResult = await updateMatchTeams(client, originalName, result.rows[0].id);
      linked += updateResult.count;
      if (updateResult.count > 0) {
        aliases += await createAlias(client, result.rows[0].id, originalName);
      }
    }
  }

  return { linked, aliases };
}

async function updateMatchTeams(client, teamName, teamId) {
  // Update HOME matches
  const homeResult = await client.query(`
    UPDATE match_results
    SET home_team_id = $1
    WHERE home_team_name = $2
      AND home_team_id IS NULL
      AND source_platform IN ('htgsports', 'heartland')
  `, [teamId, teamName]);

  // Update AWAY matches
  const awayResult = await client.query(`
    UPDATE match_results
    SET away_team_id = $1
    WHERE away_team_name = $2
      AND away_team_id IS NULL
      AND source_platform IN ('htgsports', 'heartland')
  `, [teamId, teamName]);

  return { count: homeResult.rowCount + awayResult.rowCount };
}

async function createAlias(client, teamId, name) {
  try {
    await client.query(`
      INSERT INTO team_name_aliases (id, team_id, alias_name, source)
      VALUES (gen_random_uuid(), $1, $2, 'heartland_v2')
      ON CONFLICT DO NOTHING
    `, [teamId, normalizeForMatching(name)]);
    return 1;
  } catch (e) {
    return 0;
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
