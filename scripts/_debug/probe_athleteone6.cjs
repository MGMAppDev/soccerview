/**
 * Probe AthleteOne Phase 6: Test API endpoint patterns with https module
 * No axios needed - use built-in https
 */
const https = require('https');

const EVENT_ID = 3979;
const FLIGHT_ID = 38917; // Girls G2008/2007 Flight A

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin': 'https://app.athleteone.com',
        'Referer': `https://app.athleteone.com/public/event/${EVENT_ID}/schedules-standings`,
        'Accept': 'application/json, text/plain, */*',
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function tryEndpoint(path) {
  const url = `https://api.athleteone.com/api/${path}`;
  try {
    const { status, body } = await get(url);
    if (status === 200) {
      try {
        const parsed = JSON.parse(body);
        if (parsed.data && (parsed.data.length > 0 || Object.keys(parsed.data).length > 0)) {
          return { hit: true, status, url, data: parsed.data };
        }
        return { hit: false, status, url, reason: 'empty data' };
      } catch {
        return { hit: status === 200, status, url, body: body.slice(0, 100) };
      }
    }
    return { hit: false, status, url };
  } catch (e) {
    return { hit: false, url, error: e.message };
  }
}

async function main() {
  console.log('Testing AthleteOne API endpoints for schedule/standings...');
  console.log(`EVENT_ID=${EVENT_ID}, FLIGHT_ID=${FLIGHT_ID}\n`);

  const patterns = [
    // Schedule patterns
    `Schedule/GetPublicScheduleByFlightID/${FLIGHT_ID}`,
    `Schedule/GetPublicScheduleByFlightID?flightId=${FLIGHT_ID}`,
    `Schedule/GetPublicScheduleByFlightID?flightId=${FLIGHT_ID}&eventId=${EVENT_ID}`,
    `Schedule/get-public-schedule-by-flightId/${FLIGHT_ID}`,
    `Schedule/get-public-schedule-by-flightId?flightId=${FLIGHT_ID}&eventId=${EVENT_ID}`,
    `Event/GetPublicScheduleByFlightId/${EVENT_ID}/${FLIGHT_ID}`,
    `Event/get-public-schedule/${EVENT_ID}/${FLIGHT_ID}`,
    `Event/get-public-games-by-flight/${EVENT_ID}/${FLIGHT_ID}`,
    `Game/GetPublicScheduleByFlightID/${FLIGHT_ID}`,
    `Game/GetPublicScheduleByFlightId?flightId=${FLIGHT_ID}`,
    `Game/get-public-games/${EVENT_ID}/${FLIGHT_ID}`,
    `Game/get-games-by-flight/${FLIGHT_ID}`,
    `Schedule/get-public-event-schedule-by-flightId/${FLIGHT_ID}`,
    `Schedule/GetScheduleByFlightId/${FLIGHT_ID}`,
    `Match/GetPublicMatchesByFlightID/${FLIGHT_ID}`,
    `Match/GetPublicMatchesByFlight?flightId=${FLIGHT_ID}&eventId=${EVENT_ID}`,

    // Standings patterns
    `Standing/GetPublicStandingsByFlightID/${FLIGHT_ID}`,
    `Standing/GetPublicStandingsByFlightId?flightId=${FLIGHT_ID}`,
    `Standing/GetPublicStandingsByFlightId?flightId=${FLIGHT_ID}&eventId=${EVENT_ID}`,
    `Standing/get-public-standings-by-flightId/${FLIGHT_ID}`,
    `Standing/get-public-standings-by-flightId?flightId=${FLIGHT_ID}&eventId=${EVENT_ID}`,
    `Event/get-public-standings/${EVENT_ID}/${FLIGHT_ID}`,
    `Event/get-public-standings-by-flight/${EVENT_ID}/${FLIGHT_ID}`,
    `Standings/GetPublicStandingsByFlightID/${FLIGHT_ID}`,
    `Standings/get-public-standings/${EVENT_ID}/${FLIGHT_ID}`,
    `Team/GetPublicTeamStandingsByFlightID/${FLIGHT_ID}`,
    `Team/GetPublicTeamStandingsByFlight?flightId=${FLIGHT_ID}&eventId=${EVENT_ID}`,
  ];

  for (const p of patterns) {
    const result = await tryEndpoint(p);
    if (result.hit) {
      console.log(`✅ HIT [${result.status}]: ${result.url}`);
      const d = result.data;
      if (Array.isArray(d)) {
        console.log(`   Array[${d.length}] keys:`, d[0] ? Object.keys(d[0]).join(', ') : 'empty');
        if (d[0]) console.log('   Sample:', JSON.stringify(d[0]).slice(0, 400));
      } else if (d) {
        console.log('   Keys:', Object.keys(d).join(', '));
        console.log('   Sample:', JSON.stringify(d).slice(0, 400));
      }
    } else {
      console.log(`  ❌ [${result.status||result.error}]: ${p}`);
    }
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
