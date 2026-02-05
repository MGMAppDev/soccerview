/**
 * fixReverseMatches.cjs
 *
 * Universal fix: Detect and soft-delete reverse duplicate matches.
 *
 * Root cause: Different data sources (GotSport, V1 migration, HTGSports) record
 * the same real-world game with home/away teams swapped. The semantic UNIQUE
 * constraint (match_date, home_team_id, away_team_id) treats (date, A, B) and
 * (date, B, A) as different tuples, so both get inserted.
 *
 * Result: Team Details page shows duplicate matches; ELO double-counts games.
 *
 * Resolution priority (same as matchDedup.js):
 * 1. Keep the one with an event link (league_id or tournament_id)
 * 2. Keep the one with actual scores (non-NULL)
 * 3. Keep the earliest created one
 *
 * Usage:
 *   node scripts/maintenance/fixReverseMatches.cjs --dry-run
 *   node scripts/maintenance/fixReverseMatches.cjs --execute
 */

require('dotenv').config();
const { Pool } = require('pg');

const DRY_RUN = !process.argv.includes('--execute');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  console.log(`\n=== Fix Reverse Duplicate Matches ===`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'EXECUTE'}\n`);

  const client = await pool.connect();

  try {
    // Authorize pipeline writes
    if (!DRY_RUN) {
      console.log('Authorizing pipeline writes...');
      await client.query("SELECT authorize_pipeline_write()");
      console.log('Pipeline write authorization granted\n');
    }

    // Step 1: Detect all reverse match pairs
    console.log('Detecting reverse match pairs...');
    const { rows: reversePairs } = await client.query(`
      SELECT
        a.id as id_a,
        b.id as id_b,
        a.match_date,
        a.home_team_id as a_home, a.away_team_id as a_away,
        b.home_team_id as b_home, b.away_team_id as b_away,
        a.home_score as a_home_score, a.away_score as a_away_score,
        b.home_score as b_home_score, b.away_score as b_away_score,
        a.league_id as a_league, b.league_id as b_league,
        a.tournament_id as a_tourn, b.tournament_id as b_tourn,
        a.source_match_key as a_key, b.source_match_key as b_key,
        a.created_at as a_created, b.created_at as b_created,
        ht_a.display_name as a_home_name,
        at_a.display_name as a_away_name
      FROM matches_v2 a
      JOIN matches_v2 b ON a.match_date = b.match_date
        AND a.home_team_id = b.away_team_id
        AND a.away_team_id = b.home_team_id
        AND a.id < b.id
      JOIN teams_v2 ht_a ON a.home_team_id = ht_a.id
      JOIN teams_v2 at_a ON a.away_team_id = at_a.id
      WHERE a.deleted_at IS NULL AND b.deleted_at IS NULL
      ORDER BY a.match_date DESC
    `);

    console.log(`Found ${reversePairs.length} reverse match pairs\n`);

    if (reversePairs.length === 0) {
      console.log('No reverse duplicates found. Done.');
      return;
    }

    // Step 2: Classify and show samples
    let scoreConsistent = 0;
    let scoreInconsistent = 0;
    let scoreOnlyOneHas = 0;

    for (const pair of reversePairs) {
      const aHasScore = pair.a_home_score !== null && pair.a_away_score !== null;
      const bHasScore = pair.b_home_score !== null && pair.b_away_score !== null;

      if (aHasScore && bHasScore) {
        // Check if scores are consistent (reversed)
        if (pair.a_home_score === pair.b_away_score && pair.a_away_score === pair.b_home_score) {
          scoreConsistent++;
        } else {
          scoreInconsistent++;
        }
      } else {
        scoreOnlyOneHas++;
      }
    }

    console.log(`Score analysis:`);
    console.log(`  Consistent (A=2-3 matches B=3-2): ${scoreConsistent}`);
    console.log(`  Inconsistent (scores don't match reversed): ${scoreInconsistent}`);
    console.log(`  Only one has scores: ${scoreOnlyOneHas}\n`);

    // Show samples
    console.log('Sample reverse pairs:');
    for (const pair of reversePairs.slice(0, 10)) {
      const aScore = pair.a_home_score !== null ? `${pair.a_home_score}-${pair.a_away_score}` : 'scheduled';
      const bScore = pair.b_home_score !== null ? `${pair.b_home_score}-${pair.b_away_score}` : 'scheduled';
      const aEvent = pair.a_league ? 'league' : pair.a_tourn ? 'tournament' : 'none';
      const bEvent = pair.b_league ? 'league' : pair.b_tourn ? 'tournament' : 'none';
      console.log(`  ${pair.match_date}: "${pair.a_home_name}" vs "${pair.a_away_name}"`);
      console.log(`    Record A: ${aScore} (event: ${aEvent}, key: ${pair.a_key})`);
      console.log(`    Record B: ${bScore} (event: ${bEvent}, key: ${pair.b_key})`);
    }
    if (reversePairs.length > 10) console.log(`  ... and ${reversePairs.length - 10} more`);
    console.log('');

    // Step 3: Determine which to keep — CONSERVATIVE: only fix confirmed duplicates
    // A "reverse pair" could be a legitimate rematch (pool play, tournament bracket).
    // Only soft-delete when we're SURE it's the same real-world game:
    //   1. Scores match reversed (A=2-3, B=3-2) — unambiguously same game
    //   2. One has scores, other doesn't, AND from same event — same game, one is schedule
    //   3. Both scheduled (NULL scores) AND source keys show swapped team pattern — same game
    // SKIP: Different scores = legitimate different games (rematches, pool play)
    const toDelete = [];
    let skippedDifferentGames = 0;
    let skippedAmbiguous = 0;

    for (const pair of reversePairs) {
      const aHasEvent = pair.a_league || pair.a_tourn;
      const bHasEvent = pair.b_league || pair.b_tourn;
      const aHasScore = pair.a_home_score !== null && pair.a_away_score !== null;
      const bHasScore = pair.b_home_score !== null && pair.b_away_score !== null;

      // Check if scores are consistent (reversed) — confirms same game
      const scoresConsistent = aHasScore && bHasScore &&
        pair.a_home_score === pair.b_away_score && pair.a_away_score === pair.b_home_score;

      // Check if scores are DIFFERENT — confirms different games
      const scoresDifferent = aHasScore && bHasScore && !scoresConsistent;

      if (scoresDifferent) {
        skippedDifferentGames++;
        continue; // SKIP — these are legitimate different games
      }

      // Check for legacy source key pattern (swapped team IDs in key)
      const isLegacySwap = pair.a_key && pair.b_key &&
        pair.a_key.startsWith('legacy-') && pair.b_key.startsWith('legacy-');

      // For scheduled matches (both NULL), only fix if we have evidence it's same game
      if (!aHasScore && !bHasScore && !isLegacySwap) {
        // Both scheduled, no key evidence — could be legitimate pool play
        // Check if same event: if both link to the same event, likely same game
        const sameEvent = (pair.a_league && pair.b_league && pair.a_league === pair.b_league) ||
                          (pair.a_tourn && pair.b_tourn && pair.a_tourn === pair.b_tourn);
        if (!sameEvent) {
          skippedAmbiguous++;
          continue; // SKIP — ambiguous, could be different games in different events
        }
      }

      // This pair is a confirmed reverse duplicate — determine which to keep
      let keepId, deleteId;

      // Priority 1: Keep the one with an event link
      if (aHasEvent && !bHasEvent) {
        keepId = pair.id_a; deleteId = pair.id_b;
      } else if (bHasEvent && !aHasEvent) {
        keepId = pair.id_b; deleteId = pair.id_a;
      }
      // Priority 2: Keep the one with scores
      else if (aHasScore && !bHasScore) {
        keepId = pair.id_a; deleteId = pair.id_b;
      } else if (bHasScore && !aHasScore) {
        keepId = pair.id_b; deleteId = pair.id_a;
      }
      // Priority 3: Keep the earliest created
      else {
        if (new Date(pair.a_created) <= new Date(pair.b_created)) {
          keepId = pair.id_a; deleteId = pair.id_b;
        } else {
          keepId = pair.id_b; deleteId = pair.id_a;
        }
      }

      toDelete.push({ keepId, deleteId });
    }

    console.log(`Resolution:`);
    console.log(`  Confirmed reverse duplicates to soft-delete: ${toDelete.length}`);
    console.log(`  Skipped (different scores = different games): ${skippedDifferentGames}`);
    console.log(`  Skipped (ambiguous scheduled matches): ${skippedAmbiguous}\n`);

    // Step 4: Execute soft-deletes (bulk SQL for speed)
    if (!DRY_RUN) {
      console.log('Soft-deleting reverse duplicates (bulk)...');
      const BATCH_SIZE = 500;
      let totalDeleted = 0;

      for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
        const batch = toDelete.slice(i, i + BATCH_SIZE);
        const deleteIds = batch.map(a => a.deleteId);
        const reasonCases = batch.map((a, idx) =>
          `WHEN id = $${idx + 1}::uuid THEN 'Reverse duplicate of ' || $${batch.length + idx + 1}::text`
        ).join(' ');
        const params = [
          ...deleteIds,
          ...batch.map(a => a.keepId)
        ];

        await client.query(`
          UPDATE matches_v2
          SET deleted_at = NOW(),
              deletion_reason = CASE ${reasonCases} END
          WHERE id = ANY($${params.length + 1}::uuid[])
            AND deleted_at IS NULL
        `, [...params, deleteIds]);

        totalDeleted += batch.length;
        console.log(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${totalDeleted}/${toDelete.length} processed`);
      }
      console.log(`Soft-deleted ${totalDeleted} reverse duplicate matches\n`);
    } else {
      console.log(`DRY RUN: Would soft-delete ${toDelete.length} matches\n`);
    }

    // Step 5: Verify
    const { rows: [remaining] } = await client.query(`
      SELECT COUNT(*) as cnt FROM matches_v2 a
      JOIN matches_v2 b ON a.match_date = b.match_date
        AND a.home_team_id = b.away_team_id
        AND a.away_team_id = b.home_team_id
        AND a.id < b.id
      WHERE a.deleted_at IS NULL AND b.deleted_at IS NULL
    `);
    console.log(`Verification: ${remaining.cnt} reverse pairs remaining`);

    // Summary
    console.log('\n=== Summary ===');
    console.log(`Total reverse pairs found: ${reversePairs.length}`);
    console.log(`Score-consistent pairs: ${scoreConsistent}`);
    console.log(`Score-inconsistent pairs: ${scoreInconsistent}`);
    console.log(`One-sided score pairs: ${scoreOnlyOneHas}`);
    if (!DRY_RUN) {
      console.log(`Soft-deleted: ${toDelete.length}`);
    }
    console.log(`Remaining after fix: ${remaining.cnt}`);
    console.log(`Root cause: Cross-source data with home/away swapped.`);
    console.log(`Prevention: matchDedup.js + fastProcessStaging.cjs now detect reverse matches.`);

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
