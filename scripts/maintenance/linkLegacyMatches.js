/**
 * linkLegacyMatches.js
 *
 * Attempts to link legacy gotsport matches that have no source_match_key.
 * Uses date + team name matching (fuzzy) against staging_games.
 *
 * LIMITATION: staging_games only has ~400 gotsport records, so this script
 * can only fix a small fraction of the 15,000+ unlinked matches.
 *
 * Usage: node scripts/maintenance/linkLegacyMatches.js [--dry-run]
 *
 * V2 ARCHITECTURE: Uses pg Pool with proper authorization for write protection.
 */

import pg from 'pg';
import 'dotenv/config';
import { authorizePipelineWrite } from '../universal/pipelineAuth.js';

const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const DRY_RUN = process.argv.includes('--dry-run');

// Normalize team name for fuzzy matching
function normalizeTeamName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
}

async function main() {
  console.log('='.repeat(60));
  console.log('LINK LEGACY MATCHES (No source_match_key)');
  console.log('='.repeat(60));
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE'}`);
  console.log('');

  const startTime = Date.now();
  const client = await pool.connect();

  // Authorize writes to protected tables
  await authorizePipelineWrite(client);

  try {
    // ============================================================
    // STEP 1: Load gotsport staging_games with event info
    // ============================================================
    console.log('Step 1: Loading gotsport staging_games...');

    const { rows: stagingGames } = await client.query(`
      SELECT match_date, home_team_name, away_team_name, event_name, event_id, source_match_key
      FROM staging_games
      WHERE source_platform = 'gotsport'
        AND event_name IS NOT NULL
    `);

    console.log(`  Found ${stagingGames?.length || 0} gotsport staging records with event_name`);

    if (!stagingGames || stagingGames.length === 0) {
      console.log('\n⚠️ No gotsport staging records found. Cannot proceed.');
      return;
    }

    // Build lookup: date -> [{home_normalized, away_normalized, event_name, event_id}]
    const stagingLookup = new Map();
    for (const sg of stagingGames) {
      const key = sg.match_date;
      if (!stagingLookup.has(key)) {
        stagingLookup.set(key, []);
      }
      stagingLookup.get(key).push({
        homeNorm: normalizeTeamName(sg.home_team_name),
        awayNorm: normalizeTeamName(sg.away_team_name),
        eventName: sg.event_name,
        eventId: sg.event_id,
      });
    }

    const uniqueDates = stagingLookup.size;
    console.log(`  Unique match dates in staging: ${uniqueDates}`);

    // ============================================================
    // STEP 2: Load unlinked gotsport matches
    // ============================================================
    console.log('\nStep 2: Loading unlinked gotsport matches...');

    const { rows: unlinkedMatches } = await client.query(`
      SELECT m.id, m.match_date, m.home_team_id, m.away_team_id,
             ht.display_name as home_team_name,
             at.display_name as away_team_name
      FROM matches_v2 m
      LEFT JOIN teams_v2 ht ON m.home_team_id = ht.id
      LEFT JOIN teams_v2 at ON m.away_team_id = at.id
      WHERE m.league_id IS NULL
        AND m.tournament_id IS NULL
        AND m.source_platform = 'gotsport'
        AND m.source_match_key IS NULL
    `);

    console.log(`  Total unlinked gotsport matches: ${unlinkedMatches.length}`);

    // ============================================================
    // STEP 3: Try to match by date + team names
    // ============================================================
    console.log('\nStep 3: Matching by date + team names...');

    const matchedToEvent = []; // {match_id, event_name}
    let matchedCount = 0;
    let noStagingForDate = 0;
    let noTeamMatch = 0;

    for (const match of unlinkedMatches) {
      const stagingForDate = stagingLookup.get(match.match_date);

      if (!stagingForDate) {
        noStagingForDate++;
        continue;
      }

      // Get normalized team names from match
      const homeNorm = normalizeTeamName(match.home_team_name);
      const awayNorm = normalizeTeamName(match.away_team_name);

      // Find matching staging record
      let foundEvent = null;
      for (const sg of stagingForDate) {
        // Check if team names match (substring match for fuzzy)
        const homeMatch = homeNorm.includes(sg.homeNorm) || sg.homeNorm.includes(homeNorm);
        const awayMatch = awayNorm.includes(sg.awayNorm) || sg.awayNorm.includes(awayNorm);

        if (homeMatch && awayMatch) {
          foundEvent = sg;
          break;
        }

        // Try swapped (home/away reversed)
        const homeMatchSwap = homeNorm.includes(sg.awayNorm) || sg.awayNorm.includes(homeNorm);
        const awayMatchSwap = awayNorm.includes(sg.homeNorm) || sg.homeNorm.includes(awayNorm);

        if (homeMatchSwap && awayMatchSwap) {
          foundEvent = sg;
          break;
        }
      }

      if (foundEvent) {
        matchedToEvent.push({
          matchId: match.id,
          eventName: foundEvent.eventName,
          eventId: foundEvent.eventId,
        });
        matchedCount++;
      } else {
        noTeamMatch++;
      }
    }

    console.log(`\n  Results:`);
    console.log(`    Matched to event: ${matchedCount}`);
    console.log(`    No staging for date: ${noStagingForDate}`);
    console.log(`    Date matched but teams didn't: ${noTeamMatch}`);

    if (matchedCount === 0) {
      console.log('\n⚠️ No matches could be linked. This is expected given limited staging data.');
      console.log('   The 15,000+ legacy matches will remain under "Other Matches".');
      return;
    }

    // ============================================================
    // STEP 4: Load events and create update map
    // ============================================================
    console.log('\nStep 4: Looking up event IDs...');

    // Get unique event names
    const eventNames = [...new Set(matchedToEvent.map(m => m.eventName))];
    console.log(`  ${eventNames.length} unique events found`);

    // Load leagues and tournaments
    const { rows: leagues } = await client.query(`SELECT id, name FROM leagues`);
    const { rows: tournaments } = await client.query(`SELECT id, name FROM tournaments`);

    // Build lookup maps
    const leagueMap = new Map();
    const tournamentMap = new Map();

    for (const l of leagues || []) {
      leagueMap.set(l.name?.toLowerCase().trim(), l.id);
    }
    for (const t of tournaments || []) {
      tournamentMap.set(t.name?.toLowerCase().trim(), t.id);
    }

    // Group matches by event for batch update
    const updatesByEvent = new Map();
    for (const matched of matchedToEvent) {
      const eventNameLower = matched.eventName?.toLowerCase().trim();
      const leagueId = leagueMap.get(eventNameLower);
      const tournamentId = tournamentMap.get(eventNameLower);

      if (leagueId || tournamentId) {
        const key = leagueId ? `L:${leagueId}` : `T:${tournamentId}`;
        if (!updatesByEvent.has(key)) {
          updatesByEvent.set(key, {
            type: leagueId ? 'league' : 'tournament',
            eventId: leagueId || tournamentId,
            eventName: matched.eventName,
            matchIds: [],
          });
        }
        updatesByEvent.get(key).matchIds.push(matched.matchId);
      }
    }

    let totalToUpdate = 0;
    console.log('\n  Matches grouped by event:');
    for (const [key, data] of updatesByEvent) {
      console.log(`    ${data.eventName}: ${data.matchIds.length} matches (${data.type})`);
      totalToUpdate += data.matchIds.length;
    }

    if (totalToUpdate === 0) {
      console.log('\n⚠️ No events found in leagues/tournaments tables for matched events.');
      return;
    }

    // ============================================================
    // STEP 5: Update matches_v2
    // ============================================================
    if (DRY_RUN) {
      console.log(`\n[DRY RUN] Would update ${totalToUpdate} matches`);
    } else {
      console.log(`\nStep 5: Updating ${totalToUpdate} matches...`);

      let updated = 0;
      for (const [key, data] of updatesByEvent) {
        const field = data.type === 'league' ? 'league_id' : 'tournament_id';

        const result = await client.query(`
          UPDATE matches_v2
          SET ${field} = $1, updated_at = NOW()
          WHERE id = ANY($2)
        `, [data.eventId, data.matchIds]);

        updated += result.rowCount;
        console.log(`    ✓ Linked ${result.rowCount} matches to "${data.eventName}"`);
      }

      console.log(`  ✅ Total updated: ${updated}`);

      // Refresh views
      console.log('\nStep 6: Refreshing views...');
      try {
        await client.query('SELECT refresh_app_views()');
        console.log('  ✓ Views refreshed');
      } catch (err) {
        console.log('  ⚠️ Could not refresh:', err.message);
      }
    }

    // ============================================================
    // Summary
    // ============================================================
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total unlinked gotsport:    ${unlinkedMatches.length}`);
    console.log(`Staging records available:  ${stagingGames.length}`);
    console.log(`Matched by date+teams:      ${matchedCount}`);
    console.log(`Successfully linked:        ${totalToUpdate}`);
    console.log(`Still unlinked:             ${unlinkedMatches.length - totalToUpdate}`);
    console.log(`Execution time:             ${elapsed}s`);
    console.log('='.repeat(60));

    if (unlinkedMatches.length - totalToUpdate > 0) {
      console.log('\n📋 REMAINING UNLINKED MATCHES:');
      console.log(`   ${unlinkedMatches.length - totalToUpdate} matches cannot be linked due to:`);
      console.log('   - No staging_games record for that date');
      console.log('   - Team names don\'t match (different naming conventions)');
      console.log('   These will remain under "Other Matches" in team details.');
      console.log('   This is a known limitation of legacy imports without source_match_key.');
    }

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
