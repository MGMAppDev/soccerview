/**
 * Backfill matches_v2.division from staging_games data.
 *
 * Joins matches_v2 to staging_games via source_match_key,
 * extracts tier using universal extractDivisionTier() normalizer,
 * and bulk-updates matches_v2.division.
 *
 * Performance: Bulk CASE-based UPDATE, processes 403K matches in <60s.
 *
 * Usage:
 *   node scripts/maintenance/backfillDivisionTier.cjs [--dry-run] [--limit N]
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const DRY_RUN = process.argv.includes('--dry-run');
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg >= 0 ? parseInt(process.argv[limitArg + 1]) : null;

// Universal extractDivisionTier — inline copy (CJS/ESM boundary)
function extractDivisionTier(divisionText, rawData) {
  // Check both camelCase and snake_case variants (sources may use either)
  const subdivNumber =
    rawData?.original?.heartlandSubdivision ||
    rawData?.original?.heartland_subdivision ||
    rawData?.original?.subdivision ||
    rawData?.heartland_subdivision ||
    rawData?.heartlandSubdivision ||
    rawData?.subdivision ||
    rawData?.tier;
  if (subdivNumber && /^\d{1,2}$/.test(String(subdivNumber))) {
    return `Division ${subdivNumber}`;
  }
  if (!divisionText) return null;
  let remaining = divisionText.trim();
  remaining = remaining.replace(/\bU-?\d{1,2}\b/gi, '');
  remaining = remaining.replace(/\b20[01]\d\b/g, '');
  remaining = remaining.replace(/\b(boys?|girls?|male|female|coed|co-ed)\b/gi, '');
  remaining = remaining.replace(/\(\d*v?\d*\)/gi, '');
  remaining = remaining.replace(/\b\d{1,2}v\d{1,2}\b/gi, '');
  remaining = remaining.replace(/[-·|\/]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!remaining || remaining.length < 1) return null;
  const divMatch = remaining.match(/\b(?:div(?:ision)?\.?)\s*(\d+)\b/i);
  if (divMatch) return `Division ${divMatch[1]}`;
  const groupMatch = remaining.match(/\b(flight|group|pool|bracket)\s+([A-Za-z0-9]+)\b/i);
  if (groupMatch) {
    const label = groupMatch[1].charAt(0).toUpperCase() + groupMatch[1].slice(1).toLowerCase();
    return `${label} ${groupMatch[2].toUpperCase()}`;
  }
  if (/^[A-Da-d]$/.test(remaining)) return `Division ${remaining.toUpperCase()}`;
  if (/^[A-Da-d]\d$/.test(remaining)) return remaining.toUpperCase();
  const KNOWN_TIERS = new Set([
    'premier', 'elite', 'classic', 'championship', 'select', 'academy', 'reserve',
    'platinum', 'gold', 'silver', 'bronze',
    'red', 'blue', 'white', 'green', 'orange', 'black', 'navy', 'gray', 'grey',
    'top', 'first', 'second', 'third',
  ]);
  const titleCase = (w) => w.charAt(0).toUpperCase() + w.slice(1);
  const fixRomanNumerals = (str) =>
    str.replace(/\b(Ii|Iii|Iv|Vi|Vii|Viii)\b/g, m => m.toUpperCase());
  const words = remaining.toLowerCase().split(/\s+/).filter(w => w.length > 0);
  if (words.length > 0 && words.length <= 3 && words.every(w => KNOWN_TIERS.has(w))) {
    return fixRomanNumerals(words.map(titleCase).join(' '));
  }
  const tierWords = words.filter(w => KNOWN_TIERS.has(w) || /^\d{1,2}$/.test(w));
  if (tierWords.length > 0 && tierWords.length === words.length) {
    return fixRomanNumerals(tierWords.map(w => /^\d+$/.test(w) ? `Division ${w}` : titleCase(w)).join(' '));
  }
  if (words.length >= 1 && words.length <= 3 && remaining.length <= 30) {
    return fixRomanNumerals(words.map(titleCase).join(' '));
  }
  return null;
}

async function main() {
  const startTime = Date.now();
  console.log(`=== Backfill matches_v2.division from staging_games ===`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'EXECUTE'}${LIMIT ? ` (limit: ${LIMIT})` : ''}\n`);

  const client = await pool.connect();
  try {
    if (!DRY_RUN) {
      await client.query('SELECT authorize_pipeline_write()');
    }

    // Pre-check
    const { rows: preCheck } = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE division IS NOT NULL) as has_division,
        COUNT(*) FILTER (WHERE division IS NULL) as null_division
      FROM matches_v2 WHERE deleted_at IS NULL
    `);
    console.log(`Before: ${preCheck[0].has_division} with division, ${preCheck[0].null_division} NULL\n`);

    // Fetch matches + staging data in bulk batches via JOIN
    const BATCH = 10000;
    let offset = 0;
    let totalChecked = 0;
    let totalUpdated = 0;
    const tierDistribution = {};

    while (true) {
      const { rows } = await client.query(`
        SELECT m.id, sg.division as staging_division, sg.raw_data
        FROM matches_v2 m
        JOIN staging_games sg ON sg.source_match_key = m.source_match_key
        WHERE m.division IS NULL
          AND m.deleted_at IS NULL
          AND (sg.division IS NOT NULL OR sg.raw_data IS NOT NULL)
        ORDER BY m.id
        ${LIMIT ? `LIMIT ${Math.min(BATCH, LIMIT - totalChecked)}` : `LIMIT ${BATCH}`}
        OFFSET $1
      `, [offset]);

      if (rows.length === 0) break;

      // Extract tiers
      const updates = [];
      for (const row of rows) {
        const rawData = typeof row.raw_data === 'string' ? JSON.parse(row.raw_data) : row.raw_data;
        const tier = extractDivisionTier(row.staging_division, rawData);
        if (tier) {
          updates.push({ id: row.id, tier });
          tierDistribution[tier] = (tierDistribution[tier] || 0) + 1;
        }
      }

      // Bulk UPDATE using parameterized VALUES list + JOIN
      if (updates.length > 0 && !DRY_RUN) {
        // Build bulk update: UPDATE ... FROM (VALUES ...) AS v(id, tier)
        const valParts = [];
        const params = [];
        for (let i = 0; i < updates.length; i++) {
          params.push(updates[i].id, updates[i].tier);
          valParts.push(`($${i * 2 + 1}::uuid, $${i * 2 + 2}::text)`);
        }

        await client.query(`
          UPDATE matches_v2 m
          SET division = v.tier
          FROM (VALUES ${valParts.join(', ')}) AS v(id, tier)
          WHERE m.id = v.id
        `, params);

        totalUpdated += updates.length;
      } else if (DRY_RUN) {
        totalUpdated += updates.length;
      }

      totalChecked += rows.length;
      offset += rows.length;

      if (totalChecked % 50000 === 0 || rows.length < BATCH) {
        console.log(`  Progress: ${totalChecked} checked, ${totalUpdated} would update`);
      }

      if (LIMIT && totalChecked >= LIMIT) break;
    }

    console.log(`\n--- RESULTS ---`);
    console.log(`  Checked: ${totalChecked}`);
    console.log(`  Updated: ${totalUpdated}${DRY_RUN ? ' (dry run)' : ''}`);
    console.log(`  Duration: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

    // Show tier distribution
    console.log(`\n--- TIER DISTRIBUTION ---`);
    const sorted = Object.entries(tierDistribution).sort((a, b) => b[1] - a[1]);
    for (const [tier, count] of sorted.slice(0, 25)) {
      console.log(`  ${tier}: ${count}`);
    }
    if (sorted.length > 25) console.log(`  ... and ${sorted.length - 25} more tiers`);

    // Post-check
    if (!DRY_RUN) {
      const { rows: postCheck } = await client.query(`
        SELECT
          source_platform,
          COUNT(*) FILTER (WHERE division IS NOT NULL) as has_division,
          COUNT(*) FILTER (WHERE division IS NULL) as null_division
        FROM matches_v2 WHERE deleted_at IS NULL
        GROUP BY source_platform ORDER BY source_platform
      `);
      console.log(`\n--- POST-BACKFILL BY SOURCE ---`);
      for (const r of postCheck) {
        console.log(`  ${r.source_platform}: ${r.has_division} with division, ${r.null_division} NULL`);
      }
    }

    if (!DRY_RUN) {
      await client.query('SELECT revoke_pipeline_write()');
    }
  } finally {
    client.release();
    await pool.end();
  }

  console.log(`\n=== BACKFILL COMPLETE ===`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
