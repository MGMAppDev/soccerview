/**
 * Fast Link v3 - PARALLEL VERSION
 *
 * Usage:
 *   node scripts/fastLinkV3Parallel.js --batch 0 --total-batches 4
 *   node scripts/fastLinkV3Parallel.js --batch 1 --total-batches 4
 */

import "dotenv/config";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

async function main() {
  // Parse arguments
  const args = process.argv.slice(2);
  let batchNum = null;
  let totalBatches = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--batch" && args[i + 1]) {
      batchNum = parseInt(args[i + 1]);
    }
    if (args[i] === "--total-batches" && args[i + 1]) {
      totalBatches = parseInt(args[i + 1]);
    }
  }

  if (batchNum === null || totalBatches === null) {
    console.error("Usage: node fastLinkV3Parallel.js --batch N --total-batches M");
    process.exit(1);
  }

  console.log(`⚡ Fast Link v3 - Batch ${batchNum + 1}/${totalBatches}`);
  console.log("═".repeat(55));

  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 600000, // 10 minutes for Pro tier
  });

  await client.connect();
  console.log("✅ Connected\n");

  // Skip baseline COUNT query - too slow on 467K matches
  // Jump straight to loading unique unlinked names

  // Get unique unlinked names for HOME
  console.log("Loading unlinked HOME names...");
  const unlinkedHome = await client.query(`
    SELECT DISTINCT home_team_name as name FROM match_results
    WHERE home_team_id IS NULL AND home_team_name IS NOT NULL
      AND LENGTH(home_team_name) >= 10 AND home_team_name ~ '^[A-Za-z]'
      AND home_team_name NOT ILIKE '%***%' AND home_team_name NOT ILIKE '%dropped%'
      AND home_team_name NOT ILIKE '%bye%' AND home_team_name NOT ILIKE '%tbd%'
    ORDER BY name
  `);

  // Get unique unlinked names for AWAY
  console.log("Loading unlinked AWAY names...");
  const unlinkedAway = await client.query(`
    SELECT DISTINCT away_team_name as name FROM match_results
    WHERE away_team_id IS NULL AND away_team_name IS NOT NULL
      AND LENGTH(away_team_name) >= 10 AND away_team_name ~ '^[A-Za-z]'
      AND away_team_name NOT ILIKE '%***%' AND away_team_name NOT ILIKE '%dropped%'
      AND away_team_name NOT ILIKE '%bye%' AND away_team_name NOT ILIKE '%tbd%'
    ORDER BY name
  `);

  console.log(`   Home: ${unlinkedHome.rows.length} total unique names`);
  console.log(`   Away: ${unlinkedAway.rows.length} total unique names\n`);

  // Divide work into batches
  const homeBatchSize = Math.ceil(unlinkedHome.rows.length / totalBatches);
  const awayBatchSize = Math.ceil(unlinkedAway.rows.length / totalBatches);

  const homeStart = batchNum * homeBatchSize;
  const homeEnd = Math.min((batchNum + 1) * homeBatchSize, unlinkedHome.rows.length);
  const awayStart = batchNum * awayBatchSize;
  const awayEnd = Math.min((batchNum + 1) * awayBatchSize, unlinkedAway.rows.length);

  const homeBatch = unlinkedHome.rows.slice(homeStart, homeEnd);
  const awayBatch = unlinkedAway.rows.slice(awayStart, awayEnd);

  console.log(`[Batch ${batchNum + 1}] HOME: ${homeBatch.length} names (${homeStart}-${homeEnd})`);
  console.log(`[Batch ${batchNum + 1}] AWAY: ${awayBatch.length} names (${awayStart}-${awayEnd})\n`);

  let homeLinked = 0, awayLinked = 0, aliasesCreated = 0;

  // Process HOME
  console.log(`[Batch ${batchNum + 1}] Processing HOME teams...`);
  for (let i = 0; i < homeBatch.length; i++) {
    const name = homeBatch[i].name;
    const nameLower = name.toLowerCase().trim();

    try {
      const match = await client.query(`
        SELECT team_id, alias_name, similarity(alias_name, $1) as sim
        FROM team_name_aliases
        WHERE alias_name % $1
        ORDER BY sim DESC LIMIT 1
      `, [nameLower]);

      if (match.rows.length > 0 && parseFloat(match.rows[0].sim) >= 0.75) {
        const teamId = match.rows[0].team_id;

        const updated = await client.query(`
          UPDATE match_results SET home_team_id = $1
          WHERE home_team_name = $2 AND home_team_id IS NULL
        `, [teamId, name]);

        if (updated.rowCount > 0) {
          homeLinked += updated.rowCount;

          await client.query(`
            INSERT INTO team_name_aliases (id, team_id, alias_name, source)
            VALUES (gen_random_uuid(), $1, $2, 'fuzzy_learned')
            ON CONFLICT DO NOTHING
          `, [teamId, nameLower]);
          aliasesCreated++;
        }
      }
    } catch (e) {
      // Skip errors
    }

    if ((i + 1) % 200 === 0) {
      console.log(`   [Batch ${batchNum + 1}] ${i + 1}/${homeBatch.length} processed, +${homeLinked} linked`);
    }
  }
  console.log(`   ✅ [Batch ${batchNum + 1}] HOME complete: +${homeLinked} linked\n`);

  // Process AWAY
  console.log(`[Batch ${batchNum + 1}] Processing AWAY teams...`);
  for (let i = 0; i < awayBatch.length; i++) {
    const name = awayBatch[i].name;
    const nameLower = name.toLowerCase().trim();

    try {
      const match = await client.query(`
        SELECT team_id, alias_name, similarity(alias_name, $1) as sim
        FROM team_name_aliases
        WHERE alias_name % $1
        ORDER BY sim DESC LIMIT 1
      `, [nameLower]);

      if (match.rows.length > 0 && parseFloat(match.rows[0].sim) >= 0.75) {
        const teamId = match.rows[0].team_id;

        const updated = await client.query(`
          UPDATE match_results SET away_team_id = $1
          WHERE away_team_name = $2 AND away_team_id IS NULL
        `, [teamId, name]);

        if (updated.rowCount > 0) {
          awayLinked += updated.rowCount;

          await client.query(`
            INSERT INTO team_name_aliases (id, team_id, alias_name, source)
            VALUES (gen_random_uuid(), $1, $2, 'fuzzy_learned')
            ON CONFLICT DO NOTHING
          `, [teamId, nameLower]);
          aliasesCreated++;
        }
      }
    } catch (e) {
      // Skip errors
    }

    if ((i + 1) % 200 === 0) {
      console.log(`   [Batch ${batchNum + 1}] ${i + 1}/${awayBatch.length} processed, +${awayLinked} linked`);
    }
  }
  console.log(`   ✅ [Batch ${batchNum + 1}] AWAY complete: +${awayLinked} linked\n`);

  // Final stats
  const final = await client.query(`
    SELECT COUNT(*) FILTER (WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL) as linked,
           COUNT(*) as total FROM match_results
  `);

  console.log("═".repeat(55));
  console.log(`[Batch ${batchNum + 1}] COMPLETE`);
  console.log(`📊 FINAL: ${parseInt(final.rows[0].linked).toLocaleString()} / ${parseInt(final.rows[0].total).toLocaleString()} (${(final.rows[0].linked/final.rows[0].total*100).toFixed(1)}%)`);
  console.log(`   This batch linked: +${homeLinked + awayLinked} matches`);
  console.log(`   New aliases: ${aliasesCreated}`);

  await client.end();
  console.log("\n✅ Done!");
}

main().catch(console.error);
