# Phase 1 Audit Report: Script Inventory & Pattern Analysis

## Universal Data Pipeline - Preparatory Audit

**Date:** January 29, 2026
**Prepared by:** Claude (Technical SME)
**Purpose:** Inventory all existing scripts and document patterns to preserve before designing the Universal Framework

---

## Executive Summary

**Total Scripts Audited:** 20 active production scripts
**Archived Scripts Reviewed:** 10 key legacy scripts for pattern extraction
**Critical Patterns Identified:** 12 patterns that MUST be preserved

### Key Findings

1. **V2 Architecture is Solid** - All active scripts correctly use the 3-layer architecture (staging → production → views)
2. **Rate Limiting is Critical** - Every scraper implements custom rate limiting with exponential backoff
3. **Checkpoint/Resume is Essential** - Batch scripts save progress after every operation for resumability
4. **Team Linking is Complex** - Multiple strategies cascade (exact → suffix-stripped → prefix → fuzzy)
5. **Inference Linkage is Self-Healing** - The nightly inference system learns from team-event relationships

---

## Script Inventory

### 1. Daily Pipeline Scripts (`scripts/daily/`)

| Script | Purpose | Key Logic | Lines |
|--------|---------|-----------|-------|
| `syncActiveEvents.js` | GotSport data collection | Finds active events by match activity, scrapes groups, writes to staging_games | 436 |
| `validationPipeline.js` | Staging → Production | Team creation/linking, event creation, birth year parsing, fuzzy matching | 903 |
| `recalculate_elo_v2.js` | ELO calculation | Dynamic season from DB, in-memory calculation, batch SQL updates | 398 |
| `scorePredictions.js` | Score user predictions | Team name cleaning, FK lookup, fallback to name matching | 411 |
| `captureRankSnapshot.js` | Daily rank history | Paginated fetching, upsert to rank_history_v2 | 150 |
| `compute_rankings_daily.js` | Rankings computation | (Lightweight wrapper) | ~50 |

**Total Daily Pipeline:** ~2,348 lines of production logic

---

### 2. Scraper Scripts (`scripts/scrapers/`)

| Script | Source | Technology | Key Features | Lines |
|--------|--------|------------|--------------|-------|
| `scrapeHTGSports.js` | HTGSports | Puppeteer | Division iteration, SPA handling, 100+ tournaments hardcoded | 521 |
| `scrapeHeartlandLeague.js` | Heartland Calendar | Puppeteer | Team search, schedule scraping | 530 |
| `scrapeHeartlandResults.js` | Heartland CGI | Cheerio (HTML) | Premier/Recreational leagues, subdivision iteration | 444 |
| `discoverHTGSportsEvents.js` | HTGSports | Puppeteer | Event discovery for manual addition | 141 |
| `scrapeHeartlandICS.js` | Heartland ICS | Cheerio | Calendar parsing | ~200 |
| `scrapePriorityTeams.js` | GotSport API | Fetch | Priority team scraping | ~300 |

**Total Scrapers:** ~2,136 lines of scraping logic

---

### 3. Maintenance Scripts (`scripts/maintenance/`)

| Script | Purpose | Key Logic |
|--------|---------|-----------|
| `inferEventLinkage.js` | **CRITICAL** Self-healing orphan matches | Builds team-event relationships, infers linkage by common event + date range |
| `linkUnlinkedMatches.js` | Link via source_match_key | Direct FK linking for matches with exact keys |
| `linkByEventPattern.js` | Link by event ID pattern | HTGSports/Heartland event ID extraction and linking |
| `linkFromV1Archive.js` | Link from V1 data | Joins V2 matches to V1 archived data by date+team |
| `completeBirthYearCleanup.js` | Merge duplicates, fix birth years | Finds duplicates by canonical name, merges match history |
| `cleanupGarbageMatches.js` | Delete invalid matches | Removes 2027+ dated matches, U1/U2 garbage |
| `checkStatus.js` | Database health check | Match counts, link rates, view status |
| `nightlyQC.js` | Nightly quality control | Validation and reporting |
| `validateDataIntegrity.js` | Data integrity checks | Foreign key validation, orphan detection |

---

### 4. Batch/Onetime Scripts (`scripts/onetime/`)

| Script | Purpose | Key Features |
|--------|---------|--------------|
| `runTeamScraperBatch.js` | Batch team scraping from GotSport | SERVICE_ROLE_KEY, checkpoint saving, DB write verification, exponential backoff |
| `runEventScraperBatch.js` | Batch event scraping | Checkpoint/resume, HTML scraping with Cheerio, event status tracking |

---

### 5. Key Archived Scripts (`scripts/_archive/`)

| Script | Pattern to Extract |
|--------|-------------------|
| `fastLinkV3.js` | pg_trgm fuzzy matching with 0.75 threshold, alias learning |
| `linkTeams.js` | 4-strategy cascade: exact → suffix-stripped → 30-char prefix → 20-char prefix |
| `linkMatchesComprehensive.js` | Birth year validation in linking |
| `reconcileRankedTeams.js` | Cross-platform team reconciliation |

---

## Critical Patterns to Preserve

### Pattern 1: Rate Limiting Configuration
```javascript
// From syncActiveEvents.js
const CONFIG = {
  REQUEST_DELAY_MIN: 1500,
  REQUEST_DELAY_MAX: 3000,
  GROUP_DELAY: 800,
  EVENT_DELAY: 3000,
  MAX_RETRIES: 3,
  RETRY_DELAYS: [5000, 15000, 30000],
};
```
**Must Preserve:** Variable delays, exponential backoff, configurable per-source

### Pattern 2: User Agent Rotation
```javascript
// From all scrapers
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36...",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)...",
];
function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}
```
**Must Preserve:** Rotation logic, realistic browser fingerprints

### Pattern 3: Checkpoint/Resume Logic
```javascript
// From runEventScraperBatch.js
function saveCheckpoint(lastEventId, processedEventIds) {
  const checkpoint = {
    lastEventId,
    processedEventIds: Array.from(processedEventIds),
    lastRun: new Date().toISOString(),
    stats: { ...stats },
  };
  fs.writeFileSync(CONFIG.CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2));
}
```
**Must Preserve:** Per-operation checkpointing, stats preservation, file-based persistence

### Pattern 4: Database Write Verification
```javascript
// From runTeamScraperBatch.js
async function testDatabaseWrite() {
  // Test read capability
  const { count, error } = await supabase.from("table").select("*", { count: "exact", head: true });
  // Test write capability with dummy record
  const { error: writeError } = await supabase.from("table").upsert([testRecord]);
  // Verify the write succeeded
  const { data: verifyData } = await supabase.from("table").select("id").eq("id", testId);
  // Clean up test record
  await supabase.from("table").delete().eq("id", testId);
}
```
**Must Preserve:** Pre-flight write test, SERVICE_ROLE_KEY validation

### Pattern 5: Birth Year Extraction (Priority-Based)
```javascript
// From validationPipeline.js
function extractBirthYear(teamName, seasonYear) {
  // Priority 1: Full 4-digit birth year (e.g., "Sporting 2013B")
  const fullYearMatch = name.match(/\b(20[01]\d)\b/);

  // Priority 2: 2-digit year after gender (e.g., "B14", "G15")
  const twoDigitPatterns = [/[BG](\d{2})(?![0-9])/i, /(\d{2})[BG](?![0-9])/i];

  // Priority 3: Back-calculate from age group (e.g., "U12")
  const ageGroupMatch = name.match(/\bU[-\s]?(\d+)\b/i);

  // Priority 4: Return null
}
```
**Must Preserve:** Priority order, season-aware calculation, validation bounds

### Pattern 6: Suffix Stripping Regex
```javascript
// From linkTeams.js
const strippedName = REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', '');
// Removes: " (U13 Boys)" suffix from "Sporting KC 2013 (U13 Boys)"
```
**Must Preserve:** Exact regex pattern for team_elo → match_results matching

### Pattern 7: Fuzzy Matching with pg_trgm
```javascript
// From fastLinkV3.js
const match = await client.query(`
  SELECT team_id, alias_name, similarity(alias_name, $1) as sim
  FROM team_name_aliases
  WHERE alias_name % $1
  ORDER BY sim DESC LIMIT 1
`, [nameLower]);

if (match.rows.length > 0 && parseFloat(match.rows[0].sim) >= 0.75) {
  // Accept match
}
```
**Must Preserve:** 0.75 similarity threshold, pg_trgm `%` operator usage

### Pattern 8: Inference Linkage Algorithm
```javascript
// From inferEventLinkage.js
// 1. For each unlinked match, get home_team and away_team
// 2. Find what events these teams play in (from their LINKED matches)
// 3. If both teams share a common event, AND match date fits (±30 days), link it
// 4. Single-team inference: if team only plays in ONE event, infer that event
```
**Must Preserve:** Team-event relationship building, date range extension (±30 days), fallback to single-team inference

### Pattern 9: HTML Parsing (Cheerio) for Static Sites
```javascript
// From scrapeHeartlandResults.js
const $ = cheerio.load(html);
$("table tr").each((i, row) => {
  const cells = $(row).find("td");
  // Column index mapping specific to each source
});
```
**Must Preserve:** Source-specific column mappings, error-tolerant parsing

### Pattern 10: Puppeteer for SPAs
```javascript
// From scrapeHTGSports.js
await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
await sleep(CONFIG.PAGE_LOAD_WAIT);

// Select division dropdown and iterate
const changed = await page.evaluate((divValue) => {
  select.value = divValue;
  select.dispatchEvent(new Event("change", { bubbles: true }));
});
await sleep(CONFIG.DIVISION_WAIT);
```
**Must Preserve:** networkidle2 wait strategy, dropdown iteration, event dispatch

### Pattern 11: Source Match Key Generation
```javascript
// GotSport: `gotsport-${eventId}-${matchNumber}`
// HTGSports: `htg-${eventId}-${matchId}`
// Heartland: `heartland-${level}-${homeId}-${awayId}-${date}-${gameNum}`
```
**Must Preserve:** Source-specific key formats for deduplication

### Pattern 12: Staging Table Schema
```javascript
// All scrapers write to this structure:
const stagingGame = {
  match_date,
  match_time,
  home_team_name,
  away_team_name,
  home_score,
  away_score,
  event_name,
  event_id,
  venue_name,
  field_name,
  division,
  source_platform,    // "gotsport", "htgsports", "heartland"
  source_match_key,   // Unique key per source
  raw_data: { ... },  // Original response preserved
  processed: false,
};
```
**Must Preserve:** Exact schema, raw_data JSONB preservation

---

## Edge Cases Discovered

### Edge Case 1: Team Names with Special Characters
```
- Names like "KC Fusion '15" (apostrophe)
- Names like "St. Louis FC" (periods)
- Names like "Team (Guest)" (parentheses in middle)
```
**Handling:** All linking scripts use parameterized queries to avoid SQL injection

### Edge Case 2: Birth Year Ambiguity
```
- "Pre-NAL 14" could be 2014 or age 14
- "U12" could be different birth years in different seasons
```
**Handling:** Priority-based parsing with season year context

### Edge Case 3: Duplicate Events Across Sources
```
- Same tournament on GotSport AND HTGSports
- Different event IDs but same matches
```
**Handling:** source_match_key deduplication in validation pipeline

### Edge Case 4: Rate Limiting Variability
```
- GotSport: 429 requires 60-180s cooldown
- HTGSports: More lenient but requires SPA load wait
- Heartland CGI: Standard 500ms is sufficient
```
**Handling:** Per-source CONFIG objects with custom delays

### Edge Case 5: Scheduled vs Completed Matches
```
- 0-0 score could be scheduled or actual draw
- Match date comparison determines status
```
**Handling:** Date-based status detection in all scrapers

---

## GitHub Actions Integration

### Current Pipeline Structure (MUST PRESERVE)
```yaml
# .github/workflows/daily-data-sync.yml

Phase 1: Data Collection
  - syncActiveEvents.js (GotSport)
  - scrapeHTGSports.js --active-only (HTGSports)
  - scrapeHeartlandResults.js (Heartland)

Phase 2: Validation
  - validationPipeline.js --refresh-views

Phase 2.5: Inference Linkage (CRITICAL)
  - inferEventLinkage.js

Phase 3: ELO Calculation
  - recalculate_elo_v2.js

Phase 4: Score Predictions
  - scorePredictions.js

Phase 5: Summary
  - Logging and notifications
```

---

## Recommendations for Universal Framework Design

### 1. Source Adapter Requirements
Each adapter config must support:
- [ ] Custom rate limiting (min delay, max delay, backoff multipliers)
- [ ] Technology selection (fetch/cheerio/puppeteer)
- [ ] Column/selector mappings specific to source
- [ ] Source match key format
- [ ] Checkpoint file location

### 2. Core Engine Requirements
- [ ] Read adapter config at runtime
- [ ] Support all three scraping technologies
- [ ] Write to staging_games with exact schema
- [ ] Preserve raw_data JSONB
- [ ] Implement checkpoint/resume

### 3. Promotion Engine Requirements
- [ ] All 4 linking strategies from linkTeams.js
- [ ] pg_trgm fuzzy matching with 0.75 threshold
- [ ] Birth year validation
- [ ] Suffix stripping regex
- [ ] Inference linkage integration

### 4. Non-Negotiable Constraints
- [ ] SERVICE_ROLE_KEY for all writes (bypass RLS)
- [ ] Pre-flight database write test
- [ ] GitHub Actions timeout compatibility
- [ ] Zero data loss during migration

---

## Test Cases from Real Data

### Test Case 1: GotSport Event Scraping
```
Input: Event ID 30789
Expected: Discover N groups, scrape M matches, generate unique keys
Verify: Matches in staging_games with source_platform="gotsport"
```

### Test Case 2: Team Linking Cascade
```
Input: Team name "SPORTING BV Pre-NAL 15"
Strategy 1 (exact): No match
Strategy 2 (suffix-stripped): No match
Strategy 3 (30-char prefix + birth year): Match to "Sporting Blue Valley SPORTING BV Pre-NAL 15 (U15 Boys)"
Verify: home_team_id populated correctly
```

### Test Case 3: Inference Linkage
```
Input: Orphaned match (Team A vs Team B, date 2025-09-15, no league_id)
Team A plays in: Kansas Premier League (dates 2025-08-01 to 2025-11-30)
Team B plays in: Kansas Premier League (dates 2025-08-01 to 2025-11-30)
Expected: Match linked to Kansas Premier League
```

### Test Case 4: Birth Year Extraction
```
Input: "FC Dallas 2012 Red"
Expected: birth_year=2012, birth_year_source="parsed_4digit"

Input: "Rush B14 Premier"
Expected: birth_year=2014, birth_year_source="parsed_2digit"

Input: "Nationals U13 Girls"
Expected: birth_year=2013 (if season_year=2026), birth_year_source="parsed_age_group"
```

---

## Gap Analysis: Current vs. Universal

| Feature | Current Implementation | Universal Framework Need |
|---------|----------------------|-------------------------|
| Rate limiting | Hardcoded per script | Adapter config |
| Column mappings | Hardcoded per source | Adapter config |
| Technology choice | Hardcoded (Cheerio vs Puppeteer) | Adapter config |
| Event discovery | Manual list maintenance | Automated discovery |
| Checkpoint format | File per script | Centralized checkpoint |
| Error handling | Script-specific | Standardized |

---

## Approval Checklist

Before proceeding to Phase 2, please confirm:

- [ ] You've reviewed the script inventory
- [ ] You understand the 12 critical patterns that must be preserved
- [ ] You agree with the edge cases identified
- [ ] You accept the test cases as validation criteria
- [ ] You approve moving to Phase 2: Framework Design

**STOP AND WAIT FOR USER APPROVAL**

---

## Appendix A: Full Script Count

```
scripts/daily/          6 scripts (production)
scripts/scrapers/       6 scripts (production)
scripts/maintenance/   30 scripts (mixed production/diagnostic)
scripts/onetime/       13 scripts (one-time utilities)
scripts/migrations/    17 scripts (database migrations)
scripts/_archive/      50+ scripts (deprecated V1)
scripts/_debug/        13 scripts (debug utilities)
─────────────────────────────────
TOTAL:                135+ scripts
```

## Appendix B: Database Tables Used

| Table | Purpose | Row Count |
|-------|---------|-----------|
| staging_games | Raw scraped data | Variable |
| staging_events | Raw event data | Variable |
| staging_teams | Raw team data | Variable |
| matches_v2 | Production matches | 300,564 |
| teams_v2 | Production teams | 142,541 |
| leagues | League metadata | 280 |
| tournaments | Tournament metadata | 1,514 |
| rank_history_v2 | Daily rank snapshots | Growing |

---

*End of Phase 1 Audit Report*
