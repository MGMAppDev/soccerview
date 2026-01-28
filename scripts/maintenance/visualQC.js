/**
 * Visual QC Tool for SoccerView
 *
 * Takes automated screenshots of all key screens for Claude to analyze.
 * Uses Puppeteer to run the Expo web version of the app.
 *
 * Usage:
 *   1. Start Expo web server: npx expo start --web
 *   2. Run this script: node scripts/visualQC.js
 *   3. Screenshots saved to: screenshots/qc/
 *
 * Requirements:
 *   npm install puppeteer
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Supabase client for fetching sample data
const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Configuration
const CONFIG = {
  BASE_URL: 'http://localhost:8081',
  SCREENSHOT_DIR: path.join(__dirname, '..', 'screenshots', 'qc'),
  VIEWPORT: {
    width: 390,   // iPhone 14 Pro width
    height: 844,  // iPhone 14 Pro height
    deviceScaleFactor: 2
  },
  WAIT_FOR_LOAD: 3000,  // Wait for data to load
  DARK_MODE: true
};

// Screens to capture
const SCREENS = [
  {
    name: '01_home',
    path: '/',
    description: 'Home tab - Stats overview, Latest Matches, Top Teams',
    scrolls: [0, 500, 1000]  // Take screenshots at different scroll positions
  },
  {
    name: '02_rankings',
    path: '/rankings',
    description: 'Rankings tab - Official Rankings / SoccerView Power Rating',
    scrolls: [0, 500]
  },
  {
    name: '03_teams',
    path: '/teams',
    description: 'Teams tab - Search & browse teams',
    scrolls: [0]
  },
  {
    name: '04_matches',
    path: '/matches',
    description: 'Matches tab - Recent matches with filters',
    scrolls: [0, 500]
  },
  {
    name: '05_team_detail',
    path: '/team/1',  // Sample team ID - will be updated dynamically
    description: 'Team detail - Stats, recent matches, head-to-head',
    scrolls: [0, 500, 1000]
  },
  {
    name: '06_league_standings',
    path: '/league/45260',  // Sample event ID with good data
    description: 'League standings - Points table, power ratings',
    scrolls: [0, 500]
  }
];

// Data validation checks to perform
const DATA_CHECKS = {
  home: {
    selectors: [
      { name: 'stats_cards', selector: '[data-testid="stats-card"]', minCount: 2 },
      { name: 'match_cards', selector: '[data-testid="match-card"]', minCount: 1 },
      { name: 'top_teams', selector: '[data-testid="team-row"]', minCount: 1 }
    ]
  },
  rankings: {
    selectors: [
      { name: 'team_rows', selector: '[data-testid="ranking-row"]', minCount: 10 }
    ]
  },
  teams: {
    selectors: [
      { name: 'team_count', selector: '[data-testid="team-count"]', minCount: 1 }
    ]
  }
};

async function ensureDirectoryExists(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Created directory: ${dir}`);
  }
}

async function takeScreenshot(page, name, description) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${name}_${timestamp}.png`;
  const filepath = path.join(CONFIG.SCREENSHOT_DIR, filename);

  await page.screenshot({
    path: filepath,
    fullPage: false  // Capture viewport only (mobile-sized)
  });

  console.log(`  Screenshot saved: ${filename}`);
  return { filename, filepath, description };
}

async function scrollAndCapture(page, screenName, scrollPositions) {
  const screenshots = [];

  for (let i = 0; i < scrollPositions.length; i++) {
    const scrollY = scrollPositions[i];

    await page.evaluate((y) => {
      window.scrollTo(0, y);
    }, scrollY);

    // Wait for any lazy-loaded content
    await new Promise(r => setTimeout(r, 500));

    const name = scrollPositions.length > 1
      ? `${screenName}_scroll${i}`
      : screenName;

    const screenshot = await takeScreenshot(page, name, `Scroll position: ${scrollY}px`);
    screenshots.push(screenshot);
  }

  return screenshots;
}

async function checkDataIntegrity(page, checks) {
  const results = [];

  for (const check of checks) {
    try {
      const elements = await page.$$(check.selector);
      const passed = elements.length >= check.minCount;
      results.push({
        name: check.name,
        selector: check.selector,
        expected: check.minCount,
        found: elements.length,
        passed
      });
    } catch (e) {
      results.push({
        name: check.name,
        selector: check.selector,
        expected: check.minCount,
        found: 0,
        passed: false,
        error: e.message
      });
    }
  }

  return results;
}

async function findSampleTeamId() {
  // Query Supabase directly to get a sample team with good data
  console.log('  Fetching sample team from database...');

  try {
    const { data, error } = await supabase
      .from('teams')
      .select('id, team_name, elo_rating, matches_played')
      .gt('matches_played', 10)  // Team with match history
      .not('elo_rating', 'is', null)
      .limit(1)
      .single();

    if (error) {
      console.log(`  Supabase error: ${error.message}`);
      return null;
    }

    if (data) {
      console.log(`  Found team: ${data.team_name} (${data.matches_played} matches, ELO: ${data.elo_rating})`);
      console.log(`  Team ID: ${data.id}`);
      return data.id;
    }
  } catch (e) {
    console.log(`  Error fetching team: ${e.message}`);
  }

  return null;
}

async function generateReport(allScreenshots, allChecks) {
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      totalScreenshots: allScreenshots.length,
      screenshotDir: CONFIG.SCREENSHOT_DIR,
      viewport: CONFIG.VIEWPORT
    },
    screens: allScreenshots,
    dataChecks: allChecks,
    recommendations: []
  };

  // Analyze and add recommendations
  for (const [screen, checks] of Object.entries(allChecks)) {
    const failed = checks.filter(c => !c.passed);
    if (failed.length > 0) {
      report.recommendations.push({
        screen,
        issue: `Missing elements: ${failed.map(f => f.name).join(', ')}`,
        details: failed
      });
    }
  }

  const reportPath = path.join(CONFIG.SCREENSHOT_DIR, 'qc_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nReport saved: ${reportPath}`);

  return report;
}

async function bypassOnboarding(page, baseUrl) {
  // The app uses AsyncStorage with key 'soccerview_onboarding_complete'
  // On web, AsyncStorage maps to localStorage
  console.log('Setting up onboarding bypass...');

  // First navigate to the base URL to establish the origin for localStorage
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Set the localStorage key that the app checks
  await page.evaluate(() => {
    localStorage.setItem('soccerview_onboarding_complete', 'true');
  });

  console.log('  localStorage set: soccerview_onboarding_complete = true');

  // Reload to apply the bypass
  await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  // Verify we're not on onboarding
  const pageContent = await page.content();
  const isOnOnboarding = pageContent.includes('Welcome to SoccerView') && pageContent.includes('Skip');

  if (isOnOnboarding) {
    console.log('  Still on onboarding - clicking Skip button...');
    // Click the Skip button as fallback
    await page.evaluate(() => {
      const elements = document.querySelectorAll('*');
      for (const el of elements) {
        if (el.textContent === 'Skip' && el.offsetParent !== null) {
          el.click();
          return true;
        }
      }
      return false;
    });
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('  Onboarding bypass complete');
}

async function runVisualQC() {
  console.log('='.repeat(60));
  console.log('SoccerView Visual QC Tool');
  console.log('='.repeat(60));
  console.log(`\nTarget: ${CONFIG.BASE_URL}`);
  console.log(`Viewport: ${CONFIG.VIEWPORT.width}x${CONFIG.VIEWPORT.height} @${CONFIG.VIEWPORT.deviceScaleFactor}x\n`);

  // Ensure screenshot directory exists
  await ensureDirectoryExists(CONFIG.SCREENSHOT_DIR);

  // Launch browser
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport(CONFIG.VIEWPORT);

  // Set dark mode preference (matches app default)
  if (CONFIG.DARK_MODE) {
    await page.emulateMediaFeatures([
      { name: 'prefers-color-scheme', value: 'dark' }
    ]);
  }

  const allScreenshots = [];
  const allChecks = {};

  try {
    // Bypass onboarding by setting localStorage
    await bypassOnboarding(page, CONFIG.BASE_URL);

    // First, find a valid team ID for team detail screen (from database)
    console.log('\nFinding sample team ID from database...');
    const sampleTeamId = await findSampleTeamId();

    // Update team detail path with real ID, or skip if not found
    const teamDetailScreen = SCREENS.find(s => s.name === '05_team_detail');
    if (teamDetailScreen) {
      if (sampleTeamId) {
        teamDetailScreen.path = `/team/${sampleTeamId}`;
      } else {
        console.log('  Skipping team detail screen - no valid team ID found');
        teamDetailScreen.skip = true;
      }
    }

    // Capture each screen
    for (const screen of SCREENS) {
      // Skip screens marked as skipped
      if (screen.skip) {
        console.log(`\n${'-'.repeat(40)}`);
        console.log(`SKIPPING: ${screen.name} (no valid data)`);
        continue;
      }

      console.log(`\n${'-'.repeat(40)}`);
      console.log(`Capturing: ${screen.name}`);
      console.log(`Path: ${screen.path}`);
      console.log(`Description: ${screen.description}`);

      try {
        await page.goto(`${CONFIG.BASE_URL}${screen.path}`, {
          waitUntil: 'networkidle2',
          timeout: 30000
        });

        // Wait for dynamic content to load (longer for league standings)
        const waitTime = screen.name.includes('league') ? CONFIG.WAIT_FOR_LOAD * 3 : CONFIG.WAIT_FOR_LOAD;
        await new Promise(r => setTimeout(r, waitTime));

        // Take screenshots at different scroll positions
        const screenshots = await scrollAndCapture(page, screen.name, screen.scrolls);
        allScreenshots.push(...screenshots.map(s => ({ ...s, screen: screen.name })));

        // Run data integrity checks if defined
        const screenKey = screen.name.replace(/^\d+_/, '');
        if (DATA_CHECKS[screenKey]) {
          console.log(`  Running data checks for ${screenKey}...`);
          const checks = await checkDataIntegrity(page, DATA_CHECKS[screenKey].selectors);
          allChecks[screenKey] = checks;

          const passed = checks.filter(c => c.passed).length;
          const total = checks.length;
          console.log(`  Data checks: ${passed}/${total} passed`);
        }

      } catch (e) {
        console.error(`  ERROR capturing ${screen.name}: ${e.message}`);
        allScreenshots.push({
          screen: screen.name,
          error: e.message
        });
      }
    }

    // Generate report
    const report = await generateReport(allScreenshots, allChecks);

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('QC COMPLETE');
    console.log('='.repeat(60));
    console.log(`\nScreenshots: ${report.summary.totalScreenshots}`);
    console.log(`Location: ${report.summary.screenshotDir}`);

    if (report.recommendations.length > 0) {
      console.log(`\nIssues Found: ${report.recommendations.length}`);
      for (const rec of report.recommendations) {
        console.log(`  - ${rec.screen}: ${rec.issue}`);
      }
    } else {
      console.log('\nNo issues detected!');
    }

    console.log('\nNext Steps:');
    console.log('  1. Review screenshots in screenshots/qc/');
    console.log('  2. Share qc_report.json with Claude for analysis');
    console.log('  3. Or ask Claude to read the screenshots directly');

  } finally {
    await browser.close();
  }
}

// Run if called directly
runVisualQC().catch(console.error);

export { runVisualQC, CONFIG };
