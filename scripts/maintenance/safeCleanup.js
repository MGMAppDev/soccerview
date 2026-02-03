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

  // Count NULL birth_years
  const count = await client.query("SELECT COUNT(*) as c FROM teams_v2 WHERE birth_year IS NULL");
  console.log("NULL birth_year teams:", count.rows[0].c);

  // Step 1: Create temp table with safe IDs (4-digit years)
  // Pick only ONE team per (canonical_name, gender, state, extracted_year) to avoid batch conflicts
  console.log("Finding safe 4-digit year updates...");
  await client.query(`
    CREATE TEMP TABLE safe_4digit AS
    SELECT DISTINCT ON (t1.canonical_name, t1.gender, t1.state, (regexp_match(t1.display_name, '(20[01][0-9])'))[1]::int)
      t1.id, (regexp_match(t1.display_name, '(20[01][0-9])'))[1]::int as new_by
    FROM teams_v2 t1
    WHERE t1.birth_year IS NULL
      AND t1.display_name ~ '20[01][0-9]'
      AND NOT EXISTS (
        SELECT 1 FROM teams_v2 t2
        WHERE t2.canonical_name = t1.canonical_name
          AND t2.gender = t1.gender
          AND t2.state = t1.state
          AND t2.birth_year = (regexp_match(t1.display_name, '(20[01][0-9])'))[1]::int
          AND t2.id != t1.id
      )
    ORDER BY t1.canonical_name, t1.gender, t1.state, (regexp_match(t1.display_name, '(20[01][0-9])'))[1]::int, t1.id
  `);

  const safeCount = await client.query("SELECT COUNT(*) as c FROM safe_4digit");
  console.log("Safe 4-digit updates:", safeCount.rows[0].c);

  // Apply updates
  const updated = await client.query(`
    UPDATE teams_v2 t
    SET birth_year = s.new_by,
        birth_year_source = 'extracted_from_name',
        updated_at = NOW()
    FROM safe_4digit s
    WHERE t.id = s.id
  `);
  console.log("Updated 4-digit:", updated.rowCount);

  // Step 2: 2-digit codes like 14B, 15G
  console.log("Finding safe 2-digit BG updates...");
  await client.query(`
    CREATE TEMP TABLE safe_2digit_bg AS
    SELECT DISTINCT ON (t1.canonical_name, t1.gender, t1.state, 2000 + (regexp_match(t1.display_name, '([01][0-9])[BG]'))[1]::int)
      t1.id, 2000 + (regexp_match(t1.display_name, '([01][0-9])[BG]'))[1]::int as new_by
    FROM teams_v2 t1
    WHERE t1.birth_year IS NULL
      AND t1.display_name ~ '[01][0-9][BG]'
      AND NOT EXISTS (
        SELECT 1 FROM teams_v2 t2
        WHERE t2.canonical_name = t1.canonical_name
          AND t2.gender = t1.gender
          AND t2.state = t1.state
          AND t2.birth_year = 2000 + (regexp_match(t1.display_name, '([01][0-9])[BG]'))[1]::int
          AND t2.id != t1.id
      )
    ORDER BY t1.canonical_name, t1.gender, t1.state, 2000 + (regexp_match(t1.display_name, '([01][0-9])[BG]'))[1]::int, t1.id
  `);

  const updated2 = await client.query(`
    UPDATE teams_v2 t
    SET birth_year = s.new_by,
        birth_year_source = 'extracted_from_name',
        updated_at = NOW()
    FROM safe_2digit_bg s
    WHERE t.id = s.id
  `);
  console.log("Updated 2-digit BG:", updated2.rowCount);

  // Step 3: Age group patterns (U##)
  console.log("Finding safe age group updates...");
  await client.query(`
    CREATE TEMP TABLE safe_age_group AS
    SELECT DISTINCT ON (t1.canonical_name, t1.gender, t1.state, 2026 - (regexp_match(t1.display_name, 'U(\\d+)'))[1]::int)
      t1.id, 2026 - (regexp_match(t1.display_name, 'U(\\d+)'))[1]::int as new_by
    FROM teams_v2 t1
    WHERE t1.birth_year IS NULL
      AND t1.display_name ~ 'U\\d+'
      AND NOT EXISTS (
        SELECT 1 FROM teams_v2 t2
        WHERE t2.canonical_name = t1.canonical_name
          AND t2.gender = t1.gender
          AND t2.state = t1.state
          AND t2.birth_year = 2026 - (regexp_match(t1.display_name, 'U(\\d+)'))[1]::int
          AND t2.id != t1.id
      )
    ORDER BY t1.canonical_name, t1.gender, t1.state, 2026 - (regexp_match(t1.display_name, 'U(\\d+)'))[1]::int, t1.id
  `);

  const updated3 = await client.query(`
    UPDATE teams_v2 t
    SET birth_year = s.new_by,
        birth_year_source = 'from_age_group',
        updated_at = NOW()
    FROM safe_age_group s
    WHERE t.id = s.id
  `);
  console.log("Updated age group:", updated3.rowCount);

  // Step 4: Flag remaining NULL that have year info in name
  const flaggedNull = await client.query(`
    UPDATE teams_v2
    SET data_flags = COALESCE(data_flags, '{}'::jsonb) || '{"needs_birth_year_review": true}'::jsonb
    WHERE birth_year IS NULL
      AND display_name ~ '20[01][0-9]|[01][0-9][BG]|[BG][01][0-9]|U\\d+'
      AND (data_flags IS NULL OR NOT (data_flags ? 'needs_birth_year_review'))
  `);
  console.log("Flagged NULL for review:", flaggedNull.rowCount);

  // Step 5: Flag mismatches
  const flaggedMismatch = await client.query(`
    UPDATE teams_v2
    SET data_flags = COALESCE(data_flags, '{}'::jsonb) || '{"birth_year_conflict": true}'::jsonb
    WHERE display_name ~ '20[01][0-9]'
      AND birth_year IS NOT NULL
      AND birth_year != (regexp_match(display_name, '(20[01][0-9])'))[1]::int
      AND (data_flags IS NULL OR NOT (data_flags ? 'birth_year_conflict'))
  `);
  console.log("Flagged mismatches:", flaggedMismatch.rowCount);

  // Step 6: Flag invalid range
  const flaggedInvalid = await client.query(`
    UPDATE teams_v2
    SET data_flags = COALESCE(data_flags, '{}'::jsonb) || '{"invalid_birth_year": true}'::jsonb
    WHERE birth_year IS NOT NULL
      AND (birth_year < 2007 OR birth_year > 2019)
      AND (data_flags IS NULL OR NOT (data_flags ? 'invalid_birth_year'))
  `);
  console.log("Flagged invalid range:", flaggedInvalid.rowCount);

  // Final audit
  const audit = await client.query(`
    SELECT
      COUNT(*) FILTER (WHERE birth_year IS NULL) as null_by,
      COUNT(*) FILTER (WHERE data_flags IS NOT NULL AND data_flags != '{}'::jsonb) as flagged,
      COUNT(*) FILTER (WHERE birth_year IS NOT NULL AND (data_flags IS NULL OR data_flags = '{}'::jsonb)) as clean,
      COUNT(*) as total
    FROM teams_v2
  `);

  console.log("\n=== FINAL AUDIT ===");
  console.log("Remaining NULL birth_year:", audit.rows[0].null_by);
  console.log("Flagged for review:", audit.rows[0].flagged);
  console.log("Clean teams:", audit.rows[0].clean);
  console.log("Total teams:", audit.rows[0].total);

  await client.end();
  console.log("Done");
}

run().catch(e => {
  console.error(e.message);
  process.exit(1);
});
