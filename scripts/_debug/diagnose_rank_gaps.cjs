/**
 * diagnose_rank_gaps.cjs — Read-only diagnosis of GotSport rank gaps
 * after Session 93 team merge operations.
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  console.log('=== GotSport Rank Gap Diagnosis ===\n');

  // 1. KS U11 Boys state_rank values
  console.log('--- KS U11 Boys: Current state_rank values ---');
  const ksQ = await pool.query(`
    SELECT state_rank, national_rank, display_name, gotsport_points, matches_played
    FROM teams_v2
    WHERE state = 'KS' AND birth_year = 2015 AND gender = 'M'
      AND national_rank IS NOT NULL
    ORDER BY state_rank ASC NULLS LAST
    LIMIT 30
  `);
  ksQ.rows.forEach(r => {
    console.log(`  state#${r.state_rank ?? 'NULL'} nat#${r.national_rank} | ${r.display_name} | pts=${r.gotsport_points ?? 'NULL'} mp=${r.matches_played}`);
  });

  // 2. System-wide: teams with national_rank but NULL state_rank
  console.log('\n--- System-wide: national_rank present but state_rank NULL ---');
  const nullStateQ = await pool.query(`
    SELECT COUNT(*) as cnt FROM teams_v2
    WHERE national_rank IS NOT NULL AND state_rank IS NULL
  `);
  console.log(`  Count: ${nullStateQ.rows[0].cnt}`);

  // 3. System-wide: teams with state_rank but NULL national_rank (should be 0)
  const nullNatQ = await pool.query(`
    SELECT COUNT(*) as cnt FROM teams_v2
    WHERE state_rank IS NOT NULL AND national_rank IS NULL
  `);
  console.log(`  state_rank present but national_rank NULL: ${nullNatQ.rows[0].cnt}`);

  // 4. Check rank_history_v2 for pre-merge snapshots with GotSport ranks
  console.log('\n--- rank_history_v2: Snapshots with GotSport national_rank ---');
  const rhQ = await pool.query(`
    SELECT snapshot_date,
           COUNT(*) as total_rows,
           COUNT(national_rank) as with_national_rank,
           COUNT(state_rank) as with_state_rank
    FROM rank_history_v2
    WHERE national_rank IS NOT NULL OR state_rank IS NOT NULL
    GROUP BY snapshot_date
    ORDER BY snapshot_date DESC
    LIMIT 10
  `);
  if (rhQ.rows.length === 0) {
    console.log('  NO snapshots with GotSport ranks found');
  } else {
    rhQ.rows.forEach(r => {
      console.log(`  ${r.snapshot_date}: ${r.with_national_rank} national, ${r.with_state_rank} state (of ${r.total_rows} total)`);
    });
  }

  // 5. Check rank_history_v2 columns
  console.log('\n--- rank_history_v2: Column check ---');
  const colQ = await pool.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'rank_history_v2'
    ORDER BY ordinal_position
  `);
  colQ.rows.forEach(r => console.log(`  ${r.column_name}: ${r.data_type}`));

  // 6. Check audit_log for deleted teams with rank data
  console.log('\n--- audit_log: Deleted teams with GotSport rank data ---');
  const auditQ = await pool.query(`
    SELECT COUNT(*) as cnt
    FROM audit_log
    WHERE table_name = 'teams_v2'
      AND action IN ('MERGE_DELETE', 'DELETE')
      AND (old_data->>'national_rank' IS NOT NULL
        OR old_data->>'state_rank' IS NOT NULL)
  `);
  console.log(`  Teams deleted with rank data in audit_log: ${auditQ.rows[0].cnt}`);

  // 7. Sample of audit_log entries with rank data (KS if possible)
  const auditSampleQ = await pool.query(`
    SELECT
      old_data->>'display_name' as display_name,
      old_data->>'state' as state,
      old_data->>'birth_year' as birth_year,
      old_data->>'national_rank' as national_rank,
      old_data->>'state_rank' as state_rank,
      old_data->>'gotsport_points' as gotsport_points,
      new_data->>'merged_into' as merged_into,
      changed_at
    FROM audit_log
    WHERE table_name = 'teams_v2'
      AND action IN ('MERGE_DELETE', 'DELETE')
      AND old_data->>'national_rank' IS NOT NULL
    ORDER BY changed_at DESC
    LIMIT 20
  `);
  if (auditSampleQ.rows.length > 0) {
    console.log('\n--- Sample deleted teams with ranks (most recent) ---');
    auditSampleQ.rows.forEach(r => {
      console.log(`  "${r.display_name}" (${r.state}, BY:${r.birth_year}) nat#${r.national_rank} state#${r.state_rank} pts=${r.gotsport_points} → merged_into=${r.merged_into} at ${r.changed_at}`);
    });
  }

  // 8. KS U11 Boys specifically — check audit_log for deleted teams
  console.log('\n--- KS U11 Boys: Deleted teams with rank data ---');
  const ksAuditQ = await pool.query(`
    SELECT
      old_data->>'display_name' as display_name,
      old_data->>'national_rank' as national_rank,
      old_data->>'state_rank' as state_rank,
      old_data->>'gotsport_points' as gotsport_points,
      new_data->>'merged_into' as merged_into
    FROM audit_log
    WHERE table_name = 'teams_v2'
      AND action IN ('MERGE_DELETE', 'DELETE')
      AND old_data->>'state' = 'KS'
      AND old_data->>'birth_year' = '2015'
      AND old_data->>'gender' = 'M'
      AND old_data->>'national_rank' IS NOT NULL
    ORDER BY (old_data->>'state_rank')::int ASC NULLS LAST
  `);
  if (ksAuditQ.rows.length === 0) {
    console.log('  No KS U11 Boys audit entries found');
  } else {
    ksAuditQ.rows.forEach(r => {
      console.log(`  nat#${r.national_rank} state#${r.state_rank} pts=${r.gotsport_points} "${r.display_name}" → merged_into=${r.merged_into}`);
    });
  }

  // 9. For any merged_into keepers from KS audit, check current state
  if (ksAuditQ.rows.length > 0) {
    const keeperIds = [...new Set(ksAuditQ.rows.map(r => r.merged_into).filter(Boolean))];
    if (keeperIds.length > 0) {
      console.log('\n--- KS U11 Boys: Current state of keeper teams ---');
      const keeperQ = await pool.query(`
        SELECT id, display_name, national_rank, state_rank, gotsport_points, matches_played
        FROM teams_v2
        WHERE id = ANY($1::uuid[])
        ORDER BY state_rank ASC NULLS LAST
      `, [keeperIds]);
      keeperQ.rows.forEach(r => {
        console.log(`  ${r.id} nat#${r.national_rank} state#${r.state_rank} pts=${r.gotsport_points} mp=${r.matches_played} "${r.display_name}"`);
      });
    }
  }

  // 10. System-wide rank gap summary
  console.log('\n--- System-wide rank summary ---');
  const summQ = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE national_rank IS NOT NULL) as with_national,
      COUNT(*) FILTER (WHERE state_rank IS NOT NULL) as with_state,
      COUNT(*) FILTER (WHERE gotsport_rank IS NOT NULL) as with_gs_rank,
      COUNT(*) FILTER (WHERE gotsport_points IS NOT NULL) as with_gs_points,
      COUNT(*) as total
    FROM teams_v2
  `);
  const s = summQ.rows[0];
  console.log(`  Total teams: ${s.total}`);
  console.log(`  With national_rank: ${s.with_national}`);
  console.log(`  With state_rank: ${s.with_state}`);
  console.log(`  With gotsport_rank: ${s.with_gs_rank}`);
  console.log(`  With gotsport_points: ${s.with_gs_points}`);

  await pool.end();
  console.log('\n=== DIAGNOSIS COMPLETE ===');
}
main();
