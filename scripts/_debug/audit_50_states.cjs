/**
 * 50-State PRODUCTION Audit — Session 113
 *
 * Checks all 5 data elements for each US state + DC:
 * 1. Matches in matches_v2
 * 2. ELO ratings on teams
 * 3. GotSport rankings
 * 4. League Standings in league_standings
 * 5. Scheduled future matches with league linkage
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'
];

async function main() {
  console.log('=== 50-STATE PRODUCTION AUDIT — Session 113 ===\n');

  // Batch query for efficiency — get all state stats in one pass
  const today = new Date().toISOString().slice(0, 10);

  // 1. Matches per state (via team state)
  const { rows: matchRows } = await pool.query(`
    SELECT t.state, COUNT(DISTINCT m.id) as match_count
    FROM matches_v2 m
    JOIN teams_v2 t ON (m.home_team_id = t.id OR m.away_team_id = t.id)
    WHERE m.deleted_at IS NULL AND t.state IS NOT NULL AND t.state != 'unknown'
    GROUP BY t.state
  `);
  const matchMap = Object.fromEntries(matchRows.map(r => [r.state, parseInt(r.match_count)]));

  // 2. Teams with ELO per state
  const { rows: eloRows } = await pool.query(`
    SELECT state,
           COUNT(*) as total_teams,
           COUNT(*) FILTER (WHERE elo_rating IS NOT NULL AND elo_rating > 0) as teams_with_elo
    FROM teams_v2
    WHERE state IS NOT NULL AND state != 'unknown'
    GROUP BY state
  `);
  const eloMap = Object.fromEntries(eloRows.map(r => [r.state, { total: parseInt(r.total_teams), withElo: parseInt(r.teams_with_elo) }]));

  // 3. GotSport rankings per state
  const { rows: rankRows } = await pool.query(`
    SELECT state,
           COUNT(*) FILTER (WHERE national_rank IS NOT NULL OR gotsport_rank IS NOT NULL) as gs_ranked
    FROM teams_v2
    WHERE state IS NOT NULL AND state != 'unknown'
    GROUP BY state
  `);
  const rankMap = Object.fromEntries(rankRows.map(r => [r.state, parseInt(r.gs_ranked)]));

  // 4. League standings per state
  const { rows: standRows } = await pool.query(`
    SELECT l.state, COUNT(ls.id) as standings_count
    FROM league_standings ls
    JOIN leagues l ON ls.league_id = l.id
    WHERE l.state IS NOT NULL AND l.state != 'unknown'
    GROUP BY l.state
  `);
  const standMap = Object.fromEntries(standRows.map(r => [r.state, parseInt(r.standings_count)]));

  // 5. Future scheduled matches with league linkage per state
  const { rows: schedRows } = await pool.query(`
    SELECT t.state, COUNT(DISTINCT m.id) as sched_count
    FROM matches_v2 m
    JOIN teams_v2 t ON (m.home_team_id = t.id OR m.away_team_id = t.id)
    WHERE m.deleted_at IS NULL
      AND m.match_date > $1
      AND m.home_score IS NULL
      AND m.league_id IS NOT NULL
      AND t.state IS NOT NULL AND t.state != 'unknown'
    GROUP BY t.state
  `, [today]);
  const schedMap = Object.fromEntries(schedRows.map(r => [r.state, parseInt(r.sched_count)]));

  // Print report
  const headers = ['State', 'Matches', 'ELO%', 'GS Ranks', 'Standings', 'Scheduled', 'Status'];
  console.log(headers.join(' | '));
  console.log('---'.repeat(20));

  const gaps = [];

  for (const state of STATES) {
    const matches = matchMap[state] || 0;
    const eloData = eloMap[state] || { total: 0, withElo: 0 };
    const eloTotal = eloData.total;
    const eloWithElo = eloData.withElo;
    const eloPct = eloTotal > 0 ? Math.round(100 * eloWithElo / eloTotal) : 0;
    const gsRanks = rankMap[state] || 0;
    const standings = standMap[state] || 0;
    const scheduled = schedMap[state] || 0;

    const hasMatches = matches > 0;
    const hasElo = eloPct > 50; // > 50% of teams have ELO = good
    const hasGsRanks = gsRanks > 0;
    const hasStandings = standings > 0;
    const hasScheduled = scheduled > 0;

    const elements = [hasMatches, hasElo, hasGsRanks, hasStandings, hasScheduled];
    const elementCount = elements.filter(Boolean).length;

    let status;
    if (elementCount === 5) status = '✅ PRODUCTION';
    else if (elementCount >= 3) status = '🟡 PARTIAL';
    else if (elementCount >= 1) status = '🟠 MINIMAL';
    else status = '❌ NO DATA';

    if (elementCount < 5) {
      const missingList = [];
      if (!hasMatches) missingList.push('matches');
      if (!hasElo) missingList.push(`ELO(${eloPct}%)`);
      if (!hasGsRanks) missingList.push('gsRanks');
      if (!hasStandings) missingList.push('standings');
      if (!hasScheduled) missingList.push('scheduled');
      gaps.push({ state, elementCount, matches, gsRanks, standings, scheduled, eloPct, missing: missingList });
    }

    console.log(`${state.padEnd(5)} | ${String(matches).padStart(7)} | ${String(eloPct+'%').padStart(4)} | ${String(gsRanks).padStart(8)} | ${String(standings).padStart(9)} | ${String(scheduled).padStart(9)} | ${status}`);
  }

  console.log('\n=== GAPS SUMMARY ===\n');

  // Summary by status
  const production = STATES.filter(s => {
    const matches = matchMap[s] || 0;
    const eloData = eloMap[s] || { total: 0, withElo: 0 };
    const eloPct = eloData.total > 0 ? Math.round(100 * eloData.withElo / eloData.total) : 0;
    const gsRanks = rankMap[s] || 0;
    const standings = standMap[s] || 0;
    const scheduled = schedMap[s] || 0;
    return matches > 0 && eloPct > 50 && gsRanks > 0 && standings > 0 && scheduled > 0;
  });

  console.log(`PRODUCTION (all 5): ${production.length}/51 states`);
  console.log(`States at PRODUCTION: ${production.join(', ')}`);

  console.log('\nGaps by state (missing elements):');
  gaps.sort((a, b) => b.elementCount - a.elementCount);
  for (const g of gaps) {
    console.log(`  ${g.state}: ${g.elementCount}/5 elements — MISSING: ${g.missing.join(', ')}`);
  }

  // Critical gaps analysis
  console.log('\n=== CRITICAL: States with NO matches ===');
  const noMatches = STATES.filter(s => !matchMap[s] || matchMap[s] === 0);
  console.log(noMatches.length > 0 ? noMatches.join(', ') : 'None! All states have matches.');

  console.log('\n=== States with NO standings ===');
  const noStandings = STATES.filter(s => !standMap[s] || standMap[s] === 0);
  console.log(`${noStandings.length} states: ${noStandings.join(', ')}`);

  console.log('\n=== States with NO scheduled matches ===');
  const noScheduled = STATES.filter(s => !schedMap[s] || schedMap[s] === 0);
  console.log(`${noScheduled.length} states: ${noScheduled.join(', ')}`);

  await pool.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
