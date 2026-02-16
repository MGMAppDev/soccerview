/**
 * Reclassify ECNL/ECRL/Pre-ECNL tournaments as leagues.
 * fastProcessStaging created them as tournaments because the event names
 * don't contain "league" keyword. ECNL is a league (regular season play),
 * not a tournament (weekend competition).
 *
 * Pattern: Same fix applied to MLS Next in Session 98.
 */
require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  console.log("=== Reclassify ECNL/ECRL/Pre-ECNL Tournaments → Leagues ===\n");

  // Get current season_id
  const { rows: [season] } = await pool.query(`SELECT id FROM seasons WHERE is_current = true LIMIT 1`);
  const seasonId = season?.id;

  // Find all ECNL-related tournaments
  const { rows: ecnlTournaments } = await pool.query(`
    SELECT id, name, state, source_platform
    FROM tournaments
    WHERE name ILIKE '%ECNL%' OR name ILIKE '%ECRL%' OR name ILIKE '%Pre-ECNL%'
      OR name ILIKE '%ECNL RL%'
    ORDER BY name
  `);

  console.log(`Found ${ecnlTournaments.length} ECNL-related tournaments to reclassify:\n`);
  for (const t of ecnlTournaments) {
    console.log(`  ${t.id.substring(0, 8)}... "${t.name}" (platform=${t.source_platform})`);
  }

  if (ecnlTournaments.length === 0) {
    console.log("No ECNL tournaments found. Already reclassified?");
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT authorize_pipeline_write()");

    let reclassified = 0;
    let matchesMoved = 0;

    for (const t of ecnlTournaments) {
      // 1. Create corresponding league entry
      const { rows: [league] } = await client.query(`
        INSERT INTO leagues (name, state, source_platform, season_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT DO NOTHING
        RETURNING id
      `, [t.name, t.state, t.source_platform, seasonId]);

      const leagueId = league?.id;
      if (!leagueId) {
        // League already exists — find it
        const { rows: [existing] } = await client.query(
          `SELECT id FROM leagues WHERE name = $1 AND COALESCE(source_platform, '') = COALESCE($2, '') LIMIT 1`,
          [t.name, t.source_platform]
        );
        if (!existing) {
          console.log(`  SKIP: Could not create/find league for "${t.name}"`);
          continue;
        }
        // Use existing league ID
        const existingLeagueId = existing.id;

        // 2. Move matches from tournament to league
        const { rowCount } = await client.query(`
          UPDATE matches_v2
          SET league_id = $1, tournament_id = NULL
          WHERE tournament_id = $2 AND deleted_at IS NULL
        `, [existingLeagueId, t.id]);
        matchesMoved += rowCount;

        // 3. Move source_entity_map entries
        await client.query(`
          UPDATE source_entity_map
          SET sv_id = $1
          WHERE entity_type = 'tournament' AND sv_id = $2
        `, [existingLeagueId, t.id]);

        // Also update entity_type to 'league'
        await client.query(`
          UPDATE source_entity_map
          SET entity_type = 'league'
          WHERE sv_id = $1 AND entity_type = 'tournament'
        `, [existingLeagueId]);

        // 4. Delete the tournament
        await client.query(`DELETE FROM tournaments WHERE id = $1`, [t.id]);

        reclassified++;
        console.log(`  ✅ "${t.name}": ${rowCount} matches → league ${existingLeagueId.substring(0, 8)}...`);
        continue;
      }

      // New league created
      // 2. Move matches from tournament to league
      const { rowCount } = await client.query(`
        UPDATE matches_v2
        SET league_id = $1, tournament_id = NULL
        WHERE tournament_id = $2 AND deleted_at IS NULL
      `, [leagueId, t.id]);
      matchesMoved += rowCount;

      // 3. Move source_entity_map entries
      await client.query(`
        UPDATE source_entity_map
        SET sv_id = $1, entity_type = 'league'
        WHERE entity_type = 'tournament' AND sv_id = $2
      `, [leagueId, t.id]);

      // 4. Delete the tournament
      await client.query(`DELETE FROM tournaments WHERE id = $1`, [t.id]);

      reclassified++;
      console.log(`  ✅ "${t.name}": ${rowCount} matches → league ${leagueId.substring(0, 8)}...`);
    }

    await client.query("COMMIT");
    console.log(`\n=== DONE ===`);
    console.log(`Reclassified: ${reclassified} tournaments → leagues`);
    console.log(`Matches moved: ${matchesMoved}`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error:", err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
