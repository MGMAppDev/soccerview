/**
 * fixGenericEventNames.cjs - Fix generic tournament/league names
 *
 * Root Cause: Multiple code paths created tournaments with fallback generic names
 * like "HTGSports Event 12093" or "GotSport Event 39064" when event_name was NULL.
 * The daily scraper reads event names FROM the DB (circular), so generic names persist.
 *
 * Scope: ALL sources (HTGSports, GotSport, Heartland) — universal fix
 *
 * Name Resolution Priority (4 sources):
 *   1. Adapter static event lists (HTGSports hardcoded ID→name)
 *   2. staging_games.event_name (most recent non-generic)
 *   3. canonical_events.canonical_name
 *   4. GotSport web page embedded JSON (full event name from source)
 *
 * Usage:
 *   node scripts/maintenance/fixGenericEventNames.cjs --dry-run
 *   node scripts/maintenance/fixGenericEventNames.cjs --execute
 *   node scripts/maintenance/fixGenericEventNames.cjs --dry-run --skip-web
 */

require('dotenv').config();
const { Pool } = require('pg');
const cheerio = require('cheerio');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const execute = args.includes('--execute');
const skipWeb = args.includes('--skip-web');

if (!dryRun && !execute) {
  console.log('Usage: node fixGenericEventNames.cjs [--dry-run | --execute] [--skip-web]');
  process.exit(1);
}

// ============================================================
// ADAPTER STATIC EVENT LISTS (Source of truth for known events)
// Imported from scripts/adapters/htgsports.js staticEvents
// ============================================================
const HTG_STATIC_EVENTS = new Map([
  // Season 25-26
  ['14130', '2026 Heartland Invitational - Boys'],
  ['14129', '2026 Heartland Invitational - Girls'],
  ['14126', '2026 Heartland Midwest Classic'],
  ['13516', '2026 Heartland Spring Cup'],
  ['13514', '2026 Border Battle Soccer Tournament'],
  ['13444', 'KC Fall Finale 2025'],
  ['13437', 'Challenger Sports Invitational 2025'],
  ['13418', 'Sporting Classic 2025'],
  ['13371', '2025 Sporting Iowa Fall Cup'],
  ['13014', '2025 Heartland Invitational - Boys'],
  ['13008', '2025 Heartland Open Cup'],
  ['12849', '2025 Kansas City Invitational'],
  ['12847', '2025 KC Champions Cup'],
  // Season 24-25
  ['12922', 'Omaha Evolution Invitational'],
  ['12846', '2025 Heartland Spring Cup'],
  ['12844', '2025 Border Battle'],
  ['12653', 'Champions Cup Soccer Tournament 24'],
  ['12600', 'Watertown Spring Shootout 2025'],
  ['12548', 'Winter Magic 2025'],
  ['12544', 'KC Fall Finale 2024'],
  ['12538', 'Challenger Sports Invitational 2024'],
  ['12468', '2024 Omaha Fall Cup'],
  ['12347', '2024 Wolves Spring Cup'],
  ['12215', 'April Fools Festival Tournament 24'],
  ['12122', 'Iowa Rush Fall Cup'],
  ['12093', '2024 Heartland Invitational - Boys'],
  ['12092', '2024 Heartland Invitational - Girls'],
  // Season 23-24
  ['12089', '2024 Heartland Midwest Classic'],
  ['12087', '2024 Heartland Open Cup'],
  ['11919', '2024 Capital Classic'],
  ['11891', '2024 Wildcat Classic'],
  ['11826', '2024 Sporting Classic'],
  ['11807', 'Emerald Cup Boys 2024'],
  ['11702', '2024 South Atlantic Regional - Charlotte'],
  ['11650', '2024 Kansas City Invitational'],
  ['11648', '2024 KC Champions Cup'],
  ['11647', '2024 Heartland Spring Cup'],
  ['11555', 'Challenger Sports Invitational 2023'],
  ['11300', '2023 SDYSA Prairie Cup'],
  ['11219', '2023 Heartland Invitational - Boys'],
  ['11218', '2023 Heartland Invitational - Girls'],
  ['11215', '2023 Heartland Midwest Classic'],
  ['11114', 'KC Super Cup 2023'],
  ['10727', '2023 Heartland Spring Cup'],
  // KC Youth Development Leagues
  ['13593', 'Fall 2025 KC Youth Development League'],
  ['13272', 'Spring 2025 KC Youth Development League'],
  ['12295', 'Spring 2024 KC Youth Development League'],
  ['11708', 'Fall 2023 KC Youth Development League'],
]);

// Generic name pattern — matches "HTGSports Event 12093", "GotSport Event 39064", "Event 12345", bare numbers, or bare platform names
const GENERIC_PATTERN = "^(HTGSports |GotSport |Heartland )?Event \\d+$";
const BARE_NUMBER_PATTERN = "^\\d+$";
const BARE_PLATFORM_PATTERN = "^(GotSport|HTGSports|Heartland)$";

/**
 * Extract full event name from GotSport event page.
 * GotSport embeds event JSON in HTML with the full name followed by start_date.
 * Pattern: "EVENT_NAME","start_date":"YYYY-MM-DD","end_date":"YYYY-MM-DD","created_at"
 */
async function fetchGotSportEventName(eventId) {
  try {
    const resp = await fetch(`https://system.gotsport.com/org_event/events/${eventId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    if (!resp.ok) return null;

    const html = await resp.text();
    // Decode HTML entities in embedded JSON
    const decoded = html.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    // Extract event name from JSON pattern: "NAME","start_date":"YYYY-
    const match = decoded.match(/"([^"]{5,200})","start_date":"\d{4}-\d{2}-\d{2}","end_date":"\d{4}-\d{2}-\d{2}","created_at"/);
    if (!match) return null;
    // Decode JSON unicode escapes (\u0026 → &) and trim whitespace
    const name = match[1]
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .trim();
    // Reject if the "name" is just the site name (page has no real event data)
    if (name === 'GotSport' || name === 'HTGSports' || name.length < 5) return null;
    return name;
  } catch {
    return null;
  }
}

/**
 * Sleep helper for rate limiting
 */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const client = await pool.connect();

  try {
    await client.query('SELECT authorize_pipeline_write()');

    console.log('=== Fix Generic Event Names ===');
    console.log(`Mode: ${dryRun ? 'DRY RUN' : 'EXECUTE'}${skipWeb ? ' (skip web fetch)' : ''}\n`);

    // ============================================================
    // Step 1: Diagnose — Count generic names in tournaments + leagues
    // ============================================================
    console.log('--- Step 1: Diagnosis ---');

    const { rows: tournamentGeneric } = await client.query(`
      SELECT id, name, source_event_id, source_platform
      FROM tournaments
      WHERE name ~ $1 OR name ~ $2 OR name ~ $3
      ORDER BY name
    `, [GENERIC_PATTERN, BARE_NUMBER_PATTERN, BARE_PLATFORM_PATTERN]);

    const { rows: leagueGeneric } = await client.query(`
      SELECT id, name, source_event_id, source_platform
      FROM leagues
      WHERE name ~ $1 OR name ~ $2 OR name ~ $3
      ORDER BY name
    `, [GENERIC_PATTERN, BARE_NUMBER_PATTERN, BARE_PLATFORM_PATTERN]);

    console.log(`  Tournaments with generic names: ${tournamentGeneric.length}`);
    console.log(`  Leagues with generic names: ${leagueGeneric.length}`);

    // Breakdown by pattern
    const patterns = {};
    for (const t of [...tournamentGeneric, ...leagueGeneric]) {
      const prefix = t.name.replace(/\d+$/, '').trim() || '(bare number)';
      patterns[prefix] = (patterns[prefix] || 0) + 1;
    }
    console.log('  Breakdown by pattern:');
    for (const [p, cnt] of Object.entries(patterns).sort((a, b) => b[1] - a[1])) {
      console.log(`    "${p}": ${cnt}`);
    }

    // Count affected matches
    const { rows: [matchCount] } = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE t.name ~ $1 OR t.name ~ $2 OR t.name ~ $3) as tournament_matches,
        COUNT(*) FILTER (WHERE l.name ~ $1 OR l.name ~ $2 OR l.name ~ $3) as league_matches
      FROM matches_v2 m
      LEFT JOIN tournaments t ON m.tournament_id = t.id
      LEFT JOIN leagues l ON m.league_id = l.id
      WHERE m.deleted_at IS NULL
        AND (
          (t.name IS NOT NULL AND (t.name ~ $1 OR t.name ~ $2 OR t.name ~ $3))
          OR (l.name IS NOT NULL AND (l.name ~ $1 OR l.name ~ $2 OR l.name ~ $3))
        )
    `, [GENERIC_PATTERN, BARE_NUMBER_PATTERN, BARE_PLATFORM_PATTERN]);
    console.log(`  Matches linked to generic tournaments: ${matchCount.tournament_matches}`);
    console.log(`  Matches linked to generic leagues: ${matchCount.league_matches}`);

    if (tournamentGeneric.length === 0 && leagueGeneric.length === 0) {
      console.log('\nNo generic event names found. Nothing to fix.');
      return;
    }

    // ============================================================
    // Step 2: Build name mapping from all available sources
    // ============================================================
    console.log('\n--- Step 2: Building name mappings ---');

    // Collect all source_event_ids that need resolution
    const allGeneric = [...tournamentGeneric, ...leagueGeneric];
    const sourceEventIds = [...new Set(allGeneric.map(g => g.source_event_id).filter(Boolean))];

    // Source 1: Adapter static lists
    let staticResolved = 0;
    const nameMap = new Map(); // id → correct_name

    for (const g of allGeneric) {
      if (!g.source_event_id) continue;
      const staticName = HTG_STATIC_EVENTS.get(g.source_event_id);
      if (staticName) {
        nameMap.set(g.id, staticName);
        staticResolved++;
      }
    }
    console.log(`  Source 1 (adapter static lists): ${staticResolved} resolved`);

    // Source 2: staging_games.event_name — bulk lookup
    if (sourceEventIds.length > 0) {
      const { rows: stagingNames } = await client.query(`
        SELECT DISTINCT ON (event_id) event_id, event_name
        FROM staging_games
        WHERE event_id = ANY($1)
          AND event_name IS NOT NULL
          AND event_name != ''
          AND event_name !~ $2
          AND event_name !~ $3
          AND event_name !~ $4
        ORDER BY event_id, scraped_at DESC
      `, [sourceEventIds, GENERIC_PATTERN, BARE_NUMBER_PATTERN, BARE_PLATFORM_PATTERN]);

      let stagingResolved = 0;
      const stagingMap = new Map(stagingNames.map(r => [r.event_id, r.event_name]));

      for (const g of allGeneric) {
        if (nameMap.has(g.id)) continue;
        if (!g.source_event_id) continue;
        const stagingName = stagingMap.get(g.source_event_id);
        if (stagingName) {
          nameMap.set(g.id, stagingName);
          stagingResolved++;
        }
      }
      console.log(`  Source 2 (staging_games): ${stagingResolved} resolved`);
    }

    // Source 3: canonical_events — lookup by tournament_id/league_id FK
    {
      const unresolvedIds = allGeneric.filter(g => !nameMap.has(g.id)).map(g => g.id);
      if (unresolvedIds.length > 0) {
        const { rows: canonicalNames } = await client.query(`
          SELECT ce.tournament_id as event_id, ce.canonical_name, 'tournament' as type
          FROM canonical_events ce
          WHERE ce.tournament_id = ANY($1)
            AND ce.canonical_name IS NOT NULL
            AND ce.canonical_name != ''
            AND ce.canonical_name !~ $2
            AND ce.canonical_name !~ $3
            AND ce.canonical_name !~ $4
          UNION ALL
          SELECT ce.league_id as event_id, ce.canonical_name, 'league' as type
          FROM canonical_events ce
          WHERE ce.league_id = ANY($1)
            AND ce.canonical_name IS NOT NULL
            AND ce.canonical_name != ''
            AND ce.canonical_name !~ $2
            AND ce.canonical_name !~ $3
            AND ce.canonical_name !~ $4
        `, [unresolvedIds, GENERIC_PATTERN, BARE_NUMBER_PATTERN, BARE_PLATFORM_PATTERN]);

        let canonicalResolved = 0;
        const canonicalMap = new Map(canonicalNames.map(r => [r.event_id, r.canonical_name]));

        for (const g of allGeneric) {
          if (nameMap.has(g.id)) continue;
          const canonicalName = canonicalMap.get(g.id);
          if (canonicalName) {
            nameMap.set(g.id, canonicalName);
            canonicalResolved++;
          }
        }
        console.log(`  Source 3 (canonical_events): ${canonicalResolved} resolved`);
      } else {
        console.log(`  Source 3 (canonical_events): skipped (all resolved)`);
      }
    }

    // Source 4: GotSport web page — fetch full event name from embedded JSON
    // GotSport event pages embed full name in HTML-encoded JSON data
    if (!skipWeb) {
      const unresolvedGotsport = allGeneric.filter(g =>
        !nameMap.has(g.id) && g.source_event_id && g.source_platform === 'gotsport'
      );

      if (unresolvedGotsport.length > 0) {
        console.log(`  Source 4 (GotSport web): fetching ${unresolvedGotsport.length} event pages...`);
        let webResolved = 0;
        let webFailed = 0;
        const CONCURRENCY = 5;

        // Process in batches for rate limiting
        for (let i = 0; i < unresolvedGotsport.length; i += CONCURRENCY) {
          const batch = unresolvedGotsport.slice(i, i + CONCURRENCY);
          const results = await Promise.all(
            batch.map(g => fetchGotSportEventName(g.source_event_id).then(name => ({ g, name })))
          );

          for (const { g, name } of results) {
            if (name) {
              nameMap.set(g.id, name);
              webResolved++;
            } else {
              webFailed++;
            }
          }

          // Rate limit: 1.5s between batches
          if (i + CONCURRENCY < unresolvedGotsport.length) {
            await sleep(1500);
          }

          // Progress every 25 events
          if ((i + CONCURRENCY) % 25 < CONCURRENCY) {
            process.stdout.write(`    Progress: ${Math.min(i + CONCURRENCY, unresolvedGotsport.length)}/${unresolvedGotsport.length}\r`);
          }
        }
        console.log(`  Source 4 (GotSport web): ${webResolved} resolved, ${webFailed} failed`);
      }

      // Source 4b: HTGSports web — same pattern for any unresolved HTGSports events
      const unresolvedHtg = allGeneric.filter(g =>
        !nameMap.has(g.id) && g.source_event_id && g.source_platform === 'htgsports'
      );
      if (unresolvedHtg.length > 0) {
        // HTGSports events also live on GotSport (same system)
        console.log(`  Source 4b (HTGSports web): fetching ${unresolvedHtg.length} event pages...`);
        let htgWebResolved = 0;
        for (const g of unresolvedHtg) {
          const name = await fetchGotSportEventName(g.source_event_id);
          if (name) {
            nameMap.set(g.id, name);
            htgWebResolved++;
          }
          await sleep(1500);
        }
        console.log(`  Source 4b (HTGSports web): ${htgWebResolved} resolved`);
      }
    } else {
      console.log(`  Source 4 (web fetch): skipped (--skip-web flag)`);
    }

    const unresolved = allGeneric.filter(g => !nameMap.has(g.id));
    console.log(`\n  Total resolved: ${nameMap.size} / ${allGeneric.length}`);
    console.log(`  Unresolved: ${unresolved.length}`);

    // Show samples
    if (nameMap.size > 0) {
      console.log('\n  Sample resolutions:');
      let shown = 0;
      for (const [id, name] of nameMap) {
        const orig = allGeneric.find(g => g.id === id);
        if (orig && shown < 15) {
          console.log(`    "${orig.name}" -> "${name}"`);
          shown++;
        }
      }
    }

    if (unresolved.length > 0) {
      console.log('\n  Unresolved:');
      unresolved.forEach(g => {
        console.log(`    "${g.name}" (source_event_id: ${g.source_event_id}, platform: ${g.source_platform})`);
      });
    }

    // ============================================================
    // Step 3: Bulk UPDATE
    // ============================================================
    console.log('\n--- Step 3: Applying fixes ---');

    if (nameMap.size === 0) {
      console.log('  No names resolved — nothing to update.');
    } else if (execute) {
      // Separate tournament and league updates
      const tournamentUpdates = [];
      const leagueUpdates = [];

      for (const [id, name] of nameMap) {
        const isTourn = tournamentGeneric.some(t => t.id === id);
        if (isTourn) {
          tournamentUpdates.push({ id, name });
        } else {
          leagueUpdates.push({ id, name });
        }
      }

      // Bulk UPDATE tournaments using CASE
      if (tournamentUpdates.length > 0) {
        const cases = tournamentUpdates.map((u, i) => `WHEN id = $${i * 2 + 1} THEN $${i * 2 + 2}`).join(' ');
        const ids = tournamentUpdates.map(u => u.id);
        const vals = tournamentUpdates.flatMap(u => [u.id, u.name]);

        const { rowCount } = await client.query(`
          UPDATE tournaments SET name = CASE ${cases} END
          WHERE id = ANY($${vals.length + 1})
        `, [...vals, ids]);
        console.log(`  Updated ${rowCount} tournaments`);
      }

      // Bulk UPDATE leagues using CASE
      if (leagueUpdates.length > 0) {
        const cases = leagueUpdates.map((u, i) => `WHEN id = $${i * 2 + 1} THEN $${i * 2 + 2}`).join(' ');
        const ids = leagueUpdates.map(u => u.id);
        const vals = leagueUpdates.flatMap(u => [u.id, u.name]);

        const { rowCount } = await client.query(`
          UPDATE leagues SET name = CASE ${cases} END
          WHERE id = ANY($${vals.length + 1})
        `, [...vals, ids]);
        console.log(`  Updated ${rowCount} leagues`);
      }

      // Also update canonical_events to match
      if (nameMap.size > 0) {
        const allIds = [...nameMap.keys()];
        const { rowCount: ceCount } = await client.query(`
          UPDATE canonical_events ce
          SET canonical_name = t.name
          FROM tournaments t
          WHERE ce.tournament_id = t.id AND t.id = ANY($1)
        `, [allIds.filter(id => tournamentUpdates.some(u => u.id === id))]);

        const { rowCount: ceCount2 } = await client.query(`
          UPDATE canonical_events ce
          SET canonical_name = l.name
          FROM leagues l
          WHERE ce.league_id = l.id AND l.id = ANY($1)
        `, [allIds.filter(id => leagueUpdates.some(u => u.id === id))]);

        console.log(`  Updated ${ceCount + ceCount2} canonical_events to match`);
      }
    } else {
      const tournCount = [...nameMap.keys()].filter(id => tournamentGeneric.some(t => t.id === id)).length;
      const leagueCount = nameMap.size - tournCount;
      console.log(`  Would update ${tournCount} tournaments, ${leagueCount} leagues`);
    }

    // ============================================================
    // Step 4: Post-fix report
    // ============================================================
    console.log('\n--- Step 4: Post-fix verification ---');

    const { rows: [afterTourns] } = await client.query(`
      SELECT COUNT(*) as cnt FROM tournaments WHERE name ~ $1 OR name ~ $2 OR name ~ $3
    `, [GENERIC_PATTERN, BARE_NUMBER_PATTERN, BARE_PLATFORM_PATTERN]);

    const { rows: [afterLeagues] } = await client.query(`
      SELECT COUNT(*) as cnt FROM leagues WHERE name ~ $1 OR name ~ $2 OR name ~ $3
    `, [GENERIC_PATTERN, BARE_NUMBER_PATTERN, BARE_PLATFORM_PATTERN]);

    console.log(`  Remaining generic tournaments: ${afterTourns.cnt}`);
    console.log(`  Remaining generic leagues: ${afterLeagues.cnt}`);

    // Summary
    console.log('\n=== Summary ===');
    console.log(`Before: ${tournamentGeneric.length} tournaments + ${leagueGeneric.length} leagues with generic names`);
    console.log(`Resolved: ${nameMap.size} names from ${skipWeb ? '3' : '4'} sources`);
    console.log(`After: ${afterTourns.cnt} tournaments + ${afterLeagues.cnt} leagues remaining`);

    if (dryRun) {
      console.log('\nDRY RUN — no changes made. Use --execute to apply fixes.');
    }

  } catch (err) {
    console.error('Error:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
})();
