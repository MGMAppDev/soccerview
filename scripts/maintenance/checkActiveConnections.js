import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function checkConnections() {
  try {
    await client.connect();

    const connectionsQuery = await client.query(`
      SELECT
        pid,
        usename,
        application_name,
        state,
        wait_event,
        wait_event_type,
        query_start,
        state_change,
        LEFT(query, 100) as query_preview
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid != pg_backend_pid()
      ORDER BY query_start DESC NULLS LAST
      LIMIT 20
    `);

    console.log(`📊 Active Database Connections (${connectionsQuery.rows.length} shown):\n`);

    connectionsQuery.rows.forEach(row => {
      console.log(`PID ${row.pid} - ${row.state}`);
      console.log(`  App: ${row.application_name || 'unknown'}`);
      console.log(`  User: ${row.usename}`);
      if (row.wait_event) {
        console.log(`  Waiting: ${row.wait_event_type} - ${row.wait_event}`);
      }
      if (row.query_start) {
        console.log(`  Started: ${row.query_start}`);
      }
      if (row.query_preview && row.query_preview !== '<IDLE>') {
        console.log(`  Query: ${row.query_preview}...`);
      }
      console.log('');
    });

    const totalQuery = await client.query(`
      SELECT COUNT(*) as total
      FROM pg_stat_activity
      WHERE datname = current_database()
    `);
    console.log(`Total active connections: ${totalQuery.rows[0].total}/60`);

    await client.end();
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

checkConnections();
