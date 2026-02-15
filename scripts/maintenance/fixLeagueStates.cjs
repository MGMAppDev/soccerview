/**
 * fixLeagueStates.cjs
 *
 * Maps state codes to GotSport leagues with NULL state column.
 * Uses league name patterns to infer the correct state.
 *
 * Usage:
 *   node scripts/maintenance/fixLeagueStates.cjs --dry-run
 *   node scripts/maintenance/fixLeagueStates.cjs --execute
 */

require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const dryRun = !process.argv.includes('--execute');

// State inference rules: [pattern, state, description]
// Order matters: more specific patterns first
const STATE_RULES = [
  // California
  [/NorCal/i, 'CA', 'NorCal (Northern California)'],
  [/SOCAL/i, 'CA', 'SOCAL (Southern California)'],
  [/BPYSL/i, 'CA', 'BPYSL (Bay Area)'],
  [/CCSAI/i, 'CA', 'CCSAI (Central Coast)'],
  [/Cal North|Cal South|Inter-Regional League/i, 'CA', 'Cal North/South'],
  [/State Classic League.*SCL/i, 'CA', 'State Classic League'],
  [/CASA\b/i, 'CA', 'CASA (California)'],

  // Texas
  [/TCSL/i, 'TX', 'TCSL (Texas Classic Soccer League)'],
  [/Plano Premier/i, 'TX', 'Plano Premier (TX)'],
  [/SuperLeague of Austin/i, 'TX', 'SuperLeague of Austin (TX)'],
  [/CCSL/i, 'TX', 'CCSL (Texas)'],
  [/ARLINGTON PREMIER/i, 'TX', 'Arlington Premier (TX)'],

  // Washington
  [/WPL\b/i, 'WA', 'WPL (Washington Premier League)'],
  [/WSSL/i, 'WA', 'WSSL (Washington State Soccer League)'],

  // New York
  [/Hudson Valley/i, 'NY', 'Hudson Valley (NY)'],
  [/LIJSL/i, 'NY', 'LIJSL (Long Island)'],
  [/WYSL/i, 'NY', 'WYSL (Western NY Soccer League)'],
  [/CAYSA/i, 'NY', 'CAYSA (Capital Area Youth Soccer)'],
  [/Thruway League/i, 'NY', 'Thruway League (NY)'],

  // Ohio
  [/\bOPC\b/i, 'OH', 'OPC (Ohio Premier Cup)'],
  [/OSPL|COPL|OCL/i, 'OH', 'OSPL/COPL/OCL (Ohio)'],
  [/NWOYSL/i, 'OH', 'NWOYSL (Northwest Ohio)'],
  [/WDDOA/i, 'OH', 'WDDOA (Ohio)'],
  [/\bFCL\b.*(?:National Premier|Academy)/i, 'OH', 'FCL (Ohio)'],

  // New Jersey
  [/CJSL/i, 'NJ', 'CJSL (Central Jersey Soccer League)'],
  [/SJSL/i, 'NJ', 'SJSL (South Jersey Soccer League)'],
  [/PCJSL/i, 'NJ', 'PCJSL (NJ)'],
  [/Mid NJ/i, 'NJ', 'Mid NJ'],
  [/South Jersey/i, 'NJ', 'South Jersey'],
  [/CBYSA/i, 'NJ', 'CBYSA (Central Bergen Youth Soccer)'],
  [/NISL/i, 'NJ', 'NISL (NJ)'],

  // Pennsylvania
  [/APL.*Acela/i, 'PA', 'APL/Acela (PA)'],
  [/EPPL/i, 'PA', 'EPPL (Eastern PA Premier League)'],
  [/MaxinMotion/i, 'PA', 'MaxinMotion (PA)'],
  [/PSSLU/i, 'PA', 'PSSLU (Pittsburgh)'],

  // Colorado
  [/\bCLS\b/i, 'CO', 'CLS (Colorado League Soccer)'],

  // Connecticut
  [/\bCT\b.*(?:Championship|Zone|Academy)/i, 'CT', 'CT League'],

  // Minnesota
  [/MMYSL/i, 'MN', 'MMYSL (Minnesota)'],
  [/MSPSP/i, 'MN', 'MSPSP (Minnesota)'],

  // Florida
  [/\bSFPL\b/i, 'FL', 'SFPL (South Florida Premier League)'],
  [/SFUYSA/i, 'FL', 'SFUYSA (South Florida)'],
  [/Emerald Coast/i, 'FL', 'Emerald Coast (FL)'],
  [/\bESPL\b|ES Premier/i, 'FL', 'ESPL (East Side Premier League FL)'],

  // Florida (TFL = The Florida League, NOT Tennessee)
  [/\bTFL\b/i, 'FL', 'TFL (The Florida League)'],

  // Missouri
  [/SLYSA(?! IL)/i, 'MO', 'SLYSA (St. Louis)'],
  [/MOSA\b/i, 'MO', 'MOSA (Missouri)'],

  // Illinois
  [/SLYSA IL/i, 'IL', 'SLYSA IL Central Division'],

  // Arizona
  [/\bASA\b.*(?:Advanced|Academy)/i, 'AZ', 'ASA (Arizona Soccer Association)'],
  [/Southwest Super League/i, 'AZ', 'Southwest Super League (AZ)'],
  [/Desert Conference/i, 'AZ', 'Desert Conference (AZ)'],

  // Alabama
  [/Alabama State League/i, 'AL', 'Alabama State League'],

  // Vermont
  [/Vermont Soccer/i, 'VT', 'Vermont Soccer League'],

  // Georgia
  [/Rock Spring/i, 'GA', 'Rock Spring League (GA)'],

  // Idaho
  [/Idaho Premier|ISL.*Idaho|\bISL\b.*(?:Fall|Spring).*(?:11U|All Div)/i, 'ID', 'Idaho Soccer League'],
  [/Snake River/i, 'ID', 'Snake River (ID)'],

  // Montana
  [/Montana State/i, 'MT', 'Montana State League'],

  // New Hampshire
  [/New Hampshire/i, 'NH', 'New Hampshire Soccer League'],

  // Nevada
  [/LVYSL/i, 'NV', 'LVYSL (Las Vegas Youth Soccer League)'],

  // Virginia
  [/VPSL/i, 'VA', 'VPSL (Virginia Premier Soccer League)'],
  [/Piedmont Conference/i, 'VA', 'Piedmont Conference (VA)'],

  // South Carolina
  [/\bSCCL\b/i, 'SC', 'SCCL (South Carolina)'],

  // North Carolina
  [/CASL/i, 'NC', 'CASL (Capital Area Soccer League NC)'],
  [/NECSL/i, 'NC', 'NECSL (NC)'],

  // Louisiana
  [/LCSL/i, 'LA', 'LCSL (Louisiana)'],

  // Kansas
  [/\bKPL\b/i, 'KS', 'KPL (Kansas Premier League)'],

  // Indiana
  [/\bIYSA\b/i, 'IN', 'IYSA (Indiana Youth Soccer)'],

  // Michigan
  [/WMYSA/i, 'MI', 'WMYSA (West Michigan Youth Soccer)'],

  // Alaska
  [/AK Premier/i, 'AK', 'AK Premier Soccer League'],

  // Maine
  [/Pine Tree League/i, 'ME', 'Pine Tree League (ME)'],

  // Wisconsin
  [/\bWRSA\b/i, 'WI', 'WRSA (Wisconsin)'],

  // Inter-County (NJ)
  [/Inter-County Soccer/i, 'NJ', 'Inter-County Soccer League (NJ)'],

  // GBYSL - Greater Boston
  [/GBYSL/i, 'MA', 'GBYSL (Greater Boston)'],

  // GCFYSL - Greater Cincinnati
  [/GCFYSL/i, 'OH', 'GCFYSL (Greater Cincinnati)'],

  // Great Lakes Alliance
  [/Great Lakes Alliance/i, 'OH', 'Great Lakes Alliance (OH)'],

  // ACSL
  [/\bACSL\b/i, 'CT', 'ACSL (CT)'],

  // MSDSL
  [/MSDSL/i, 'MO', 'MSDSL (Missouri)'],

  // OPL
  [/\bOPL\b/i, 'OH', 'OPL (Ohio Premier League)'],

  // Northeast Soccer League
  [/Northeast Soccer League/i, 'NY', 'Northeast Soccer League (NY)'],

  // Yellowstone Conference
  [/Yellowstone/i, 'MT', 'Yellowstone Conference (MT)'],

  // Frontier
  [/Frontier/i, 'MT', 'Frontier (MT)'],
];

// Multi-state / national conference patterns (skip these)
const SKIP_PATTERNS = [
  /National League.*Conference/i,
  /Champions Conference/i,
  /Mid.?Atlantic Conference/i,
  /Mid South Conference/i,
  /New England Conference/i,
  /North Atlantic(?! Fall| Spring)/i,
  /South Atlantic Conference/i,
  /Northwest Conference/i,
  /National Academy League/i,
  /Northeast Academy League/i,
  /Regional Academy League/i,
  /Development Player League/i,
  /Red River NPL/i,
  /Mid-America Academy/i,
  /\bNL Team\b/i,
  /Mid-Atlantic Premier League/i,
  /NPL.*Central States/i,
  /NPL.*South Atlantic Premier/i,
  /NPL.*GSPL/i,
  /EDP League(?! FL)/i,
  /ELITE CLUBS ALLIANCE/i,
  /USA Soccer/i,
  /The Spot/i,
  /JPL Mountain West/i,
];

function inferState(name) {
  // Check if it's a multi-state/national pattern to skip
  for (const skip of SKIP_PATTERNS) {
    if (skip.test(name)) return { state: null, reason: 'SKIP: multi-state/national' };
  }

  // Check state rules
  for (const [pattern, state, desc] of STATE_RULES) {
    if (pattern.test(name)) return { state, reason: desc };
  }

  return { state: null, reason: 'UNKNOWN' };
}

async function main() {
  console.log(`\n=== Fix League States (${dryRun ? 'DRY RUN' : 'EXECUTE'}) ===\n`);

  const { rows: leagues } = await pool.query(
    'SELECT id, name, source_event_id FROM leagues WHERE state IS NULL ORDER BY name'
  );

  console.log(`Found ${leagues.length} leagues with NULL state\n`);

  const updates = [];
  const skipped = [];
  const unknown = [];

  for (const league of leagues) {
    const { state, reason } = inferState(league.name);
    if (state) {
      updates.push({ id: league.id, name: league.name, state, reason });
    } else if (reason.startsWith('SKIP')) {
      skipped.push({ name: league.name, reason });
    } else {
      unknown.push({ name: league.name, source_event_id: league.source_event_id });
    }
  }

  console.log(`Will update: ${updates.length}`);
  console.log(`Skipped (multi-state): ${skipped.length}`);
  console.log(`Unknown: ${unknown.length}\n`);

  // Show state summary
  const stateCounts = {};
  for (const u of updates) {
    stateCounts[u.state] = (stateCounts[u.state] || 0) + 1;
  }
  console.log('=== State Distribution ===');
  Object.entries(stateCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([state, count]) => console.log(`  ${state}: ${count} leagues`));

  if (unknown.length > 0) {
    console.log('\n=== Unknown Leagues ===');
    unknown.forEach(u => console.log(`  ${u.source_event_id} | ${u.name}`));
  }

  if (!dryRun && updates.length > 0) {
    console.log('\n=== Executing Updates ===');
    let updated = 0;
    for (const u of updates) {
      await pool.query('UPDATE leagues SET state = $1 WHERE id = $2', [u.state, u.id]);
      updated++;
    }
    console.log(`Updated ${updated} leagues with state codes.`);
  }

  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
