require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  // Count staged rows
  const { rows: [count] } = await pool.query("SELECT COUNT(*) as cnt FROM staging_games WHERE source_platform = 'sincsports'");
  console.log('SINC Sports staging rows:', count.cnt);

  // Check data quality sample
  const { rows: sample } = await pool.query("SELECT match_date, match_time, home_team_name, away_team_name, home_score, away_score, division, source_match_key FROM staging_games WHERE source_platform = 'sincsports' ORDER BY match_date DESC LIMIT 5");
  console.log('\nSample (most recent):');
  sample.forEach(r => {
    console.log('  ' + r.match_date + ' ' + (r.match_time || 'no-time') + ' | ' + r.home_team_name + ' ' + (r.home_score != null ? r.home_score : 'null') + '-' + (r.away_score != null ? r.away_score : 'null') + ' ' + r.away_team_name + ' | ' + r.division + ' | ' + r.source_match_key);
  });

  // Check score distribution
  const { rows: [scores] } = await pool.query("SELECT COUNT(*) FILTER(WHERE home_score IS NOT NULL) as with_scores, COUNT(*) FILTER(WHERE home_score IS NULL) as scheduled FROM staging_games WHERE source_platform = 'sincsports'");
  console.log('\nWith scores (completed): ' + scores.with_scores);
  console.log('Scheduled (NULL scores): ' + scores.scheduled);

  // Check divisions
  const { rows: divs } = await pool.query("SELECT division, COUNT(*) as cnt FROM staging_games WHERE source_platform = 'sincsports' GROUP BY division ORDER BY cnt DESC LIMIT 10");
  console.log('\nTop divisions:');
  divs.forEach(d => console.log('  ' + d.division + ': ' + d.cnt + ' matches'));

  // Check time values
  const { rows: times } = await pool.query("SELECT match_time::text, COUNT(*) as cnt FROM staging_games WHERE source_platform = 'sincsports' AND match_time IS NOT NULL GROUP BY match_time ORDER BY cnt DESC LIMIT 10");
  console.log('\nTop match times:');
  times.forEach(t => console.log('  ' + t.match_time + ': ' + t.cnt));

  // Check gender/age from raw_data
  const { rows: genders } = await pool.query("SELECT raw_data->>'gender' as gender, COUNT(*) as cnt FROM staging_games WHERE source_platform = 'sincsports' GROUP BY raw_data->>'gender' ORDER BY cnt DESC");
  console.log('\nGender distribution:');
  genders.forEach(g => console.log('  ' + g.gender + ': ' + g.cnt));

  const { rows: ages } = await pool.query("SELECT raw_data->>'ageGroup' as age_group, COUNT(*) as cnt FROM staging_games WHERE source_platform = 'sincsports' GROUP BY raw_data->>'ageGroup' ORDER BY cnt DESC LIMIT 10");
  console.log('\nAge group distribution:');
  ages.forEach(a => console.log('  ' + a.age_group + ': ' + a.cnt));

  await pool.end();
})();
