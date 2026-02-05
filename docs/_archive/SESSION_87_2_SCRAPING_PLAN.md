# Session 87.2: Complete Heartland + HTGSports Scraping

> **Goal:** Scrape ALL Premier outdoor soccer for 2025-2026 season from Heartland (CGI results + Calendar) and HTGSports, process through V2 pipeline, ensure full data integrity before v1 app launch.

---

## CRITICAL RESEARCH FINDINGS (Session 87.2)

### Heartland Has FOUR Data Access Mechanisms

The previous plan incorrectly declared the CGI "dead". **Deep research proves it's ALIVE but behind Cloudflare protection.** Evidence:

| Evidence | Location | What It Proves |
|----------|----------|----------------|
| `scrapers/heartland_data/working_test_1.html` | Saved HTML | CGI returns real standings (Team, W-L-T, GF, GA, Pts) |
| `scrapers/heartland_data/heartland_standings_2026_01_15.json` | 2,000+ team records | CGI worked 20 days ago (Jan 15, 2026) |
| `scripts/_debug/heartland_standings_analysis.json` | Form analysis | Score-Standings page has forms targeting CGI, results load in iframe |
| `scrapers/heartland_data/_reports_cgi-jrb_subdiv_results_cgi.html` | Error page with Cloudflare script | CGI responds but Cloudflare blocks bare HTTP |

### The Four Sources

| # | Source | URL | Data Type | Technology | Status |
|---|--------|-----|-----------|------------|--------|
| 1 | **CGI Results** | `heartlandsoccer.net/reports/cgi-jrb/subdiv_results.cgi` | Match RESULTS with scores | Cheerio (broken) / **Puppeteer (fix)** | Behind Cloudflare |
| 2 | **CGI Standings** | `heartlandsoccer.net/reports/cgi-jrb/subdiv_standings.cgi` | Team W-L-T-GF-GA-Pts | Same | Behind Cloudflare |
| 3 | **Calendar** | `calendar.heartlandsoccer.net/team/` | Scheduled matches (NULL scores) | Puppeteer | ALIVE (blocked by init bug) |
| 4 | **Blue Sombrero ICS** | `calendar.bluesombrero.com/api/v1/Calendar` | Calendar feeds | HTTP/ICS parsing | Needs discovery params |

### Why Bare HTTP Fails (Cloudflare)

The CGI endpoints live behind Cloudflare protection:
```html
<!-- From saved error page -->
<script data-cfasync="false" src="/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js"></script>
```

Bare HTTP (Cheerio `fetch()`) gets blocked. But the **Score-Standings WordPress page** works because:
1. WordPress page loads in browser -> passes Cloudflare challenge
2. Page has forms with dropdowns targeting CGI endpoints
3. Form results load in an iframe (`id="results-target"`, `name="iresults"`)
4. User clicks "Go!" -> CGI processes request -> results appear in iframe

**Solution:** Use Puppeteer to automate the Score-Standings page form submissions.

### Score-Standings Page Form Structure (from `heartland_standings_analysis.json`)

**Premier Results Form:**
- `id="results-premier-b_g"` -> Boys/Girls
- `id="results-premier-age"` -> U-9 through U-18 (11 options)
- `id="results-premier-subdivison"` -> 1-14 (14 options)
- Submit button: "Go!"
- Form action: `heartlandsoccer.net/reports/cgi-jrb/subdiv_results.cgi`
- Results target: iframe `id="results-target"` / `name="iresults"`

**Premier Standings Form:**
- `id="standings-premier-b_g"` -> Boys/Girls
- `id="standings-premier-age"` -> U-9 through U-18
- `id="standings-premier-subdivison"` -> 1-14
- Form action: `heartlandsoccer.net/reports/cgi-jrb/subdiv_standings.cgi`

**Combinations:** 2 genders x 11 ages x 14 subdivisions = **308 Premier divisions**

### Why Two CGI Sources Were Both Needed (Historical Context)

| CGI Endpoint | Data | Powers | Why Essential |
|-------------|------|--------|---------------|
| `subdiv_results.cgi` | Individual match results WITH scores | ELO calculation, match history, season stats | **Without scores, can't calculate rankings** |
| `subdiv_standings.cgi` | Aggregated team W-L-T records | Standings verification, data integrity check | **Cross-references match data for accuracy** |

The Calendar (Source 3) provides FUTURE scheduled matches with NULL scores - different data entirely. Both results (past) AND calendar (future) are needed for complete coverage.

---

## Execution Plan

### STEP 0: Fix Puppeteer Initialization Bug (5 min)

**File:** `scripts/universal/coreScraper.js`, `initializeTechnology()` method (~line 112)

```javascript
// BEFORE:
if (this.adapter.technology === "puppeteer") {
// AFTER:
if (this.adapter.technology === "puppeteer" || this.adapter.technology === "mixed") {
```

**Why:** Heartland adapter uses `technology: "mixed"`. Without this fix, Puppeteer never initializes for Heartland.

**Status:** [ ]

### STEP 1: Update Heartland Adapter - CGI via Puppeteer

**File:** `scripts/adapters/heartland.js`

**Change:** Replace `scrapeCGIResults()` Cheerio HTTP approach with Puppeteer form automation via Score-Standings page.

**New approach:**
1. Navigate to `https://www.heartlandsoccer.net/league/score-standings/` with Puppeteer
2. Wait for page load + Cloudflare challenge to complete
3. For each Premier division (2 genders x 11 ages x 14 subdivisions):
   a. Select gender from `#results-premier-b_g`
   b. Select age from `#results-premier-age`
   c. Select subdivision from `#results-premier-subdivison`
   d. Click the "Go!" submit button for the Premier Results form
   e. Wait for iframe `#results-target` to load
   f. Extract match data from iframe content (same HTML format as before)
   g. Rate limit between requests
4. Parse the same HTML table format (Date, Game#, Time, Home Team, Home Score, Away Team, Away Score)

**Key detail:** The iframe receives the same HTML that the old direct Cheerio requests got. The parsing logic in `parseResultsHtml()` remains unchanged.

**Also add:** Heartland tournament event IDs on HTGSports for discovery:
- `13008` - 2025 Heartland Open Cup
- `13014` - 2025 Heartland Invitational Tournament - Boys
- `13516` - 2026 Heartland Spring Cup

**Status:** [ ]

### STEP 2: Run Heartland CGI + Calendar Scraper

```bash
node scripts/universal/coreScraper.js --adapter heartland
```

**What happens:**
1. **CGI Results event** (Premier): Puppeteer navigates Score-Standings page, fills forms, extracts results from iframe for all 308 divisions
2. **Calendar event**: Puppeteer searches 14 club terms on `calendar.heartlandsoccer.net`, scrapes team schedules

**Expected:**
- CGI: Hundreds to thousands of match results WITH scores for Fall 2025 + Spring 2026
- Calendar: Scheduled future matches with NULL scores

**Status:** [ ]

### STEP 3: Run HTGSports Scraper

```bash
node scripts/universal/coreScraper.js --adapter htgsports
```

**What it does:**
- 44+ static events (database discovery + static list)
- Puppeteer navigates SPA, iterates division dropdowns, extracts matches
- 2025-2026 season events include Heartland tournaments + multi-state events

**Expected:** ~1,000-5,000 matches to staging

**Status:** [ ]

### STEP 4: Run GotSport Scraper (Active Events)

```bash
node scripts/universal/coreScraper.js --adapter gotsport --active-only
```

**Status:** [ ]

### STEP 5: Process All New Staging Data

```bash
# 5a: Clean staging (reject garbage)
node scripts/universal/intakeValidator.js --clean-staging

# 5b: Process staging -> production (THE ONLY path)
node scripts/universal/dataQualityEngine.js --process-staging
```

**Status:** [ ]

### STEP 6: Run Team Deduplication

```bash
node scripts/universal/deduplication/teamDedup.js --report
# Execute if duplicates found
node scripts/universal/deduplication/teamDedup.js --execute
```

**Status:** [ ]

### STEP 7: Recalculate ELO + Refresh Views

```bash
node scripts/daily/recalculate_elo_v2.js
```

**Status:** [ ]

### STEP 8: Verify Data Integrity

```bash
node scripts/daily/verifyDataIntegrity.js
```

**Verification queries:**
```sql
-- New staging records by source
SELECT source_platform, COUNT(*) FROM staging_games WHERE processed = false GROUP BY 1;

-- Production match counts
SELECT COUNT(*) FROM matches_v2 WHERE deleted_at IS NULL;
SELECT COUNT(*) FROM teams_v2;

-- Cross-reference with Jan 15 standings data
-- Compare W-L-T from CGI standings vs calculated from matches_v2
```

**Status:** [ ]

### STEP 9: Update Scraping Playbook

**File:** `docs/3-DATA_SCRAPING_PLAYBOOK.md`

Add comprehensive Heartland section documenting:
- All 4 data access mechanisms
- Blue Sombrero discovery
- Cloudflare bypass via Puppeteer
- Form structure on Score-Standings page
- Parameter names and dropdown IDs
- HTGSports tournament event IDs for Heartland

**Status:** [ ]

---

## Files to Modify

| File | Change |
|------|--------|
| `scripts/universal/coreScraper.js` | Fix Puppeteer init for "mixed" technology (~line 112) |
| `scripts/adapters/heartland.js` | Replace Cheerio CGI scraping with Puppeteer form automation |
| `docs/3-DATA_SCRAPING_PLAYBOOK.md` | Document all Heartland data mechanisms |

---

## Key Existing Code to Reuse

| File | Function | Reuse |
|------|----------|-------|
| `scripts/adapters/heartland.js:469` | `parseResultsHtml()` | Exact same HTML parsing - iframe returns same format |
| `scripts/adapters/heartland.js:571` | `scrapeCalendarSchedules()` | Calendar scraping unchanged |
| `scripts/scrapers/scrapeHeartlandICS.js` | `parseICS()`, Blue Sombrero API | Future ICS integration |
| `scripts/maintenance/diagnoseHeartlandStandings.js` | Puppeteer diagnostic pattern | Reference for form automation |
| `scripts/_debug/heartland_standings_analysis.json` | Form structure, dropdown IDs | Exact selectors for Puppeteer |

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Cloudflare blocks Puppeteer | Puppeteer runs headful Chrome - passes challenges. Add delays. |
| Score-Standings page changes | Form IDs from analysis JSON. Screenshot diagnostic exists. |
| CGI returns no data for some divisions | Expected - not all 308 combinations have data. Log and continue. |
| HTGSports rate limiting | Adapter has 2-3s delays + exponential backoff |
| Duplicate data | ON CONFLICT DO NOTHING in staging, semantic dedup in pipeline |

---

## Verification Checklist

- [ ] CGI results scraping returns real match data (not 0)
- [ ] Calendar scraping returns scheduled matches
- [ ] HTGSports scraping returns tournament data
- [ ] All new data flows through staging -> intakeValidator -> dataQualityEngine -> production
- [ ] No duplicate teams created
- [ ] ELO recalculated with new match data
- [ ] Views refreshed
- [ ] Data integrity verification passes
- [ ] Scraping Playbook updated with all Heartland mechanisms
