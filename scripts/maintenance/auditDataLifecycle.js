#!/usr/bin/env node
/**
 * SOCCERVIEW DATA LIFECYCLE AUDIT
 * ================================
 * Run after any major enhancement to verify universal fixes across all layers.
 * Usage: node scripts/maintenance/auditDataLifecycle.js
 */

const fs = require('fs');
const path = require('path');

const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', c: '\x1b[36m', b: '\x1b[1m', x: '\x1b[0m' };
const results = { pass: [], warn: [], fail: [] };

const pass = (m) => { results.pass.push(m); console.log(`${C.g}✅${C.x} ${m}`); };
const warn = (m) => { results.warn.push(m); console.log(`${C.y}⚠️${C.x} ${m}`); };
const fail = (m) => { results.fail.push(m); console.log(`${C.r}❌${C.x} ${m}`); };
const header = (t) => console.log(`\n${C.b}${C.c}═══ ${t} ═══${C.x}`);

const read = (p) => { try { return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null; } catch { return null; } };

// ============================================================================
// UNIVERSAL PATTERNS (Update when new patterns discovered)
// ============================================================================
const PATTERNS = {
  divisionCorrect: 'U-?\\d',
  divisionBroken: ['U-\\d+', 'U-\\\\d+'],
  ageGroupCorrect: 'U[-\\s]?(\\d',
  ageGroupBroken: ['u(\\d{1,2})', 'U(\\d+)'],
  scoreBroken: ['?? 0', 'score || 0', 'COALESCE(home_score, 0)', 'COALESCE(away_score, 0)']
};

// LAYER 1: Scrapers & Adapters
function auditLayer1(root) {
  header('LAYER 1: Scrapers & Adapters');
  
  for (const f of ['htgsports.js', 'gotsport.js', 'heartland.js', '_template.js']) {
    const c = read(path.join(root, 'scripts/adapters', f));
    if (!c) continue;
    const hasBroken = PATTERNS.divisionBroken.some(p => c.includes(p) && !c.includes(PATTERNS.divisionCorrect));
    if (hasBroken) fail(`${f}: Broken division regex`);
    else if (c.includes(PATTERNS.divisionCorrect)) pass(`${f}: Universal division regex`);
    else pass(`${f}: No division dropdown (OK)`);
  }
  
  for (const f of ['scrapeHTGSports.js', 'scrapeHeartland.js', 'scrapeGotSport.js']) {
    const c = read(path.join(root, 'scripts/scrapers', f));
    if (!c) continue;
    const hasBroken = PATTERNS.divisionBroken.some(p => c.includes(p) && !c.includes(PATTERNS.divisionCorrect));
    if (hasBroken) fail(`legacy/${f}: Broken division regex`);
    else pass(`legacy/${f}: OK`);
  }
  
  const core = read(path.join(root, 'scripts/universal/coreScraper.js'));
  if (core && /if\s*\(\s*matches\.length\s*>\s*0\s*\)[\s\S]{0,500}processedEventIds\.add/.test(core)) {
    pass('coreScraper: Checkpoint inside matches.length > 0');
  } else if (core) {
    fail('coreScraper: Checkpoint logic incorrect');
  }
}

// LAYER 2: Validation & Normalization
function auditLayer2(root) {
  header('LAYER 2: Validation & Normalization');
  
  const files = [
    ['scripts/universal/intakeValidator.js', 'intakeValidator'],
    ['scripts/universal/dataQualityEngine.js', 'dataQualityEngine'],
    ['scripts/universal/normalizers/teamNormalizer.js', 'teamNormalizer']
  ];
  
  for (const [p, name] of files) {
    const c = read(path.join(root, p));
    if (!c) continue;
    if (c.includes(PATTERNS.ageGroupCorrect) || c.includes('birth_year')) {
      pass(`${name}: Age handling OK`);
    } else if (PATTERNS.ageGroupBroken.some(b => c.includes(b))) {
      warn(`${name}: Age regex may miss dash/space`);
    }
    if (PATTERNS.scoreBroken.some(b => c.includes(b))) {
      fail(`${name}: Dangerous score fallback to 0`);
    } else {
      pass(`${name}: No score fallbacks`);
    }
  }
  
  if (read(path.join(root, 'scripts/maintenance/mergeTeams.js'))) pass('mergeTeams.js: Exists');
  else fail('mergeTeams.js: MISSING');
}

// LAYER 3: App Views
function auditLayer3(root) {
  header('LAYER 3: App Views & Presentation');
  
  for (const dir of ['scripts/migrations', 'sql']) {
    const dirPath = path.join(root, dir);
    if (!fs.existsSync(dirPath)) continue;
    for (const f of fs.readdirSync(dirPath).filter(x => x.endsWith('.sql'))) {
      const c = read(path.join(dirPath, f));
      if (c && c.includes('COALESCE') && c.includes('score') && c.includes(', 0)')) {
        fail(`${f}: COALESCE(score, 0) breaks scheduled matches`);
      }
    }
  }
  
  if (fs.existsSync(path.join(root, 'scripts/daily/refreshViews.js'))) pass('refreshViews.js: Exists');
  if (fs.existsSync(path.join(root, 'scripts/maintenance/ensureViewIndexes.js'))) pass('ensureViewIndexes.js: Exists');
}

// CROSS-LAYER
function auditCrossLayer(root) {
  header('CROSS-LAYER: Documentation');
  
  for (const d of ['CLAUDE.md', 'docs/1-ARCHITECTURE.md']) {
    const c = read(path.join(root, d));
    if (c && c.includes(PATTERNS.divisionCorrect)) pass(`${d}: Documents patterns`);
    else if (c) warn(`${d}: May need update`);
  }
}

// MAIN
function main() {
  console.log(`\n${C.b}╔════════════════════════════════════════════════════╗${C.x}`);
  console.log(`${C.b}║   SOCCERVIEW DATA LIFECYCLE AUDIT                  ║${C.x}`);
  console.log(`${C.b}╚════════════════════════════════════════════════════╝${C.x}`);
  
  let root = process.cwd();
  if (!fs.existsSync(path.join(root, 'package.json'))) root = path.resolve(root, '..', '..');
  if (!fs.existsSync(path.join(root, 'package.json'))) { console.error('Run from project root'); process.exit(1); }
  
  auditLayer1(root);
  auditLayer2(root);
  auditLayer3(root);
  auditCrossLayer(root);
  
  header('SUMMARY');
  console.log(`${C.g}PASSED: ${results.pass.length}${C.x} | ${C.y}WARNINGS: ${results.warn.length}${C.x} | ${C.r}FAILURES: ${results.fail.length}${C.x}`);
  
  if (results.fail.length > 0) {
    console.log(`\n${C.r}${C.b}FIX THESE:${C.x}`);
    results.fail.forEach((f, i) => console.log(`${C.r}  ${i + 1}. ${f}${C.x}`));
    process.exit(1);
  }
  console.log(`\n${C.g}${C.b}✓ ALL CRITICAL CHECKS PASSED${C.x}`);
}

main();
