#!/usr/bin/env node
/**
 * check_wave_coverage.cjs — Audit planned vs actual scraping
 * Compares STATE_COVERAGE_CHECKLIST Wave plan against actual database contents
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  console.log('='.repeat(80));
  console.log('WAVE PLAN vs ACTUAL DATA — Honest Audit');
  console.log('='.repeat(80));

  // 1. SportsAffinity data in staging
  console.log('\n--- SPORTSAFFINITY DATA IN STAGING ---');
  const { rows: saStaging } = await pool.query(`
    SELECT
      COALESCE(raw_data->>'state', 'UNKNOWN') as state,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE processed = true) as processed,
      COUNT(*) FILTER (WHERE processed = false) as unprocessed,
      MIN(match_date)::text as earliest,
      MAX(match_date)::text as latest
    FROM staging_games
    WHERE source_platform = 'sportsaffinity'
    GROUP BY 1 ORDER BY total DESC
  `);
  for (const r of saStaging) {
    console.log(`  ${r.state}: ${r.total} total (${r.processed} processed, ${r.unprocessed} unprocessed) | ${r.earliest} to ${r.latest}`);
  }

  // 2. SportsAffinity events that were actually scraped
  console.log('\n--- SPORTSAFFINITY EVENTS ACTUALLY SCRAPED ---');
  const { rows: saEvents } = await pool.query(`
    SELECT
      COALESCE(event_name, 'UNKNOWN') as event_name,
      COALESCE(event_id, 'UNKNOWN') as event_id,
      COUNT(*) as total,
      MIN(match_date)::text as earliest,
      MAX(match_date)::text as latest
    FROM staging_games
    WHERE source_platform = 'sportsaffinity'
    GROUP BY 1, 2 ORDER BY total DESC
  `);
  for (const r of saEvents) {
    console.log(`  ${r.event_name} | ID: ${r.source_event_id} | ${r.total} matches | ${r.earliest} to ${r.latest}`);
  }

  // 3. Wave 3 SportsAffinity states — what do we ACTUALLY have?
  const wave3 = [
    { state: 'GA', league: 'GPL + Classic/Athena (SportsAffinity)', planned: 'GA Girls + more events' },
    { state: 'MN', league: 'MYSA State Competitive (6 tiers)', planned: 'SportsAffinity event discovery' },
    { state: 'UT', league: 'UYSA Premier League (320+ teams)', planned: 'SportsAffinity event discovery' },
    { state: 'OR', league: 'OYSA Competitive League', planned: 'SportsAffinity event discovery' },
    { state: 'NE', league: 'NE Youth Soccer League', planned: 'SportsAffinity event discovery' },
    { state: 'PA', league: 'PA West State Leagues', planned: 'SportsAffinity for PA-W' },
  ];

  console.log('\n' + '='.repeat(80));
  console.log('WAVE 3: SPORTSAFFINITY STATES — PLANNED vs ACTUAL');
  console.log('='.repeat(80));

  for (const w of wave3) {
    const { rows: [stateData] } = await pool.query(`
      SELECT
        COUNT(*) as total_matches,
        COUNT(*) FILTER (WHERE match_date >= '2025-08-01' AND match_date < '2026-08-01') as current_season
      FROM matches_v2 m
      JOIN teams_v2 t ON t.id = m.home_team_id
      WHERE m.deleted_at IS NULL AND t.state = $1
    `, [w.state]);

    const { rows: leagues } = await pool.query(`
      SELECT l.name, l.source_platform, COUNT(m.id) as matches
      FROM leagues l
      LEFT JOIN matches_v2 m ON m.league_id = l.id AND m.deleted_at IS NULL
      WHERE l.state = $1
      GROUP BY l.name, l.source_platform
      ORDER BY matches DESC
      LIMIT 10
    `, [w.state]);

    const { rows: saMatches } = await pool.query(`
      SELECT COUNT(*) as cnt
      FROM staging_games
      WHERE source_platform = 'sportsaffinity'
        AND (raw_data->>'state' = $1 OR event_name ILIKE '%' || $1 || '%')
    `, [w.state]);

    console.log(`\n${w.state} — PLANNED: ${w.league}`);
    console.log(`  Action needed: ${w.planned}`);
    console.log(`  ACTUAL matches_v2: ${stateData.total_matches} total, ${stateData.current_season} current season`);
    console.log(`  SportsAffinity staging: ${saMatches[0].cnt} records`);
    if (leagues.length > 0) {
      for (const l of leagues) {
        console.log(`    League: ${l.name} (${l.source_platform || 'unknown'}) — ${l.matches} matches`);
      }
    } else {
      console.log(`    NO STATE-SPECIFIC LEAGUES in DB`);
    }
  }

  // 4. Wave 4-8 — Other unbuilt adapters
  console.log('\n' + '='.repeat(80));
  console.log('WAVES 4-8: UNBUILT ADAPTERS — STATUS');
  console.log('='.repeat(80));

  const otherWaves = [
    { wave: 4, name: 'PlayMetrics', states: ['CO'], leagues: 'Colorado Advanced League (9 tiers) + SDL' },
    { wave: 5, name: 'Demosphere', states: ['VA', 'DC', 'IL', 'WI'], leagues: 'NCSL, IL Premiership, WYSA' },
    { wave: 6, name: 'Squadi', states: ['AR'], leagues: 'Arkansas Competitive Soccer League' },
    { wave: 7, name: 'Custom', states: ['RI', 'HI', 'NM'], leagues: 'Super Liga, Oahu League, DCSL' },
  ];

  for (const w of otherWaves) {
    console.log(`\nWave ${w.wave}: ${w.name} — ${w.leagues}`);
    console.log(`  Adapter status: NOT BUILT`);
    for (const state of w.states) {
      const { rows: [d] } = await pool.query(`
        SELECT COUNT(*) as matches
        FROM matches_v2 m
        JOIN teams_v2 t ON t.id = m.home_team_id
        WHERE m.deleted_at IS NULL AND t.state = $1
          AND match_date >= '2025-08-01'
      `, [state]);
      console.log(`  ${state}: ${d.matches} current-season matches (from GotSport/other sources only)`);
    }
  }

  // 5. Wave 8: ECNL full scrape
  console.log('\n\nWave 8: ECNL (TotalGlobalSports)');
  const { rows: ecnlData } = await pool.query(`
    SELECT
      COALESCE(event_name, event_id) as event,
      COUNT(*) as matches
    FROM staging_games
    WHERE source_platform = 'totalglobalsports'
    GROUP BY 1 ORDER BY matches DESC
  `);
  console.log(`  Events scraped: ${ecnlData.length} of 13`);
  for (const r of ecnlData) {
    console.log(`    ${r.event}: ${r.matches} matches`);
  }

  // 6. SUMMARY — What was planned vs what was done
  console.log('\n' + '='.repeat(80));
  console.log('HONEST SUMMARY: PLANNED vs DONE');
  console.log('='.repeat(80));

  console.log(`
Wave 1 (Foundation): COMPLETE ✓
  - KS/MO Heartland: DONE
  - NC SINC Sports: DONE
  - MLS Next: DONE
  - GA SportsAffinity (Boys): DONE
  - GotSport Rankings: DONE

Wave 2 (GotSport Discovery): MOSTLY COMPLETE
  - 2a (10 small states): DONE
  - 2b (large markets): ALREADY HAD DATA from prior sessions
  - 2c (national programs): PARTIALLY DONE (GA, some USYS NL)
  - 2d (small markets): NOT DONE (ND, WV, WY)

Wave 3 (SportsAffinity Expansion): NOT STARTED
  - GA Girls: NOT DONE
  - MN MYSA: NOT DONE
  - UT UYSA: NOT DONE
  - OR OYSA: NOT DONE
  - NE NYSL: NOT DONE
  - PA-W: NOT DONE
  Note: Adapter is BUILT but only GA Boys was scraped

Wave 4 (PlayMetrics): NOT STARTED — adapter not built
Wave 5 (Demosphere): NOT STARTED — adapter not built
Wave 6 (Squadi): NOT STARTED — adapter not built
Wave 7 (Custom): NOT STARTED — adapters not built
Wave 8 (ECNL Full): 1 of 13 events scraped
`);

  await pool.end();
}

run().catch(e => { console.error(e.message); process.exit(1); });
