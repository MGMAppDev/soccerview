/**
 * Quick script to scrape and insert the missing Heartland matches
 * Uses the FIXED regex to capture alphanumeric team IDs like "711A"
 */

require('dotenv').config();
const cheerio = require('cheerio');
const https = require('https');
const pg = require('pg');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// Fixed regex functions
function extractTeamId(name) {
  if (!name) return null;
  const match = name.match(/^([A-Za-z0-9]+)\s+/);
  return match ? match[1] : null;
}

function normalizeTeamName(name) {
  if (!name) return "";
  const match = name.match(/^[A-Za-z0-9]+\s+(.+)$/);
  return match ? match[1].trim() : name.trim();
}

function parseDate(dateStr) {
  if (!dateStr || dateStr.trim() === "") return null;
  const months = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  };
  const match = dateStr.match(/([A-Za-z]+)\s+(\d+)/);
  if (!match) return null;
  const month = months[match[1]];
  const day = parseInt(match[2], 10);
  if (month === undefined || isNaN(day)) return null;
  const year = month >= 7 ? 2025 : 2026;
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

async function fetchPage(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });
  });
}

async function scrapeSubdivision(level, gender, age, subdiv) {
  const paramNames = level === 'Premier'
    ? { gender: 'b_g', age: 'age', subdiv: 'subdivison' }
    : { gender: 'b_g3', age: 'age1', subdiv: 'subdivison1' };

  const url = `https://heartlandsoccer.net/reports/cgi-jrb/subdiv_results.cgi?level=${level}&${paramNames.gender}=${gender}&${paramNames.age}=${encodeURIComponent(age)}&${paramNames.subdiv}=${subdiv}`;

  const html = await fetchPage(url);
  const $ = cheerio.load(html);

  if (html.includes('Select Subdivision Error') || html.includes('could not match')) {
    return [];
  }

  const matches = [];
  let lastDate = null;
  const normalizedAge = age.match(/U-?(\d+)/i)?.[1] ? `U${age.match(/U-?(\d+)/i)[1]}` : age;

  $("table tr").each((i, row) => {
    const cells = $(row).find("td");
    if (cells.length < 7) return;

    const dateCell = $(cells[0]).text().trim();
    const gameNum = $(cells[1]).text().trim();
    const time = $(cells[2]).text().trim();
    const homeTeamRaw = $(cells[3]).text().trim();
    const homeScoreText = $(cells[4]).text().trim();
    const awayTeamRaw = $(cells[5]).text().trim();
    const awayScoreText = $(cells[6]).text().trim();

    if (homeTeamRaw === "Home" || homeScoreText === "") return;

    const matchDate = dateCell ? parseDate(dateCell) : lastDate;
    if (dateCell && parseDate(dateCell)) lastDate = parseDate(dateCell);

    const homeId = extractTeamId(homeTeamRaw);
    const awayId = extractTeamId(awayTeamRaw);
    const homeTeamName = normalizeTeamName(homeTeamRaw);
    const awayTeamName = normalizeTeamName(awayTeamRaw);

    if (!homeId || !awayId) return;

    const homeScore = parseInt(homeScoreText, 10);
    const awayScore = parseInt(awayScoreText, 10);
    if (isNaN(homeScore) || isNaN(awayScore)) return;

    // Generate source_match_key
    const sourceMatchKey = `heartland-${level.toLowerCase()}-${homeId}-${awayId}-${matchDate}-${gameNum}`;

    matches.push({
      source_platform: 'heartland',
      source_match_key: sourceMatchKey,
      match_date: matchDate,
      match_time: time || null,
      home_team_name: homeTeamName,
      away_team_name: awayTeamName,
      home_score: homeScore,
      away_score: awayScore,
      event_name: `Heartland ${level} League 2026`,
      division: `${normalizedAge} ${gender}`,
      processed: false,
      raw_data: {
        heartland_subdivision: subdiv,
        level: level.toLowerCase(),
        gameNum: gameNum,
        homeId: homeId,
        awayId: awayId
      }
    });
  });

  return matches;
}

async function upsertMatches(client, matches) {
  let inserted = 0;
  let skipped = 0;

  for (const match of matches) {
    try {
      // First check if match already exists
      const existing = await client.query(`
        SELECT id FROM staging_games
        WHERE source_match_key = $1
      `, [match.source_match_key]);

      if (existing.rows.length > 0) {
        skipped++;
        continue;
      }

      // Insert new match
      await client.query(`
        INSERT INTO staging_games (
          source_platform, source_match_key, match_date, match_time,
          home_team_name, away_team_name, home_score, away_score,
          event_name, division, processed, raw_data, scraped_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
      `, [
        match.source_platform,
        match.source_match_key,
        match.match_date,
        match.match_time,
        match.home_team_name,
        match.away_team_name,
        match.home_score,
        match.away_score,
        match.event_name,
        match.division,
        match.processed,
        JSON.stringify(match.raw_data)
      ]);

      inserted++;
    } catch (e) {
      console.error(`  Error inserting match: ${e.message}`);
    }
  }

  return { inserted, skipped };
}

async function run() {
  const client = await pool.connect();

  try {
    console.log('='.repeat(70));
    console.log('SCRAPING HEARTLAND WITH FIXED ALPHANUMERIC ID SUPPORT');
    console.log('='.repeat(70));

    // Scrape the subdivisions that had the missing data
    const subdivisions = [
      { level: 'Premier', gender: 'Boys', age: 'U-11', subdivs: ['1', '2', '3', '4', '5', '6', '7', '8', '9'] }
    ];

    let totalInserted = 0;
    let totalUpdated = 0;
    let totalMatches = 0;

    for (const config of subdivisions) {
      console.log(`\nProcessing ${config.gender} ${config.age} ${config.level}...`);

      for (const subdiv of config.subdivs) {
        process.stdout.write(`  Subdivision ${subdiv}... `);

        const matches = await scrapeSubdivision(config.level, config.gender, config.age, subdiv);
        totalMatches += matches.length;

        if (matches.length > 0) {
          const { inserted, skipped } = await upsertMatches(client, matches);
          totalInserted += inserted;
          totalUpdated += skipped;
          console.log(`${matches.length} matches (${inserted} new, ${skipped} existing)`);
        } else {
          console.log('no matches');
        }

        // Rate limiting
        await new Promise(r => setTimeout(r, 500));
      }
    }

    console.log('\n' + '='.repeat(70));
    console.log('SCRAPE COMPLETE');
    console.log('='.repeat(70));
    console.log(`Total matches scraped: ${totalMatches}`);
    console.log(`New matches inserted: ${totalInserted}`);
    console.log(`Existing matches updated: ${totalUpdated}`);

    // Verify the specific match was captured
    console.log('\n📋 Verifying Sept 14 match...');
    const { rows } = await client.query(`
      SELECT
        home_team_name,
        away_team_name,
        home_score,
        away_score,
        match_date
      FROM staging_games
      WHERE source_platform = 'heartland'
        AND match_date::text LIKE '2025-09-14%'
        AND (
          (home_team_name ILIKE '%union kc%elite%b15%' AND away_team_name ILIKE '%pre-nal%15%')
          OR (away_team_name ILIKE '%union kc%elite%b15%' AND home_team_name ILIKE '%pre-nal%15%')
        )
    `);

    if (rows.length > 0) {
      console.log('✅ MISSING MATCH NOW IN STAGING:');
      rows.forEach(r => {
        console.log(`   ${r.match_date}: ${r.home_team_name} vs ${r.away_team_name} (${r.home_score}-${r.away_score})`);
      });
    } else {
      console.log('❌ Match still not found');
    }

  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(console.error);
