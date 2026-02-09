/**
 * fixDoublePrefix.cjs — Retroactive fix for all double-prefix team names
 * ======================================================================
 * Fixes existing teams_v2 and canonical_teams records where the club name
 * is doubled in display_name (e.g., "Kansas Rush Kansas Rush Pre-ECNL 14B").
 *
 * Usage:
 *   node scripts/maintenance/fixDoublePrefix.cjs              # Dry-run (default)
 *   node scripts/maintenance/fixDoublePrefix.cjs --dry-run    # Explicit dry-run
 *   node scripts/maintenance/fixDoublePrefix.cjs --execute    # Apply fixes
 *   node scripts/maintenance/fixDoublePrefix.cjs --case-insensitive --dry-run
 *   node scripts/maintenance/fixDoublePrefix.cjs --case-insensitive --execute
 *
 * --case-insensitive: Uses ~* (case-insensitive regex) to catch mixed-case
 *   patterns like "Sporting Wichita SPORTING WICHITA". Only targets records
 *   NOT already caught by the case-sensitive pass.
 *
 * Safe: dry-run by default, shows samples and counts before any changes.
 * No data loss: only corrects display_name/canonical_name text. No deletes.
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Detection regex: matches team names where first N words repeat
const DETECT_REGEX = "'^(.{3,30})\\s+\\1'";

async function main() {
  const args = process.argv.slice(2);
  const isExecute = args.includes('--execute');
  const isDryRun = !isExecute;
  const caseInsensitive = args.includes('--case-insensitive');

  // When case-insensitive, use ~* operator and exclude already-fixed case-sensitive matches
  const MATCH_OP = caseInsensitive ? '~*' : '~';
  const EXTRA_FILTER = caseInsensitive ? `AND display_name !~ ${DETECT_REGEX}` : '';
  const EXTRA_FILTER_CT = caseInsensitive ? `AND canonical_name !~ ${DETECT_REGEX}` : '';

  console.log('=== Double-Prefix Team Name Fix ===');
  console.log(`Mode: ${isDryRun ? 'DRY RUN (no changes)' : 'EXECUTE (will modify data)'}`);
  if (caseInsensitive) console.log('Case-insensitive mode: targeting mixed-case patterns only');
  console.log('');

  const client = await pool.connect();

  try {
    // ---------------------------------------------------------------
    // Step 1: Count affected teams_v2 records
    // ---------------------------------------------------------------
    console.log('--- Step 1: Diagnosis ---\n');

    const countQ = await client.query(`
      SELECT COUNT(*) as cnt
      FROM teams_v2
      WHERE display_name ${MATCH_OP} ${DETECT_REGEX} ${EXTRA_FILTER}
    `);
    const totalAffected = parseInt(countQ.rows[0].cnt, 10);
    console.log(`Affected teams_v2 records: ${totalAffected}`);

    if (totalAffected === 0) {
      console.log('\nNo double-prefix teams found. Nothing to fix.');
      return;
    }

    // By state breakdown
    const stateQ = await client.query(`
      SELECT state, COUNT(*) as cnt
      FROM teams_v2
      WHERE display_name ${MATCH_OP} ${DETECT_REGEX} ${EXTRA_FILTER}
      GROUP BY state
      ORDER BY cnt DESC
      LIMIT 10
    `);
    console.log('\nBy state:');
    stateQ.rows.forEach(r => console.log(`  ${r.state || 'NULL'}: ${r.cnt}`));

    // Match status
    const matchQ = await client.query(`
      SELECT
        CASE WHEN matches_played > 0 THEN 'Has matches' ELSE 'No matches' END as status,
        COUNT(*) as cnt
      FROM teams_v2
      WHERE display_name ${MATCH_OP} ${DETECT_REGEX} ${EXTRA_FILTER}
      GROUP BY 1
    `);
    console.log('\nMatch status:');
    matchQ.rows.forEach(r => console.log(`  ${r.status}: ${r.cnt}`));

    // Sample before/after
    console.log('\nSample fixes (first 15):');
    const sampleQ = await client.query(`
      SELECT
        id,
        display_name as current_name,
        regexp_replace(display_name, ${DETECT_REGEX}, '\\1', ${caseInsensitive ? "'i'" : "''"}) as fixed_name
      FROM teams_v2
      WHERE display_name ${MATCH_OP} ${DETECT_REGEX} ${EXTRA_FILTER}
      ORDER BY display_name
      LIMIT 15
    `);
    sampleQ.rows.forEach(r => {
      console.log(`  CURRENT: "${r.current_name}"`);
      console.log(`  FIXED:   "${r.fixed_name}"`);
      console.log('');
    });

    // Check for potential duplicate pairs (double-prefix + clean version already exists)
    const dupeQ = await client.query(`
      WITH doubled AS (
        SELECT
          id,
          display_name,
          regexp_replace(display_name, ${DETECT_REGEX}, '\\1', ${caseInsensitive ? "'i'" : "''"}) as clean_name,
          birth_year, gender
        FROM teams_v2
        WHERE display_name ${MATCH_OP} ${DETECT_REGEX} ${EXTRA_FILTER}
      )
      SELECT COUNT(*) as cnt
      FROM doubled d
      JOIN teams_v2 t ON LOWER(t.display_name) = LOWER(d.clean_name)
        AND t.birth_year IS NOT DISTINCT FROM d.birth_year
        AND t.gender IS NOT DISTINCT FROM d.gender
        AND t.id != d.id
    `);
    console.log(`Potential duplicate pairs (clean version already exists): ${dupeQ.rows[0].cnt}`);
    if (parseInt(dupeQ.rows[0].cnt, 10) > 0) {
      console.log('  NOTE: These teams have a clean-named counterpart. May need merge later.');
    }

    // Count affected canonical_teams
    const canonQ = await client.query(`
      SELECT COUNT(*) as cnt
      FROM canonical_teams
      WHERE canonical_name ${MATCH_OP} ${DETECT_REGEX} ${EXTRA_FILTER_CT}
    `);
    console.log(`\nAffected canonical_teams records: ${canonQ.rows[0].cnt}`);

    if (isDryRun) {
      console.log('\n--- DRY RUN COMPLETE ---');
      console.log('Run with --execute to apply fixes.');
      return;
    }

    // ---------------------------------------------------------------
    // Step 2: Execute fixes
    // ---------------------------------------------------------------
    console.log('\n--- Step 2: Applying Fixes ---\n');

    await client.query('BEGIN');

    // Authorize pipeline write (required by write protection triggers on teams_v2)
    await client.query('SELECT authorize_pipeline_write()');

    // Fix teams_v2: display_name + canonical_name
    // SAFE approach using CTE:
    //   1. Among double-prefix records that fix to the SAME canonical, pick one winner
    //      (most matches played, then earliest created) — others skipped
    //   2. Also skip if a clean-named record already occupies that canonical slot
    const fixTeams = await client.query(`
      WITH to_fix AS (
        SELECT id,
               display_name,
               regexp_replace(display_name, ${DETECT_REGEX}, '\\1', ${caseInsensitive ? "'i'" : "''"}) as fixed_display,
               LOWER(regexp_replace(display_name, ${DETECT_REGEX}, '\\1', ${caseInsensitive ? "'i'" : "''"})) as fixed_canonical,
               birth_year, gender, state,
               ROW_NUMBER() OVER (
                 PARTITION BY LOWER(regexp_replace(display_name, ${DETECT_REGEX}, '\\1', ${caseInsensitive ? "'i'" : "''"})),
                              birth_year, gender, state
                 ORDER BY matches_played DESC NULLS LAST, created_at
               ) as rn
        FROM teams_v2
        WHERE display_name ${MATCH_OP} ${DETECT_REGEX} ${EXTRA_FILTER}
      )
      UPDATE teams_v2 t
      SET display_name = tf.fixed_display,
          canonical_name = tf.fixed_canonical,
          updated_at = NOW()
      FROM to_fix tf
      WHERE t.id = tf.id
        AND tf.rn = 1
        AND NOT EXISTS (
          SELECT 1 FROM teams_v2 t2
          WHERE t2.id != t.id
            AND t2.canonical_name = tf.fixed_canonical
            AND t2.birth_year IS NOT DISTINCT FROM tf.birth_year
            AND t2.gender IS NOT DISTINCT FROM tf.gender
            AND t2.state IS NOT DISTINCT FROM tf.state
            AND t2.display_name !${MATCH_OP} ${DETECT_REGEX}
        )
    `);
    console.log(`Fixed teams_v2: ${fixTeams.rowCount} records`);

    // Count remaining (skipped — need merge, not just rename)
    const skippedQ = await client.query(`
      SELECT COUNT(*) as cnt
      FROM teams_v2
      WHERE display_name ${MATCH_OP} ${DETECT_REGEX} ${EXTRA_FILTER}
    `);
    const skipped = parseInt(skippedQ.rows[0].cnt, 10);
    if (skipped > 0) {
      console.log(`Skipped (need merge with clean counterpart): ${skipped}`);
    }

    await client.query('COMMIT');
    console.log('teams_v2 updates committed.\n');

    // Fix canonical_teams (separate transaction — same conflict avoidance)
    await client.query('BEGIN');
    const fixCanon = await client.query(`
      WITH to_fix_ct AS (
        SELECT id,
               canonical_name,
               regexp_replace(canonical_name, ${DETECT_REGEX}, '\\1', ${caseInsensitive ? "'i'" : "''"}) as fixed_name,
               birth_year, gender, state,
               ROW_NUMBER() OVER (
                 PARTITION BY regexp_replace(canonical_name, ${DETECT_REGEX}, '\\1', ${caseInsensitive ? "'i'" : "''"}),
                              birth_year, gender, state
                 ORDER BY id
               ) as rn
        FROM canonical_teams
        WHERE canonical_name ${MATCH_OP} ${DETECT_REGEX} ${EXTRA_FILTER_CT}
      )
      UPDATE canonical_teams ct
      SET canonical_name = tf.fixed_name
      FROM to_fix_ct tf
      WHERE ct.id = tf.id
        AND tf.rn = 1
        AND NOT EXISTS (
          SELECT 1 FROM canonical_teams ct2
          WHERE ct2.id != ct.id
            AND ct2.canonical_name = tf.fixed_name
            AND ct2.birth_year IS NOT DISTINCT FROM tf.birth_year
            AND ct2.gender IS NOT DISTINCT FROM tf.gender
            AND ct2.state IS NOT DISTINCT FROM tf.state
            AND ct2.canonical_name !${MATCH_OP} ${DETECT_REGEX}
        )
    `);
    console.log(`Fixed canonical_teams: ${fixCanon.rowCount} records`);

    const skippedCanonQ = await client.query(`
      SELECT COUNT(*) as cnt
      FROM canonical_teams
      WHERE canonical_name ${MATCH_OP} ${DETECT_REGEX} ${EXTRA_FILTER_CT}
    `);
    const skippedCanon = parseInt(skippedCanonQ.rows[0].cnt, 10);
    if (skippedCanon > 0) {
      console.log(`Skipped canonical_teams (need merge): ${skippedCanon}`);
    }

    await client.query('COMMIT');
    console.log('canonical_teams updates committed.');

    // ---------------------------------------------------------------
    // Step 3: Verify and refresh views
    // ---------------------------------------------------------------
    console.log('\n--- Step 3: Verification ---\n');

    const verifyQ = await client.query(`
      SELECT COUNT(*) as cnt
      FROM teams_v2
      WHERE display_name ${MATCH_OP} ${DETECT_REGEX} ${EXTRA_FILTER}
    `);
    console.log(`Remaining double-prefix teams: ${verifyQ.rows[0].cnt}`);

    console.log('\nRefreshing app views...');
    await client.query('SELECT refresh_app_views()');
    console.log('Views refreshed.');

    console.log('\n=== FIX COMPLETE ===');
    console.log(`Fixed: ${fixTeams.rowCount} teams_v2 + ${fixCanon.rowCount} canonical_teams`);

  } catch (err) {
    console.error('Error:', err.message);
    console.error(err.stack);
    try { await client.query('ROLLBACK'); } catch (e) { /* ignore */ }
  } finally {
    client.release();
    await pool.end();
  }
}

main();
