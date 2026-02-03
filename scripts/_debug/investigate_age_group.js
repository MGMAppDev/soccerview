import pg from 'pg';
const { Pool } = pg;
import dotenv from 'dotenv';
dotenv.config();

async function runAllQueries() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  console.log('='.repeat(80));
  console.log('INVESTIGATING AGE_GROUP FILTER ISSUE');
  console.log('='.repeat(80));

  // First check what columns exist in teams_v2
  console.log('\n--- teams_v2 columns ---');
  const cols = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'teams_v2'
    ORDER BY ordinal_position;
  `);
  console.log('teams_v2 columns:', cols.rows.map(r => r.column_name).join(', '));

  // Query 1: Find teams with mismatched age names in U11 filter
  console.log('\n--- Query 1: Teams stored as U11 but with different age in name ---');
  const q1 = await pool.query(`
    SELECT
        display_name,
        birth_year,
        age_group,
        'U' || (2025 - birth_year) as expected_age_group_season,
        state,
        gender
    FROM teams_v2
    WHERE state = 'KS'
      AND gender = 'M'
      AND age_group = 'U11'
      AND (display_name ILIKE '%U10%' OR display_name ILIKE '%U12%' OR display_name ILIKE '%U9%')
    LIMIT 20;
  `);
  console.table(q1.rows);

  // Query 2: Birth year distribution for U11 teams in KS
  console.log('\n--- Query 2: Birth year distribution for U11 teams in KS ---');
  const q2 = await pool.query(`
    SELECT
        birth_year,
        age_group,
        COUNT(*) as team_count,
        'U' || (2025 - birth_year) as calculated_from_birth_year
    FROM teams_v2
    WHERE state = 'KS'
      AND gender = 'M'
      AND age_group = 'U11'
    GROUP BY birth_year, age_group
    ORDER BY birth_year;
  `);
  console.table(q2.rows);

  // Query 3: Check calculate_age_group function
  console.log('\n--- Query 3: calculate_age_group trigger function ---');
  const q3 = await pool.query(`
    SELECT prosrc
    FROM pg_proc
    WHERE proname = 'calculate_age_group';
  `);
  if (q3.rows.length > 0) {
    console.log(q3.rows[0].prosrc);
  } else {
    console.log('No function found with name calculate_age_group');
  }

  // Query 4: Teams where stored age_group doesn't match calculated
  console.log('\n--- Query 4: Mismatches grouped by stored vs should_be ---');
  const q4 = await pool.query(`
    SELECT
        COUNT(*) as total_mismatch,
        age_group as stored,
        'U' || (CASE WHEN EXTRACT(MONTH FROM CURRENT_DATE) >= 8
                     THEN EXTRACT(YEAR FROM CURRENT_DATE)
                     ELSE EXTRACT(YEAR FROM CURRENT_DATE) - 1
                END - birth_year) as should_be
    FROM teams_v2
    WHERE birth_year IS NOT NULL
      AND age_group IS NOT NULL
      AND age_group != 'U' || (CASE WHEN EXTRACT(MONTH FROM CURRENT_DATE) >= 8
                                   THEN EXTRACT(YEAR FROM CURRENT_DATE)
                                   ELSE EXTRACT(YEAR FROM CURRENT_DATE) - 1
                              END - birth_year)
    GROUP BY age_group, birth_year
    ORDER BY total_mismatch DESC
    LIMIT 20;
  `);
  console.table(q4.rows);

  // Query 5: Total count of teams with wrong age_group
  console.log('\n--- Query 5: Total count of teams with wrong age_group ---');
  const q5 = await pool.query(`
    SELECT
        COUNT(*) as total_teams_with_wrong_age_group
    FROM teams_v2
    WHERE birth_year IS NOT NULL
      AND age_group IS NOT NULL
      AND age_group != 'U' || (CASE WHEN EXTRACT(MONTH FROM CURRENT_DATE) >= 8
                                   THEN EXTRACT(YEAR FROM CURRENT_DATE)
                                   ELSE EXTRACT(YEAR FROM CURRENT_DATE) - 1
                              END - birth_year);
  `);
  console.log(q5.rows[0]);

  const total = await pool.query('SELECT COUNT(*) as total FROM teams_v2 WHERE birth_year IS NOT NULL AND age_group IS NOT NULL');
  console.log('Total teams with both fields:', total.rows[0]);

  const pct = (parseInt(q5.rows[0].total_teams_with_wrong_age_group) / parseInt(total.rows[0].total) * 100).toFixed(2);
  console.log(`Percentage with wrong age_group: ${pct}%`);

  // Query 6: Check app_rankings columns
  console.log('\n--- Query 6: app_rankings columns ---');
  const arcols = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'app_rankings'
    ORDER BY ordinal_position;
  `);
  console.log('app_rankings columns:', arcols.rows.map(r => r.column_name).join(', '));

  // Query 6b: Specific teams comparison
  console.log('\n--- Query 6b: Specific teams comparison (teams_v2 vs app_rankings) ---');
  const q6 = await pool.query(`
    SELECT
        t.display_name as team_name,
        t.birth_year,
        t.age_group as teams_v2_age_group,
        ar.age_group as app_rankings_age_group
    FROM teams_v2 t
    JOIN app_rankings ar ON t.id = ar.id
    WHERE t.state = 'KS'
      AND t.gender = 'M'
      AND (t.display_name ILIKE '%Northeast United SC CKU Arsenal 15B%'
           OR t.display_name ILIKE '%Sporting Blue Valley%2014B%')
    LIMIT 5;
  `);
  console.table(q6.rows);

  // Bonus: Check what the app_rankings view definition is
  console.log('\n--- Bonus: app_rankings view definition (age_group part) ---');
  const viewDef = await pool.query(`
    SELECT pg_get_viewdef('app_rankings', true) as definition;
  `);
  console.log(viewDef.rows[0].definition);

  await pool.end();
}

runAllQueries().catch(console.error);
