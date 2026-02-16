#!/usr/bin/env node
/**
 * audit_season_coverage.cjs — Exhaustive empirical database audit
 *
 * Determines EXACTLY what Fall 2025 data exists vs is missing,
 * broken down by state, source, month, and adapter.
 *
 * Season: August 1, 2025 → July 31, 2026
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function runAudit() {
  console.log('='.repeat(80));
  console.log('SOCCERVIEW SEASON COVERAGE AUDIT — Current Season 2025-26');
  console.log('Season: August 1, 2025 → July 31, 2026');
  console.log('Run at:', new Date().toISOString());
  console.log('='.repeat(80));

  // ── 1. MATCHES BY MONTH (production matches_v2) ──
  console.log('\n' + '─'.repeat(60));
  console.log('1. PRODUCTION MATCHES BY MONTH (matches_v2, deleted_at IS NULL)');
  console.log('─'.repeat(60));
  const { rows: monthlyMatches } = await pool.query(`
    SELECT
      TO_CHAR(DATE_TRUNC('month', match_date), 'YYYY-MM') as month,
      COUNT(*) as total_matches,
      COUNT(*) FILTER (WHERE home_score IS NOT NULL) as played,
      COUNT(*) FILTER (WHERE home_score IS NULL) as scheduled
    FROM matches_v2
    WHERE deleted_at IS NULL
      AND match_date >= '2025-08-01' AND match_date < '2026-08-01'
    GROUP BY 1 ORDER BY 1
  `);
  console.log('Month       | Total    | Played   | Scheduled');
  console.log('-'.repeat(55));
  let totalProd = 0, totalPlayed = 0, totalScheduled = 0;
  for (const r of monthlyMatches) {
    console.log(`${r.month}     | ${String(r.total_matches).padStart(8)} | ${String(r.played).padStart(8)} | ${String(r.scheduled).padStart(8)}`);
    totalProd += parseInt(r.total_matches);
    totalPlayed += parseInt(r.played);
    totalScheduled += parseInt(r.scheduled);
  }
  console.log('-'.repeat(55));
  console.log(`TOTAL       | ${String(totalProd).padStart(8)} | ${String(totalPlayed).padStart(8)} | ${String(totalScheduled).padStart(8)}`);

  // ── 2. MATCHES BY STATE + HALF (Fall vs Spring) ──
  console.log('\n' + '─'.repeat(60));
  console.log('2. MATCHES BY STATE — Fall 2025 (Aug-Dec) vs Spring 2026 (Jan-Jul)');
  console.log('─'.repeat(60));
  const { rows: stateHalf } = await pool.query(`
    SELECT
      COALESCE(t.state, 'UNKNOWN') as state,
      COUNT(*) FILTER (WHERE m.match_date >= '2025-08-01' AND m.match_date < '2026-01-01') as fall_2025,
      COUNT(*) FILTER (WHERE m.match_date >= '2026-01-01' AND m.match_date < '2026-08-01') as spring_2026,
      COUNT(*) as total
    FROM matches_v2 m
    JOIN teams_v2 t ON t.id = m.home_team_id
    WHERE m.deleted_at IS NULL
      AND m.match_date >= '2025-08-01' AND m.match_date < '2026-08-01'
    GROUP BY 1
    ORDER BY total DESC
  `);
  console.log('State    | Fall 2025 | Spring 2026 | Total    | Fall %');
  console.log('-'.repeat(65));
  for (const r of stateHalf) {
    const fallPct = r.total > 0 ? Math.round((r.fall_2025 / r.total) * 100) : 0;
    console.log(`${String(r.state).padEnd(8)} | ${String(r.fall_2025).padStart(9)} | ${String(r.spring_2026).padStart(11)} | ${String(r.total).padStart(8)} | ${String(fallPct).padStart(4)}%`);
  }

  // ── 3. MATCHES BY SOURCE PLATFORM + MONTH ──
  console.log('\n' + '─'.repeat(60));
  console.log('3. STAGING_GAMES BY SOURCE PLATFORM + MONTH');
  console.log('─'.repeat(60));
  const { rows: sourcePlatform } = await pool.query(`
    SELECT
      COALESCE(source_platform, 'unknown') as source,
      TO_CHAR(DATE_TRUNC('month', match_date), 'YYYY-MM') as month,
      COUNT(*) as count,
      COUNT(*) FILTER (WHERE processed = true) as processed,
      COUNT(*) FILTER (WHERE processed = false) as unprocessed
    FROM staging_games
    WHERE match_date >= '2025-08-01' AND match_date < '2026-08-01'
    GROUP BY 1, 2 ORDER BY 1, 2
  `);
  console.log('Source          | Month   | Total    | Processed | Unprocessed');
  console.log('-'.repeat(70));
  let lastSource = '';
  for (const r of sourcePlatform) {
    const prefix = r.source !== lastSource ? r.source : '               ';
    lastSource = r.source;
    console.log(`${prefix.padEnd(15)} | ${r.month} | ${String(r.count).padStart(8)} | ${String(r.processed).padStart(9)} | ${String(r.unprocessed).padStart(11)}`);
  }

  // ── 4. SOURCE PLATFORM SUMMARY ──
  console.log('\n' + '─'.repeat(60));
  console.log('4. SOURCE PLATFORM SUMMARY (all time)');
  console.log('─'.repeat(60));
  const { rows: sourceSummary } = await pool.query(`
    SELECT
      COALESCE(source_platform, 'unknown') as source,
      MIN(match_date) as earliest,
      MAX(match_date) as latest,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE processed = true) as processed,
      COUNT(*) FILTER (WHERE processed = false) as unprocessed
    FROM staging_games
    GROUP BY 1 ORDER BY total DESC
  `);
  console.log('Source          | Earliest   | Latest     | Total    | Processed | Backlog');
  console.log('-'.repeat(80));
  for (const r of sourceSummary) {
    const earliest = r.earliest ? r.earliest.toISOString().slice(0, 10) : 'N/A';
    const latest = r.latest ? r.latest.toISOString().slice(0, 10) : 'N/A';
    console.log(`${r.source.padEnd(15)} | ${earliest} | ${latest.padEnd(10)} | ${String(r.total).padStart(8)} | ${String(r.processed).padStart(9)} | ${String(r.unprocessed).padStart(7)}`);
  }

  // ── 5. SPORTSAFFINITY SPECIFIC ──
  console.log('\n' + '─'.repeat(60));
  console.log('5. SPORTSAFFINITY DATA — Detail by state + month');
  console.log('─'.repeat(60));
  const { rows: saDetail } = await pool.query(`
    SELECT
      COALESCE(
        CASE
          WHEN raw_data->>'state' IS NOT NULL AND raw_data->>'state' != '' THEN raw_data->>'state'
          ELSE 'UNKNOWN'
        END,
        'UNKNOWN'
      ) as state,
      TO_CHAR(DATE_TRUNC('month', match_date), 'YYYY-MM') as month,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE processed = true) as processed,
      COUNT(*) FILTER (WHERE processed = false) as unprocessed
    FROM staging_games
    WHERE source_platform = 'sportsaffinity'
    GROUP BY 1, 2 ORDER BY 1, 2
  `);
  if (saDetail.length === 0) {
    console.log('  No SportsAffinity data in staging_games.');
  } else {
    console.log('State    | Month   | Total    | Processed | Unprocessed');
    console.log('-'.repeat(60));
    for (const r of saDetail) {
      console.log(`${r.state.padEnd(8)} | ${r.month} | ${String(r.total).padStart(8)} | ${String(r.processed).padStart(9)} | ${String(r.unprocessed).padStart(11)}`);
    }
  }

  // ── 6. STATES WITH ZERO FALL 2025 MATCHES ──
  console.log('\n' + '─'.repeat(60));
  console.log('6. STATES WITH ZERO FALL 2025 DATA IN PRODUCTION');
  console.log('─'.repeat(60));
  const { rows: allStates } = await pool.query(`
    SELECT DISTINCT state FROM teams_v2
    WHERE state IS NOT NULL AND state != '' AND state != 'unknown' AND state != 'Unknown'
    ORDER BY state
  `);
  const { rows: fallStates } = await pool.query(`
    SELECT DISTINCT t.state
    FROM matches_v2 m
    JOIN teams_v2 t ON t.id = m.home_team_id
    WHERE m.deleted_at IS NULL
      AND m.match_date >= '2025-08-01' AND m.match_date < '2026-01-01'
      AND t.state IS NOT NULL AND t.state != '' AND t.state != 'unknown'
  `);
  const fallStateSet = new Set(fallStates.map(r => r.state));
  const missingFall = allStates.filter(r => !fallStateSet.has(r.state)).map(r => r.state);
  console.log(`States in system: ${allStates.length}`);
  console.log(`States WITH Fall 2025 data: ${fallStates.length}`);
  console.log(`States WITHOUT Fall 2025 data: ${missingFall.length}`);
  if (missingFall.length > 0) {
    console.log(`\nMissing states: ${missingFall.join(', ')}`);
  }

  // ── 7. TOP STATES BY MATCH COUNT (current season) ──
  console.log('\n' + '─'.repeat(60));
  console.log('7. TOP 20 STATES BY CURRENT SEASON MATCH COUNT');
  console.log('─'.repeat(60));
  const { rows: topStates } = await pool.query(`
    SELECT
      COALESCE(t.state, 'UNKNOWN') as state,
      COUNT(*) as matches,
      COUNT(DISTINCT m.home_team_id) + COUNT(DISTINCT m.away_team_id) as approx_teams,
      MIN(m.match_date) as earliest,
      MAX(m.match_date) as latest
    FROM matches_v2 m
    JOIN teams_v2 t ON t.id = m.home_team_id
    WHERE m.deleted_at IS NULL
      AND m.match_date >= '2025-08-01' AND m.match_date < '2026-08-01'
    GROUP BY 1
    ORDER BY matches DESC
    LIMIT 20
  `);
  console.log('State    | Matches  | ~Teams   | Earliest   | Latest');
  console.log('-'.repeat(65));
  for (const r of topStates) {
    const earliest = r.earliest ? r.earliest.toISOString().slice(0, 10) : 'N/A';
    const latest = r.latest ? r.latest.toISOString().slice(0, 10) : 'N/A';
    console.log(`${String(r.state).padEnd(8)} | ${String(r.matches).padStart(8)} | ${String(r.approx_teams).padStart(8)} | ${earliest} | ${latest}`);
  }

  // ── 8. STAGING BACKLOG ──
  console.log('\n' + '─'.repeat(60));
  console.log('8. STAGING BACKLOG (unprocessed records)');
  console.log('─'.repeat(60));
  const { rows: backlog } = await pool.query(`
    SELECT
      COALESCE(source_platform, 'unknown') as source,
      COUNT(*) as unprocessed,
      MIN(match_date)::text as earliest,
      MAX(match_date)::text as latest
    FROM staging_games
    WHERE processed = false
    GROUP BY 1 ORDER BY unprocessed DESC
  `);
  if (backlog.length === 0) {
    console.log('  No unprocessed staging records!');
  } else {
    console.log('Source          | Unprocessed | Earliest   | Latest');
    console.log('-'.repeat(60));
    for (const r of backlog) {
      console.log(`${r.source.padEnd(15)} | ${String(r.unprocessed).padStart(11)} | ${(r.earliest || 'N/A').slice(0, 10)} | ${(r.latest || 'N/A').slice(0, 10)}`);
    }
  }

  // ── 9. LEAGUE/TOURNAMENT COVERAGE ──
  console.log('\n' + '─'.repeat(60));
  console.log('9. LEAGUES + TOURNAMENTS WITH CURRENT SEASON MATCHES');
  console.log('─'.repeat(60));
  const { rows: leagueCoverage } = await pool.query(`
    SELECT
      COALESCE(l.name, t.name, 'UNLINKED') as event_name,
      CASE WHEN m.league_id IS NOT NULL THEN 'league' WHEN m.tournament_id IS NOT NULL THEN 'tournament' ELSE 'unlinked' END as type,
      COALESCE(l.state, t.state, 'UNK') as state,
      COUNT(*) as matches,
      MIN(m.match_date)::text as earliest,
      MAX(m.match_date)::text as latest
    FROM matches_v2 m
    LEFT JOIN leagues l ON l.id = m.league_id
    LEFT JOIN tournaments t ON t.id = m.tournament_id
    WHERE m.deleted_at IS NULL
      AND m.match_date >= '2025-08-01' AND m.match_date < '2026-08-01'
    GROUP BY 1, 2, 3
    ORDER BY matches DESC
    LIMIT 40
  `);
  console.log('Type       | State | Matches  | Earliest   | Latest     | Event Name');
  console.log('-'.repeat(95));
  for (const r of leagueCoverage) {
    const name = r.event_name.length > 40 ? r.event_name.slice(0, 37) + '...' : r.event_name;
    console.log(`${r.type.padEnd(10)} | ${(r.state || 'UNK').padEnd(5)} | ${String(r.matches).padStart(8)} | ${(r.earliest || '').slice(0, 10)} | ${(r.latest || '').slice(0, 10)} | ${name}`);
  }

  // ── 10. OVERALL SUMMARY ──
  console.log('\n' + '='.repeat(80));
  console.log('OVERALL SUMMARY');
  console.log('='.repeat(80));
  const { rows: [totals] } = await pool.query(`
    SELECT
      COUNT(*) as total_active,
      COUNT(*) FILTER (WHERE match_date >= '2025-08-01' AND match_date < '2026-01-01') as fall_2025,
      COUNT(*) FILTER (WHERE match_date >= '2026-01-01' AND match_date < '2026-08-01') as spring_2026,
      COUNT(*) FILTER (WHERE match_date < '2025-08-01') as pre_season,
      COUNT(*) FILTER (WHERE match_date >= '2026-08-01') as next_season
    FROM matches_v2 WHERE deleted_at IS NULL
  `);
  console.log(`Total active matches:     ${totals.total_active}`);
  console.log(`  Pre-season (<Aug 2025): ${totals.pre_season}`);
  console.log(`  Fall 2025 (Aug-Dec):    ${totals.fall_2025}`);
  console.log(`  Spring 2026 (Jan-Jul):  ${totals.spring_2026}`);
  console.log(`  Next season (>Aug 2026):${totals.next_season}`);
  console.log(`\nFall 2025 % of current season: ${
    parseInt(totals.fall_2025) + parseInt(totals.spring_2026) > 0
      ? Math.round(parseInt(totals.fall_2025) / (parseInt(totals.fall_2025) + parseInt(totals.spring_2026)) * 100)
      : 0
  }%`);
  console.log(`States missing Fall 2025: ${missingFall.length} of ${allStates.length}`);

  const { rows: [teamCount] } = await pool.query(`SELECT COUNT(*) as cnt FROM teams_v2`);
  const { rows: [stagingCount] } = await pool.query(`SELECT COUNT(*) FILTER (WHERE processed = false) as cnt FROM staging_games`);
  console.log(`\nTotal teams:              ${teamCount.cnt}`);
  console.log(`Staging backlog:          ${stagingCount.cnt}`);

  console.log('\n' + '='.repeat(80));
  console.log('AUDIT COMPLETE');
  console.log('='.repeat(80));

  await pool.end();
}

runAudit().catch(err => {
  console.error('AUDIT ERROR:', err.message);
  process.exit(1);
});
