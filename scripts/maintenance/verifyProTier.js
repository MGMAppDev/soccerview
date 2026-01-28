import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function verifyProTier() {
  try {
    await client.connect();
    console.log('✅ Database ONLINE - Pro Tier Active\n');

    const settingsQuery = await client.query(`
      SELECT
        name,
        setting,
        unit
      FROM pg_settings
      WHERE name IN ('max_connections', 'statement_timeout')
      ORDER BY name
    `);

    console.log('📊 Pro Tier Configuration:');
    settingsQuery.rows.forEach(row => {
      const value = row.unit ? `${row.setting}${row.unit}` : row.setting;
      const isGood = (row.name === 'max_connections' && row.setting === '200') ||
                     (row.name === 'statement_timeout' && row.setting === '600000');
      const check = isGood ? '✅' : '⚠️';
      console.log(`  ${check} ${row.name}: ${value}`);
    });

    const sizeQuery = await client.query(`
      SELECT pg_size_pretty(pg_database_size(current_database())) as size
    `);
    console.log(`\n💾 Database Size: ${sizeQuery.rows[0].size}`);

    await client.end();
  } catch (err) {
    console.error('❌ Database error:', err.message);
    process.exit(1);
  }
}

verifyProTier();
