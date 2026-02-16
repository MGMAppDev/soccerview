require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  try {
    // Check staging_events
    const { rows: stagingEvents } = await pool.query(`
      SELECT event_name, event_type, source_platform, source_event_id 
      FROM staging_events 
      WHERE source_platform = 'mlsnext'
    `);
    console.log('=== staging_events for MLS Next ===');
    console.log(JSON.stringify(stagingEvents, null, 2));

    // Check the actual tournament record
    const { rows: tournamentRecord } = await pool.query(`
      SELECT id, name, source_event_id, source_platform
      FROM tournaments 
      WHERE source_event_id = '12' AND source_platform = 'mlsnext'
    `);
    console.log('\n=== Tournament record in DB ===');
    console.log(JSON.stringify(tournamentRecord, null, 2));

    // Check if there's a league record
    const { rows: leagueRecord } = await pool.query(`
      SELECT id, name, source_event_id, source_platform
      FROM leagues 
      WHERE source_event_id = '12' AND source_platform = 'mlsnext'
    `);
    console.log('\n=== League record in DB ===');
    console.log(JSON.stringify(leagueRecord, null, 2));

    await pool.end();
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
