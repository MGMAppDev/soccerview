/**
 * Detailed Stats Audit - per-match breakdown
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function audit() {
  const client = await pool.connect();

  try {
    const teamId = 'cc329f08-1f57-4a7b-923a-768b2138fa92';

    // Get season boundaries
    const seasonResult = await client.query(`
      SELECT start_date, end_date FROM seasons WHERE is_current = true
    `);
    const seasonStart = seasonResult.rows[0].start_date;

    console.log("DETAILED MATCH BREAKDOWN:");
    console.log("=".repeat(80));

    const matches = await client.query(`
      SELECT
        m.id,
        m.match_date,
        m.home_score,
        m.away_score,
        m.home_team_id,
        m.away_team_id,
        ht.display_name as home_team,
        at.display_name as away_team,
        COALESCE(l.name, t.name, 'Unlinked') as event_name,
        m.source_match_key
      FROM matches_v2 m
      JOIN teams_v2 ht ON m.home_team_id = ht.id
      JOIN teams_v2 at ON m.away_team_id = at.id
      LEFT JOIN leagues l ON m.league_id = l.id
      LEFT JOIN tournaments t ON m.tournament_id = t.id
      WHERE m.home_team_id = $1 OR m.away_team_id = $1
      ORDER BY m.match_date ASC
    `, [teamId]);

    let totalWins = 0, totalLosses = 0, totalDraws = 0;

    console.log("Date       | Home Score-Score Away | Team Side | Result | Event");
    console.log("-".repeat(100));

    matches.rows.forEach(m => {
      const isHome = m.home_team_id === teamId;
      const teamScore = isHome ? m.home_score : m.away_score;
      const oppScore = isHome ? m.away_score : m.home_score;

      let result = 'D';
      if (teamScore > oppScore) {
        result = 'W';
        totalWins++;
      } else if (teamScore < oppScore) {
        result = 'L';
        totalLosses++;
      } else {
        totalDraws++;
      }

      const date = m.match_date?.toISOString().split('T')[0] || 'NULL';
      const homeShort = m.home_team.substring(0, 20);
      const awayShort = m.away_team.substring(0, 20);
      const side = isHome ? 'HOME' : 'AWAY';
      const eventShort = m.event_name.substring(0, 30);

      console.log(`${date} | ${homeShort.padEnd(20)} ${m.home_score}-${m.away_score} ${awayShort.padEnd(20)} | ${side} | ${result} | ${eventShort}`);
    });

    console.log("-".repeat(100));
    console.log(`TOTAL: ${matches.rows.length} matches, ${totalWins}W-${totalLosses}L-${totalDraws}D`);

    // Now check what ELO script would calculate
    console.log("\n\nELO SCRIPT FILTER TEST:");
    console.log("(home_score IS NOT NULL AND away_score IS NOT NULL AND match_date >= season_start)");

    const eloEligible = await client.query(`
      SELECT COUNT(*) as cnt,
        SUM(CASE
          WHEN (home_team_id = $1 AND home_score > away_score)
            OR (away_team_id = $1 AND away_score > home_score) THEN 1 ELSE 0 END) as wins,
        SUM(CASE
          WHEN (home_team_id = $1 AND home_score < away_score)
            OR (away_team_id = $1 AND away_score < home_score) THEN 1 ELSE 0 END) as losses,
        SUM(CASE WHEN home_score = away_score THEN 1 ELSE 0 END) as draws
      FROM matches_v2
      WHERE (home_team_id = $1 OR away_team_id = $1)
        AND home_score IS NOT NULL
        AND away_score IS NOT NULL
        AND match_date >= $2
    `, [teamId, seasonStart]);

    const elo = eloEligible.rows[0];
    console.log(`ELO-eligible: ${elo.cnt} matches, ${elo.wins}W-${elo.losses}L-${elo.draws}D`);

    // Check teams_v2 stored values
    const stored = await client.query(`
      SELECT matches_played, wins, losses, draws FROM teams_v2 WHERE id = $1
    `, [teamId]);

    const s = stored.rows[0];
    console.log(`\nStored in teams_v2: ${s.matches_played} matches, ${s.wins}W-${s.losses}L-${s.draws}D`);

    console.log("\n\n⚠️  DISCREPANCY ANALYSIS:");

    if (parseInt(elo.cnt) !== s.matches_played) {
      console.log(`   ELO-eligible (${elo.cnt}) != stored (${s.matches_played})`);
      console.log("   -> This means the ELO script has a bug OR hasn't run recently");
      console.log("   -> Or there are DUPLICATE team entries affecting the count");
    }

    // Check for duplicate teams with similar name
    console.log("\n\nCHECKING FOR DUPLICATE/VARIANT TEAM ENTRIES:");
    const variants = await client.query(`
      SELECT id, display_name, matches_played, wins, losses, draws
      FROM teams_v2
      WHERE display_name ILIKE '%Sporting%BV%Pre-NAL%15%'
        OR display_name ILIKE '%SBV%Pre-NAL%15%'
        OR (canonical_name ILIKE '%Sporting%Pre-NAL%15%' AND birth_year = 2015)
      ORDER BY matches_played DESC
    `);

    variants.rows.forEach(v => {
      const isCurrent = v.id === teamId ? ' <-- THIS ONE' : '';
      console.log(`   ${v.id.substring(0, 8)}... | ${v.display_name.substring(0, 60)} | ${v.matches_played}mp ${v.wins}W-${v.losses}L-${v.draws}D${isCurrent}`);
    });

    // Check if any matches belong to a VARIANT team ID
    console.log("\n\nCHECKING MATCHES BY TEAM VARIANT:");
    for (const v of variants.rows) {
      const matchCount = await client.query(`
        SELECT COUNT(*) as cnt
        FROM matches_v2
        WHERE (home_team_id = $1 OR away_team_id = $1)
          AND home_score IS NOT NULL
          AND away_score IS NOT NULL
      `, [v.id]);
      console.log(`   ${v.id.substring(0, 8)}... | ${matchCount.rows[0].cnt} matches | ${v.display_name.substring(0, 50)}`);
    }

  } finally {
    client.release();
    await pool.end();
  }
}

audit().catch(console.error);
