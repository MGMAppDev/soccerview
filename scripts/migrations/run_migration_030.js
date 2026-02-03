/**
 * Run Migration 030: Create Canonical Registry System
 * Phase 1 of Universal Data Quality Specification
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function runMigration() {
  console.log('🔄 Running Migration 030: Canonical Registry System\n');

  const client = await pool.connect();

  try {
    // Read the SQL file
    const sqlPath = path.join(__dirname, '030_create_canonical_registries.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    // Split into individual statements
    const statements = sql
      .split(/;\s*$/m)
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    console.log(`📋 Executing ${statements.length} statements...\n`);

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      const preview = stmt.substring(0, 60).replace(/\n/g, ' ');

      try {
        await client.query(stmt);
        console.log(`✅ ${i + 1}/${statements.length}: ${preview}...`);
      } catch (err) {
        // Check if it's just "already exists" type error
        if (err.message.includes('already exists') || err.message.includes('duplicate')) {
          console.log(`⏭️  ${i + 1}/${statements.length}: Already exists - ${preview}...`);
        } else {
          console.error(`❌ ${i + 1}/${statements.length}: ${err.message}`);
          console.error(`   Statement: ${preview}...`);
        }
      }
    }

    // Verify tables created
    console.log('\n📊 VERIFICATION:');

    const tables = ['canonical_events', 'canonical_teams', 'canonical_clubs'];
    for (const table of tables) {
      const { rows } = await client.query(`
        SELECT COUNT(*) as count FROM ${table}
      `);
      console.log(`   ${table}: ${rows[0].count} rows`);
    }

    // Verify functions created
    const functions = ['resolve_canonical_event', 'resolve_canonical_team', 'resolve_canonical_club'];
    for (const func of functions) {
      const { rows } = await client.query(`
        SELECT proname FROM pg_proc WHERE proname = $1
      `, [func]);
      console.log(`   ${func}(): ${rows.length > 0 ? '✅ exists' : '❌ missing'}`);
    }

    // Test resolve function
    console.log('\n🧪 TESTING resolve_canonical_event():');
    const { rows: testResult } = await client.query(`
      SELECT * FROM resolve_canonical_event('Heartland Soccer League 2025')
    `);
    if (testResult.length > 0) {
      console.log(`   ✅ Found: ${testResult[0].canonical_name}`);
    } else {
      console.log(`   ⚠️ No match found (registry may need more data)`);
    }

    console.log('\n✅ Migration 030 complete!');

  } finally {
    client.release();
    await pool.end();
  }
}

runMigration().catch(err => {
  console.error('Fatal error:', err);
  pool.end();
  process.exit(1);
});
