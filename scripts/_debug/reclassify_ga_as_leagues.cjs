/**
 * Session 106 — Reclassify Girls Academy events as leagues
 *
 * The GA events (42137, 42138, 44874, 45530) were registered by prior scrapes
 * as tournaments. We now have them registered as leagues in the leagues table.
 *
 * This script:
 * 1. Finds matches linked to GA tournament entries
 * 2. Re-links them to the new GA league entries
 * 3. Soft-deletes (removes) the old tournament-linked records if needed
 *
 * Note: We use UPDATE to change league_id/tournament_id, not delete.
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Allow write access (pipeline authorization)
const AUTHORIZE_SQL = `SELECT authorize_pipeline_write()`;

async function main() {
  console.log('=== Session 106: Reclassify GA Events as Leagues ===\n');

  try {
    await pool.query(AUTHORIZE_SQL);
    console.log('Pipeline write authorized.\n');
  } catch (e) {
    console.log('Note: authorize_pipeline_write() not available:', e.message);
  }

  // GA event IDs to reclassify (GotSport source event IDs)
  const GA_EVENTS = ['42137', '42138', '44874', '45530'];

  for (const eventId of GA_EVENTS) {
    const sourceEventId = `gotsport-${eventId}`;

    // Find the old tournament entry
    const { rows: tourRows } = await pool.query(
      'SELECT id, name FROM tournaments WHERE source_event_id = $1',
      [eventId]  // Note: old entries may have just the numeric ID, not 'gotsport-' prefix
    );
    const { rows: tourRowsWithPrefix } = await pool.query(
      'SELECT id, name FROM tournaments WHERE source_event_id = $1',
      [sourceEventId]
    );
    const { rows: tourRowsAlt } = await pool.query(
      `SELECT id, name FROM tournaments
       WHERE name ILIKE '%girl%academy%' AND
       (source_event_id = $1 OR source_event_id = $2)`,
      [eventId, sourceEventId]
    );

    const allTourRows = [...new Map([...tourRows, ...tourRowsWithPrefix, ...tourRowsAlt].map(r => [r.id, r])).values()];

    // Find the new league entry
    const { rows: leagueRows } = await pool.query(
      'SELECT id, name FROM leagues WHERE source_event_id = $1',
      [sourceEventId]
    );

    if (leagueRows.length === 0) {
      console.log(`  SKIP ${eventId}: No league entry found (not yet registered)`);
      continue;
    }

    const leagueId = leagueRows[0].id;
    const leagueName = leagueRows[0].name;

    if (allTourRows.length === 0) {
      console.log(`  SKIP ${eventId}: No existing tournament entry found — matches already linked to league or don't exist`);
      // Check if there are already matches linked to this league
      const { rows: leagueMatches } = await pool.query(
        'SELECT COUNT(*) as cnt FROM matches_v2 WHERE league_id = $1 AND deleted_at IS NULL',
        [leagueId]
      );
      console.log(`    League ${leagueName}: ${leagueMatches[0].cnt} matches already linked`);
      continue;
    }

    for (const tour of allTourRows) {
      const tournamentId = tour.id;

      // Count matches linked to this tournament
      const { rows: matchCount } = await pool.query(
        'SELECT COUNT(*) as cnt FROM matches_v2 WHERE tournament_id = $1 AND deleted_at IS NULL',
        [tournamentId]
      );
      const count = parseInt(matchCount[0].cnt);

      if (count === 0) {
        console.log(`  SKIP ${eventId} tournament "${tour.name}": 0 matches linked`);
        continue;
      }

      console.log(`  RECLASSIFY ${eventId}: "${tour.name}" → "${leagueName}"`);
      console.log(`    ${count} matches to re-link`);

      // Re-link matches from tournament → league
      const { rowCount } = await pool.query(`
        UPDATE matches_v2
        SET league_id = $1, tournament_id = NULL
        WHERE tournament_id = $2 AND deleted_at IS NULL
      `, [leagueId, tournamentId]);

      console.log(`    → Re-linked ${rowCount} matches`);
    }

    // Final count
    const { rows: finalCount } = await pool.query(
      'SELECT COUNT(*) as cnt FROM matches_v2 WHERE league_id = $1 AND deleted_at IS NULL',
      [leagueId]
    );
    console.log(`    League "${leagueName}": ${finalCount[0].cnt} total matches`);
  }

  console.log('\n=== Done ===');
  await pool.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
