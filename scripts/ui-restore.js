#!/usr/bin/env node
/**
 * UI Restore Utility
 * Restores UI files from archived backups
 *
 * Usage:
 *   node scripts/ui-restore.js team-details          # List available versions
 *   node scripts/ui-restore.js team-details golden   # Restore golden version
 *   node scripts/ui-restore.js team-details latest   # Restore most recent backup
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const ARCHIVE_DIR = path.join(PROJECT_ROOT, 'ui-archives');

// Map archive folders to app paths
const ARCHIVE_TO_PATH = {
  'team-details': 'app/team/[id].tsx',
  'rankings': 'app/(tabs)/rankings.tsx',
  'matches': 'app/(tabs)/matches.tsx',
  'teams': 'app/(tabs)/teams.tsx',
  'home': 'app/(tabs)/index.tsx',
};

function listVersions(component) {
  const archiveDir = path.join(ARCHIVE_DIR, component);

  if (!fs.existsSync(archiveDir)) {
    console.error(`ERROR: Archive not found: ${component}`);
    console.error('Available archives:', Object.keys(ARCHIVE_TO_PATH).join(', '));
    process.exit(1);
  }

  const files = fs.readdirSync(archiveDir)
    .filter(f => f.endsWith('.tsx'))
    .sort()
    .reverse();

  console.log('');
  console.log(`ARCHIVE: ${component}/`);
  console.log('='.repeat(50));
  console.log(`   Target: ${ARCHIVE_TO_PATH[component]}`);
  console.log('');
  console.log('   Available versions:');

  files.forEach(f => {
    const isGolden = f.includes('golden');
    const prefix = isGolden ? 'GOLDEN' : '      ';
    console.log(`   ${prefix} ${f}`);
  });

  console.log('');
  console.log('To restore:');
  console.log(`   node scripts/ui-restore.js ${component} golden  # Restore golden version`);
  console.log(`   node scripts/ui-restore.js ${component} latest  # Restore most recent`);
  console.log('');
}

function restoreVersion(component, version) {
  const archiveDir = path.join(ARCHIVE_DIR, component);
  const targetPath = path.join(PROJECT_ROOT, ARCHIVE_TO_PATH[component]);

  if (!fs.existsSync(archiveDir)) {
    console.error(`ERROR: Archive not found: ${component}`);
    process.exit(1);
  }

  const files = fs.readdirSync(archiveDir)
    .filter(f => f.endsWith('.tsx'))
    .sort()
    .reverse();

  let sourceFile;

  if (version === 'golden') {
    sourceFile = files.find(f => f.includes('golden'));
    if (!sourceFile) {
      console.error(`ERROR: No golden version found for ${component}`);
      process.exit(1);
    }
  } else if (version === 'latest') {
    sourceFile = files[0];
  } else {
    sourceFile = files.find(f => f.includes(version));
    if (!sourceFile) {
      console.error(`ERROR: Version not found: ${version}`);
      console.error('Available:', files.slice(0, 5).join(', '));
      process.exit(1);
    }
  }

  const sourcePath = path.join(archiveDir, sourceFile);

  // Backup current before restore
  if (fs.existsSync(targetPath)) {
    const timestamp = new Date().toISOString().slice(0, 10);
    const timeStr = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
    const backupPath = path.join(archiveDir, `pre-restore_${timestamp}_${timeStr}.tsx`);
    fs.copyFileSync(targetPath, backupPath);
    console.log(`Current version backed up to: ${path.relative(PROJECT_ROOT, backupPath)}`);
  }

  // Restore
  fs.copyFileSync(sourcePath, targetPath);

  console.log('');
  console.log('UI RESTORED');
  console.log('='.repeat(50));
  console.log(`Source:  ${sourceFile}`);
  console.log(`Target:  ${ARCHIVE_TO_PATH[component]}`);
  console.log('');
  console.log('Reload the app to verify UI is working correctly.');
  console.log('');
}

// Main
const component = process.argv[2];
const version = process.argv[3];

if (!component) {
  console.log('');
  console.log('UI RESTORE UTILITY');
  console.log('='.repeat(50));
  console.log('');
  console.log('Usage:');
  console.log('  node scripts/ui-restore.js <component>          # List versions');
  console.log('  node scripts/ui-restore.js <component> golden   # Restore golden');
  console.log('  node scripts/ui-restore.js <component> latest   # Restore latest');
  console.log('');
  console.log('Available components:');
  Object.entries(ARCHIVE_TO_PATH).forEach(([archive, appPath]) => {
    console.log(`  ${archive.padEnd(15)} -> ${appPath}`);
  });
  console.log('');
  process.exit(0);
}

if (!version) {
  listVersions(component);
} else {
  restoreVersion(component, version);
}
