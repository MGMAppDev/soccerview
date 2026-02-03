import "dotenv/config";
import pg from "pg";
import { authorizePipelineWrite } from '../universal/pipelineAuth.js';

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  statement_timeout: 600000
});

async function run() {
  await client.connect();
  console.log(new Date().toISOString(), "Connected");

  // Authorize writes to protected tables
  await authorizePipelineWrite(client);

  // Quick count
  const count = await client.query("SELECT COUNT(*) as c FROM teams_v2 WHERE birth_year IS NULL");
  console.log(new Date().toISOString(), "NULL birth_year teams:", count.rows[0].c);

  // Create temp table with IDs of teams that would cause conflicts
  console.log(new Date().toISOString(), "Finding conflict IDs...");
  await client.query(`
    CREATE TEMP TABLE conflict_ids AS
    SELECT t1.id
    FROM teams_v2 t1
    JOIN teams_v2 t2 ON
      t1.id != t2.id
      AND t1.canonical_name = t2.canonical_name
      AND t1.gender = t2.gender
      AND t1.state = t2.state
      AND t1.birth_year IS NULL
      AND t2.birth_year IS NOT NULL
      AND t1.display_name ~ '20[01][0-9]'
      AND t2.birth_year = (regexp_match(t1.display_name, '(20[01][0-9])'))[1]::int
  `);

  const conflictCount = await client.query("SELECT COUNT(*) as c FROM conflict_ids");
  console.log(new Date().toISOString(), "Conflict IDs found:", conflictCount.rows[0].c);

  // Update all NULL birth_year teams EXCEPT those with conflicts
  console.log(new Date().toISOString(), "Updating non-conflict teams...");
  const updated = await client.query(`
    UPDATE teams_v2
    SET birth_year = (regexp_match(display_name, '(20[01][0-9])'))[1]::int,
        birth_year_source = 'extracted_from_name'
    WHERE birth_year IS NULL
      AND display_name ~ '20[01][0-9]'
      AND id NOT IN (SELECT id FROM conflict_ids)
  `);
  console.log(new Date().toISOString(), "Updated:", updated.rowCount);

  // Flag the conflicts
  const flagged = await client.query(`
    UPDATE teams_v2
    SET data_flags = COALESCE(data_flags, '{}'::jsonb) || '{"potential_duplicate": true}'::jsonb
    WHERE id IN (SELECT id FROM conflict_ids)
  `);
  console.log(new Date().toISOString(), "Flagged conflicts:", flagged.rowCount);

  // Flag name vs stored mismatches
  const mismatches = await client.query(`
    UPDATE teams_v2
    SET data_flags = COALESCE(data_flags, '{}'::jsonb) || '{"birth_year_conflict": true}'::jsonb
    WHERE display_name ~ '20[01][0-9]'
      AND birth_year IS NOT NULL
      AND birth_year != (regexp_match(display_name, '(20[01][0-9])'))[1]::int
      AND (data_flags IS NULL OR NOT (data_flags ? 'birth_year_conflict'))
  `);
  console.log(new Date().toISOString(), "Flagged mismatches:", mismatches.rowCount);

  // Flag invalid range
  const invalid = await client.query(`
    UPDATE teams_v2
    SET data_flags = COALESCE(data_flags, '{}'::jsonb) || '{"invalid_birth_year": true}'::jsonb
    WHERE birth_year IS NOT NULL
      AND (birth_year < 2007 OR birth_year > 2019)
      AND (data_flags IS NULL OR NOT (data_flags ? 'invalid_birth_year'))
  `);
  console.log(new Date().toISOString(), "Flagged invalid range:", invalid.rowCount);

  // Final audit
  const audit = await client.query(`
    SELECT
      COUNT(*) FILTER (WHERE birth_year IS NULL) as null_by,
      COUNT(*) FILTER (WHERE data_flags IS NOT NULL) as flagged,
      COUNT(*) as total
    FROM teams_v2
  `);
  console.log("\n=== RESULT ===");
  console.log("Remaining NULL:", audit.rows[0].null_by);
  console.log("Flagged:", audit.rows[0].flagged);
  console.log("Total:", audit.rows[0].total);

  await client.end();
  console.log("Done");
}

run().catch(e => {
  console.error(e.message);
  process.exit(1);
});
