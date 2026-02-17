/**
 * Session 106 — Reclassify USYS NL Team/Club Premier events as leagues
 *
 * fastProcessStaging linked matches to OLD tournament entries (numeric source_event_id).
 * Our new league entries (gotsport-prefix) have 0 matches.
 *
 * Strategy: Re-link matches from old tournament → new league entry.
 * Winter Events (50898, 50935) stay as tournaments — they're single-weekend showcases.
 *
 * Pattern from reclassify_ga_as_leagues.cjs
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Events to reclassify from tournament → league
// Format: { oldSourceId (tournament), newSourceId (league) }
const RECLASSIFY_MAP = [
  // NL Team Premier (8 conferences)
  { eventId: '50925', name: 'NL Team Desert' },
  { eventId: '50944', name: 'NL Team Great Lakes' },
  { eventId: '46789', name: 'NL Team Mid Atlantic' },
  { eventId: '50933', name: 'NL Team Mid South' },
  { eventId: '50867', name: 'NL Team Midwest' },
  { eventId: '46794', name: 'NL Team New England' },
  { eventId: '46792', name: 'NL Team North Atlantic' },
  { eventId: '50910', name: 'NL Team Piedmont' },

  // NL Club Premier 1 (7 conferences)
  { eventId: '50936', name: 'NL Club P1 Frontier' },
  { eventId: '50937', name: 'NL Club P1 Great Lakes' },
  { eventId: '50938', name: 'NL Club P1 Midwest' },
  { eventId: '50939', name: 'NL Club P1 Northeast' },
  { eventId: '50940', name: 'NL Club P1 Pacific' },
  { eventId: '50941', name: 'NL Club P1 Piedmont' },
  { eventId: '50942', name: 'NL Club P1 Southeast' },

  // NL Club Premier 2 (4 new conferences)
  { eventId: '50931', name: 'NL Club P2 Desert' },
  { eventId: '50922', name: 'NL Club P2 Great Lakes' },
  { eventId: '50923', name: 'NL Club P2 Midwest' },
  { eventId: '51345', name: 'NL Club P2 Piedmont' },

  // Existing USYS NL events that were stored as tournaments (also reclassify)
  { eventId: '44340', name: 'NL Team South Atlantic 15U-19U' },
  { eventId: '50581', name: 'NL Team South Atlantic 13U-14U' },  // Was 50581 a tournament?
  { eventId: '43114', name: 'NL Team Sunshine P1' },
  { eventId: '43943', name: 'NL Club P2 Sunshine' },
];

// Winter events to KEEP as tournaments (single-weekend showcases)
const KEEP_AS_TOURNAMENT = ['50935', '50898'];

async function main() {
  console.log('=== Session 106: Reclassify USYS NL Events as Leagues ===\n');
  console.log(`Events to reclassify: ${RECLASSIFY_MAP.length}`);
  console.log(`Events to keep as tournament: ${KEEP_AS_TOURNAMENT.join(', ')}\n`);

  try {
    await pool.query('SELECT authorize_pipeline_write()');
    console.log('Pipeline write authorized.\n');
  } catch (e) {
    console.log('Note: authorize_pipeline_write():', e.message.substring(0, 80));
  }

  let totalRelinked = 0;
  let skipped = 0;
  let alreadyOk = 0;

  for (const ev of RECLASSIFY_MAP) {
    const { eventId, name } = ev;
    const newSourceId = `gotsport-${eventId}`;

    // Find old tournament entry (numeric source_event_id)
    const { rows: tourRows } = await pool.query(
      'SELECT id, name FROM tournaments WHERE source_event_id = $1',
      [eventId]
    );

    // Find new league entry
    const { rows: leagueRows } = await pool.query(
      'SELECT id, name FROM leagues WHERE source_event_id = $1',
      [newSourceId]
    );

    if (leagueRows.length === 0) {
      console.log(`  SKIP ${eventId} (${name}): No league entry with source_event_id '${newSourceId}'`);
      skipped++;
      continue;
    }

    const leagueId = leagueRows[0].id;
    const leagueName = leagueRows[0].name;

    if (tourRows.length === 0) {
      // No old tournament — check if matches already linked to league
      const { rows: existingLeagueMatches } = await pool.query(
        'SELECT COUNT(*) as cnt FROM matches_v2 WHERE league_id = $1 AND deleted_at IS NULL',
        [leagueId]
      );
      const cnt = parseInt(existingLeagueMatches[0].cnt);
      if (cnt > 0) {
        console.log(`  OK ${eventId} (${name}): ${cnt} matches already in league`);
        alreadyOk++;
      } else {
        console.log(`  SKIP ${eventId} (${name}): No tournament entry and no league matches`);
        skipped++;
      }
      continue;
    }

    for (const tour of tourRows) {
      const { rows: matchCount } = await pool.query(
        'SELECT COUNT(*) as cnt FROM matches_v2 WHERE tournament_id = $1 AND deleted_at IS NULL',
        [tour.id]
      );
      const count = parseInt(matchCount[0].cnt);

      if (count === 0) {
        console.log(`  SKIP ${eventId} (${name}): tournament "${tour.name}" has 0 matches`);
        continue;
      }

      console.log(`  RECLASSIFY ${eventId}: "${tour.name}" → "${leagueName}" (${count} matches)`);

      const { rowCount } = await pool.query(`
        UPDATE matches_v2
        SET league_id = $1, tournament_id = NULL
        WHERE tournament_id = $2 AND deleted_at IS NULL
      `, [leagueId, tour.id]);

      console.log(`    → Re-linked ${rowCount} matches`);
      totalRelinked += rowCount;
    }
  }

  // Final league match counts
  console.log('\n=== Final USYS NL League Counts ===');
  const { rows: finalCounts } = await pool.query(`
    SELECT l.name, COUNT(m.id) as match_count
    FROM leagues l
    LEFT JOIN matches_v2 m ON m.league_id = l.id AND m.deleted_at IS NULL
    WHERE (l.name ILIKE '%USYS%' OR l.name ILIKE '%national league%'
        OR l.name ILIKE '%NL Club%' OR l.name ILIKE '%NL Team%')
      AND COUNT(m.id) > 0
    GROUP BY l.name
    ORDER BY match_count DESC
  `);
  // Can't use HAVING COUNT in WHERE, use subquery
  const { rows: finalCounts2 } = await pool.query(`
    SELECT l.name, COUNT(m.id) as match_count
    FROM leagues l
    LEFT JOIN matches_v2 m ON m.league_id = l.id AND m.deleted_at IS NULL
    WHERE (l.name ILIKE '%USYS%' OR l.name ILIKE '%national league%'
        OR l.name ILIKE '%NL Club%' OR l.name ILIKE '%NL Team%')
    GROUP BY l.name
    ORDER BY match_count DESC
  `);
  finalCounts2.forEach(r => {
    if (parseInt(r.match_count) > 0) {
      console.log(`  ${r.match_count} | ${r.name}`);
    }
  });

  const totalNL = finalCounts2.reduce((sum, r) => sum + parseInt(r.match_count), 0);
  console.log(`\n  Total USYS NL league matches: ${totalNL}`);
  console.log(`  Total re-linked: ${totalRelinked}`);
  console.log(`  Already OK: ${alreadyOk}`);
  console.log(`  Skipped: ${skipped}`);

  await pool.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
