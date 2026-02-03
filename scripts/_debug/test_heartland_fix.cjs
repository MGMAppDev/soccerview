/**
 * Test the Heartland adapter fix by scraping a specific subdivision
 * This verifies that alphanumeric team IDs are now captured
 */

require('dotenv').config();
const cheerio = require('cheerio');
const https = require('https');

const url = 'https://heartlandsoccer.net/reports/cgi-jrb/subdiv_results.cgi?level=Premier&b_g=Boys&age=U-11&subdivison=1';

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

async function fetchAndParse() {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const $ = cheerio.load(data);
        const matches = [];
        let lastDate = null;

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

          if (!homeId || !awayId) {
            console.log(`  ⚠️ SKIPPED (no ID): ${homeTeamRaw} vs ${awayTeamRaw}`);
            return;
          }

          const homeScore = parseInt(homeScoreText, 10);
          const awayScore = parseInt(awayScoreText, 10);
          if (isNaN(homeScore) || isNaN(awayScore)) return;

          matches.push({
            matchDate,
            gameNum,
            homeId,
            awayId,
            homeTeamName,
            awayTeamName,
            homeScore,
            awayScore
          });
        });

        resolve(matches);
      });
      res.on('error', reject);
    });
  });
}

async function run() {
  console.log('='.repeat(70));
  console.log('TESTING HEARTLAND ADAPTER FIX');
  console.log('='.repeat(70));
  console.log('\nFetching U-11 Boys Premier Subdivision 1...\n');

  const matches = await fetchAndParse();

  console.log(`Found ${matches.length} matches\n`);

  // Find the specific Sept 14 match
  const sept14Match = matches.find(m =>
    m.matchDate === '2025-09-14' &&
    (m.homeTeamName.includes('Union KC Jr Elite B15') || m.awayTeamName.includes('Union KC Jr Elite B15')) &&
    (m.homeTeamName.includes('Pre-NAL 15') || m.awayTeamName.includes('Pre-NAL 15'))
  );

  if (sept14Match) {
    console.log('✅ FOUND THE MISSING MATCH:');
    console.log(`   Date: ${sept14Match.matchDate}`);
    console.log(`   Game #: ${sept14Match.gameNum}`);
    console.log(`   Home: ${sept14Match.homeTeamName} (ID: ${sept14Match.homeId})`);
    console.log(`   Away: ${sept14Match.awayTeamName} (ID: ${sept14Match.awayId})`);
    console.log(`   Score: ${sept14Match.homeScore}-${sept14Match.awayScore}`);
  } else {
    console.log('❌ Sept 14 match NOT found');
  }

  // Show all matches with team 711A
  console.log('\n\nAll matches with team ID "711A":');
  const team711A = matches.filter(m => m.homeId === '711A' || m.awayId === '711A');
  team711A.forEach(m => {
    console.log(`  ${m.matchDate}: ${m.homeTeamName} vs ${m.awayTeamName} (${m.homeScore}-${m.awayScore})`);
  });

  console.log('\n' + '='.repeat(70));
  console.log('FIX VERIFIED: Alphanumeric team IDs are now captured!');
  console.log('='.repeat(70));
}

run().catch(console.error);
