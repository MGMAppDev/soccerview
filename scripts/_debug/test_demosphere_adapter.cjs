/**
 * Test Demosphere Adapter - Verify JSON Parsing
 * ==============================================
 *
 * Quick test to verify the corrected adapter works with real API data.
 * Tests the actual JSON format: tm1/tm2, sc1/sc2, dt, tim, facn
 */

const fetch = require('node-fetch');

const TEST_URL = 'https://elements.demosphere-secure.com/80738/schedules/Fall2025/115189283.js';

async function testDemosphereAPI() {
  console.log('Testing Demosphere API...\n');
  console.log(`Fetching: ${TEST_URL}\n`);

  try {
    const response = await fetch(TEST_URL);

    if (!response.ok) {
      console.log(`ERROR: HTTP ${response.status} ${response.statusText}`);
      return;
    }

    const jsonText = await response.text();
    const jsonData = JSON.parse(jsonText);

    const matchIds = Object.keys(jsonData);
    console.log(`Found ${matchIds.length} matches in JSON\n`);

    // Show first 3 matches as examples
    const sampleCount = Math.min(3, matchIds.length);
    console.log(`Sample of first ${sampleCount} matches:\n`);

    for (let i = 0; i < sampleCount; i++) {
      const matchId = matchIds[i];
      const match = jsonData[matchId];

      console.log(`Match ID: ${matchId}`);
      console.log(`  Date: ${match.dt}`);
      console.log(`  Time: ${match.tim}`);
      console.log(`  Team 1 ID: ${match.tm1}`);
      console.log(`  Team 2 ID: ${match.tm2}`);
      console.log(`  Score 1: ${match.sc1 === "" ? "NULL (unplayed)" : match.sc1}`);
      console.log(`  Score 2: ${match.sc2 === "" ? "NULL (unplayed)" : match.sc2}`);
      console.log(`  Location: ${match.facn || "N/A"}`);
      console.log('');
    }

    // Parse time example
    const firstMatch = jsonData[matchIds[0]];
    if (firstMatch.tim) {
      const timeMatch = firstMatch.tim.match(/(\d{1,2}):(\d{2})/);
      if (timeMatch) {
        const hours = timeMatch[1].padStart(2, '0');
        const minutes = timeMatch[2];
        const parsedTime = `${hours}:${minutes}`;
        console.log(`Time parsing example: "${firstMatch.tim}" -> "${parsedTime}"\n`);
      }
    }

    // Count played vs unplayed
    let played = 0;
    let unplayed = 0;
    matchIds.forEach(id => {
      const m = jsonData[id];
      if (m.sc1 === "" || m.sc2 === "") {
        unplayed++;
      } else {
        played++;
      }
    });

    console.log(`Match Status:`);
    console.log(`  Played (scores): ${played}`);
    console.log(`  Unplayed (future): ${unplayed}`);

  } catch (error) {
    console.log(`ERROR: ${error.message}`);
    console.log(error.stack);
  }
}

testDemosphereAPI();
