import "dotenv/config";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL environment variable");
  process.exit(1);
}

async function main() {
  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log("Connected to PostgreSQL\n");

    // Check columns
    console.log("=== teams_v2 COLUMNS ===\n");
    const columns = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'teams_v2'
      ORDER BY ordinal_position
    `);

    if (columns.rows.length === 0) {
      console.log("Table 'teams_v2' does not exist!\n");
    } else {
      console.log(`Found ${columns.rows.length} columns:\n`);
      columns.rows.forEach(col => {
        const nullable = col.is_nullable === 'YES' ? 'nullable' : 'NOT NULL';
        console.log(`  ${col.column_name.padEnd(20)} ${col.data_type.padEnd(15)} (${nullable})`);
      });
    }

  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
