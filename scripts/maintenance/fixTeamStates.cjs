/**
 * fixTeamStates.cjs
 *
 * Universal fix: Correct teams_v2.state using state names found in display_name.
 *
 * Root cause: Session 76 GotSport rankings importer used team_association field
 * to infer state, which was unreliable (cross-border registrations).
 * Result: Teams like "Sporting Iowa" have state='KS' (wrong association mapping).
 *
 * Phase 1: CORRECT mismatched states (name says Iowa, state says KS)
 * Phase 2: UPGRADE unknown/XX states where name provides evidence
 * Phase 3: Refresh materialized views
 *
 * Usage:
 *   node scripts/maintenance/fixTeamStates.cjs --dry-run
 *   node scripts/maintenance/fixTeamStates.cjs --execute
 */

require('dotenv').config();
const { Pool } = require('pg');

const DRY_RUN = !process.argv.includes('--execute');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ============================================================
// US STATE NAME → ABBREVIATION MAPPING
// Sorted longest-first for correct matching (e.g., "West Virginia" before "Virginia")
// ============================================================

const STATE_NAMES_MAP = {
  'west virginia': 'WV',
  'south carolina': 'SC',
  'south dakota': 'SD',
  'north carolina': 'NC',
  'north dakota': 'ND',
  'new hampshire': 'NH',
  'new jersey': 'NJ',
  'new mexico': 'NM',
  'new york': 'NY',
  'rhode island': 'RI',
  'alabama': 'AL',
  'alaska': 'AK',
  'arizona': 'AZ',
  'arkansas': 'AR',
  'california': 'CA',
  'colorado': 'CO',
  'connecticut': 'CT',
  'delaware': 'DE',
  'florida': 'FL',
  'georgia': 'GA',
  'hawaii': 'HI',
  'idaho': 'ID',
  'illinois': 'IL',
  'indiana': 'IN',
  'iowa': 'IA',
  'kansas': 'KS',
  'kentucky': 'KY',
  'louisiana': 'LA',
  'maine': 'ME',
  'maryland': 'MD',
  'massachusetts': 'MA',
  'michigan': 'MI',
  'minnesota': 'MN',
  'mississippi': 'MS',
  'missouri': 'MO',
  'montana': 'MT',
  'nebraska': 'NE',
  'nevada': 'NV',
  'ohio': 'OH',
  'oklahoma': 'OK',
  'oregon': 'OR',
  'pennsylvania': 'PA',
  'tennessee': 'TN',
  'texas': 'TX',
  'utah': 'UT',
  'vermont': 'VT',
  'virginia': 'VA',
  'washington': 'WA',
  'wisconsin': 'WI',
  'wyoming': 'WY',
};

// Sorted entries: longest state name first for correct matching
const STATE_ENTRIES = Object.entries(STATE_NAMES_MAP)
  .sort((a, b) => b[0].length - a[0].length);

/**
 * Infer US state abbreviation from a team name.
 * Returns null if no unambiguous state found.
 */
function inferStateFromName(name) {
  if (!name) return null;
  const lower = name.toLowerCase();

  for (const [stateName, abbrev] of STATE_ENTRIES) {
    // Word boundary match
    const regex = new RegExp(`\\b${stateName}\\b`, 'i');
    if (!regex.test(lower)) continue;

    // Ambiguity checks
    if (stateName === 'kansas' && /\bkansas\s+city\b/i.test(lower)) continue;
    if (stateName === 'washington' && !/\bwashington\s+state\b/i.test(lower)) continue;
    // "New York City" is still NY, no skip needed
    // "Virginia" only matches if "West Virginia" didn't match first (sorted longest-first)

    return abbrev;
  }
  return null;
}

async function main() {
  console.log(`\n=== Fix Team States from Display Name ===`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'EXECUTE'}\n`);

  const client = await pool.connect();

  try {
    // Authorize pipeline writes
    if (!DRY_RUN) {
      console.log('Authorizing pipeline writes...');
      await client.query("SELECT authorize_pipeline_write()");
      console.log('Pipeline write authorization granted\n');
    }

    // Step 1: Load all active teams
    console.log('Loading teams...');
    const { rows: allTeams } = await client.query(`
      SELECT id, display_name, canonical_name, birth_year, gender, state,
             matches_played, elo_rating, gotsport_rank, gotsport_points
      FROM teams_v2
      WHERE canonical_name NOT LIKE '%_merged_%'
    `);
    console.log(`Loaded ${allTeams.length} active teams\n`);

    // Step 2: Classify teams by state inference
    const mismatches = [];     // name says X, state says Y (Y is a real state code)
    const upgrades = [];       // state is 'unknown'/'XX', name provides evidence
    let nameHasState = 0;
    let nameNoState = 0;

    for (const team of allTeams) {
      const inferred = inferStateFromName(team.display_name);
      if (!inferred) {
        nameNoState++;
        continue;
      }
      nameHasState++;

      if (team.state === inferred) continue; // Already correct

      if (team.state === 'unknown' || team.state === 'XX') {
        upgrades.push({ ...team, inferredState: inferred });
      } else {
        mismatches.push({ ...team, inferredState: inferred });
      }
    }

    console.log(`Teams with state name in display_name: ${nameHasState}`);
    console.log(`Teams without state name: ${nameNoState}`);
    console.log(`\nMISMATCHES (wrong state): ${mismatches.length}`);
    console.log(`UPGRADES (unknown→inferred): ${upgrades.length}\n`);

    // Show sample mismatches
    if (mismatches.length > 0) {
      console.log('Sample mismatches:');
      for (const t of mismatches.slice(0, 10)) {
        console.log(`  "${t.display_name}" state=${t.state} → should be ${t.inferredState} (matches=${t.matches_played || 0})`);
      }
      if (mismatches.length > 10) console.log(`  ... and ${mismatches.length - 10} more`);
      console.log('');
    }

    // Show sample upgrades
    if (upgrades.length > 0) {
      console.log('Sample upgrades:');
      for (const t of upgrades.slice(0, 10)) {
        console.log(`  "${t.display_name}" state=${t.state} → ${t.inferredState} (matches=${t.matches_played || 0})`);
      }
      if (upgrades.length > 10) console.log(`  ... and ${upgrades.length - 10} more`);
      console.log('');
    }

    if (mismatches.length === 0 && upgrades.length === 0) {
      console.log('No state fixes needed. Done.');
      return;
    }

    // Step 3: Process all fixes (mismatches first, then upgrades)
    const allFixes = [...mismatches, ...upgrades];
    let directUpdates = 0;
    let mergeCount = 0;
    let skipCount = 0;

    if (!DRY_RUN) {
      console.log(`\nPhase 1: Processing ${allFixes.length} state corrections...`);

      for (let i = 0; i < allFixes.length; i++) {
        const team = allFixes[i];

        // Check for UNIQUE constraint conflict
        // Would another team with same (canonical_name, birth_year, gender, new_state) exist?
        const { rows: conflicts } = await client.query(`
          SELECT id, display_name, matches_played, elo_rating, gotsport_rank, gotsport_points
          FROM teams_v2
          WHERE canonical_name = $1 AND birth_year = $2 AND gender = $3 AND state = $4
            AND id != $5 AND canonical_name NOT LIKE '%_merged_%'
        `, [team.canonical_name, team.birth_year, team.gender, team.inferredState, team.id]);

        if (conflicts.length === 0) {
          // Safe to directly update
          await client.query(
            `UPDATE teams_v2 SET state = $1, updated_at = NOW() WHERE id = $2`,
            [team.inferredState, team.id]
          );
          directUpdates++;
        } else {
          // Conflict! Merge: keep the team with most matches
          const target = conflicts[0];
          const keepId = (target.matches_played || 0) >= (team.matches_played || 0) ? target.id : team.id;
          const mergeId = keepId === target.id ? team.id : target.id;

          // Soft-delete conflicting matches
          await client.query(`
            UPDATE matches_v2 m SET deleted_at = NOW(), deletion_reason = 'Duplicate during state merge to ' || $1
            WHERE m.deleted_at IS NULL AND (
              (m.home_team_id = $2 AND EXISTS (
                SELECT 1 FROM matches_v2 k WHERE k.home_team_id = $1 AND k.away_team_id = m.away_team_id
                  AND k.match_date = m.match_date AND k.deleted_at IS NULL
              ))
              OR (m.away_team_id = $2 AND EXISTS (
                SELECT 1 FROM matches_v2 k WHERE k.away_team_id = $1 AND k.home_team_id = m.home_team_id
                  AND k.match_date = m.match_date AND k.deleted_at IS NULL
              ))
            )
          `, [keepId, mergeId]);

          // Transfer remaining matches
          await client.query(
            `UPDATE matches_v2 SET home_team_id = $1 WHERE home_team_id = $2 AND deleted_at IS NULL`,
            [keepId, mergeId]
          );
          await client.query(
            `UPDATE matches_v2 SET away_team_id = $1 WHERE away_team_id = $2 AND deleted_at IS NULL`,
            [keepId, mergeId]
          );

          // Transfer GotSport data if merger has it and keeper doesn't
          if (!target.gotsport_rank && team.gotsport_rank && keepId === target.id) {
            await client.query(`
              UPDATE teams_v2 t SET gotsport_rank = s.gotsport_rank, gotsport_points = s.gotsport_points
              FROM teams_v2 s WHERE t.id = $1 AND s.id = $2
            `, [keepId, mergeId]);
          }

          // Rename merged team to avoid unique constraint issues
          await client.query(
            `UPDATE teams_v2 SET canonical_name = canonical_name || '_merged_' || $2, updated_at = NOW() WHERE id = $1`,
            [mergeId, keepId]
          );

          // If the wrong-state team was kept, update its state
          if (keepId === team.id) {
            await client.query(
              `UPDATE teams_v2 SET state = $1, updated_at = NOW() WHERE id = $2`,
              [team.inferredState, keepId]
            );
          }

          mergeCount++;
        }

        if ((i + 1) % 100 === 0) {
          console.log(`  Processed ${i + 1}/${allFixes.length} (${directUpdates} updates, ${mergeCount} merges)...`);
        }
      }

      console.log(`\nPhase 1 complete:`);
      console.log(`  Direct state updates: ${directUpdates}`);
      console.log(`  Merges (conflict resolution): ${mergeCount}`);
    } else {
      // Dry run: count potential conflicts
      let potentialMerges = 0;
      let potentialUpdates = 0;

      for (const team of allFixes) {
        const { rows: conflicts } = await client.query(`
          SELECT id FROM teams_v2
          WHERE canonical_name = $1 AND birth_year = $2 AND gender = $3 AND state = $4
            AND id != $5 AND canonical_name NOT LIKE '%_merged_%'
          LIMIT 1
        `, [team.canonical_name, team.birth_year, team.gender, team.inferredState, team.id]);

        if (conflicts.length > 0) potentialMerges++;
        else potentialUpdates++;
      }

      console.log(`DRY RUN results:`);
      console.log(`  Would directly update: ${potentialUpdates} teams`);
      console.log(`  Would merge (conflicts): ${potentialMerges} teams`);
      console.log(`  Total: ${allFixes.length} fixes`);
    }

    // Step 4: Verify
    const { rows: [afterMismatch] } = await client.query(`
      SELECT COUNT(*) as cnt FROM teams_v2
      WHERE canonical_name NOT LIKE '%_merged_%'
        AND display_name ~* '\\m(iowa|texas|florida|california|colorado|ohio|michigan|illinois|indiana|minnesota|wisconsin|tennessee|georgia|virginia|maryland|pennsylvania|arizona|oregon|utah|nevada|alabama|arkansas|kentucky|louisiana|mississippi|missouri|montana|nebraska|oklahoma|wyoming|idaho|maine|vermont|delaware|connecticut|massachusetts|hawaii|alaska|north carolina|south carolina|north dakota|south dakota|new jersey|new mexico|new york|new hampshire|rhode island|west virginia)\\M'
        AND state NOT IN (
          SELECT CASE display_name
            WHEN display_name THEN 'placeholder'
          END
        )
    `);

    // More targeted verify: check specific known issue
    const { rows: iowaCheck } = await client.query(`
      SELECT COUNT(*) as cnt FROM teams_v2
      WHERE display_name ~* '\\mIowa\\M'
        AND state != 'IA'
        AND canonical_name NOT LIKE '%_merged_%'
    `);
    console.log(`\nVerification: Iowa teams with wrong state: ${iowaCheck[0].cnt}`);

    // Phase 3: Refresh views
    if (!DRY_RUN) {
      console.log('\nPhase 2: Refreshing materialized views...');
      await client.query('REFRESH MATERIALIZED VIEW CONCURRENTLY app_rankings');
      console.log('  app_rankings refreshed');
      await client.query('REFRESH MATERIALIZED VIEW CONCURRENTLY app_matches_feed');
      console.log('  app_matches_feed refreshed');
      console.log('  (app_team_profile skipped - takes 7+ min, refresh separately)');
    }

    console.log('\n=== Summary ===');
    console.log(`Total mismatches (wrong state): ${mismatches.length}`);
    console.log(`Total upgrades (unknown→inferred): ${upgrades.length}`);
    if (!DRY_RUN) {
      console.log(`Direct updates: ${directUpdates}`);
      console.log(`Merges: ${mergeCount}`);
    }
    console.log(`Iowa teams still wrong: ${iowaCheck[0].cnt}`);
    console.log(`Prevention: teamNormalizer.js now has inferStateFromName() for pipeline.`);
    console.log(`Root cause: Session 76 GotSport rankings importer used unreliable association mapping.`);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('FATAL:', err.message);
  pool.end();
  process.exit(1);
});
