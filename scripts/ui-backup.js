#!/usr/bin/env node
/**
 * UI Backup Utility
 * Creates timestamped backups of UI files before modification
 *
 * Usage:
 *   node scripts/ui-backup.js app/team/[id].tsx
 *   node scripts/ui-backup.js app/(tabs)/rankings.tsx
 *
 * This script is MANDATORY before any UI file modification.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const ARCHIVE_DIR = path.join(PROJECT_ROOT, 'ui-archives');

// Map of app paths to archive folder names
const PATH_TO_ARCHIVE = {
  'app/team/[id].tsx': 'team-details',
  'app/(tabs)/rankings.tsx': 'rankings',
  'app/(tabs)/matches.tsx': 'matches',
  'app/(tabs)/teams.tsx': 'teams',
  'app/(tabs)/index.tsx': 'home',
};

function getArchiveFolder(filePath) {
  // Normalize path separators (Windows -> Unix style for matching)
  const normalizedPath = filePath.replace(/\\/g, '/');

  // Check direct mapping first
  if (PATH_TO_ARCHIVE[normalizedPath]) {
    return PATH_TO_ARCHIVE[normalizedPath];
  }

  // Extract component name from path
  const fileName = path.basename(filePath, '.tsx');
  if (fileName === '[id]') {
    return path.basename(path.dirname(filePath));
  }
  if (fileName === 'index') {
    return 'home';
  }
  return fileName;
}

function backupUIFile(filePath) {
  if (!filePath) {
    console.error('ERROR: Usage: node scripts/ui-backup.js <file-path>');
    console.error('');
    console.error('Examples:');
    console.error('  node scripts/ui-backup.js app/team/[id].tsx');
    console.error('  node scripts/ui-backup.js app/(tabs)/rankings.tsx');
    process.exit(1);
  }

  // Resolve full path
  const fullPath = path.isAbsolute(filePath)
    ? filePath
    : path.join(PROJECT_ROOT, filePath);

  // Verify file exists
  if (!fs.existsSync(fullPath)) {
    console.error(`ERROR: File not found: ${fullPath}`);
    process.exit(1);
  }

  // Determine archive folder
  const archiveFolder = getArchiveFolder(filePath);
  const archiveSubDir = path.join(ARCHIVE_DIR, archiveFolder);

  // Create archive directory if needed
  if (!fs.existsSync(archiveSubDir)) {
    fs.mkdirSync(archiveSubDir, { recursive: true });
    console.log(`Created archive directory: ${archiveSubDir}`);
  }

  // Generate timestamp
  const now = new Date();
  const timestamp = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, ''); // HHMMSS
  const backupFileName = `backup_${timestamp}_${timeStr}.tsx`;
  const backupPath = path.join(archiveSubDir, backupFileName);

  // Copy file
  fs.copyFileSync(fullPath, backupPath);

  console.log('');
  console.log('UI BACKUP CREATED');
  console.log('='.repeat(50));
  console.log(`Source:  ${filePath}`);
  console.log(`Backup:  ${path.relative(PROJECT_ROOT, backupPath)}`);
  console.log('');

  // List existing backups
  const backups = fs.readdirSync(archiveSubDir)
    .filter(f => f.endsWith('.tsx'))
    .sort()
    .reverse();

  console.log(`Archive: ${archiveFolder}/ (${backups.length} versions)`);
  console.log('   Recent backups:');
  backups.slice(0, 5).forEach((b, i) => {
    const isGolden = b.includes('golden');
    const prefix = isGolden ? 'GOLDEN' : '      ';
    console.log(`   ${prefix} ${b}`);
  });

  if (backups.length > 5) {
    console.log(`   ... and ${backups.length - 5} more`);
  }

  console.log('');
  console.log('REMINDER: Make minimal, surgical changes only!');
  console.log('');

  return backupPath;
}

// Run if called directly
const filePath = process.argv[2];
backupUIFile(filePath);
