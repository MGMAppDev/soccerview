require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const { rows } = await pool.query(`
    SELECT name, state, season_id
    FROM leagues
    WHERE name ILIKE '%NPL%'
       OR name ILIKE '%National Premier%'
       OR name ILIKE '%Premier League%'
       OR name ILIKE '%WPL%'
       OR name ILIKE '%SAPL%'
       OR name ILIKE '%Red River%'
       OR name ILIKE '%NorCal NPL%'
    ORDER BY name
  `);
  console.log(`Found ${rows.length} NPL-related leagues:`);
  rows.forEach(row => console.log(` - "${row.name}" | state: ${row.state}`));
  await pool.end();
}

main().catch(e => { console.error(e.message); pool.end(); });
