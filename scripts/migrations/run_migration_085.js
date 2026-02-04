/**
 * Migration Runner: 085_add_semantic_match_constraint
 * ===================================================
 * Session 85: Universal SoccerView ID Architecture
 *
 * Adds semantic unique constraint on matches_v2:
 * UNIQUE (match_date, home_team_id, away_team_id)
 *
 * PREREQUISITE: Run matchDedup.js --execute BEFORE this migration
 * to remove existing duplicates, or the constraint will fail.
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { Pool } = pg;

async function runMigration() {
  console.log('🔄 Migration 085: Add Semantic Match Constraint');
  console.log('='.repeat(50));

  // Load environment
  await import('dotenv/config');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const client = await pool.connect();

  try {
    // Step 1: Verify no duplicates exist
    console.log('\n1️⃣  Verifying no duplicates exist...');
    const { rows: dupes } = await client.query(`
      SELECT COUNT(*) as count
      FROM (
        SELECT match_date, home_team_id, away_team_id
        FROM matches_v2
        GROUP BY match_date, home_team_id, away_team_id
        HAVING COUNT(*) > 1
      ) x
    `);

    if (parseInt(dupes[0].count) > 0) {
      console.error(`❌ Found ${dupes[0].count} duplicate groups!`);
      console.error('   Run: node scripts/universal/deduplication/matchDedup.js --execute');
      console.error('   BEFORE running this migration.');
      process.exit(1);
    }
    console.log('   ✅ No duplicates found');

    // Step 2: Check current constraints
    console.log('\n2️⃣  Checking current constraints...');
    const { rows: constraints } = await client.query(`
      SELECT constraint_name, constraint_type
      FROM information_schema.table_constraints
      WHERE table_name = 'matches_v2'
        AND constraint_type IN ('UNIQUE', 'PRIMARY KEY')
    `);
    console.log('   Current constraints:', constraints.map(c => c.constraint_name).join(', ') || 'none');

    // Step 3: Read and execute migration SQL
    console.log('\n3️⃣  Executing migration SQL...');
    const sqlPath = path.join(__dirname, '085_add_semantic_match_constraint.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    // Split by semicolons and execute each statement
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const statement of statements) {
      if (statement.toLowerCase().startsWith('comment')) {
        // Skip COMMENT statements for now (may fail on some PG versions)
        continue;
      }
      try {
        await client.query(statement);
        console.log('   ✅ Executed:', statement.substring(0, 60) + '...');
      } catch (err) {
        if (err.message.includes('already exists') || err.message.includes('does not exist')) {
          console.log('   ⏭️  Skipped (already applied):', statement.substring(0, 50) + '...');
        } else {
          throw err;
        }
      }
    }

    // Step 4: Verify new constraint exists
    console.log('\n4️⃣  Verifying new constraint...');
    const { rows: newConstraints } = await client.query(`
      SELECT constraint_name, constraint_type
      FROM information_schema.table_constraints
      WHERE table_name = 'matches_v2'
        AND constraint_name = 'unique_match_semantic'
    `);

    if (newConstraints.length > 0) {
      console.log('   ✅ Constraint unique_match_semantic created successfully');
    } else {
      console.error('   ❌ Constraint was not created');
      process.exit(1);
    }

    console.log('\n✅ Migration 085 completed successfully!');
    console.log('   Matches are now uniquely identified by:');
    console.log('   (match_date, home_team_id, away_team_id)');

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration().catch(e => {
  console.error(e);
  process.exit(1);
});
