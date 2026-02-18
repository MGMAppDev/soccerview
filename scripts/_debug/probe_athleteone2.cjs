/**
 * Probe AthleteOne — Phase 2: Find schedule + standings endpoints
 * Click into a flight to intercept the API call
 */
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const EVENT_ID = 3979;
const FLIGHT_ID = 38917; // Girls G2008/2007 Flight A (has 6 teams, active schedule)

async function probe() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  // Directly hit the API endpoints with the known flight ID
  // No browser needed if these are REST APIs
  const axios = require('axios');

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Origin': 'https://app.athleteone.com',
    'Referer': `https://app.athleteone.com/public/event/${EVENT_ID}/schedules-standings`,
  };

  const baseApi = 'https://api.athleteone.com/api';

  // Try common schedule endpoint patterns
  const schedulePatterns = [
    `/Schedule/get-public-schedule-by-flightId/${EVENT_ID}/${FLIGHT_ID}`,
    `/Schedule/get-public-games-by-flightId/${EVENT_ID}/${FLIGHT_ID}`,
    `/Game/get-public-games/${EVENT_ID}/${FLIGHT_ID}`,
    `/Event/get-public-schedule-by-eventId-flightId/${EVENT_ID}/${FLIGHT_ID}`,
    `/Event/get-public-schedule/${EVENT_ID}?flightId=${FLIGHT_ID}`,
    `/Schedule/GetPublicScheduleByFlightID/${FLIGHT_ID}`,
    `/Schedule/GetPublicScheduleByFlightID?flightId=${FLIGHT_ID}&eventId=${EVENT_ID}`,
  ];

  const standingsPatterns = [
    `/Standing/get-public-standings-by-flightId/${EVENT_ID}/${FLIGHT_ID}`,
    `/Standings/get-public-standings/${EVENT_ID}/${FLIGHT_ID}`,
    `/Standing/GetPublicStandingsByFlightID/${FLIGHT_ID}`,
    `/Event/get-public-standings/${EVENT_ID}?flightId=${FLIGHT_ID}`,
    `/Standing/GetPublicStandingsByFlightID?flightId=${FLIGHT_ID}&eventId=${EVENT_ID}`,
  ];

  console.log('=== Testing schedule endpoints ===');
  const axios2 = require('axios');
  for (const path of schedulePatterns) {
    try {
      const res = await axios2.get(`${baseApi}${path}`, { headers, timeout: 5000 });
      const data = res.data;
      console.log(`✅ HIT: ${path}`);
      if (data.data) {
        const inner = data.data;
        if (Array.isArray(inner)) {
          console.log(`  -> Array[${inner.length}], keys:`, inner[0] ? Object.keys(inner[0]) : 'empty');
        } else {
          console.log(`  -> Object keys:`, Object.keys(inner));
        }
      } else {
        console.log(`  -> Keys:`, Object.keys(data));
      }
    } catch (e) {
      const status = e.response?.status;
      console.log(`❌ ${status||'ERR'}: ${path}`);
    }
  }

  console.log('\n=== Testing standings endpoints ===');
  for (const path of standingsPatterns) {
    try {
      const res = await axios2.get(`${baseApi}${path}`, { headers, timeout: 5000 });
      const data = res.data;
      console.log(`✅ HIT: ${path}`);
      if (data.data) {
        const inner = data.data;
        if (Array.isArray(inner)) {
          console.log(`  -> Array[${inner.length}], keys:`, inner[0] ? Object.keys(inner[0]) : 'empty');
          if (inner[0]) console.log('  Sample:', JSON.stringify(inner[0]).slice(0, 300));
        } else {
          console.log(`  -> Object keys:`, Object.keys(inner));
        }
      } else {
        console.log(`  -> Keys:`, Object.keys(data));
      }
    } catch (e) {
      const status = e.response?.status;
      console.log(`❌ ${status||'ERR'}: ${path}`);
    }
  }

  await browser.close();
  console.log('\nDone.');
}

probe().catch(e => { console.error('Error:', e.message); process.exit(1); });
