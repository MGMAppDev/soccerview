/**
 * discoverGotSportEvents.js
 *
 * PHASE 2: GotSport Event Discovery for Daily Sync
 *
 * Purpose:
 * - Analyze orphan teams to identify coverage gaps
 * - Add known major events we're not scraping
 * - Track event discovery needs over time
 *
 * The orphan problem (51K teams with GS rank but no matches) is a COVERAGE GAP:
 * - These teams play in GotSport events we don't scrape
 * - GotSport Rankings API gives us team names but NOT event IDs
 * - We need to expand our event coverage to capture their matches
 *
 * Strategy:
 * 1. Analyze orphan patterns to identify which leagues/events we're missing
 * 2. Maintain a list of known major events to add
 * 3. Track progress over time
 *
 * V2 ARCHITECTURE COMPLIANCE:
 * - Uses pg Pool for bulk operations
 * - Writes only to leagues/tournaments tables (not protected)
 * - Data flows through normal scraper → staging → pipeline
 *
 * Usage:
 *   node scripts/daily/discoverGotSportEvents.js --report     # Analyze orphans
 *   node scripts/daily/discoverGotSportEvents.js --add-known  # Add known missing events
 *
 * Session 82 - February 3, 2026
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  statement_timeout: 120000
});

const REPORT_MODE = process.argv.includes('--report');
const ADD_KNOWN = process.argv.includes('--add-known');

// Known major GotSport events we should be scraping
// These are national-level leagues/tournaments with significant participation
// Event IDs can be found from GotSport URLs: /events/{id}/schedules
const KNOWN_MISSING_EVENTS = [
  // ECNL - Elite Clubs National League (Boys & Girls)
  // { id: 'TODO', name: 'ECNL Boys 2025-26', type: 'league', platform: 'gotsport' },
  // { id: 'TODO', name: 'ECNL Girls 2025-26', type: 'league', platform: 'gotsport' },

  // MLS NEXT - Major League Soccer youth development
  // { id: 'TODO', name: 'MLS NEXT 2025-26', type: 'league', platform: 'gotsport' },

  // GA Cup - Girls Academy Cup
  // { id: 'TODO', name: 'GA Cup 2026', type: 'tournament', platform: 'gotsport' },

  // NOTE: Event IDs need to be discovered from GotSport website
  // Search for events at: https://system.gotsport.com/events
  // The ID is in the URL: /events/{id}/schedules
];

async function analyzeOrphanPatterns(client) {
  console.log('='.repeat(70));
  console.log('ORPHAN TEAM ANALYSIS');
  console.log('='.repeat(70));
  console.log('');

  // Count orphans by pattern
  const { rows: patterns } = await client.query(`
    SELECT
      CASE
        WHEN display_name ILIKE '%ECNL%' THEN 'ECNL'
        WHEN display_name ILIKE '%MLS NEXT%' OR display_name ILIKE '%MLS Next%' THEN 'MLS NEXT'
        WHEN display_name ILIKE '%Elite NL%' OR display_name ILIKE '%ENL%' THEN 'Elite NL'
        WHEN display_name ILIKE '%GA Cup%' OR display_name ILIKE '%Girls Academy%' THEN 'GA / Girls Academy'
        WHEN display_name ILIKE '%NAL%' OR display_name ILIKE '%National League%' THEN 'NAL'
        WHEN display_name ILIKE '%Pre-MLS%' OR display_name ILIKE '%PreMLS%' OR display_name ILIKE '%PRE MLS%' THEN 'Pre-MLS'
        WHEN display_name ILIKE '%Premier%' THEN 'Premier League'
        WHEN display_name ILIKE '%Select%' THEN 'Select League'
        WHEN display_name ILIKE '%Classic%' THEN 'Classic'
        WHEN display_name ILIKE '%NPL%' THEN 'NPL'
        WHEN display_name ILIKE '%Regional%' THEN 'Regional'
        WHEN display_name ILIKE '%State%' THEN 'State League'
        ELSE 'Other/Local'
      END as event_type,
      COUNT(*) as orphan_count,
      ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER(), 1) as pct
    FROM teams_v2
    WHERE national_rank IS NOT NULL AND matches_played = 0
    GROUP BY 1
    ORDER BY 2 DESC
  `);

  console.log('Orphan Teams by Event Type Pattern:');
  console.log('');
  console.log('| Event Type | Orphan Count | % of Total |');
  console.log('|------------|--------------|------------|');
  let total = 0;
  for (const p of patterns) {
    console.log(`| ${p.event_type.padEnd(18)} | ${p.orphan_count.toString().padStart(12)} | ${p.pct.toString().padStart(9)}% |`);
    total += parseInt(p.orphan_count);
  }
  console.log('');
  console.log(`Total orphan teams: ${total.toLocaleString()}`);

  // State breakdown for top orphan patterns
  console.log('');
  console.log('Top States with ECNL/MLS NEXT Orphans:');
  const { rows: states } = await client.query(`
    SELECT
      COALESCE(state, 'Unknown') as state,
      COUNT(*) as cnt
    FROM teams_v2
    WHERE national_rank IS NOT NULL
      AND matches_played = 0
      AND (display_name ILIKE '%ECNL%' OR display_name ILIKE '%MLS NEXT%')
    GROUP BY 1
    ORDER BY 2 DESC
    LIMIT 10
  `);
  states.forEach(s => console.log(`  ${s.state}: ${s.cnt} teams`));

  // Coverage comparison
  console.log('');
  console.log('Coverage Summary:');
  const { rows: coverage } = await client.query(`
    SELECT
      COUNT(*) as total_gs_ranked,
      COUNT(*) FILTER (WHERE matches_played > 0) as with_matches,
      COUNT(*) FILTER (WHERE matches_played = 0) as orphans
    FROM teams_v2
    WHERE national_rank IS NOT NULL
  `);
  const c = coverage[0];
  const coverageRate = (100 * c.with_matches / c.total_gs_ranked).toFixed(1);
  console.log(`  Total GS-ranked teams: ${parseInt(c.total_gs_ranked).toLocaleString()}`);
  console.log(`  Teams with matches: ${parseInt(c.with_matches).toLocaleString()} (${coverageRate}%)`);
  console.log(`  Orphan teams: ${parseInt(c.orphans).toLocaleString()} (${(100 - coverageRate).toFixed(1)}%)`);

  return { patterns, total };
}

async function addKnownEvents(client) {
  console.log('');
  console.log('='.repeat(70));
  console.log('ADDING KNOWN MISSING EVENTS');
  console.log('='.repeat(70));
  console.log('');

  if (KNOWN_MISSING_EVENTS.length === 0) {
    console.log('No events configured in KNOWN_MISSING_EVENTS.');
    console.log('');
    console.log('To add events:');
    console.log('1. Find the event on GotSport: https://system.gotsport.com/events');
    console.log('2. Get the event ID from the URL: /events/{id}/schedules');
    console.log('3. Add to KNOWN_MISSING_EVENTS array in this script');
    console.log('4. Run: node scripts/daily/discoverGotSportEvents.js --add-known');
    return 0;
  }

  let added = 0;
  for (const event of KNOWN_MISSING_EVENTS) {
    const table = event.type === 'league' ? 'leagues' : 'tournaments';

    // Check if already exists
    const { rows: existing } = await client.query(`
      SELECT id FROM ${table} WHERE source_event_id = $1
    `, [event.id]);

    if (existing.length > 0) {
      console.log(`  [SKIP] ${event.name} - already exists`);
      continue;
    }

    // Insert new event
    if (event.type === 'league') {
      await client.query(`
        INSERT INTO leagues (name, source_platform, source_event_id)
        VALUES ($1, $2, $3)
      `, [event.name, event.platform, event.id]);
    } else {
      await client.query(`
        INSERT INTO tournaments (name, source_platform, source_event_id, start_date, end_date)
        VALUES ($1, $2, $3, CURRENT_DATE, CURRENT_DATE + INTERVAL '1 year')
      `, [event.name, event.platform, event.id]);
    }

    console.log(`  [ADDED] ${event.name} (${event.type}, ID: ${event.id})`);
    added++;
  }

  console.log('');
  console.log(`Added ${added} new events.`);
  console.log('');
  console.log('Next: Run the GotSport scraper to fetch matches for these events:');
  console.log('  node scripts/universal/coreScraper.js --adapter gotsport --active-only');

  return added;
}

async function generateDiscoveryRecommendations(client) {
  console.log('');
  console.log('='.repeat(70));
  console.log('RECOMMENDATIONS');
  console.log('='.repeat(70));
  console.log('');

  console.log('To reduce orphan rate, consider adding these event types:');
  console.log('');
  console.log('1. ECNL (3,910 orphans) - Elite Clubs National League');
  console.log('   - Major US youth league, boys and girls');
  console.log('   - Find at: https://system.gotsport.com (search "ECNL")');
  console.log('');
  console.log('2. MLS NEXT (744 orphans) - MLS Youth Development');
  console.log('   - Professional pathway league');
  console.log('   - Find at: https://system.gotsport.com (search "MLS NEXT")');
  console.log('');
  console.log('3. State Leagues - Expand regional coverage');
  console.log('   - Focus on high-orphan states: FL, CA, TX, GA');
  console.log('');
  console.log('To add an event:');
  console.log('  1. Find the event ID from GotSport URL');
  console.log('  2. Add to KNOWN_MISSING_EVENTS in this script');
  console.log('  3. Run: node scripts/daily/discoverGotSportEvents.js --add-known');
}

async function main() {
  console.log('');
  console.log('GotSport Event Discovery - Phase 2');
  console.log('Date:', new Date().toISOString().split('T')[0]);
  console.log('');

  if (!REPORT_MODE && !ADD_KNOWN) {
    console.log('Usage:');
    console.log('  --report     Analyze orphan patterns and coverage gaps');
    console.log('  --add-known  Add known missing events to database');
    console.log('');
    process.exit(0);
  }

  const client = await pool.connect();

  try {
    if (REPORT_MODE) {
      await analyzeOrphanPatterns(client);
      await generateDiscoveryRecommendations(client);
    }

    if (ADD_KNOWN) {
      await addKnownEvents(client);
    }

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
