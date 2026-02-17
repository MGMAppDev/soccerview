/**
 * NCSL Complete Scraper - Session 103
 * ====================================
 * Discovers ALL NCSL division IDs, scrapes ALL matches, stages directly.
 * No coreScraper dependency - direct DB writes for reliability.
 *
 * Steps:
 * 1. Fetch a known NCSL division page HTML
 * 2. Extract ALL division IDs from the page's JavaScript
 * 3. Fetch .js JSON endpoint for each division
 * 4. Parse matches and INSERT into staging_games
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const ORG_ID = '80738';
const SEASONS = [
  { name: 'Fall2025', key: '115189101', label: 'NCSL Travel Fall 2025' },
  { name: 'Spring2025', key: '114346054', label: 'NCSL Travel Spring 2025' },
];
const BASE_URL = 'https://elements.demosphere-secure.com';
const SOURCE_PLATFORM = 'demosphere';

// Month map for parsing "14-SEP-2025" dates
const MONTH_MAP = {
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12'
};

function parseDate(dateStr) {
  if (!dateStr) return null;
  const m = dateStr.match(/(\d+)-([A-Z]{3})-(\d{4})/i);
  if (!m) return null;
  const month = MONTH_MAP[m[2].toUpperCase()];
  if (!month) return null;
  return `${m[3]}-${month}-${m[1].padStart(2, '0')}`;
}

function parseTime(timStr) {
  if (!timStr) return null;
  const m = timStr.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

function parseScore(sc) {
  if (sc === null || sc === undefined || sc === '') return null;
  const n = parseInt(sc);
  return isNaN(n) ? null : n;
}

async function fetchJSON(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': '*/*',
    }
  });
  if (!response.ok) return null;
  const text = await response.text();
  try { return JSON.parse(text); } catch { return null; }
}

async function fetchHTML(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,*/*',
    }
  });
  if (!response.ok) return null;
  return await response.text();
}

async function discoverDivisions(seasonName) {
  console.log(`\nDiscovering divisions for ${seasonName}...`);

  // Strategy: Fetch a known division page and extract ALL division IDs
  // from the page's JavaScript navigation (they list all sibling divisions)
  const knownDivId = '115189283'; // GU16 Division 3 (verified working)
  const url = `${BASE_URL}/${ORG_ID}/schedules/${seasonName}/${knownDivId}.html`;

  const html = await fetchHTML(url);
  if (!html) {
    console.log(`  Could not fetch ${url}`);
    // Try alternate: scrape the schedule index from OttoSport
    return await discoverDivisionsFromJS(seasonName);
  }

  // Extract division IDs from the HTML
  // Demosphere pages contain links like: /80738/schedules/Fall2025/115189216.html
  const divisionPattern = new RegExp(
    `/${ORG_ID}/schedules/${seasonName}/(\\d+(?:\\.\\d+)?)\\.html`,
    'g'
  );

  const divisions = new Set();
  let match;
  while ((match = divisionPattern.exec(html)) !== null) {
    divisions.add(match[1]);
  }

  // Also look for division IDs in JavaScript arrays/objects
  const jsPattern = /["'](\d{9,})["']/g;
  while ((match = jsPattern.exec(html)) !== null) {
    // Only add IDs that look like Demosphere division keys (9+ digits)
    divisions.add(match[1]);
  }

  console.log(`  Found ${divisions.size} division IDs from HTML`);
  return Array.from(divisions);
}

async function discoverDivisionsFromJS(seasonName) {
  // Fallback: Try to find divisions by brute-force checking sequential IDs
  // around the known ID range
  console.log(`  Trying JS-based discovery...`);

  // The known Fall2025 division is 115189283
  // Try a range around it
  const baseId = 115189000;
  const divisions = [];

  for (let offset = 0; offset <= 500; offset += 50) {
    const testId = (baseId + offset).toString();
    const url = `${BASE_URL}/${ORG_ID}/schedules/${seasonName}/${testId}.js`;
    try {
      const response = await fetch(url, { method: 'HEAD' });
      if (response.ok) {
        divisions.push(testId);
      }
    } catch { /* skip */ }
  }

  console.log(`  Found ${divisions.length} divisions via probing`);
  return divisions;
}

async function scrapeSeason(season) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`SCRAPING: ${season.label}`);
  console.log(`Season: ${season.name}, Key: ${season.key}`);
  console.log(`${'='.repeat(60)}`);

  // Step 1: Discover ALL division IDs
  const divisionIds = await discoverDivisions(season.name);
  if (divisionIds.length === 0) {
    console.log(`  No divisions found for ${season.name} - skipping`);
    return { matches: 0, divisions: 0 };
  }

  console.log(`\nScraping ${divisionIds.length} divisions...`);

  let totalMatches = 0;
  let totalStaged = 0;
  let divisionCount = 0;

  for (let i = 0; i < divisionIds.length; i++) {
    const divId = divisionIds[i];
    const url = `${BASE_URL}/${ORG_ID}/schedules/${season.name}/${divId}.js`;

    // Rate limit
    if (i > 0) await new Promise(r => setTimeout(r, 600));

    const jsonData = await fetchJSON(url);
    if (!jsonData) {
      // Not a valid division - skip silently
      continue;
    }

    const matchIds = Object.keys(jsonData);
    if (matchIds.length === 0) continue;

    divisionCount++;
    totalMatches += matchIds.length;

    // Parse matches and prepare for staging
    const batch = [];
    for (const matchId of matchIds) {
      const md = jsonData[matchId];

      const matchDate = parseDate(md.dt);
      if (!matchDate) continue;

      const matchTime = parseTime(md.tim);
      const homeScore = parseScore(md.sc1);
      const awayScore = parseScore(md.sc2);

      if (!md.tm1 || !md.tm2 || md.tm1 === md.tm2) continue;

      const sourceMatchKey = `demosphere-${ORG_ID}-${season.name}-${matchId}`;

      batch.push({
        match_date: matchDate,
        match_time: matchTime,
        home_team_name: `DEMOSPHERE_TEAM_${md.tm1}`,
        away_team_name: `DEMOSPHERE_TEAM_${md.tm2}`,
        home_score: homeScore,
        away_score: awayScore,
        event_name: season.label,
        event_id: `${ORG_ID}-${season.name.toLowerCase()}`,
        venue_name: md.facn || null,
        division: divId,
        source_platform: SOURCE_PLATFORM,
        source_match_key: sourceMatchKey,
        raw_data: JSON.stringify({
          source_home_team_id: md.tm1,
          source_away_team_id: md.tm2,
          demosphere_match_id: matchId,
          demosphere_game_code: md.code,
          division_id: divId,
          season_key: season.key,
          org_id: ORG_ID,
        }),
      });
    }

    // Insert batch into staging_games
    if (batch.length > 0) {
      try {
        const cols = [
          'match_date', 'match_time', 'home_team_name', 'away_team_name',
          'home_score', 'away_score', 'event_name', 'event_id',
          'venue_name', 'division', 'source_platform', 'source_match_key',
          'raw_data', 'processed'
        ];

        const values = [];
        const placeholders = batch.map((row, idx) => {
          const base = idx * cols.length;
          values.push(
            row.match_date, row.match_time, row.home_team_name, row.away_team_name,
            row.home_score, row.away_score, row.event_name, row.event_id,
            row.venue_name, row.division, row.source_platform, row.source_match_key,
            row.raw_data, false
          );
          return `(${cols.map((_, j) => `$${base + j + 1}`).join(', ')})`;
        });

        const sql = `
          INSERT INTO staging_games (${cols.join(', ')})
          VALUES ${placeholders.join(', ')}
          ON CONFLICT (source_match_key) DO NOTHING
        `;

        const result = await pool.query(sql, values);
        totalStaged += result.rowCount;
      } catch (err) {
        console.log(`  DB ERROR for div ${divId}: ${err.message}`);
      }
    }

    if (divisionCount % 10 === 0) {
      console.log(`  Progress: ${divisionCount} divisions, ${totalMatches} matches found, ${totalStaged} staged`);
    }
  }

  console.log(`\n--- ${season.label} COMPLETE ---`);
  console.log(`  Divisions with data: ${divisionCount}`);
  console.log(`  Matches found: ${totalMatches}`);
  console.log(`  Matches staged: ${totalStaged}`);

  return { matches: totalStaged, divisions: divisionCount, found: totalMatches };
}

async function main() {
  console.log('NCSL Complete Scraper - Session 103');
  console.log('===================================\n');

  // Check current staging count
  const { rows: [before] } = await pool.query(
    "SELECT COUNT(*) as cnt FROM staging_games WHERE source_platform = 'demosphere'"
  );
  console.log(`Existing demosphere staging records: ${before.cnt}`);

  let grandTotalStaged = 0;
  let grandTotalFound = 0;
  let grandTotalDivisions = 0;

  for (const season of SEASONS) {
    try {
      const result = await scrapeSeason(season);
      grandTotalStaged += result.matches;
      grandTotalFound += result.found || 0;
      grandTotalDivisions += result.divisions;
    } catch (err) {
      console.log(`ERROR scraping ${season.label}: ${err.message}`);
    }
  }

  // Check final staging count
  const { rows: [after] } = await pool.query(
    "SELECT COUNT(*) as cnt FROM staging_games WHERE source_platform = 'demosphere'"
  );

  console.log(`\n${'='.repeat(60)}`);
  console.log('NCSL SCRAPE COMPLETE');
  console.log(`${'='.repeat(60)}`);
  console.log(`Total divisions scraped: ${grandTotalDivisions}`);
  console.log(`Total matches found: ${grandTotalFound}`);
  console.log(`Total matches staged: ${grandTotalStaged}`);
  console.log(`Demosphere staging records: ${before.cnt} → ${after.cnt} (+${after.cnt - before.cnt})`);

  await pool.end();
}

main().catch(err => {
  console.error('FATAL:', err);
  pool.end();
  process.exit(1);
});
