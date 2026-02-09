require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  console.log('=== RANK RECOVERY VERIFICATION ===\n');

  // 1. KS U11 Boys GotSport state_rank sequence
  console.log('--- 1. KS U11 Boys (GotSport state_rank) ---');
  const ks = await pool.query(`
    SELECT state_rank, national_rank, display_name, gotsport_points
    FROM teams_v2
    WHERE state = 'KS' AND birth_year = 2015 AND gender = 'M'
      AND national_rank IS NOT NULL
    ORDER BY state_rank ASC NULLS LAST
    LIMIT 20
  `);
  ks.rows.forEach(r => {
    console.log(`  state#${r.state_rank} nat#${r.national_rank} pts=${r.gotsport_points} | ${r.display_name}`);
  });
  const ksRanks = ks.rows.map(r => r.state_rank).filter(r => r != null);
  const ksGaps = [];
  for (let i = 1; i < ksRanks.length; i++) {
    if (ksRanks[i] - ksRanks[i-1] > 1) {
      for (let g = ksRanks[i-1] + 1; g < ksRanks[i]; g++) ksGaps.push(g);
    }
  }
  const ksDupes = [];
  for (let i = 1; i < ksRanks.length; i++) {
    if (ksRanks[i] === ksRanks[i-1]) ksDupes.push(ksRanks[i]);
  }
  console.log(`  Gaps: ${ksGaps.length > 0 ? ksGaps.join(', ') : 'NONE'}`);
  console.log(`  Ties: ${ksDupes.length > 0 ? ksDupes.join(', ') : 'NONE'}`);

  // 2. System-wide: teams with national_rank
  console.log('\n--- 2. System-wide rank status ---');
  const systemStats = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE national_rank IS NOT NULL) as with_national,
      COUNT(*) FILTER (WHERE state_rank IS NOT NULL) as with_state,
      COUNT(*) FILTER (WHERE gotsport_points IS NOT NULL) as with_points,
      COUNT(*) FILTER (WHERE national_rank IS NOT NULL AND state_rank IS NULL) as nat_no_state,
      COUNT(*) FILTER (WHERE national_rank IS NOT NULL AND gotsport_points IS NULL) as nat_no_points
    FROM teams_v2
  `);
  const s = systemStats.rows[0];
  console.log(`  Teams with national_rank: ${parseInt(s.with_national).toLocaleString()}`);
  console.log(`  Teams with state_rank:    ${parseInt(s.with_state).toLocaleString()}`);
  console.log(`  Teams with gotsport_pts:  ${parseInt(s.with_points).toLocaleString()}`);
  console.log(`  nat_rank but NO state_rank: ${s.nat_no_state}`);
  console.log(`  nat_rank but NO points:     ${s.nat_no_points}`);

  // 3. Spot check other states
  console.log('\n--- 3. Spot checks (top 5 by state) ---');
  for (const [state, by, gender] of [['TX', 2015, 'M'], ['CA', 2014, 'F'], ['FL', 2013, 'M']]) {
    const spot = await pool.query(`
      SELECT state_rank, national_rank, display_name
      FROM teams_v2
      WHERE state = $1 AND birth_year = $2 AND gender = $3::gender_type
        AND national_rank IS NOT NULL
      ORDER BY state_rank ASC NULLS LAST
      LIMIT 5
    `, [state, by, gender]);
    console.log(`  ${state} U${2026-by} ${gender === 'M' ? 'Boys' : 'Girls'}:`);
    spot.rows.forEach(r => {
      console.log(`    state#${r.state_rank} nat#${r.national_rank} | ${r.display_name}`);
    });
  }

  // 4. Verify app_rankings view has GotSport data
  console.log('\n--- 4. app_rankings view sample ---');
  const appRank = await pool.query(`
    SELECT display_name, national_rank, state_rank, gotsport_points
    FROM app_rankings
    WHERE state = 'KS' AND age_group = 'U11' AND gender = 'M'
      AND national_rank IS NOT NULL
    ORDER BY national_rank ASC
    LIMIT 5
  `);
  appRank.rows.forEach(r => {
    console.log(`  nat#${r.national_rank} state#${r.state_rank} pts=${r.gotsport_points} | ${r.display_name}`);
  });

  // 5. Compare before/after in rank_history
  console.log('\n--- 5. Data integrity check ---');
  const integrity = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE state_rank <= 0) as invalid_state_rank,
      COUNT(*) FILTER (WHERE national_rank <= 0) as invalid_national_rank,
      MIN(state_rank) as min_state_rank,
      MIN(national_rank) as min_national_rank,
      MAX(state_rank) as max_state_rank,
      MAX(national_rank) as max_national_rank
    FROM teams_v2
    WHERE national_rank IS NOT NULL
  `);
  const i = integrity.rows[0];
  console.log(`  Invalid state_rank (<=0):    ${i.invalid_state_rank}`);
  console.log(`  Invalid national_rank (<=0): ${i.invalid_national_rank}`);
  console.log(`  State rank range: ${i.min_state_rank} - ${i.max_state_rank}`);
  console.log(`  National rank range: ${i.min_national_rank} - ${i.max_national_rank}`);

  console.log('\n=== VERIFICATION COMPLETE ===');
  await pool.end();
})();
