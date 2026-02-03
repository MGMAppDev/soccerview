/**
 * Fast Link v3 RESUME - Continues AWAY teams from position 21000
 * 
 * Usage: node scripts/fastLinkV3_resume.js
 */

import "dotenv/config";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const RESUME_FROM = 21000; // Skip first 21000 AWAY names (already processed)

async function main() {
  console.log("⚡ Fast Link v3 - RESUME MODE");
  console.log("═".repeat(55));
  console.log(`   Resuming AWAY teams from position ${RESUME_FROM}\n`);

  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 60000,
  });

  await client.connect();
  console.log("✅ Connected\n");

  // Get baseline
  const baseline = await client.query(`
    SELECT COUNT(*) FILTER (WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL) as linked,
           COUNT(*) as total FROM match_results
  `);
  console.log(`📊 BASELINE: ${parseInt(baseline.rows[0].linked).toLocaleString()} / ${parseInt(baseline.rows[0].total).toLocaleString()} (${(baseline.rows[0].linked/baseline.rows[0].total*100).toFixed(1)}%)\n`);

  // Get unique unlinked AWAY names only
  console.log("Loading unlinked AWAY names...");
  const unlinkedAway = await client.query(`
    SELECT DISTINCT away_team_name as name FROM match_results 
    WHERE away_team_id IS NULL AND away_team_name IS NOT NULL
      AND LENGTH(away_team_name) >= 10 AND away_team_name ~ '^[A-Za-z]'
      AND away_team_name NOT ILIKE '%***%' AND away_team_name NOT ILIKE '%dropped%'
      AND away_team_name NOT ILIKE '%bye%' AND away_team_name NOT ILIKE '%tbd%'
  `);

  console.log(`   Total AWAY names: ${unlinkedAway.rows.length}`);
  console.log(`   Resuming from: ${RESUME_FROM}`);
  console.log(`   Remaining: ${unlinkedAway.rows.length - RESUME_FROM}\n`);

  let awayLinked = 0, aliasesCreated = 0;

  // Process AWAY - starting from RESUME_FROM
  console.log("Processing AWAY teams (resumed)...");
  for (let i = RESUME_FROM; i < unlinkedAway.rows.length; i++) {
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
      console.log(`   ${i + 1}/${unlinkedAway.rows.length} processed, +${awayLinked} linked (this session)`);
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
  console.log(`   Session improvement: +${parseInt(final.rows[0].linked) - parseInt(baseline.rows[0].linked)} fully linked`);

  await client.end();
  console.log("\n✅ Done!");
}

main().catch(console.error);
