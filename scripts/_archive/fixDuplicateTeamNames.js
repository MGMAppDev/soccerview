/**
 * Fix Duplicate Team Names
 *
 * Fixes team names where the club name appears twice:
 * "Las Vegas Sports Academy Las Vegas Sports Academy U10 Boys"
 * → "Las Vegas Sports Academy U10 Boys"
 *
 * Run: node scripts/fixDuplicateTeamNames.js
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function findDuplicatePrefix(name) {
  if (!name) return null;

  const words = name.split(' ');

  // Try prefix lengths from 2 to 5 words
  for (let len = 2; len <= 5; len++) {
    if (words.length >= len * 2) {
      const prefix = words.slice(0, len).join(' ');
      const rest = words.slice(len).join(' ');

      // Check if rest starts with same prefix (case insensitive)
      if (rest.toLowerCase().startsWith(prefix.toLowerCase())) {
        // Return the cleaned name (prefix + rest without the duplicate prefix)
        const restWords = rest.split(' ');
        const cleanedRest = restWords.slice(len).join(' ');
        return prefix + ' ' + cleanedRest;
      }
    }
  }

  return null;
}

async function main() {
  console.log('=== Fix Duplicate Team Names ===\n');

  // First, get count
  const { count: totalCount } = await supabase
    .from('teams')
    .select('*', { count: 'exact', head: true });

  console.log(`Total teams in database: ${totalCount.toLocaleString()}`);

  // Process in batches
  const BATCH_SIZE = 1000;
  let offset = 0;
  let totalFixed = 0;
  let totalScanned = 0;
  const fixes = [];

  console.log('\nScanning for duplicates...\n');

  while (offset < totalCount) {
    const { data: teams, error } = await supabase
      .from('teams')
      .select('id, team_name')
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      console.error('Error fetching teams:', error);
      break;
    }

    if (!teams || teams.length === 0) break;

    for (const team of teams) {
      const cleanedName = findDuplicatePrefix(team.team_name);
      if (cleanedName) {
        fixes.push({
          id: team.id,
          oldName: team.team_name,
          newName: cleanedName.trim()
        });
      }
    }

    totalScanned += teams.length;
    process.stdout.write(`\rScanned: ${totalScanned.toLocaleString()} / ${totalCount.toLocaleString()} | Found: ${fixes.length.toLocaleString()} duplicates`);

    offset += BATCH_SIZE;
  }

  console.log('\n');

  if (fixes.length === 0) {
    console.log('No duplicate team names found!');
    return;
  }

  console.log(`Found ${fixes.length.toLocaleString()} teams with duplicate names\n`);

  // Show some examples
  console.log('Examples of fixes:');
  fixes.slice(0, 5).forEach((fix, i) => {
    console.log(`\n${i + 1}. BEFORE: ${fix.oldName}`);
    console.log(`   AFTER:  ${fix.newName}`);
  });

  console.log('\n\nApplying fixes...\n');

  // Apply fixes in batches
  const UPDATE_BATCH_SIZE = 100;
  for (let i = 0; i < fixes.length; i += UPDATE_BATCH_SIZE) {
    const batch = fixes.slice(i, i + UPDATE_BATCH_SIZE);

    // Update each team in the batch
    for (const fix of batch) {
      const { error } = await supabase
        .from('teams')
        .update({ team_name: fix.newName })
        .eq('id', fix.id);

      if (error) {
        console.error(`Error updating team ${fix.id}:`, error.message);
      } else {
        totalFixed++;
      }
    }

    process.stdout.write(`\rFixed: ${totalFixed.toLocaleString()} / ${fixes.length.toLocaleString()}`);
  }

  console.log('\n\n=== Complete ===');
  console.log(`Total teams fixed: ${totalFixed.toLocaleString()}`);
}

main().catch(console.error);
