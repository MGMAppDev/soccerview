/**
 * Link Heartland Matches - Focused linking for HTGSports + Heartland League
 * =========================================================================
 *
 * Heartland teams use different naming conventions than GotSport:
 *   - "Sporting KC 2012 Blue" vs "Sporting Kansas City 2012 Boys Blue"
 *   - "KC Fusion 14G Premier" vs "Kansas City Fusion 2010 Girls Premier"
 *
 * This script uses aggressive fuzzy matching and alias expansion to link
 * as many Heartland matches as possible.
 *
 * Usage: node scripts/linkHeartlandMatches.js
 */

import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
});

// Common abbreviation mappings for KC area teams
const ABBREVIATION_MAP = {
  'kc': 'kansas city',
  'sporting kc': 'sporting kansas city',
  'kc fusion': 'kansas city fusion',
  'kc athletics': 'kansas city athletics',
  'op': 'overland park',
  'joco': 'johnson county',
  'ks': 'kansas',
  'mo': 'missouri',
};

function expandAbbreviations(name) {
  let expanded = name.toLowerCase();
  for (const [abbr, full] of Object.entries(ABBREVIATION_MAP)) {
    // Only replace if it's a word boundary match
    const regex = new RegExp(`\\b${abbr}\\b`, 'gi');
    expanded = expanded.replace(regex, full);
  }
  return expanded;
}

async function main() {
  console.log('='.repeat(70));
  console.log('🏆 HEARTLAND MATCH LINKING - Focused Pass');
  console.log('='.repeat(70));
  console.log(`Started: ${new Date().toISOString()}\n`);

  const client = await pool.connect();

  try {
    // Set fuzzy match threshold
    await client.query(`SET pg_trgm.similarity_threshold = 0.6`);

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
        AND LENGTH(home_team_name) >= 5
    `);

    const unlinkedAway = await client.query(`
      SELECT DISTINCT away_team_name as name
      FROM match_results
      WHERE source_platform IN ('htgsports', 'heartland')
        AND away_team_id IS NULL
        AND away_team_name IS NOT NULL
        AND LENGTH(away_team_name) >= 5
    `);

    // Combine unique names
    const uniqueNames = new Set([
      ...unlinkedHome.rows.map(r => r.name),
      ...unlinkedAway.rows.map(r => r.name)
    ]);

    console.log(`   Found ${uniqueNames.size} unique unlinked team names\n`);

    // ========================================
    // STEP 3: Try to match each name
    // ========================================
    console.log('🔄 STEP 2: Matching team names (with abbreviation expansion)...');

    let homeLinked = 0;
    let awayLinked = 0;
    let aliasesCreated = 0;
    const processed = { count: 0 };
    const startTime = Date.now();

    for (const originalName of uniqueNames) {
      // Try matching with original name first
      let match = await findBestMatch(client, originalName);

      // If no match, try with expanded abbreviations
      if (!match) {
        const expandedName = expandAbbreviations(originalName);
        if (expandedName !== originalName.toLowerCase()) {
          match = await findBestMatch(client, expandedName);
        }
      }

      if (match) {
        // Update HOME matches
        const homeResult = await client.query(`
          UPDATE match_results
          SET home_team_id = $1
          WHERE home_team_name = $2
            AND home_team_id IS NULL
            AND source_platform IN ('htgsports', 'heartland')
        `, [match.team_id, originalName]);
        homeLinked += homeResult.rowCount;

        // Update AWAY matches
        const awayResult = await client.query(`
          UPDATE match_results
          SET away_team_id = $1
          WHERE away_team_name = $2
            AND away_team_id IS NULL
            AND source_platform IN ('htgsports', 'heartland')
        `, [match.team_id, originalName]);
        awayLinked += awayResult.rowCount;

        // Create alias for future lookups
        if (homeResult.rowCount > 0 || awayResult.rowCount > 0) {
          try {
            await client.query(`
              INSERT INTO team_name_aliases (id, team_id, alias_name, source)
              VALUES (gen_random_uuid(), $1, $2, 'heartland_linked')
              ON CONFLICT DO NOTHING
            `, [match.team_id, originalName.toLowerCase().trim()]);
            aliasesCreated++;
          } catch (e) {
            // Ignore alias creation errors
          }
        }
      }

      processed.count++;
      if (processed.count % 100 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        console.log(`   ${processed.count}/${uniqueNames.size} processed, +${homeLinked + awayLinked} linked (${elapsed}s)`);
      }
    }

    console.log(`   ✅ Complete: +${homeLinked} home, +${awayLinked} away linked\n`);

    // ========================================
    // STEP 4: Try lower similarity threshold for remaining
    // ========================================
    console.log('🔄 STEP 3: Trying lower threshold (0.5) for remaining...');
    await client.query(`SET pg_trgm.similarity_threshold = 0.5`);

    // Get still-unlinked names
    const stillUnlinked = await client.query(`
      SELECT DISTINCT
        COALESCE(
          CASE WHEN home_team_id IS NULL THEN home_team_name END,
          CASE WHEN away_team_id IS NULL THEN away_team_name END
        ) as name
      FROM match_results
      WHERE source_platform IN ('htgsports', 'heartland')
        AND (home_team_id IS NULL OR away_team_id IS NULL)
        AND (home_team_name IS NOT NULL OR away_team_name IS NOT NULL)
      LIMIT 500
    `);

    let lowThreshLinked = 0;
    for (const row of stillUnlinked.rows) {
      if (!row.name) continue;

      const match = await findBestMatch(client, row.name);
      if (match && match.similarity >= 0.55) {
        // Update HOME
        const homeResult = await client.query(`
          UPDATE match_results
          SET home_team_id = $1
          WHERE home_team_name = $2 AND home_team_id IS NULL
            AND source_platform IN ('htgsports', 'heartland')
        `, [match.team_id, row.name]);

        // Update AWAY
        const awayResult = await client.query(`
          UPDATE match_results
          SET away_team_id = $1
          WHERE away_team_name = $2 AND away_team_id IS NULL
            AND source_platform IN ('htgsports', 'heartland')
        `, [match.team_id, row.name]);

        lowThreshLinked += homeResult.rowCount + awayResult.rowCount;

        // Create alias
        if (homeResult.rowCount > 0 || awayResult.rowCount > 0) {
          try {
            await client.query(`
              INSERT INTO team_name_aliases (id, team_id, alias_name, source)
              VALUES (gen_random_uuid(), $1, $2, 'heartland_low_thresh')
              ON CONFLICT DO NOTHING
            `, [match.team_id, row.name.toLowerCase().trim()]);
            aliasesCreated++;
          } catch (e) {}
        }
      }
    }
    console.log(`   ✅ Low threshold: +${lowThreshLinked} linked\n`);

    // ========================================
    // STEP 5: Final stats
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

    console.log(`\n   Aliases created: ${aliasesCreated}`);
    console.log(`   Total matches linked: ${homeLinked + awayLinked + lowThreshLinked}`);
    console.log(`\n✅ Completed: ${new Date().toISOString()}`);

  } finally {
    client.release();
    await pool.end();
  }
}

async function findBestMatch(client, name) {
  const normalizedName = name.toLowerCase().trim();

  const result = await client.query(`
    SELECT
      a.team_id,
      a.alias_name,
      similarity(a.alias_name, $1) as sim
    FROM team_name_aliases a
    WHERE a.alias_name % $1
    ORDER BY sim DESC
    LIMIT 1
  `, [normalizedName]);

  if (result.rows.length > 0) {
    return {
      team_id: result.rows[0].team_id,
      similarity: result.rows[0].sim,
    };
  }

  return null;
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
