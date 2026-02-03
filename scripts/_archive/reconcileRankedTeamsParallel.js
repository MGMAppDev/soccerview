/**
 * Reconcile Ranked Teams v2.1 - PARALLEL VERSION
 * ================================================
 *
 * Splits work into batches for parallel processing
 *
 * Usage:
 *   node scripts/reconcileRankedTeamsParallel.js --batch 0 --total-batches 4
 *   node scripts/reconcileRankedTeamsParallel.js --batch 1 --total-batches 4
 *   ...etc
 */

import pg from "pg";
import "dotenv/config";

const DATABASE_URL = process.env.DATABASE_URL;
const MIN_SIMILARITY = 0.5;

if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL environment variable!");
  process.exit(1);
}

function normalizeTeamName(name) {
  if (!name) return "";
  return name
    .replace(/\s*\([^)]+\)\s*$/g, "")
    .toLowerCase()
    .trim();
}

function extractYear(name) {
  if (!name) return null;
  const fullMatch = name.match(/\b(20[01][0-9])\b/);
  if (fullMatch) return fullMatch[1];
  const shortMatch = name.match(/\b(0[5-9]|1[0-9])[GB]\b/i);
  if (shortMatch) {
    const year = parseInt(shortMatch[1]);
    return `20${year.toString().padStart(2, '0')}`;
  }
  const standaloneMatch = name.match(/(?<![GB])\b(0[5-9]|1[0-9])\b(?![GB])/i);
  if (standaloneMatch) {
    const year = parseInt(standaloneMatch[1]);
    return `20${year.toString().padStart(2, '0')}`;
  }
  return null;
}

function extractAgeGroup(name) {
  if (!name) return null;
  const uMatch = name.match(/\bU-?(\d{1,2})\b/i);
  if (uMatch) return `U${uMatch[1]}`;
  const gbMatch = name.match(/\b[GB](\d{1,2})\b/i);
  if (gbMatch) return `U${gbMatch[1]}`;
  return null;
}

function extractGender(name) {
  if (!name) return null;
  const lowerName = name.toLowerCase();
  if (lowerName.includes('boys') || lowerName.includes(' b ') || /\d+b\b/.test(lowerName)) return 'Boys';
  if (lowerName.includes('girls') || lowerName.includes(' g ') || /\d+g\b/.test(lowerName)) return 'Girls';
  return null;
}

async function main() {
  // Parse arguments
  const args = process.argv.slice(2);
  let batchNum = null;
  let totalBatches = null;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--batch" && args[i + 1]) {
      batchNum = parseInt(args[i + 1]);
    }
    if (args[i] === "--total-batches" && args[i + 1]) {
      totalBatches = parseInt(args[i + 1]);
    }
    if (args[i] === "--dry-run") {
      dryRun = true;
    }
  }

  if (batchNum === null || totalBatches === null) {
    console.error("Usage: node reconcileRankedTeamsParallel.js --batch N --total-batches M");
    process.exit(1);
  }

  console.log("=".repeat(60));
  console.log(`RECONCILE RANKED TEAMS v2.1 - BATCH ${batchNum + 1}/${totalBatches}`);
  console.log("=".repeat(60));
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE UPDATE"}`);
  console.log(`Min similarity: ${MIN_SIMILARITY}\n`);

  // Connect to database
  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 600000, // 10 minutes (increased for parallel fuzzy matching)
  });

  await client.connect();
  console.log("Connected to database\n");

  // Get total count first
  const { rows: [{ count: totalCount }] } = await client.query(`
    SELECT COUNT(*) as count FROM team_elo
    WHERE national_rank IS NOT NULL AND matches_played = 0
  `);

  const batchSize = Math.ceil(totalCount / totalBatches);
  const offset = batchNum * batchSize;

  console.log(`Total teams: ${totalCount}`);
  console.log(`Batch size: ${batchSize}`);
  console.log(`This batch: ${offset} to ${offset + batchSize}\n`);

  // Get priority teams for this batch
  console.log("Fetching priority teams for this batch...");

  const priorityQuery = `
    SELECT id, team_name, national_rank, state_rank, age_group, gender, state, gotsport_team_id, matches_played
    FROM team_elo
    WHERE national_rank IS NOT NULL AND matches_played = 0
    ORDER BY national_rank ASC
    LIMIT ${batchSize} OFFSET ${offset}
  `;

  const { rows: priorityTeams } = await client.query(priorityQuery);

  console.log(`Found ${priorityTeams.length} teams in this batch\n`);

  if (priorityTeams.length === 0) {
    console.log("No teams to process in this batch!");
    await client.end();
    process.exit(0);
  }

  // Process teams
  console.log("Finding matches using pg_trgm similarity...\n");
  console.log("-".repeat(60));

  const matches = [];
  const noMatches = [];
  let processed = 0;

  for (const pt of priorityTeams) {
    const searchName = normalizeTeamName(pt.team_name);
    const rankedYear = extractYear(pt.team_name);
    const rankedAge = extractAgeGroup(pt.team_name) || pt.age_group;
    const rankedGender = extractGender(pt.team_name) || pt.gender;

    const similarQuery = `
      SELECT
        id, team_name, age_group, gender, state, matches_played, elo_rating, national_rank,
        similarity(LOWER(team_name), $1) as sim
      FROM team_elo
      WHERE matches_played > 0
        AND similarity(LOWER(team_name), $1) > $2
        AND id != $3
      ORDER BY sim DESC
      LIMIT 10
    `;

    const { rows: candidates } = await client.query(similarQuery, [searchName, MIN_SIMILARITY, pt.id]);

    let bestMatch = null;

    for (const candidate of candidates) {
      const candYear = extractYear(candidate.team_name);
      const candAge = extractAgeGroup(candidate.team_name) || candidate.age_group;
      const candGender = extractGender(candidate.team_name) || candidate.gender;

      if (rankedYear && candYear && rankedYear !== candYear) continue;
      if (rankedGender && candGender && rankedGender !== candGender) continue;
      if (rankedAge && candAge) {
        const rankedAgeNum = parseInt(rankedAge.replace('U', ''));
        const candAgeNum = parseInt(candAge.replace('U', ''));
        if (Math.abs(rankedAgeNum - candAgeNum) > 2) continue;
      }
      if (pt.state && candidate.state && pt.state !== candidate.state) continue;
      if (candidate.national_rank && candidate.national_rank !== pt.national_rank) continue;

      bestMatch = candidate;
      break;
    }

    if (bestMatch) {
      matches.push({ ranked: pt, matched: bestMatch });

      if (matches.length <= 10) {
        console.log(`#${pt.national_rank} "${pt.team_name.substring(0, 40)}"`);
        console.log(`   -> "${bestMatch.team_name.substring(0, 40)}" (${bestMatch.matches_played} matches, ${(bestMatch.sim * 100).toFixed(1)}% sim)\n`);
      }
    } else {
      noMatches.push(pt);
    }

    processed++;
    if (processed % 100 === 0) {
      console.log(`[Batch ${batchNum + 1}] Processed ${processed}/${priorityTeams.length}, found ${matches.length} matches`);
    }
  }

  console.log("-".repeat(60));
  console.log(`\n[Batch ${batchNum + 1}] Matches: ${matches.length}/${priorityTeams.length} (${(matches.length/priorityTeams.length*100).toFixed(1)}%)`);
  console.log(`[Batch ${batchNum + 1}] No match: ${noMatches.length}\n`);

  if (matches.length === 0) {
    console.log("No matches to update!");
    await client.end();
    process.exit(0);
  }

  // Update database
  if (dryRun) {
    console.log("DRY RUN - no database changes made.\n");
    await client.end();
    return;
  }

  console.log("Updating database...\n");

  let updated = 0;
  let errors = 0;

  for (const m of matches) {
    try {
      await client.query(`
        UPDATE team_elo SET
          national_rank = $1,
          state_rank = $2,
          gotsport_team_id = COALESCE(gotsport_team_id, $3)
        WHERE id = $4
      `, [m.ranked.national_rank, m.ranked.state_rank, m.ranked.gotsport_team_id, m.matched.id]);

      await client.query(`
        UPDATE team_elo SET
          national_rank = NULL,
          state_rank = NULL
        WHERE id = $1
      `, [m.ranked.id]);

      updated++;
    } catch (e) {
      errors++;
      if (errors <= 3) {
        console.error(`Error: ${e.message}`);
      }
    }

    if (updated % 100 === 0 && updated > 0) {
      console.log(`  [Batch ${batchNum + 1}] Updated ${updated}/${matches.length}...`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(`BATCH ${batchNum + 1}/${totalBatches} COMPLETE`);
  console.log("=".repeat(60));
  console.log(`Teams processed: ${priorityTeams.length}`);
  console.log(`Matches found: ${matches.length}`);
  console.log(`Successfully updated: ${updated}`);
  console.log(`Errors: ${errors}`);
  console.log(`No match found: ${noMatches.length}`);

  await client.end();
}

main().catch(console.error);
