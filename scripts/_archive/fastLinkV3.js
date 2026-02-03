/**
 * Fast Link v3 - Small batch fuzzy with progress
 * 
 * Usage: node scripts/fastLinkV3.js
 */

import "dotenv/config";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

async function main() {
  console.log("⚡ Fast Link v3");
  console.log("═".repeat(55));

  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 60000, // 1 min per query
  });

  await client.connect();
  console.log("✅ Connected\n");

  // Get baseline
  const baseline = await client.query(`
    SELECT COUNT(*) FILTER (WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL) as linked,
           COUNT(*) as total FROM match_results
  `);
  console.log(`📊 BASELINE: ${parseInt(baseline.rows[0].linked).toLocaleString()} / ${parseInt(baseline.rows[0].total).toLocaleString()} (${(baseline.rows[0].linked/baseline.rows[0].total*100).toFixed(1)}%)\n`);

  // Get unique unlinked names
  console.log("Loading unlinked names...");
  const unlinkedHome = await client.query(`
    SELECT DISTINCT home_team_name as name FROM match_results 
    WHERE home_team_id IS NULL AND home_team_name IS NOT NULL
      AND LENGTH(home_team_name) >= 10 AND home_team_name ~ '^[A-Za-z]'
      AND home_team_name NOT ILIKE '%***%' AND home_team_name NOT ILIKE '%dropped%'
      AND home_team_name NOT ILIKE '%bye%' AND home_team_name NOT ILIKE '%tbd%'
  `);
  const unlinkedAway = await client.query(`
    SELECT DISTINCT away_team_name as name FROM match_results 
    WHERE away_team_id IS NULL AND away_team_name IS NOT NULL
      AND LENGTH(away_team_name) >= 10 AND away_team_name ~ '^[A-Za-z]'
      AND away_team_name NOT ILIKE '%***%' AND away_team_name NOT ILIKE '%dropped%'
      AND away_team_name NOT ILIKE '%bye%' AND away_team_name NOT ILIKE '%tbd%'
  `);

  console.log(`   Home: ${unlinkedHome.rows.length} unique names`);
  console.log(`   Away: ${unlinkedAway.rows.length} unique names\n`);

  let homeLinked = 0, awayLinked = 0, aliasesCreated = 0;

  // Process HOME
  console.log("Processing HOME teams...");
  for (let i = 0; i < unlinkedHome.rows.length; i++) {
    const name = unlinkedHome.rows[i].name;
    const nameLower = name.toLowerCase().trim();

    try {
      // Find best match
      const match = await client.query(`
        SELECT team_id, alias_name, similarity(alias_name, $1) as sim
        FROM team_name_aliases
        WHERE alias_name % $1
        ORDER BY sim DESC LIMIT 1
      `, [nameLower]);

      if (match.rows.length > 0 && parseFloat(match.rows[0].sim) >= 0.75) {
        const teamId = match.rows[0].team_id;

        // Update all matches with this name
        const updated = await client.query(`
          UPDATE match_results SET home_team_id = $1
          WHERE home_team_name = $2 AND home_team_id IS NULL
        `, [teamId, name]);

        if (updated.rowCount > 0) {
          homeLinked += updated.rowCount;

          // Store alias for future
          await client.query(`
            INSERT INTO team_name_aliases (id, team_id, alias_name, source)
            VALUES (gen_random_uuid(), $1, $2, 'fuzzy_learned')
            ON CONFLICT DO NOTHING
          `, [teamId, nameLower]);
          aliasesCreated++;
        }
      }
    } catch (e) {
      // Skip errors, continue
    }

    if ((i + 1) % 500 === 0) {
      console.log(`   ${i + 1}/${unlinkedHome.rows.length} processed, +${homeLinked} linked`);
    }
  }
  console.log(`   ✅ HOME complete: +${homeLinked} linked\n`);

  // Process AWAY
  console.log("Processing AWAY teams...");
  for (let i = 0; i < unlinkedAway.rows.length; i++) {
    const name = unlinkedAway.rows[i].name;
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

    if ((i + 1) % 500 === 0) {
      console.log(`   ${i + 1}/${unlinkedAway.rows.length} processed, +${awayLinked} linked`);
    }
  }
  console.log(`   ✅ AWAY complete: +${awayLinked} linked\n`);

  // Final
  const final = await client.query(`
    SELECT COUNT(*) FILTER (WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL) as linked,
           COUNT(*) as total FROM match_results
  `);

  console.log("═".repeat(55));
  console.log(`📊 FINAL: ${parseInt(final.rows[0].linked).toLocaleString()} / ${parseInt(final.rows[0].total).toLocaleString()} (${(final.rows[0].linked/final.rows[0].total*100).toFixed(1)}%)`);
  console.log(`   New aliases created: ${aliasesCreated}`);
  console.log(`   Improvement: +${parseInt(final.rows[0].linked) - parseInt(baseline.rows[0].linked)} fully linked`);

  await client.end();
  console.log("\n✅ Done!");
}

main().catch(console.error);
