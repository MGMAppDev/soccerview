/**
 * Universal Standings Scraper Engine
 * ===================================
 * Session 92: Scrape authoritative league standings from ANY source.
 *
 * UNIVERSAL PATTERN: All source-specific logic lives in adapter configs.
 * This engine is 100% source-agnostic. Adding a new standings source
 * requires ONLY adding a `standings` section to the adapter config.
 *
 * Architecture:
 *   Adapter config (standings section) → This engine → staging_standings
 *   staging_standings → processStandings.cjs → league_standings (production)
 *   league_standings → app_league_standings view → App
 *
 * Usage:
 *   node scripts/universal/scrapeStandings.js --adapter heartland
 *   node scripts/universal/scrapeStandings.js --adapter heartland --season "2025_fall"
 *   node scripts/universal/scrapeStandings.js --adapter htgsports --dry-run
 *   node scripts/universal/scrapeStandings.js --adapter gotsport --limit 5
 */

import 'dotenv/config';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =========================================================================
// CLI ARGUMENTS
// =========================================================================

const args = process.argv.slice(2);
const adapterName = args.find((_, i) => args[i - 1] === '--adapter') || null;
const seasonFilter = args.find((_, i) => args[i - 1] === '--season') || null;
const limitArg = parseInt(args.find((_, i) => args[i - 1] === '--limit') || '0', 10);
const isDryRun = args.includes('--dry-run');
const isVerbose = args.includes('--verbose');

if (!adapterName) {
  console.error('Usage: node scrapeStandings.js --adapter <name> [--season <season>] [--dry-run] [--limit N]');
  console.error('');
  console.error('Options:');
  console.error('  --adapter <name>   Adapter name (heartland, htgsports, gotsport, etc.)');
  console.error('  --season <season>  Filter to specific season (e.g., "2025_fall")');
  console.error('  --dry-run          Parse and display without writing to database');
  console.error('  --limit N          Limit number of standings sources to scrape');
  console.error('  --verbose          Show detailed parsing output');
  process.exit(1);
}

// =========================================================================
// DATABASE
// =========================================================================

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// =========================================================================
// LOAD ADAPTER
// =========================================================================

async function loadAdapter(name) {
  const adapterPath = path.join(__dirname, '..', 'adapters', `${name}.js`);
  if (!fs.existsSync(adapterPath)) {
    console.error(`Adapter not found: ${adapterPath}`);
    process.exit(1);
  }
  const module = await import(`file://${adapterPath.replace(/\\/g, '/')}`);
  const adapter = module.default;

  if (!adapter.standings) {
    console.error(`Adapter '${name}' does not have a standings section.`);
    console.error('Add a standings config to the adapter to enable standings scraping.');
    console.error('See scripts/adapters/_template.js for the standings interface.');
    process.exit(1);
  }

  return adapter;
}

// =========================================================================
// TECHNOLOGY HELPERS
// =========================================================================

let browser = null;

async function initPuppeteer() {
  if (browser) return browser;
  const puppeteer = (await import('puppeteer')).default;
  browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  console.log('  Puppeteer browser launched');
  return browser;
}

async function fetchWithCheerio(url, adapter) {
  const cheerio = (await import('cheerio')).default || await import('cheerio');
  const headers = {};
  if (adapter.userAgents?.length) {
    headers['User-Agent'] = adapter.userAgents[Math.floor(Math.random() * adapter.userAgents.length)];
  }

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      console.error(`  HTTP ${response.status} for ${url}`);
      return null;
    }
    const html = await response.text();
    return cheerio.load(html);
  } catch (err) {
    console.error(`  Fetch error for ${url}: ${err.message}`);
    return null;
  }
}

async function fetchWithPuppeteer(url, adapter, options = {}) {
  const b = await initPuppeteer();
  const page = await b.newPage();

  if (adapter.userAgents?.length) {
    await page.setUserAgent(adapter.userAgents[Math.floor(Math.random() * adapter.userAgents.length)]);
  }

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    if (options.waitForSelector) {
      await page.waitForSelector(options.waitForSelector, { timeout: 10000 }).catch(() => {});
    }
    return page;
  } catch (err) {
    console.error(`  Puppeteer error for ${url}: ${err.message}`);
    await page.close();
    return null;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function applyRateLimit(adapter) {
  const rl = adapter.rateLimiting || {};
  const min = rl.requestDelayMin || 300;
  const max = rl.requestDelayMax || 600;
  const delay = min + Math.random() * (max - min);
  return sleep(delay);
}

// =========================================================================
// ENGINE CONTEXT (passed to adapter functions)
// =========================================================================

function createEngine(adapter) {
  return {
    adapter,
    fetchWithCheerio: (url) => fetchWithCheerio(url, adapter),
    fetchWithPuppeteer: (url, opts) => fetchWithPuppeteer(url, adapter, opts),
    initPuppeteer: () => initPuppeteer(),
    sleep,
    applyRateLimit: () => applyRateLimit(adapter),
    isVerbose,
    pool,
  };
}

// =========================================================================
// INSERT TO STAGING
// =========================================================================

async function insertToStaging(standings, sourcePlatform, snapshotDate) {
  if (standings.length === 0) return 0;
  if (isDryRun) {
    console.log(`  [DRY RUN] Would insert ${standings.length} standings rows`);
    return standings.length;
  }

  const client = await pool.connect();
  try {
    // Batch insert using unnest for performance
    const values = {
      league_source_id: [],
      division: [],
      team_name: [],
      team_source_id: [],
      played: [],
      wins: [],
      losses: [],
      draws: [],
      goals_for: [],
      goals_against: [],
      points: [],
      position: [],
      red_cards: [],
      extra_data: [],
      source_platform: [],
      source_snapshot_date: [],
      season: [],
      age_group: [],
      gender: [],
    };

    for (const s of standings) {
      values.league_source_id.push(s.league_source_id);
      values.division.push(s.division || null);
      values.team_name.push(s.team_name);
      values.team_source_id.push(s.team_source_id || null);
      values.played.push(s.played ?? null);
      values.wins.push(s.wins ?? null);
      values.losses.push(s.losses ?? null);
      values.draws.push(s.draws ?? null);
      values.goals_for.push(s.goals_for ?? null);
      values.goals_against.push(s.goals_against ?? null);
      values.points.push(s.points ?? null);
      values.position.push(s.position ?? null);
      values.red_cards.push(s.red_cards ?? null);
      values.extra_data.push(s.extra_data ? JSON.stringify(s.extra_data) : null);
      values.source_platform.push(sourcePlatform);
      values.source_snapshot_date.push(snapshotDate);
      values.season.push(s.season || null);
      values.age_group.push(s.age_group || null);
      values.gender.push(s.gender || null);
    }

    const result = await client.query(`
      INSERT INTO staging_standings (
        league_source_id, division, team_name, team_source_id,
        played, wins, losses, draws, goals_for, goals_against,
        points, position, red_cards, extra_data,
        source_platform, source_snapshot_date, season, age_group, gender
      )
      SELECT * FROM unnest(
        $1::text[], $2::text[], $3::text[], $4::text[],
        $5::int[], $6::int[], $7::int[], $8::int[], $9::int[], $10::int[],
        $11::int[], $12::int[], $13::int[], $14::jsonb[],
        $15::text[], $16::date[], $17::text[], $18::text[], $19::text[]
      )
    `, [
      values.league_source_id, values.division, values.team_name, values.team_source_id,
      values.played, values.wins, values.losses, values.draws, values.goals_for, values.goals_against,
      values.points, values.position, values.red_cards, values.extra_data,
      values.source_platform, values.source_snapshot_date, values.season, values.age_group, values.gender,
    ]);

    return result.rowCount;
  } finally {
    client.release();
  }
}

// =========================================================================
// MAIN
// =========================================================================

async function main() {
  console.log('='.repeat(60));
  console.log('UNIVERSAL STANDINGS SCRAPER');
  console.log('='.repeat(60));
  console.log(`Adapter:  ${adapterName}`);
  console.log(`Season:   ${seasonFilter || 'all available'}`);
  console.log(`Dry run:  ${isDryRun}`);
  console.log(`Limit:    ${limitArg || 'none'}`);
  console.log('');

  const adapter = await loadAdapter(adapterName);
  const engine = createEngine(adapter);
  const standingsConfig = adapter.standings;

  // -----------------------------------------------------------------------
  // STEP 1: Discover standings sources (seasons, divisions, etc.)
  // -----------------------------------------------------------------------

  console.log('Step 1: Discovering standings sources...');

  let sources;
  if (typeof standingsConfig.discoverSources === 'function') {
    sources = await standingsConfig.discoverSources(engine, { season: seasonFilter });
  } else if (standingsConfig.staticSources) {
    sources = standingsConfig.staticSources;
    if (seasonFilter) {
      sources = sources.filter(s => s.season === seasonFilter || s.id.includes(seasonFilter));
    }
  } else {
    console.error('Adapter standings config must have discoverSources() or staticSources[]');
    process.exit(1);
  }

  if (limitArg > 0) {
    sources = sources.slice(0, limitArg);
  }

  console.log(`  Found ${sources.length} standings source(s)`);

  // -----------------------------------------------------------------------
  // STEP 2: Scrape each source
  // -----------------------------------------------------------------------

  let totalRows = 0;
  let totalSources = 0;

  for (const source of sources) {
    console.log(`\nStep 2: Scraping "${source.name || source.id}"...`);

    try {
      // Call the adapter's universal scrape function
      const standings = await standingsConfig.scrapeSource(engine, source);

      if (!standings || standings.length === 0) {
        console.log('  No standings data found (will retry next run)');
        continue;
      }

      console.log(`  Parsed ${standings.length} team standings`);

      if (isVerbose && standings.length > 0) {
        console.log('  Sample:', JSON.stringify(standings[0], null, 2));
      }

      // -----------------------------------------------------------------------
      // STEP 3: Write to staging_standings
      // -----------------------------------------------------------------------

      const snapshotDate = source.snapshot_date || new Date().toISOString().split('T')[0];
      const inserted = await insertToStaging(standings, adapter.id, snapshotDate);
      console.log(`  Inserted ${inserted} rows to staging_standings`);

      totalRows += standings.length;
      totalSources++;

    } catch (err) {
      console.error(`  Error scraping "${source.name || source.id}": ${err.message}`);
      if (isVerbose) console.error(err.stack);
    }

    // Rate limit between sources
    await applyRateLimit(adapter);
  }

  // -----------------------------------------------------------------------
  // SUMMARY
  // -----------------------------------------------------------------------

  console.log('\n' + '='.repeat(60));
  console.log('STANDINGS SCRAPE COMPLETE');
  console.log('='.repeat(60));
  console.log(`Sources scraped: ${totalSources}/${sources.length}`);
  console.log(`Total standings: ${totalRows}`);
  console.log(`Dry run:         ${isDryRun}`);
  console.log('');
  console.log('Next step: node scripts/maintenance/processStandings.cjs');

  // Cleanup
  if (browser) await browser.close();
  await pool.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  if (browser) browser.close().catch(() => {});
  pool.end().catch(() => {});
  process.exit(1);
});
