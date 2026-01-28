# SoccerView Data Scraping Playbook

> **Version 1.0** | Created: January 27, 2026
>
> Comprehensive, repeatable process for expanding the SoccerView database.
> Execute this playbook nightly to maximize data coverage before V1 launch.

---

## Quick Start: Nightly Execution

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    NIGHTLY DATA EXPANSION WORKFLOW                      │
│                                                                         │
│   1. User: "Run data scraping playbook for [SOURCE NAME]"               │
│   2. Claude: Executes Phase 1-7 automatically                           │
│   3. Claude: Reports results + updates CLAUDE.md                        │
│   4. Morning: User reviews results during QC session                    │
└─────────────────────────────────────────────────────────────────────────┘
```

**To Execute:** Simply tell Claude:
> "Run the Data Scraping Playbook for [source name from Priority Queue]"

---

## Table of Contents

1. [Data Accountability Checklist](#1-data-accountability-checklist)
2. [Database Schema Readiness](#2-database-schema-readiness)
3. [7-Phase Scraping Process](#3-seven-phase-scraping-process)
4. [Data Source Inventory](#4-data-source-inventory)
5. [Gap Analysis & Priority Queue](#5-gap-analysis--priority-queue)
6. [UI Integration Checklist](#6-ui-integration-checklist)
7. [Background QC Procedures](#7-background-qc-procedures)
8. [Rollback & Recovery](#8-rollback--recovery)

---

## 1. Data Accountability Checklist

> **Every scraper MUST capture these fields. Missing fields = incomplete integration.**

### Required Data Fields (MUST HAVE)

| Category | Field | Database Column | Priority | Notes |
|----------|-------|-----------------|----------|-------|
| **Match Identity** | Match ID | `source_match_key` | 🔴 CRITICAL | Deduplication key |
| **Match Identity** | Source Platform | `source_platform` | 🔴 CRITICAL | e.g., "gotsport", "htgsports" |
| **Match Identity** | Event ID | `event_id` | 🔴 CRITICAL | Links to event_registry |
| **Teams** | Home Team Name | `home_team_name` | 🔴 CRITICAL | Raw name from source |
| **Teams** | Away Team Name | `away_team_name` | 🔴 CRITICAL | Raw name from source |
| **Scheduling** | Match Date | `match_date` | 🔴 CRITICAL | ISO format YYYY-MM-DD |
| **Scheduling** | Match Time | `match_time` | 🟠 HIGH | HH:MM format |
| **Results** | Home Score | `home_score` | 🔴 CRITICAL | NULL if not played yet |
| **Results** | Away Score | `away_score` | 🔴 CRITICAL | NULL if not played yet |
| **Classification** | Age Group | `age_group` | 🟠 HIGH | e.g., "U13", "U17" |
| **Classification** | Gender | `gender` | 🟠 HIGH | "Boys" or "Girls" |
| **Classification** | Division | `division` | 🟡 MEDIUM | e.g., "Premier", "Gold" |
| **Location** | State | `state` | 🟠 HIGH | 2-letter code |
| **Location** | Venue/Field | `venue` | 🟡 MEDIUM | Field name if available |

### Required Event Registry Fields

| Field | Column | Priority | Notes |
|-------|--------|----------|-------|
| Event ID | `event_id` | 🔴 CRITICAL | Must match match_results.event_id |
| Event Name | `event_name` | 🔴 CRITICAL | Human readable |
| Source Type | `source_type` | 🔴 CRITICAL | **"league" OR "tournament"** |
| Source Platform | `source_platform` | 🔴 CRITICAL | e.g., "htgsports" |
| Match Count | `match_count` | 🟠 HIGH | Total matches in event |
| State | `state` | 🟠 HIGH | Primary state |
| Region | `region` | 🟡 MEDIUM | e.g., "Kansas City" |
| Season | `season` | 🟡 MEDIUM | e.g., "2025" |
| Start Date | `start_date` | 🟡 MEDIUM | Event start |
| End Date | `end_date` | 🟡 MEDIUM | Event end |

### Data Quality Rules

| Rule | Validation | Action if Failed |
|------|------------|------------------|
| No duplicate matches | Check `source_match_key` unique | Skip insert, log warning |
| Valid date format | YYYY-MM-DD regex | Parse and convert |
| Score is numeric | Integer >= 0 | Set NULL if invalid |
| Team names not empty | Length > 0 | Skip match, log error |
| Event registered | event_id in event_registry | **CREATE registry entry first** |
| State is valid | 2-letter US state code | Infer from source or set NULL |

---

## 2. Database Schema Readiness

### Current Schema Status: ✅ READY

The SoccerView database is optimized for multi-source data injection:

```sql
-- Core Tables
teams                 -- 149,000 rows, source_name column for multi-source
match_results         -- 470,135 rows, source_platform + source_match_key for dedup
event_registry        -- 1,761 rows, source_type for league vs tournament
team_name_aliases     -- 352,000 rows, fuzzy matching support

-- Key Indexes
idx_match_results_source_match_key_unique  -- Prevents duplicates
idx_match_results_source_platform          -- Fast source filtering
idx_teams_reconciliation_priority          -- Fast linking
idx_teams_reconciliation_candidates        -- Fuzzy matching
```

### Pre-Scrape Database Checklist

Run before ANY new source integration:

```javascript
// scripts/preScrapeAudit.js - Run this first
const checks = [
  { name: "match_results has source_match_key", status: "✅" },
  { name: "match_results has source_platform", status: "✅" },
  { name: "event_registry has source_type", status: "✅" },
  { name: "teams has source_name", status: "✅" },
  { name: "Unique constraint on source_match_key", status: "✅" },
  { name: "pg_trgm extension enabled", status: "✅" },
];
```

### Schema Extensions Needed (Future)

| Extension | Purpose | Priority | Status |
|-----------|---------|----------|--------|
| `upcoming_matches` view | Separate future vs past matches | 🟡 MEDIUM | Planned |
| `team_schedules` table | Direct schedule storage | 🟡 MEDIUM | Planned |
| `source_health` table | Track source reliability | 🟢 LOW | Planned |

---

## 3. Seven-Phase Scraping Process

### Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     7-PHASE SCRAPING PROCESS                            │
│                                                                         │
│  Phase 1: Source Identification & Research           (15-30 min)        │
│     ↓                                                                   │
│  Phase 2: Access & API Evaluation                    (15-30 min)        │
│     ↓                                                                   │
│  Phase 3: Go/No-Go Decision                          (5 min)            │
│     ↓                                                                   │
│  Phase 4: Scraper Development                        (30-120 min)       │
│     ↓                                                                   │
│  Phase 5: Data Extraction & Injection                (varies)           │
│     ↓                                                                   │
│  Phase 6: Integration Pipeline                       (30-60 min)        │
│     ↓                                                                   │
│  Phase 7: Verification & Documentation               (15 min)           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### Phase 1: Source Identification & Research

**Objective:** Understand what data exists and where it lives.

#### 1.1 Initial Discovery

```markdown
## Source Research Checklist

- [ ] Source name: ____________________
- [ ] Website URL: ____________________
- [ ] Geographic coverage: ____________________
- [ ] Data type: [ ] League  [ ] Tournament  [ ] Both
- [ ] Approximate team count: ____________________
- [ ] Approximate match count: ____________________
- [ ] Date range available: ____________________
```

#### 1.2 Data Availability Assessment

| Question | Answer | Impact |
|----------|--------|--------|
| Does source have **MATCH RESULTS** with scores? | Yes/No | If No: Schedule-only source |
| Does source have **UPCOMING SCHEDULES**? | Yes/No | Key differentiator for parents |
| Does source have **TEAM ROSTERS**? | Yes/No | Future feature |
| Does source have **STANDINGS/TABLES**? | Yes/No | Can cross-reference |
| What **DATE RANGE** is available? | ____ | Need Aug 2023+ minimum |
| Is data **PUBLICLY ACCESSIBLE**? | Yes/No | If No: May need auth |

#### 1.3 Platform Technical Analysis

```markdown
## Technical Discovery

- [ ] Platform type: [ ] Static HTML  [ ] SPA (React/Angular/Vue)  [ ] API-based
- [ ] Authentication required: [ ] None  [ ] Login  [ ] API Key
- [ ] Anti-scraping measures: [ ] None  [ ] Rate limits  [ ] Captcha  [ ] IP blocking
- [ ] Data format: [ ] HTML tables  [ ] JSON API  [ ] ICS/iCal  [ ] PDF
- [ ] URL pattern identified: ____________________
- [ ] Division/bracket selector: [ ] Dropdown  [ ] Tabs  [ ] URL params
```

---

### Phase 2: Access & API Evaluation

**Objective:** Determine HOW to access the data efficiently.

> ⚠️ **CRITICAL MANDATE: EXHAUSTIVE RESEARCH REQUIRED**
>
> Claude MUST use ALL means necessary to find data access methods. Do NOT give up after checking obvious paths.
> The data exists - the job is to find the door. Be creative, persistent, and thorough.

#### 2.1 Exhaustive API Discovery Protocol

**Claude MUST check ALL of the following before declaring "no access":**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    MANDATORY RESEARCH CHECKLIST                         │
│                                                                         │
│   □ Browser DevTools → Network tab (XHR/Fetch filter)                   │
│   □ View Page Source → Search for "api", "endpoint", "fetch"            │
│   □ JavaScript files → Search for API URLs, tokens, endpoints           │
│   □ robots.txt → Often reveals hidden paths                             │
│   □ sitemap.xml → May list data pages                                   │
│   □ /.well-known/ directory                                             │
│   □ /api/, /v1/, /v2/, /data/, /export/ paths                          │
│   □ GraphQL endpoints (/graphql, /__graphql)                           │
│   □ WebSocket connections (ws://, wss://)                              │
│   □ iCal/ICS feeds (webcal://, .ics files)                             │
│   □ RSS/Atom feeds                                                      │
│   □ Embedded iframes → Check iframe src URLs                           │
│   □ Mobile app → Reverse engineer API calls                            │
│   □ Third-party integrations (Zapier, webhooks)                        │
│   □ Public GitHub repos → Search for scrapers others built             │
│   □ Archive.org Wayback Machine → Old API versions may still work      │
│   □ Google search: "site:example.com api" or "example.com scraper"     │
│   □ Developer documentation (even if hidden)                            │
│   □ URL parameter fuzzing (?format=json, ?export=true, etc.)           │
│   □ CGI-bin directories (legacy but often data-rich)                   │
│   └─────────────────────────────────────────────────────────────────────┘
```

#### 2.2 Hidden Endpoint Discovery Techniques

**JavaScript Analysis:**
```javascript
// Search loaded JS files for API patterns
const patterns = [
  /https?:\/\/[^"'\s]+api[^"'\s]*/gi,
  /\/api\/v\d+\/[^"'\s]*/gi,
  /fetch\s*\(\s*["']([^"']+)["']/gi,
  /axios\.(get|post)\s*\(\s*["']([^"']+)["']/gi,
  /endpoint['":\s]+["']([^"']+)["']/gi,
];
```

**URL Parameter Experiments:**
```
# Try appending these to data pages:
?format=json
?format=xml
?export=csv
?download=true
?raw=true
?callback=jsonp
?_format=json
.json (at end of URL)
/json (at end of path)
```

**Common Hidden Paths:**
```
/api/                    # Standard API
/rest/                   # REST API
/services/               # Service endpoints
/data/                   # Data exports
/export/                 # Export functionality
/reports/                # Report generators
/cgi-bin/                # Legacy CGI scripts
/feeds/                  # RSS/data feeds
/calendar/               # Calendar data
/schedule/               # Schedule data
/_next/data/             # Next.js data
/__api__/                # Internal APIs
```

#### 2.3 Platform-Specific Backdoors

| Platform Type | Known Access Methods |
|---------------|---------------------|
| **Stack Sports** | Blue Sombrero calendar API (`webcal://calendar.bluesombrero.com/api/v1/Calendar`) |
| **Demosphere** | Often has `/services/` REST endpoints, check Network tab |
| **PlayMetrics** | JSON API, may need auth token from login flow |
| **SportsEngine** | Has public schedule widgets with JSON data |
| **TeamSnap** | REST API with OAuth, also has iCal exports |
| **LeagueApps** | GraphQL API, check `/graphql` endpoint |
| **GotSport** | HTML tables + hidden JSON in page source |
| **HTGSports** | Division dropdown triggers XHR, intercept those calls |
| **Affinity** | Schedule pages often have .ics download links |

#### 2.4 When Standard Methods Fail

```
If no obvious API exists, try these advanced techniques:

1. MOBILE APP ANALYSIS
   - Download the organization's mobile app (if exists)
   - Use proxy tool (Charles, mitmproxy) to intercept API calls
   - Mobile apps often use cleaner APIs than websites

2. EMBED/WIDGET ANALYSIS
   - Many sites embed schedules from third parties
   - The iframe src URL often has direct data access
   - Example: <iframe src="https://data.provider.com/embed/12345">

3. PARTNER/AFFILIATE SITES
   - The same data may appear on partner sites with better access
   - Search for the organization name + "schedule" or "results"

4. WAYBACK MACHINE
   - https://web.archive.org/web/*/example.com/*
   - Old versions of sites may have exposed APIs
   - Old documentation pages may reveal endpoints

5. SEARCH FOR EXISTING SCRAPERS
   - GitHub: "site_name scraper" or "site_name api"
   - Someone may have already solved this problem
```

#### 2.5 Access Method Decision Tree

```
                    Is there a public API?
                           │
              ┌────────────┴────────────┐
              │                         │
             YES                       NO
              │                         │
              ▼                         ▼
    Use API directly          Did you check ALL items in 2.1?
    (fastest, most reliable)            │
                              ┌─────────┴─────────┐
                              │                   │
                              NO                 YES
                              │                   │
                              ▼                   ▼
                      GO BACK AND           Is it a Single Page App?
                      CHECK THEM ALL               │
                                          ┌───────┴───────┐
                                          │               │
                                         YES             NO
                                          │               │
                                          ▼               ▼
                                    Use Puppeteer   Use HTTP fetch
                                    (DOM scraping)  (HTML parsing)
```

#### 2.6 Rate Limit & Access Testing

```javascript
// Test access pattern
const testAccess = async () => {
  // 1. Single request test
  const response = await fetch(targetUrl);
  console.log("Status:", response.status);
  console.log("Headers:", response.headers);

  // 2. Check for rate limit headers
  // X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After

  // 3. Test 5 requests in sequence
  for (let i = 0; i < 5; i++) {
    await fetch(targetUrl);
    await sleep(1000); // 1 second delay
  }
  // If all succeed: safe to proceed
  // If 429 errors: need longer delays
};
```

#### 2.7 Document EVERYTHING

Even failed attempts are valuable - document what you tried so we don't repeat work:

```markdown
## Source: [Name] - Access Research

### Attempted Methods
1. ✅/❌ Network tab analysis - [findings]
2. ✅/❌ robots.txt check - [findings]
3. ✅/❌ API path fuzzing - [findings]
4. ✅/❌ JavaScript analysis - [findings]
5. ✅/❌ Mobile app analysis - [findings]
6. ✅/❌ iCal/RSS feeds - [findings]
7. ✅/❌ GitHub scraper search - [findings]
8. ✅/❌ Wayback Machine - [findings]

### Verified Access Method
[Document the working method with full details]

### Code Sample
[Working code snippet to access the data]
```

---

### Phase 3: Go/No-Go Decision

**Objective:** Make informed decision before investing development time.

#### 3.1 Go/No-Go Checklist

| Criterion | Requirement | Status | Weight |
|-----------|-------------|--------|--------|
| **Data Quality** | Has match scores (not just schedules) | ⬜ | 🔴 CRITICAL |
| **Data Volume** | 1,000+ matches available | ⬜ | 🔴 CRITICAL |
| **Access Method** | Can access without login/API key | ⬜ | 🟠 HIGH |
| **Legal/ToS** | No explicit scraping prohibition | ⬜ | 🟠 HIGH |
| **Date Range** | Has data from Aug 2023+ | ⬜ | 🟠 HIGH |
| **Geographic Gap** | Fills underserved region | ⬜ | 🟠 HIGH |
| **Technical Feasibility** | Achievable in <2 hours dev time | ⬜ | 🟡 MEDIUM |

#### 3.2 Decision Matrix

| Score | Decision | Action |
|-------|----------|--------|
| 6-7 Critical/High ✅ | **GO** | Proceed to Phase 4 |
| 4-5 Critical/High ✅ | **CONDITIONAL GO** | Proceed with caution, document limitations |
| <4 Critical/High ✅ | **NO GO** | Document findings, move to next source |

#### 3.3 No-Go Documentation

If NO GO, record:
```markdown
## Source: [Name] - NO GO

**Date:** YYYY-MM-DD
**Reason:** [Primary reason for rejection]
**Blocker:** [Specific technical/legal/data issue]
**Revisit Trigger:** [Condition that would change decision]
```

---

### Phase 4: Scraper Development

**Objective:** Build robust scraper following established patterns.

#### 4.1 Scraper Template

```javascript
// scripts/scrape[SourceName].js

const { createClient } = require("@supabase/supabase-js");
const puppeteer = require("puppeteer"); // If SPA

// Configuration
const CONFIG = {
  SOURCE_NAME: "source_name",
  SOURCE_PLATFORM: "source_platform",
  BASE_URL: "https://...",
  RATE_LIMIT_MS: 2000, // Delay between requests
  BATCH_SIZE: 100,     // Records per upsert
  EVENT_IDS: [
    // List of event/league IDs to scrape
  ],
};

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Main scraper function
async function scrapeSource() {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Starting ${CONFIG.SOURCE_NAME} scraper`);
  console.log(`${"=".repeat(60)}\n`);

  const stats = {
    eventsProcessed: 0,
    matchesFound: 0,
    matchesInserted: 0,
    matchesSkipped: 0,
    errors: [],
  };

  // ... scraping logic

  return stats;
}

// Event registry helper (CRITICAL)
async function ensureEventRegistered(eventId, eventName, sourceType) {
  const { data: existing } = await supabase
    .from("event_registry")
    .select("event_id")
    .eq("event_id", eventId)
    .single();

  if (!existing) {
    await supabase.from("event_registry").insert({
      event_id: eventId,
      event_name: eventName,
      source_type: sourceType, // "league" OR "tournament"
      source_platform: CONFIG.SOURCE_PLATFORM,
      match_count: 0, // Updated after scrape
    });
    console.log(`  ✅ Registered event: ${eventName}`);
  }
}

// Match upsert with deduplication
async function upsertMatches(matches) {
  const { data, error } = await supabase
    .from("match_results")
    .upsert(matches, {
      onConflict: "source_match_key",
      ignoreDuplicates: false, // Update existing
    });

  if (error) throw error;
  return data;
}

// Run
scrapeSource()
  .then(stats => {
    console.log("\n📊 Final Stats:", stats);
    process.exit(0);
  })
  .catch(err => {
    console.error("❌ Fatal error:", err);
    process.exit(1);
  });
```

#### 4.2 Required Scraper Features

| Feature | Implementation | Why |
|---------|----------------|-----|
| **Deduplication** | Use `source_match_key` unique constraint | Prevents duplicate matches |
| **Event Registry** | Call `ensureEventRegistered()` first | Required for League Standings |
| **Rate Limiting** | `await sleep(CONFIG.RATE_LIMIT_MS)` | Avoid IP blocks |
| **Error Handling** | Try/catch with continue | Don't stop on single failure |
| **Progress Logging** | Console output every N records | Monitor long-running scrapes |
| **Stats Tracking** | Count found/inserted/skipped | Verify success |
| **Checkpoint Resume** | Save progress to file | Resume interrupted scrapes |

#### 4.2.1 🚨 SCRAPER ROBUSTNESS: LESSONS LEARNED

> **CRITICAL:** Our early scrapers failed repeatedly due to these issues.
> EVERY new scraper MUST address ALL of these or it WILL break.

##### Lesson 1: Division/Bracket Dropdown Iteration

**The Problem (Session 40 - HTGSports):**
- Original scraper captured only 1-3 matches per event
- Expected: 500-800 matches per event
- Root cause: Parser wasn't iterating through division dropdown

**The Fix:**
```javascript
// ❌ WRONG - Only captures default view
const matches = await page.evaluate(() => parseTable());

// ✅ CORRECT - Iterate ALL divisions
const divisionDropdown = await page.$('select.division-selector');
const options = await divisionDropdown.$$('option');

for (const option of options) {
  await option.click();
  await page.waitForTimeout(2000); // Wait for dynamic reload
  const divMatches = await page.evaluate(() => parseTable());
  allMatches.push(...divMatches);
}
```

**MANDATORY CHECK:**
```
□ Does the source have division/bracket dropdowns?
□ Does the scraper iterate through ALL options?
□ Does it wait for dynamic content after each selection?
```

##### Lesson 2: Dynamic Content Loading (SPAs)

**The Problem:**
- HTML captured before JavaScript finished loading data
- Empty tables or partial data

**The Fix:**
```javascript
// ❌ WRONG - Immediate capture
await page.goto(url);
const html = await page.content();

// ✅ CORRECT - Wait for data
await page.goto(url);
await page.waitForSelector('table.game-data', { timeout: 10000 });
await page.waitForFunction(() => {
  const rows = document.querySelectorAll('table.game-data tr');
  return rows.length > 1; // Wait until data rows exist
});
const html = await page.content();
```

**MANDATORY CHECK:**
```
□ Is the site an SPA (React, Angular, Vue)?
□ Does the scraper wait for data to load?
□ Is there a timeout with proper error handling?
```

##### Lesson 3: Table Selector Accuracy

**The Problem (Session 40 - HTGSports):**
- Wrong table selector captured navigation/footer tables
- Correct data table had specific class combination

**The Fix:**
```javascript
// ❌ WRONG - Too generic
const table = await page.$('table');

// ✅ CORRECT - Specific selector
const table = await page.$('table.table-striped.table-hover.table-condensed');
// Or identify by unique parent container
const table = await page.$('#scheduleContainer table');
```

**MANDATORY CHECK:**
```
□ Has DOM diagnostic been run first?
□ Is the table selector specific enough?
□ Are there multiple tables on the page being confused?
```

##### Lesson 4: Column Index Mapping

**The Problem:**
- Assumed column positions (score in column 3)
- Different events had different column layouts

**The Fix:**
```javascript
// ❌ WRONG - Hardcoded indices
const score = row.cells[3].textContent;

// ✅ CORRECT - Find by header
const headers = Array.from(table.querySelectorAll('th'))
  .map(th => th.textContent.trim().toLowerCase());
const scoreIndex = headers.findIndex(h => h.includes('score'));
const score = row.cells[scoreIndex]?.textContent;
```

**MANDATORY CHECK:**
```
□ Are column positions verified against headers?
□ Does the scraper handle missing columns gracefully?
□ Are there variations between events/divisions?
```

##### Lesson 5: Date/Time Parsing Edge Cases

**The Problem (Session 43 - Heartland):**
- Soccer seasons span year boundaries (Aug-Dec = year X, Jan-Jul = year X+1)
- Dates like "12/15" without year were assigned wrong year

**The Fix:**
```javascript
// ❌ WRONG - Assumes current year
const date = new Date(`${monthDay}/${currentYear}`);

// ✅ CORRECT - Season-aware parsing
function parseSeasonDate(monthDay) {
  const [month, day] = monthDay.split('/').map(Number);
  const now = new Date();
  const year = now.getFullYear();

  // Soccer season: Aug-Jul
  // If month is Aug-Dec, use current/previous year based on current month
  // If month is Jan-Jul, use current/next year based on current month
  if (month >= 8 && month <= 12) {
    // Fall portion of season
    return new Date(year, month - 1, day);
  } else {
    // Spring portion of season
    return new Date(year + 1, month - 1, day);
  }
}
```

**MANDATORY CHECK:**
```
□ Does date parsing handle year boundaries?
□ Are timezone issues addressed?
□ What happens with invalid/malformed dates?
```

##### Lesson 6: Checkpoint/Resume Capability

**The Problem:**
- Long scrapes (4+ hours) would fail partway through
- Had to restart from beginning, wasting hours

**The Fix:**
```javascript
// Checkpoint file pattern
const CHECKPOINT_FILE = '.scraper_checkpoint.json';

function saveCheckpoint(state) {
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify({
    lastEventIndex: state.eventIndex,
    lastDivisionIndex: state.divisionIndex,
    processedMatches: state.processedMatches,
    timestamp: new Date().toISOString(),
  }));
}

function loadCheckpoint() {
  if (fs.existsSync(CHECKPOINT_FILE)) {
    return JSON.parse(fs.readFileSync(CHECKPOINT_FILE));
  }
  return null;
}

// Use in main loop
const checkpoint = loadCheckpoint();
const startEvent = checkpoint?.lastEventIndex || 0;
const startDivision = checkpoint?.lastDivisionIndex || 0;
```

**MANDATORY CHECK:**
```
□ Does scraper save progress periodically?
□ Can it resume from checkpoint?
□ Is checkpoint cleared on successful completion?
```

##### Pre-Production Scraper Checklist

Before running ANY scraper in production:

```markdown
## Scraper QA Checklist

### Data Completeness
- [ ] Single event test: Expected vs actual match count?
- [ ] Sample data review: All fields populated?
- [ ] Division coverage: ALL divisions captured?
- [ ] Date range: Correct season dates?

### Robustness
- [ ] Dynamic content: Waits for data load?
- [ ] Dropdown iteration: Handles all options?
- [ ] Error recovery: Continues on single failures?
- [ ] Checkpoint: Can resume interrupted runs?

### Edge Cases
- [ ] Empty divisions: Handled gracefully?
- [ ] Missing scores: NULL, not 0?
- [ ] Special characters in team names?
- [ ] Timezone handling?

### Performance
- [ ] Rate limiting: Appropriate delays?
- [ ] Memory usage: No leaks on long runs?
- [ ] Batch sizing: Optimal insert batches?
```

---

#### 4.3 DOM Diagnostic Pattern (for SPAs)

```javascript
// scripts/diagnose[SourceName].js
// Run this FIRST to understand page structure

const puppeteer = require("puppeteer");

async function diagnose() {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

  await page.goto(TARGET_URL);
  await page.waitForTimeout(3000); // Wait for SPA to load

  // Dump DOM structure
  const html = await page.content();
  fs.writeFileSync("dom_dump.html", html);

  // Take screenshot
  await page.screenshot({ path: "screenshot.png", fullPage: true });

  // Analyze selectors
  const analysis = await page.evaluate(() => {
    return {
      tables: document.querySelectorAll("table").length,
      forms: document.querySelectorAll("form").length,
      selects: [...document.querySelectorAll("select")].map(s => ({
        id: s.id,
        options: s.options.length,
      })),
      // ... more analysis
    };
  });

  console.log("Analysis:", JSON.stringify(analysis, null, 2));
  await browser.close();
}
```

---

### Phase 5: Data Extraction & Injection

**Objective:** Run scraper and inject data into SoccerView database.

#### 5.1 Pre-Extraction Checklist

```markdown
## Pre-Extraction Checklist

- [ ] Scraper tested on single event/page
- [ ] Sample data looks correct
- [ ] source_match_key format defined
- [ ] event_registry entry will be created
- [ ] source_type correctly identified (league/tournament)
- [ ] Database connection verified
```

#### 5.2 Execution

```bash
# Run with logging
node scripts/scrape[SourceName].js 2>&1 | tee scrape_output_$(date +%Y%m%d_%H%M%S).log

# Or run in background
node scripts/scrape[SourceName].js > scrape_output.log 2>&1 &
echo $! > scrape_pid.txt
```

#### 5.3 Monitoring

```javascript
// Check progress during long scrapes
const checkProgress = async () => {
  const { count: matchCount } = await supabase
    .from("match_results")
    .select("*", { count: "exact", head: true })
    .eq("source_platform", "new_source");

  console.log(`Matches from new source: ${matchCount}`);
};
```

---

### Phase 6: Integration Pipeline

**Objective:** Connect new matches to teams and calculate ratings.

#### 6.1 Integration Steps (Run in Order)

```bash
# Step 1: Create teams from new match data
node scripts/integrateHeartlandTeams.js
# (Or equivalent for new source - extracts unique team names, creates team records)

# Step 2: Link matches to team IDs
node scripts/linkTeams.js
# Links home_team_name → home_team_id, away_team_name → away_team_id

# Step 3: Recalculate ELO ratings
node scripts/recalculate_elo_v2.js
# Processes all linked matches, updates team ELO

# Step 4: Sync match counts
node scripts/syncMatchCounts.js
# Updates teams.matches_played for visibility in app

# Step 5: Score predictions (if applicable)
node scripts/scorePredictions.js
```

#### 6.2 Integration Pipeline Script

```javascript
// scripts/runIntegrationPipeline.js
// Run this after any scraper completes

const { execSync } = require("child_process");

const steps = [
  { name: "Integrate Teams", cmd: "node scripts/integrateHeartlandTeams.js" },
  { name: "Link Matches", cmd: "node scripts/linkTeams.js" },
  { name: "Recalculate ELO", cmd: "node scripts/recalculate_elo_v2.js" },
  { name: "Sync Match Counts", cmd: "node scripts/syncMatchCounts.js" },
];

for (const step of steps) {
  console.log(`\n▶️ ${step.name}...`);
  try {
    execSync(step.cmd, { stdio: "inherit" });
    console.log(`✅ ${step.name} complete`);
  } catch (err) {
    console.error(`❌ ${step.name} failed:`, err.message);
    process.exit(1);
  }
}

console.log("\n🎉 Integration pipeline complete!");
```

---

### Phase 7: Verification & Documentation

**Objective:** Confirm data integrated correctly and document results.

#### 7.1 Verification Queries

```sql
-- 1. Check new matches inserted
SELECT source_platform, COUNT(*) as matches
FROM match_results
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY source_platform;

-- 2. Check event registry populated
SELECT event_id, event_name, source_type, match_count
FROM event_registry
WHERE source_platform = 'new_source';

-- 3. Check link rate
SELECT
  COUNT(*) as total,
  COUNT(home_team_id) as linked,
  ROUND(100.0 * COUNT(home_team_id) / COUNT(*), 1) as link_rate
FROM match_results
WHERE source_platform = 'new_source';

-- 4. Check teams created
SELECT source_name, COUNT(*) as teams
FROM teams
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY source_name;

-- 5. Verify no orphaned event_ids
SELECT DISTINCT m.event_id, COUNT(*) as orphaned_matches
FROM match_results m
LEFT JOIN event_registry e ON m.event_id = e.event_id
WHERE m.event_id IS NOT NULL AND e.event_id IS NULL
GROUP BY m.event_id;
```

#### 7.2 UI Verification Checklist

| Check | Steps | Expected Result |
|-------|-------|-----------------|
| **Teams Tab** | Search for team from new source | Team appears with match count |
| **Rankings Tab** | Filter by state from new source | Teams appear in rankings |
| **Team Details** | Tap team from new source | Recent matches show correctly |
| **League Standings** | Tap League Standings for league team | Points table displays |
| **Match Cards** | View matches from new source | Scores, dates, teams all correct |

#### 7.3 Documentation Update

After successful integration, update CLAUDE.md:

```markdown
## Updates to make:

1. Quick Reference table:
   - Total Teams: [new count]
   - Total Matches: [new count]
   - Link Rate: [new rate]

2. Data Completeness Status table:
   - Add new source row

3. Session History:
   - Document what was scraped
   - Note any issues encountered

4. Data Source Inventory (Section 4):
   - Update status from "Pending" to "Complete"
```

---

## 4. Data Source Inventory

### National Platforms

| Platform | URL | Coverage | Type | Status | Priority |
|----------|-----|----------|------|--------|----------|
| **GotSport** | gotsport.com | 50 states | Both | ✅ Production | - |
| **ECNL** | ecnlsoccer.com | Nationwide | Elite League | ⬜ Research | 🟠 HIGH |
| **MLS Next** | mlsnext.mlssoccer.com | Nationwide | Elite League | ⬜ Research | 🟠 HIGH |
| **Girls Academy** | girlsacademyleague.com | Nationwide | Elite League | ⬜ Research | 🟡 MEDIUM |
| **US Club Soccer NPL** | usclubsoccer.org | Nationwide | Premier League | ⬜ Research | 🟡 MEDIUM |
| **USYS National League** | nationaleague.com | Nationwide | Premier League | ⬜ Research | 🟡 MEDIUM |

### Regional Platforms

| Platform | URL | States | Type | Status | Priority |
|----------|-----|--------|------|--------|----------|
| **HTGSports** | events.htgsports.net | 26+ states | Both | ✅ Partial (Heartland only) | 🔴 CRITICAL |
| **EDP Soccer** | edpsoccer.com | NJ,PA,DE,MD,VA,NY,CT,FL,OH | Both | ⬜ Research | 🟠 HIGH |
| **SINC Sports** | sincsports.com | NC | Both | ⬜ Research | 🔴 CRITICAL |
| **Demosphere** | *.demosphere.com | WI,MI,IA,WA | Both | ⬜ Research | 🟠 HIGH |
| **Affinity** | affinitysoccer.com | WA | Both | ⬜ Research | 🟠 HIGH |
| **PlayMetrics** | playmetrics.com | MS,WI,GA | Both | ⬜ Research | 🟡 MEDIUM |

### State-Level Sources

| State | Primary Platform | Secondary | League System | Status | Priority |
|-------|-----------------|-----------|---------------|--------|----------|
| **SC** | SportsConnect | - | SCYSA State League | ⬜ Research | 🔴 CRITICAL |
| **NC** | SINC Sports | - | NCYSA Classic League | ⬜ Research | 🔴 CRITICAL |
| **GA** | GotSport | PlayMetrics | GA Premier League | ⬜ Expand GotSport | 🔴 CRITICAL |
| **NE** | Custom site | - | Nebraska YSL | ⬜ Research | 🔴 CRITICAL |
| **MS** | PlayMetrics | - | MSA State League | ⬜ Research | 🟠 HIGH |
| **AL** | GotSport | - | ASA State League | ⬜ Expand GotSport | 🟠 HIGH |
| **TN** | GotSport | - | TSL State League | ⬜ Expand GotSport | 🟠 HIGH |
| **LA** | GotSport | - | LCSL | ⬜ Expand GotSport | 🟠 HIGH |
| **WA** | Affinity/Demosphere | - | RCL, League WA | ⬜ Research | 🟠 HIGH |
| **KS** | HTGSports | Heartland | Heartland Soccer | ✅ Complete | - |
| **MO** | HTGSports | Heartland | Heartland Soccer | ✅ Complete | - |

---

## 4.5 VERIFIED ACCESS METHODS (Shelf-Ready)

> **Last Updated:** January 27, 2026
>
> Deep research completed on top priority sources. These access methods are VERIFIED and ready to implement.

---

### 🔴 PRIORITY 1: SINC Sports (North Carolina)

**Coverage:** NC - 3,172 teams at 20.4% coverage
**Est. Matches:** 25,000+
**Status:** ✅ ACCESS METHOD VERIFIED

#### Platform Analysis
- **Technology:** ASP.NET with EO.Web controls
- **Data Loading:** Server-side rendering via `__doPostBack()` callbacks
- **Authentication:** None required for public schedule data

#### Access Methods (3 Options)

**Option A: Excel Export (BEST)**
```
URL: soccer.sincsports.com/schedule.aspx?tid=[TOURNAMENT_ID]
Button ID: btnExtractSched
Method: Trigger Excel export programmatically via Puppeteer
```

**Option B: AutoComplete Web Service**
```
Endpoint: /services/AutoComplete.asmx/GetTournaments
Method: SOAP/ASMX web service
Returns: Tournament list for search/discovery
```

**Option C: Direct HTML Scraping**
```
URL Pattern: soccer.sincsports.com/schedule.aspx?tid=NCFL&year=2025&div=[DIV_CODE]
Division Codes: U11M01, U13F03, U14M02 (age/gender/tier format)
Selectors:
  - Game tables: class="gameTable"
  - Results page: TTResults.aspx?tid=NCFL
```

#### Known Tournament IDs
```javascript
const SINC_TOURNAMENTS = {
  "NCFL": "NCYSA Fall Classic League",
  "NCCSL": "North Carolina Classic Spring League",
  // Discover more via AutoComplete service
};
```

#### Implementation Notes
- Uses EO Grid controls (not standard HTML tables)
- Division dropdown must be iterated (like HTGSports pattern)
- PDF export also available: `btnPrintSchedules`

---

### 🔴 PRIORITY 2: SportsConnect/Affinity (South Carolina + Multi-State)

**Coverage:** SC (17.3%), NE (26.3%), WA (43.7%), + 10 more states
**Est. Matches:** 50,000+ across all states
**Status:** ✅ ACCESS METHOD VERIFIED

#### Platform Analysis
- **Technology:** Sports Connect (Stack Sports) / SportsAffinity
- **Subdomains:** `[state].sportsaffinity.com` or `[state].affinitysoccer.com`
- **Authentication:** None for public schedules and iCal feeds

#### Access Methods (2 Options)

**Option A: iCal Calendar Feeds (BEST - BACKDOOR)**
```
Discovery: Navigate to Schedules > Calendar > Sync
URL Pattern: [subdomain]/schedules/[guid]/[team-guid]?view=dates
Format: Standard iCal (.ics) format
Refresh: Real-time updates
```

**Option B: Tournament Standings Pages**
```
URL Pattern: [subdomain]/tour/public/info/tournamentlist.asp
Parameters:
  - Tournamentguid: [GUID] (e.g., FD7DF8C6-8C26-400A-9890-CF6CFB9E9343)
  - sessionguid: [optional session token]
```

#### State Subdomains Discovered
```javascript
const AFFINITY_SUBDOMAINS = {
  "SC": "scysa.sportsaffinity.com",
  "NE": "nebraskasoccer.sportsaffinity.com",
  "WA": "wys.sportsaffinity.com",
  "GA": "gs.affinitysoccer.com",
  "OH": "ohionorth.affinitysoccer.com",
  "NJ": "njysa.affinitysoccer.com",
  "PA": "pawest.affinitysoccer.com",
  "HI": "hysa.affinitysoccer.com",
  "UT": "uysa.affinitysoccer.com",
};
```

#### iCal Parsing Pattern
```javascript
// Use existing scrapeHeartlandICS.js as template
// iCal SUMMARY format: "Team A Vs Team B"
// Parse into home_team_name, away_team_name
```

#### Implementation Notes
- iCal feeds are the cleanest data source
- Need to discover tournament GUIDs first via tournament list pages
- Legacy system (uses V1 infrastructure, not V2 API)

---

### 🔴 PRIORITY 3: Nebraska Youth Soccer League

**Coverage:** NE - 911 teams at 26.3% coverage
**Est. Matches:** 5,000+
**Status:** ✅ ACCESS METHOD VERIFIED

#### Platform Analysis
- **Website:** nysleague.org (Squarespace front-end)
- **Scheduling Backend:** Sports Affinity (nebraskasoccer.sportsaffinity.com)
- **Authentication:** None for public data

#### Access Methods

**Option A: Sports Affinity Integration (BEST)**
```
Same as SportsConnect/Affinity above
Subdomain: nebraskasoccer.sportsaffinity.com
Tournament GUIDs available in URL parameters
```

**Option B: PDF Standings Downloads**
```
URL: nysleague.org/past-results
Files:
  - 2024-spring-division-champions.pdf
  - 2023-fall-division-champions.pdf
  - Spring 2024 Standings (linked externally)
Note: Limited to standings, not full match data
```

#### Implementation Notes
- Nebraska uses SportsAffinity for actual scheduling
- nysleague.org is just a front-end with links
- Use Affinity scraper for full match data

---

### 🟠 PRIORITY 4: EDP Soccer (Northeast Region)

**Coverage:** NJ, PA, DE, MD, VA, NY, CT, FL, OH
**Est. Matches:** 30,000+
**Status:** ✅ ACCESS METHOD VERIFIED - **USES GOTSPORT!**

#### Critical Discovery
> **EDP Soccer uses GotSport as their backend!**
> We can use our EXISTING GotSport scraper - just need event IDs.

#### Access Methods

**Option A: GotSport Integration (BEST)**
```
Platform: events.gotsport.com (same as current scraper)
Event ID Example: "LeagueFall25"
Event Pin: "6655"
Method: Use existing ingest_gotsport.js patterns
```

**Option B: GotSport Schedule URL**
```
URL: events.gotsport.com/events/schedule.aspx
Parameters:
  - EventID: [tournament_id]
  - GroupID: [group_id]
  - Gender: "Boys" or "Girls"
  - Age: "12", "14", etc.
```

#### EDP Event Discovery
```javascript
// Contact: League@EDPSoccer.com for event list
// Or discover via GotSport event search
const EDP_EVENTS = {
  "LeagueFall25": { name: "EDP Fall League 2025", pin: "6655" },
  // Add more as discovered
};
```

#### Implementation Notes
- NO new scraper needed!
- Just discover EDP event IDs on GotSport
- Add to existing syncActiveEvents.js config

---

### 🟠 PRIORITY 5: Demosphere (Multi-State)

**Coverage:** WI, MI, IA, WA + others
**Est. Matches:** 20,000+
**Status:** ⚠️ PARTIAL - Needs More Research

#### Platform Analysis
- **Technology:** Demosphere youth sports platform
- **Subdomains:** `[club].demosphere-secure.com`
- **Authentication:** Varies by club

#### Access Methods (Unverified)

**Option A: iCal Exports (Likely)**
```
Similar to SportsAffinity, Demosphere likely has iCal exports
Check: Club schedule pages for calendar sync options
```

**Option B: Direct HTML Scraping**
```
Club schedules typically at: [club].demosphere-secure.com/schedules
Need to identify specific club subdomains for target states
```

#### Known Demosphere Clubs
```javascript
// Need to discover - example pattern:
// mlsa.demosphere-secure.com (Mt. Lebanon Soccer Association)
```

#### Implementation Notes
- Demosphere is a white-label platform
- Each club has own subdomain
- Need to compile list of clubs per state
- May need per-club scraper configuration

---

### Reference: Existing GotSport Scraper (GitHub)

**Repository:** [ericdaugherty/gotsport-scraper](https://github.com/ericdaugherty/gotsport-scraper)

```go
// GotSport URL Pattern
http://events.gotsport.com/events/schedule.aspx

// Parameters
params := map[string]string{
    "EventID": "15267",
    "GroupID": "166875",
    "Gender":  "Boys",
    "Age":     "12",
}
```

---

### Quick Reference: Access Method by Source

| Source | Best Method | Auth | Scraper Effort |
|--------|-------------|------|----------------|
| **SINC Sports (NC)** | Excel Export + Puppeteer | None | 🟡 Medium |
| **SportsAffinity (SC,NE,WA+)** | iCal Calendar Feeds | None | 🟢 Low |
| **Nebraska YSL** | SportsAffinity Backend | None | 🟢 Low (reuse) |
| **EDP Soccer** | GotSport (existing!) | None | 🟢 Very Low |
| **Demosphere** | iCal/HTML TBD | Varies | 🟠 Medium-High |
| **HTGSports** | Division Dropdown + HTML | None | ✅ Already Built |

---

## 5. Gap Analysis & Priority Queue

### Current Coverage by State

```
Coverage Legend:
🟢 70%+ (Good)    🟡 50-69% (Moderate)    🟠 30-49% (Low)    🔴 <30% (Critical)
```

| Priority | State | Coverage | Teams | Gap (matches needed) | Best Source |
|----------|-------|----------|-------|---------------------|-------------|
| 1 | 🔴 **SC** | 17.3% | 1,205 | ~8,000 | SportsConnect/SINC |
| 2 | 🔴 **NC** | 20.4% | 3,172 | ~25,000 | SINC Sports |
| 3 | 🔴 **GA** | 26.0% | 3,030 | ~20,000 | GotSport expansion |
| 4 | 🔴 **NE** | 26.3% | 911 | ~5,000 | Custom/HTGSports |
| 5 | 🔴 **MS** | 27.5% | 655 | ~3,500 | PlayMetrics |
| 6 | 🟠 **AL** | 33.9% | 992 | ~5,000 | GotSport expansion |
| 7 | 🟠 **TN** | 40.9% | 1,762 | ~8,000 | GotSport expansion |
| 8 | 🟠 **LA** | 43.2% | 711 | ~4,000 | GotSport expansion |
| 9 | 🟠 **WA** | 43.7% | 2,815 | ~15,000 | Affinity/Demosphere |
| 10 | 🟠 **CO** | 44.4% | 2,119 | ~10,000 | GotSport expansion |

### Nightly Priority Queue

Execute sources in this order for maximum impact:

```markdown
## Priority Queue (Updated: Jan 27, 2026)

### Tier 1: Critical Gap States (🔴 <30% coverage)
1. [ ] **HTGSports Nationwide** - Expand beyond Heartland (50K+ matches potential)
2. [ ] **SINC Sports (NC)** - 3,172 teams at 20.4% coverage
3. [ ] **SportsConnect (SC)** - 1,205 teams at 17.3% coverage
4. [ ] **Nebraska YSL** - 911 teams at 26.3% coverage

### Tier 2: High Impact Sources
5. [ ] **EDP Soccer** - NE region coverage (uses GotSport backend)
6. [ ] **Demosphere (WI/MI/IA)** - Multiple states, one scraper
7. [ ] **GotSport GA/AL/TN expansion** - Discover more events

### Tier 3: Elite League Data
8. [ ] **ECNL** - Elite tier nationwide
9. [ ] **MLS Next** - Elite tier nationwide
10. [ ] **Girls Academy** - Elite girls tier
```

---

## 6. UI Integration Checklist

### After Every Data Injection

| Screen | Check | Expected | Pass? |
|--------|-------|----------|-------|
| **Teams Tab** | | | |
| | Search team from new source | Team appears | ⬜ |
| | Team has correct match count | `matches_played > 0` | ⬜ |
| | Team has ELO rating | ELO displayed or "No rating" | ⬜ |
| **Rankings Tab** | | | |
| | Filter by new source state | Teams appear in list | ⬜ |
| | Teams sorted correctly | By rank (Official) or ELO (SoccerView) | ⬜ |
| **Team Details** | | | |
| | Recent Matches section | Shows matches from new source | ⬜ |
| | Match cards formatted correctly | Date, teams, score visible | ⬜ |
| | Team name NOT truncated | Full name visible | ⬜ |
| **League Standings** | | | |
| | Card appears for league teams | "League Standings" button visible | ⬜ |
| | Points table loads | Teams, stats, form badges | ⬜ |
| | Performance (no timeout) | Loads in <3 seconds | ⬜ |
| **Home Tab** | | | |
| | Latest Matches carousel | New matches appear | ⬜ |
| | Stats update | Total matches count increases | ⬜ |

### Common Integration Issues

| Issue | Symptom | Solution |
|-------|---------|----------|
| Teams not in search | Team exists but not searchable | Run `syncMatchCounts.js` |
| No League Standings | Button missing for league teams | Check `event_registry.source_type` |
| Match cards missing data | Blank fields | Check scraper captured all fields |
| ELO not calculating | Teams stuck at 1500 | Verify matches linked (`home_team_id` not null) |
| Duplicate teams | Same team appears twice | Run `deduplicateTeams.js` |

---

## 7. Background QC Procedures

### Automated Nightly Checks

```javascript
// scripts/nightlyQC.js
// Run after every data injection

const QC_CHECKS = [
  {
    name: "Orphaned Event IDs",
    query: `
      SELECT COUNT(DISTINCT m.event_id) as orphaned
      FROM match_results m
      LEFT JOIN event_registry e ON m.event_id = e.event_id
      WHERE m.event_id IS NOT NULL AND e.event_id IS NULL
    `,
    threshold: 0,
    severity: "CRITICAL",
  },
  {
    name: "Unlinked Match Rate",
    query: `
      SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE home_team_id IS NULL) / COUNT(*), 1)
      FROM match_results
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `,
    threshold: 20, // Max 20% unlinked
    severity: "HIGH",
  },
  {
    name: "Missing Scores (Completed Matches)",
    query: `
      SELECT COUNT(*)
      FROM match_results
      WHERE match_date < CURRENT_DATE
        AND (home_score IS NULL OR away_score IS NULL)
        AND created_at > NOW() - INTERVAL '24 hours'
    `,
    threshold: 100, // Allow some schedule-only data
    severity: "MEDIUM",
  },
  {
    name: "Invalid State Codes",
    query: `
      SELECT COUNT(*)
      FROM match_results
      WHERE state IS NOT NULL
        AND state NOT IN ('AL','AK','AZ',...) -- All 50 states
    `,
    threshold: 0,
    severity: "LOW",
  },
];
```

### Weekly Deep QC

| Check | Query/Method | Frequency |
|-------|--------------|-----------|
| Cross-source duplicate detection | `deduplicateTeams.js --dry-run` | Weekly |
| Alias accuracy audit | Sample 100 aliases, verify matches | Weekly |
| ELO distribution check | Histogram of ELO values | Weekly |
| Link rate by source | Group by `source_platform` | Weekly |
| Event registry completeness | All event_ids have registry | Weekly |

### QC Report Template

```markdown
## Nightly QC Report - [DATE]

### Data Injection Summary
- Source: [SOURCE NAME]
- Matches Added: [COUNT]
- Teams Created: [COUNT]
- Link Rate: [PERCENT]

### QC Checks
| Check | Result | Status |
|-------|--------|--------|
| Orphaned Event IDs | 0 | ✅ PASS |
| Unlinked Rate | 15% | ✅ PASS |
| Missing Scores | 45 | ⚠️ REVIEW |

### Issues Found
- [List any issues]

### Actions Taken
- [List any fixes applied]

### Next Steps
- [Recommendations for next night]
```

---

## 8. Rollback & Recovery

### If Something Goes Wrong

#### Scenario 1: Bad Data Injected

```sql
-- Delete matches from specific scrape run
DELETE FROM match_results
WHERE source_platform = 'bad_source'
  AND created_at > '2026-01-27 00:00:00';

-- Verify deletion
SELECT COUNT(*) FROM match_results WHERE source_platform = 'bad_source';
```

#### Scenario 2: Duplicate Teams Created

```javascript
// Identify duplicates
const findDuplicates = await supabase
  .from("teams")
  .select("team_name, COUNT(*)")
  .group("team_name")
  .gt("COUNT(*)", 1);

// Run deduplication
node scripts/deduplicateTeams.js
```

#### Scenario 3: Event Registry Wrong source_type

```sql
-- Fix incorrect source_type
UPDATE event_registry
SET source_type = 'league'  -- or 'tournament'
WHERE event_id = 'wrong-event-id';
```

#### Scenario 4: ELO Corrupted

```bash
# Full ELO recalculation from scratch
node scripts/recalculate_elo_v2.js --reset
```

### Backup Before Major Operations

```bash
# Create backup of critical tables before risky operations
pg_dump -t teams -t match_results -t event_registry > backup_$(date +%Y%m%d).sql
```

---

## Appendix A: Scraper Checklist Template

```markdown
## Scraper: [SOURCE NAME]

### Phase 1: Research
- [ ] Source URL documented
- [ ] Data types identified (league/tournament/both)
- [ ] Geographic coverage mapped
- [ ] Date range confirmed (Aug 2023+)

### Phase 2: Access
- [ ] Platform type identified (HTML/SPA/API)
- [ ] Access method selected
- [ ] Rate limits tested
- [ ] No auth required (or auth obtained)

### Phase 3: Go/No-Go
- [ ] Decision: GO / NO-GO
- [ ] Rationale documented

### Phase 4: Development
- [ ] Scraper script created
- [ ] DOM diagnostic completed (if SPA)
- [ ] Sample data extracted successfully
- [ ] source_match_key format defined

### Phase 5: Extraction
- [ ] Full scrape executed
- [ ] Event registry entries created
- [ ] All matches have event_id

### Phase 6: Integration
- [ ] Teams created/linked
- [ ] Matches linked to team IDs
- [ ] ELO recalculated
- [ ] Match counts synced

### Phase 7: Verification
- [ ] Verification queries passed
- [ ] UI checks passed
- [ ] CLAUDE.md updated
- [ ] QC report generated
```

---

## Appendix B: Quick Reference Commands

```bash
# Run any scraper
node scripts/scrape[SourceName].js

# Run integration pipeline
node scripts/runIntegrationPipeline.js

# Check database health
node scripts/auditSupabaseHealth.js

# Run nightly QC
node scripts/nightlyQC.js

# Generate coverage report
node scripts/v1LaunchReport.js

# Fix common issues
node scripts/syncMatchCounts.js    # Teams not showing in app
node scripts/linkTeams.js          # Matches not linked
node scripts/deduplicateTeams.js   # Duplicate teams
```

---

*This playbook is the authoritative guide for SoccerView data expansion.*
*Update after each successful integration.*
