/**
 * Probe SportsAffinity for standings pages
 * Tests various possible standings URLs on the GA Soccer Fall 2025 event
 */
const https = require('https');

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      }
    };
    const client = url.startsWith('https') ? https : require('http');
    client.get(url, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        console.log(`  Redirect ${res.statusCode} -> ${res.headers.location}`);
        return resolve({ statusCode: res.statusCode, body: '', redirect: res.headers.location });
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  const subdomain = 'gs-fall25gplacadathclrias';
  const tournamentGuid = 'E7A6731D-D5FF-41B4-9C3C-300ECEE69150';
  const baseUrl = `https://${subdomain}.sportsaffinity.com/tour/public/info`;

  // First, get a flight GUID from the accepted list
  console.log('=== FETCHING ACCEPTED LIST FOR FLIGHT GUIDS ===');
  const acceptedUrl = `${baseUrl}/accepted_list.asp?sessionguid=&tournamentguid=${tournamentGuid}`;
  const { statusCode: accStatus, body: accBody } = await fetchPage(acceptedUrl);
  console.log('Status:', accStatus, 'Body length:', accBody.length);

  // Extract first flight GUID
  const flightMatch = accBody.match(/flightguid=([A-F0-9-]+)/i);
  const firstFlightGuid = flightMatch ? flightMatch[1] : null;
  console.log('First flight GUID:', firstFlightGuid);

  // Probe various possible standings URLs
  const urlsToTest = [
    `${baseUrl}/standings.asp?sessionguid=&tournamentguid=${tournamentGuid}`,
    `${baseUrl}/flight_standings.asp?sessionguid=&tournamentguid=${tournamentGuid}`,
    `${baseUrl}/flight_standings.asp?sessionguid=&tournamentguid=${tournamentGuid}&flightguid=${firstFlightGuid}`,
    `${baseUrl}/standings2.asp?sessionguid=&tournamentguid=${tournamentGuid}`,
    `${baseUrl}/standings_print.asp?sessionguid=&tournamentguid=${tournamentGuid}`,
    `${baseUrl}/pool_standings.asp?sessionguid=&tournamentguid=${tournamentGuid}`,
    `${baseUrl}/pool_standings.asp?sessionguid=&flightguid=${firstFlightGuid}&tournamentguid=${tournamentGuid}`,
    `${baseUrl}/bracket.asp?sessionguid=&tournamentguid=${tournamentGuid}`,
    `${baseUrl}/results.asp?sessionguid=&tournamentguid=${tournamentGuid}`,
    `${baseUrl}/schedule_results2.asp?sessionguid=&flightguid=${firstFlightGuid}&tournamentguid=${tournamentGuid}`,
  ];

  for (const url of urlsToTest) {
    const shortUrl = url.replace(baseUrl, '...');
    try {
      const { statusCode, body, redirect } = await fetchPage(url);
      const hasTable = body.includes('<table');
      const hasStandings = /standings|W-L-D|record|points|GP|played/i.test(body);
      const bodyLen = body.length;

      console.log(`\n${shortUrl}`);
      console.log(`  Status: ${statusCode}, Size: ${bodyLen}, Tables: ${hasTable}, Standings: ${hasStandings}`);
      if (redirect) console.log(`  Redirect to: ${redirect}`);

      // If it has standings keywords, show a snippet
      if (hasStandings && bodyLen > 100) {
        // Find standings table
        const standingsIdx = body.search(/standings|W-L-D|record|points/i);
        if (standingsIdx > -1) {
          const snippet = body.substring(Math.max(0, standingsIdx - 200), standingsIdx + 500)
            .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
          console.log(`  Snippet: ${snippet.substring(0, 300)}`);
        }
      }
    } catch (err) {
      console.log(`\n${shortUrl}`);
      console.log(`  Error: ${err.message}`);
    }
  }

  // Also check the schedule_results2 page for embedded standings
  if (firstFlightGuid) {
    console.log('\n=== CHECKING SCHEDULE PAGE FOR STANDINGS ===');
    const schedUrl = `${baseUrl}/schedule_results2.asp?sessionguid=&flightguid=${firstFlightGuid}&tournamentguid=${tournamentGuid}`;
    const { body: schedBody } = await fetchPage(schedUrl);

    // Look for W-L-D record patterns
    const recordRegex = /(\d+-\d+-\d+)/g;
    const records = [];
    let m;
    while ((m = recordRegex.exec(schedBody)) !== null) {
      if (!records.includes(m[1])) records.push(m[1]);
      if (records.length > 10) break;
    }
    console.log('W-L-D records found:', records);

    // Look for "standings" keyword
    const standingsIdx = schedBody.toLowerCase().indexOf('standings');
    if (standingsIdx > -1) {
      console.log('Found "standings" at index:', standingsIdx);
      const snippet = schedBody.substring(Math.max(0, standingsIdx - 100), standingsIdx + 300)
        .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
      console.log('Context:', snippet.substring(0, 300));
    }

    // Look for GP/W/L/D/GF/GA column headers
    const headerRegex = /<t[hd][^>]*>(GP|W|L|D|GF|GA|PTS|Pts|Record|Played)<\/t[hd]>/gi;
    const headers = [];
    while ((m = headerRegex.exec(schedBody)) !== null) {
      headers.push(m[1]);
    }
    console.log('Standings headers found:', headers);
  }
}

main().catch(e => console.error(e));
