/**
 * Session 104: Quick probe of WI PlayMetrics league pages to check accessibility.
 * Uses fetch (not Puppeteer) to check if pages load.
 */

const BASE = 'https://playmetricssports.com';

const LEAGUES = [
  { id: 'maysa-fall-2025', leagueId: '1027-1519-e326860f', name: 'MAYSA Fall 2025' },
  { id: 'maysa-spring-2025', leagueId: '1027-1262-9af9ea75', name: 'MAYSA Spring 2025' },
  { id: 'east-central-fall-2025', leagueId: '1028-1508-d9de4618', name: 'East Central Fall 2025' },
  { id: 'east-central-spring-2025', leagueId: '1028-1245-87cf8b2e', name: 'East Central Spring 2025' },
  { id: 'cwsl-current', leagueId: '1033-1414-5115f522', name: 'Central WI Soccer League' },
];

async function main() {
  console.log('=== Probing WI PlayMetrics League Pages ===\n');

  for (const league of LEAGUES) {
    const url = `${BASE}/g/leagues/${league.leagueId}/league_view.html`;
    console.log(`${league.name}: ${url}`);

    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        redirect: 'follow',
      });

      console.log(`  HTTP ${response.status} (${response.statusText})`);
      const html = await response.text();
      console.log(`  HTML length: ${html.length} chars`);

      // Check if it contains division cards
      const hasDivisions = html.includes('league-divisions__grid__card');
      const hasContent = html.includes('division_view.html');
      const hasNoData = html.includes('No divisions') || html.includes('not found') || html.includes('404');

      console.log(`  Has divisions: ${hasDivisions}, Has links: ${hasContent}, Has error: ${hasNoData}`);

      // Extract title if present
      const titleMatch = html.match(/<title>([^<]+)<\/title>/);
      if (titleMatch) console.log(`  Title: ${titleMatch[1]}`);

      // Count division links
      const divMatches = html.match(/division_view\.html/g);
      console.log(`  Division links found: ${divMatches ? divMatches.length : 0}`);
    } catch (error) {
      console.log(`  ERROR: ${error.message}`);
    }
    console.log();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
