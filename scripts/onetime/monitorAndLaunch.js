import pg from 'pg';
import dotenv from 'dotenv';
import { spawn } from 'child_process';

dotenv.config();

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function checkProTier() {
  try {
    await client.connect();

    const settingsQuery = await client.query(`
      SELECT setting::int as max_connections
      FROM pg_settings
      WHERE name = 'max_connections'
    `);

    await client.end();

    return parseInt(settingsQuery.rows[0].max_connections);
  } catch (err) {
    console.error('❌ Check failed:', err.message);
    return null;
  }
}

async function launchLinkingBatches() {
  console.log('\n🚀 LAUNCHING 4 OPTIMIZED LINKING BATCHES\n');
  console.log('═'.repeat(55));

  const batches = [];

  for (let i = 0; i < 4; i++) {
    console.log(`\n[Batch ${i + 1}/4] Starting...`);

    const process = spawn('node', [
      'scripts/fastLinkV3Parallel.js',
      '--batch', i.toString(),
      '--total-batches', '4'
    ], {
      detached: false,
      stdio: 'inherit'
    });

    batches.push(process);

    // Small delay between launches
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('\n✅ All 4 batches launched successfully!');
  console.log('\n📊 Batches will process in parallel:');
  console.log('   - Batch 1: HOME names 0-4,424 + AWAY names 0-6,197');
  console.log('   - Batch 2: HOME names 4,424-8,848 + AWAY names 6,197-12,393');
  console.log('   - Batch 3: HOME names 8,848-13,271 + AWAY names 12,393-18,590');
  console.log('   - Batch 4: HOME names 13,271-17,695 + AWAY names 18,590-24,786');
  console.log('\n⏱️  Estimated time: 2-3 hours with Pro tier\n');

  return batches;
}

async function monitor() {
  console.log('👀 Monitoring Pro Tier Activation');
  console.log('═'.repeat(55));
  console.log('Checking max_connections every 2 minutes...');
  console.log('Will auto-launch linking batches when max_connections = 200\n');

  let checkCount = 1;

  while (true) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] Check #${checkCount}:`);

    const maxConnections = await checkProTier();

    if (maxConnections === null) {
      console.log('   ⚠️  Database check failed, retrying in 2 minutes...\n');
    } else if (maxConnections >= 200) {
      console.log(`   ✅ max_connections = ${maxConnections} (Pro tier ACTIVE!)\n`);

      // Launch batches
      await launchLinkingBatches();

      // Exit - batches are now running independently
      process.exit(0);
    } else {
      console.log(`   ⏳ max_connections = ${maxConnections} (waiting for 200...)\n`);
    }

    checkCount++;

    // Wait 2 minutes
    await new Promise(resolve => setTimeout(resolve, 120000));
  }
}

monitor().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
