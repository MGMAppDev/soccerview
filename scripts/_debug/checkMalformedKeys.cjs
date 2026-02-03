// Check malformed source_match_keys
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  try {
    // Sample malformed keys
    const { rows } = await pool.query(`
      SELECT source_match_key
      FROM staging_games
      WHERE source_match_key LIKE '%' || chr(10) || '%'
      AND processed = false
      LIMIT 10
    `);

    console.log('=== Sample malformed keys ===');
    for (const r of rows) {
      const key = r.source_match_key;
      const cleaned = key.split('\n')[0];
      console.log('Original:', JSON.stringify(key));
      console.log('Cleaned:', JSON.stringify(cleaned));
      console.log('---');
    }

    // Check if cleaning would create duplicates
    const { rows: dupeCheck } = await pool.query(`
      SELECT split_part(source_match_key, chr(10), 1) as cleaned_key, COUNT(*) as cnt
      FROM staging_games
      WHERE source_match_key LIKE '%' || chr(10) || '%'
      AND processed = false
      GROUP BY split_part(source_match_key, chr(10), 1)
      HAVING COUNT(*) > 1
      LIMIT 5
    `);

    console.log('\n=== Would cleaning create duplicates? ===');
    console.log('Keys that would have duplicates:', dupeCheck.length);

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
})();
