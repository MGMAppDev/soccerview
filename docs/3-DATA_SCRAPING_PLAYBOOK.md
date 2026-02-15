# SoccerView Data Scraping Playbook

> **Version 7.0** | Updated: February 14, 2026 | Post-Expansion QC Protocol (Session 96)
>
> Comprehensive, repeatable process for expanding the SoccerView database.
> Execute this playbook to add new data sources following V2 architecture.
>
> **🚨 Read [GUARDRAILS](1.1-GUARDRAILS_v2.md) before writing any scraper.**
>
> **⚠️ CRITICAL (Session 76):** NEVER write directly to `teams_v2` or `matches_v2`.
> ALL data MUST flow through staging → dataQualityEngine → production.
> Direct writes bypass normalizers and create orphaned duplicate teams.
>
> **⚠️ CRITICAL (Session 84): PREMIER-ONLY POLICY**
> SoccerView ONLY includes premier/competitive youth soccer data.
> **DO NOT scrape:** Recreational leagues, community programs, development leagues.
> The `intakeValidator.js` will reject any recreational data that slips through.
>
> **⚠️ CRITICAL (Session 92 QC): DUAL-SYSTEM ARCHITECTURE**
> SoccerView has TWO independent data pipelines. See "Dual-System Overview" below.
> Match data → Heavy pipeline → Rankings/ELO. Standings data → Lightweight absorption → League Standings page.

---

## Dual-System Overview (Session 92 QC)

SoccerView has TWO independent data pipelines. Choose the right one:

| | System 1: Match Pipeline | System 2: Standings Absorption |
|-|--------------------------|-------------------------------|
| **Purpose** | Rankings, ELO, Teams, Matches | League Standings page |
| **Input** | staging_games | staging_standings |
| **Processor** | DQE / fastProcessStaging | processStandings.cjs |
| **Resolver** | Heavy 3-tier (source map → canonical → fuzzy) | Lightweight (source map → exact → create) |
| **Output** | matches_v2, teams_v2 (ELO) | league_standings |
| **View** | app_rankings, app_matches_feed, etc. | app_league_standings (PART 1) |
| **Fuzzy matching** | YES (cross-source dedup needed) | NO (authoritative data) |

**Shared resource:** `teams_v2` — standings reads/enriches, never overwrites.

See [ARCHITECTURE.md](1.2-ARCHITECTURE.md) for full dual-system diagram.

---

## Quick Start

### Match Data (Rankings/ELO)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    MATCH DATA WORKFLOW                                   │
│                                                                         │
│   1. SCRAPE → node scripts/universal/coreScraper.js --adapter {name}   │
│   2. PROCESS (Option A - fast bulk):                                    │
│      → node scripts/maintenance/fastProcessStaging.cjs                 │
│   2. PROCESS (Option B - full pipeline):                                │
│      → node scripts/universal/dataQualityEngine.js --process-staging   │
│   3. ELO → node scripts/daily/recalculate_elo_v2.js                    │
│   4. VIEWS → node scripts/refresh_views_manual.js                      │
│   5. VERIFY → node scripts/daily/verifyDataIntegrity.js                │
└─────────────────────────────────────────────────────────────────────────┘
```

### League Standings Data (League Standings Page)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    STANDINGS DATA WORKFLOW                               │
│                                                                         │
│   1. SCRAPE → node scripts/universal/scrapeStandings.js --adapter {n}  │
│   2. PROCESS → node scripts/maintenance/processStandings.cjs           │
│   3. VIEWS → REFRESH MATERIALIZED VIEW app_league_standings            │
│   4. VERIFY → node scripts/_debug/verify_standings_completeness.cjs    │
│                                                                         │
│   Lightweight resolver: NO fuzzy matching. Trust the league data.       │
│   Universal: zero custom code per source. Add adapter config only.      │
│   Scale: designed for 200-400 league sources.                           │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Universal Scraper Framework (Session 57) - PREFERRED

**Adding a new data source now requires only a ~50 line config file, not a custom script.**

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     SOURCE ADAPTERS                              │
│  /scripts/adapters/gotsport.js    (Cheerio - static HTML)       │
│  /scripts/adapters/htgsports.js   (Puppeteer - JavaScript SPA)  │
│  /scripts/adapters/heartland.js   (Puppeteer - CGI via AJAX)     │
│  /scripts/adapters/sincsports.js  (Puppeteer - Bootstrap grid)  │
│  /scripts/adapters/_template.js   (Template for new sources)    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              CORE SCRAPER ENGINE                                 │
│  /scripts/universal/coreScraper.js (841 lines)                  │
│                                                                  │
│  • Reads adapter config                                          │
│  • Handles rate limiting, retries, checkpoints                  │
│  • Writes to staging_games with source_platform tag             │
│  • Technology-agnostic (Cheerio, Puppeteer, or API)             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              STAGING TABLES (Layer 1)                            │
│  staging_games, staging_teams, staging_events                   │
└─────────────────────────────────────────────────────────────────┘
```

### Adding a New Data Source

```bash
# 1. Copy template adapter
cp scripts/adapters/_template.js scripts/adapters/newsource.js

# 2. Edit adapter config (~50 lines):
#    - Set platform name, base URL
#    - Configure CSS selectors for match data
#    - Set rate limits
#    - Define generateMatchKey function

# 3. Test with dry run
node scripts/universal/coreScraper.js --adapter newsource --event 12345 --dry-run

# 4. Run for real
node scripts/universal/coreScraper.js --adapter newsource --active

# 5. Process staging and refresh views
node scripts/maintenance/fastProcessStaging.cjs
node scripts/refresh_views_manual.js
```

**Time to add new source: ~1-2 hours (config only, no custom code)**

### Supported Technologies

| Technology | Use Case | Adapter Example |
|------------|----------|-----------------|
| Cheerio | Static HTML pages | gotsport.js, heartland.js |
| Puppeteer | JavaScript SPAs | htgsports.js, sincsports.js |
| API | REST endpoints | (future) |

### CRITICAL: Alphanumeric Team ID Extraction (Session 61)

**Problem Discovered:** Heartland scraper was missing matches because team IDs can be alphanumeric (e.g., "711A", "12AB"), not just numeric (e.g., "7115").

**Root Cause:** The regex `^\d+` only matched pure numeric IDs, causing teams like "711A Union KC Jr Elite B15" to be skipped entirely.

**Universal Fix Applied:**
```javascript
// ❌ WRONG - Only matches numeric IDs (e.g., "7115")
extractTeamId: (name) => {
  const match = name.match(/^(\d+)\s+/);
  return match ? match[1] : null;
}

// ✅ CORRECT - Matches all alphanumeric IDs (e.g., "711A", "7115", "12AB")
extractTeamId: (name) => {
  const match = name.match(/^([A-Za-z0-9]+)\s+/);
  return match ? match[1] : null;
}
```

**Impact:** This bug caused 64 matches per Heartland subdivision to be silently skipped. When writing new adapters, ALWAYS use alphanumeric-capable regex patterns for ID extraction.

### CRITICAL: Division Detection Pattern (Session 74)

**Problem Discovered:** HTGSports scraper found only 1 of 38 divisions in Sporting Classic 2025 because the division detection regex required a dash (e.g., "U-11") but the site used format without dash (e.g., "U11").

**Root Cause:** The regex `/U-\d+|2017|2016.../i` required a hyphen after "U". Many sources use "U11", "U09" without the dash.

**Universal Pattern (use this for ALL adapters):**
```javascript
// ❌ WRONG - Only matches "U-11" (requires dash)
divisionPattern: /U-\d+|2017|2016|2015|2014|2013|2012|2011|2010/i

// ✅ CORRECT - Matches both "U11" AND "U-11" with optional dash
divisionPattern: /U-?\d{1,2}\b|20[01]\d/i
```

**Pattern breakdown:**
- `U-?` - "U" followed by optional dash (the `?` makes it optional)
- `\d{1,2}` - One or two digits (matches U9 through U19)
- `\b` - Word boundary (prevents partial matches like "U115" in team names)
- `20[01]\d` - Birth years 2000-2019 (matches "2015", "2016", etc.)

**How to use in adapters:**
```javascript
// In your adapter config:
config: {
  divisionPattern: /U-?\d{1,2}\b|20[01]\d/i,
}

// When filtering division dropdowns:
const divisionOptions = options.filter(opt =>
  opt.textContent.match(/U-?\d{1,2}\b|20[01]\d/i)
);

// When identifying which dropdown contains divisions:
const hasDiv = options.some(opt =>
  opt.textContent.match(/U-?\d{1,2}\b|20[01]\d/i)
);
```

**Impact of bug:** Scraper found 1 division instead of 38, missing 335 matches from Sporting Classic 2025.

### CRITICAL: Checkpoint Logic - Only Mark Processed When Data Found (Session 74)

**Problem Discovered:** Events were marked as "processed" in checkpoints even when 0 matches were found, causing them to be permanently skipped on future runs.

**Root Cause:** Checkpoint update happened unconditionally after scraping each event:
```javascript
// ❌ WRONG - Marks processed even with no data
await scrapeEvent(eventId);
checkpoint.processedEvents.push(eventId);  // Always executes!
saveCheckpoint(checkpoint);
```

**Universal Fix:**
```javascript
// ✅ CORRECT - Only mark processed when data found
const matches = await scrapeEvent(eventId);
if (matches.length > 0) {
  checkpoint.processedEvents.push(eventId);
  saveCheckpoint(checkpoint);
} else {
  console.warn(`Event ${eventId} returned 0 matches - NOT marking as processed`);
}
```

**Why this matters:**
- Network issues may cause temporary empty results
- Page structure changes may cause scraper to return 0 matches
- Incorrect division detection may skip all divisions
- Marking empty as "processed" = event NEVER scraped again = permanent data loss

**Best Practices:**
1. **Checkpoint updates MUST be conditional** on `matches.length > 0`
2. **Log warnings** when 0 matches found for investigation
3. **Don't checkpoint partial failures** - if event has 38 divisions but only 1 scraped, don't mark as done
4. **Consider retry logic** before giving up on an event

### Universal Event Discovery (Session 63) - NO MORE STATIC LISTS

**Problem:** Adapters used hardcoded static event lists requiring manual maintenance.

**Solution:** Universal database-based discovery added to core engine.

```javascript
// Core engine method - works for ANY source
async discoverEventsFromDatabase(lookbackDays = 7, forwardDays = 7) {
  // Extract prefix from matchKeyFormat (e.g., "htg-{eventId}" -> "htg")
  const matchKeyPrefix = this.adapter.matchKeyFormat?.split('-')[0];
  const sourcePattern = `${matchKeyPrefix}-%`;

  // Query matches_v2 filtered by source
  const { data } = await supabase.from("matches_v2")
    .select("league_id, tournament_id")
    .like("source_match_key", sourcePattern)
    .gte("match_date", lookbackDate)
    .lte("match_date", forwardDate);

  // ... returns events with metadata from leagues/tournaments tables
}
```

**How adapters use it:**
```javascript
// In adapter discovery config:
discoverEvents: async (engine) => {
  // Call universal method - works for ANY source
  const dbEvents = await engine.discoverEventsFromDatabase(14, 14);

  // Merge with static list for new events not yet in DB
  const staticEvents = engine.adapter.discovery.staticEvents || [];
  // ... merge logic

  return dbEvents;
}
```

**Results by source:**
| Source | Matches Found | Pattern Prefix |
|--------|--------------|----------------|
| gotsport | 9,268 | `gotsport` |
| htgsports | 5,224 | `htg` |
| heartland | 5,129 | `heartland` |

### Usage Examples

```bash
# Scrape all active events for a source (uses universal discovery)
node scripts/universal/coreScraper.js --adapter gotsport --active

# Scrape specific event
node scripts/universal/coreScraper.js --adapter htgsports --event 12345

# Dry run (no database writes)
node scripts/universal/coreScraper.js --adapter heartland --active --dry-run

# Resume from checkpoint
node scripts/universal/coreScraper.js --adapter gotsport --active --resume

# Force universal discovery even for sources with static lists
node scripts/universal/coreScraper.js --adapter htgsports --active --useUniversalDiscovery
```

---

## League Standings Pipeline (Session 92 QC)

### Architecture

League standings are a **SEPARATE system** from the match pipeline. Standings data is authoritative — the league publishes exactly which teams are in which division with their W-L-T record. This data is ABSORBED with lightweight resolution, not forced through the heavy match pipeline.

```
  Adapter config (standings section)      scrapeStandings.js (universal)
  e.g. heartland.js                 ───►  staging_standings (raw TEXT)
                                                │
                                                ▼
                                     processStandings.cjs
                                     LIGHTWEIGHT team resolution:
                                       Step 1: source_entity_map + metadata verify
                                       Step 2: Exact name + birth_year + gender
                                       Step 3: Create new team (NO fuzzy matching)
                                                │
                                                ▼
                                     league_standings (production, UUID FKs)
                                                │
                                                ▼
                                     app_league_standings (hybrid view)
                                     PART 1: Scraped standings (authoritative)
                                     PART 2: Computed fallback (non-scraped leagues)
```

### Lightweight Team Resolver vs Heavy Match Resolver

The standings resolver is intentionally simpler than the match pipeline's resolver:

**Step 1: source_entity_map + Metadata Verification**
- Look up source team ID in `source_entity_map`
- If found, VERIFY metadata compatibility (birth_year, gender)
- If metadata compatible → enrich NULLs → use it
- If metadata INCOMPATIBLE → find enriched alternative or redirect

**Step 2: Exact Name + Metadata Match**
- Find teams_v2 record by (name, birth_year, gender) exactly
- Prefer records WITH metadata over those with NULL
- Register in source_entity_map for future Tier 1

**Step 3: Create New Team (Trust the League)**
- INSERT INTO teams_v2 with full metadata from standings
- Register in source_entity_map
- **NO FUZZY MATCHING** — creating is safer than matching wrong

### Adding Standings for Any New League Source

**1. Add standings config to adapter** (e.g., `scripts/adapters/mls_next.js`):
```javascript
standings: {
  staticSources: [
    { type: 'archive', url: 'https://...', season: '2025_fall', params: {...} }
  ],
  // OR dynamic discovery:
  discoverSources: async (engine) => { /* return sources */ },
  scrapeSource: async (engine, source) => {
    // Return array of standings objects:
    return [{
      team_name: 'Team A',
      team_source_id: 'src-123',     // REQUIRED for Tier 1 resolution
      league_source_id: 'league-1',   // Links to leagues table
      age_group: 'U-11',              // e.g. U-11, U-12
      gender: 'Boys',                 // Boys or Girls
      division: 'Division 1',         // Subdivision/division name
      played: 8, wins: 6, losses: 1, draws: 1,
      goals_for: 20, goals_against: 8, points: 19,
      position: 1, red_cards: 0,
    }];
  },
}
```

**2. Run the pipeline:**
```bash
# Scrape
node scripts/universal/scrapeStandings.js --adapter mls_next

# Process (lightweight resolver — no fuzzy matching)
node scripts/maintenance/processStandings.cjs

# Refresh view
psql $DATABASE_URL -c "REFRESH MATERIALIZED VIEW app_league_standings;"

# Verify 1:1 completeness
node scripts/_debug/verify_standings_completeness.cjs
```

**3. That's it.** Zero custom code. The lightweight resolver handles all sources universally.

### Standings-Specific Tables

| Layer | Table | Purpose |
|-------|-------|---------|
| **Staging** | `staging_standings` | Raw standings (TEXT fields, no FKs) |
| **Production** | `league_standings` | Validated standings (UUID FKs to teams_v2, leagues) |
| **View** | `app_league_standings` | Hybrid: PART 1 (scraped) UNION PART 2 (computed fallback) |

### Daily Pipeline Integration

Standings scraping and processing runs as part of the nightly GitHub Actions workflow:
- **Phase 1.5:** `scrapeStandings.js --adapter heartland` (parallel with match scraping)
- **Phase 2.6:** `processStandings.cjs` (after match pipeline completes)
- **Phase 5:** `REFRESH MATERIALIZED VIEW app_league_standings` (with all other views)

### Scale: 200-400 League Sources

The standings pipeline is designed for massive scale:
- **Per-source work:** Add ~20 lines of adapter config (standings section)
- **Processing:** Universal lightweight resolver handles ALL sources
- **No fuzzy matching:** Avoids O(n²) name comparison scaling issues
- **source_entity_map:** O(1) lookup per team after first resolution
- **Future optimization:** Bulk SQL operations when row count exceeds 10K+

---

## V2 Architecture Overview (Match Pipeline)

### Data Flow

```
Scrapers → staging_games → dataQualityEngine.js → matches_v2 → app_views → App
```

### Key Tables

| Layer | Table | Purpose |
|-------|-------|---------|
| **Staging** | `staging_games` | Raw match data from scrapers |
| **Staging** | `staging_teams` | Raw team data from scrapers |
| **Staging** | `staging_events` | Raw event data from scrapers |
| **Production** | `matches_v2` | Validated match data |
| **Production** | `teams_v2` | Validated team data |
| **Production** | `leagues` | League metadata |
| **Production** | `tournaments` | Tournament metadata |
| **App Views** | `app_matches_feed` | Pre-computed for app |
| **App Views** | `app_rankings` | Pre-computed for app |

### Why Staging Tables?

1. **No constraints** - Scrapers NEVER fail due to data issues
2. **All data captured** - Bad data is reviewed, not lost
3. **Validation centralized** - One pipeline handles all sources
4. **Debugging easier** - Raw data preserved for investigation

### CRITICAL: source_match_key (Session 57 - UNIQUE Constraint)

**ALWAYS generate `source_match_key`** - This field is now UNIQUE and enables:
- **Upsert strategy** - `ON CONFLICT (source_match_key)` for idempotent inserts
- **Match linkage** - Links matches_v2 back to staging_games for event info
- **Deduplication** - Prevents duplicate match imports
- **Data repair** - Allows fixing matches without re-scraping

**Format by source:**
| Source | Format | Example |
|--------|--------|---------|
| GotSport | `gotsport-{eventId}-{matchNum}` | `gotsport-39064-91` |
| HTGSports | `htg-{eventId}-{matchId}` | `htg-12345-678` |
| Heartland | `heartland-{level}-{homeId}-{awayId}-{date}-{gameNum}` | `heartland-premier-abc123-def456-2025-03-15-1` |
| SINC Sports | `sincsports-{eventId}-{matchNumber}` | `sincsports-NCFL-38209` |
| Legacy | `legacy-{eventId8}-{homeId8}-{awayId8}-{date}` | `legacy-b2c9a5aa-0bc3985a-3406f39e-2025-06-29` |

```javascript
// ✅ CORRECT - unique, traceable key (Universal Framework generates automatically)
source_match_key: `gotsport-${eventId}-${matchId}`
source_match_key: `htg-${eventId}-${gameId}`
source_match_key: `heartland-premier-${homeId}-${awayId}-${date}-1`

// ❌ WRONG - missing key causes orphaned matches
source_match_key: null  // DON'T DO THIS!
```

**Session 57 Migration:** Backfilled 286,253 NULL keys, removed 3,562 duplicates, added UNIQUE constraint.

### CRITICAL: Scheduled/Future Matches

**Always scrape upcoming/scheduled matches (0-0 scores).** They power:
- **Team Details "Upcoming" section** - Parents want to see their kid's next games
- **app_upcoming_schedule view** - Critical app feature

**DO scrape:**
- Matches with 0-0 scores (scheduled but not played)
- Future dates within current or next season (through Fall 2027)
- Matches without final scores yet

**DON'T delete:**
- 0-0 scored matches (they're scheduled, not garbage)
- Current season dates (Aug 2025 - Jul 2026 right now)

**Only delete matches if:**
- Date is impossibly far future (2028+)
- Team names are garbage (test data, TBD, etc.)

### Data Integrity for Upcoming Section (Session 56)

**IMPORTANT:** `app_upcoming_schedule` ONLY shows matches linked to a league or tournament.

Unlinked matches are EXCLUDED because:
- Parents plan weekends around this data - accuracy is critical
- If we don't know what event a match belongs to, we shouldn't show it
- User trust > coverage

**What this means for scrapers:**
- Always capture `event_name` and `event_id` for scheduled matches
- Matches without event info can still be scraped but won't appear in "Upcoming"
- They still get ELO calculated if they have scores later

### Self-Healing Pipeline (Session 56)

Orphaned matches (no league/tournament) are NOT permanent. The nightly pipeline includes **inference linkage** that automatically fixes them:

**How it works:**
1. `inferEventLinkage.js` runs after validation each night
2. For each orphaned match, checks what events the teams play in
3. If both teams share a common event → infers the linkage
4. Updates matches_v2 with the inferred event

**Why this improves over time:**
```
Day 1:  Scrape new event → Teams gain event history
Day 2:  Inference sees Team A plays in that event
        → Links Team A's old orphaned matches
Day 30: Most teams have event history
        → Orphan count shrinks toward 0
```

**Initial results (Session 56):**
- 6,944 orphaned matches analyzed
- 1,155 inferred and linked
- Remaining orphans will shrink each night

---

## V2 Scraper Template

```javascript
/**
 * Example V2 Scraper
 * Writes to staging_games (NOT matches_v2)
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const CONFIG = {
  SOURCE_PLATFORM: "new_source",
  BATCH_SIZE: 500,
};

async function main() {
  const matches = []; // Scrape matches here

  // Transform to staging_games schema
  const stagingGames = matches.map(m => ({
    match_date: m.date,         // TEXT - no parsing required
    match_time: m.time,         // TEXT
    home_team_name: m.home,     // TEXT NOT NULL
    away_team_name: m.away,     // TEXT NOT NULL
    home_score: m.homeScore,    // TEXT
    away_score: m.awayScore,    // TEXT
    event_name: m.eventName,    // TEXT
    event_id: m.eventId,        // TEXT - REQUIRED for Tier 1 resolution
    venue_name: m.venue,        // TEXT
    division: m.division,       // TEXT
    source_platform: CONFIG.SOURCE_PLATFORM,  // REQUIRED
    source_match_key: `${CONFIG.SOURCE_PLATFORM}-${m.id}`,  // For dedup
    raw_data: {                 // JSONB - preserve original + source IDs
      ...m,
      source_home_team_id: m.homeTeamId,  // REQUIRED (Session 89)
      source_away_team_id: m.awayTeamId,  // REQUIRED (Session 89)
    },
    processed: false,           // Will be true after validation
  }));

  // Insert in batches
  for (let i = 0; i < stagingGames.length; i += CONFIG.BATCH_SIZE) {
    const batch = stagingGames.slice(i, i + CONFIG.BATCH_SIZE);
    const { error } = await supabase.from("staging_games").insert(batch);
    if (error) console.error("Insert error:", error.message);
  }

  console.log(`✅ Staged ${stagingGames.length} matches`);
  console.log("📋 Next: Run fastProcessStaging.cjs or dataQualityEngine.js to process");
}

main();
```

---

## Staging Table Schema

### staging_games

| Column | Type | Required | Notes |
|--------|------|----------|-------|
| `id` | BIGSERIAL | Auto | Primary key |
| `match_date` | TEXT | Yes | Any format - validation handles parsing |
| `match_time` | TEXT | No | Any format |
| `home_team_name` | TEXT | Yes | Raw name from source |
| `away_team_name` | TEXT | Yes | Raw name from source |
| `home_score` | TEXT | No | Can be "2", "TBD", null |
| `away_score` | TEXT | No | Can be "2", "TBD", null |
| `event_name` | TEXT | No | Human readable |
| `event_id` | TEXT | No | Source's event ID |
| `venue_name` | TEXT | No | Venue/location |
| `field_name` | TEXT | No | Specific field |
| `division` | TEXT | No | Age group + gender |
| `source_platform` | TEXT | Yes | e.g., "heartland", "gotsport" |
| `source_match_key` | TEXT | No | For deduplication |
| `raw_data` | JSONB | No | Original data preserved |
| `processed` | BOOLEAN | No | Set true after validation |
| `created_at` | TIMESTAMPTZ | Auto | Insertion timestamp |

### staging_events

| Column | Type | Required | Notes |
|--------|------|----------|-------|
| `event_name` | TEXT | Yes | Human readable |
| `event_type` | TEXT | No | "league" or "tournament" |
| `source_platform` | TEXT | Yes | e.g., "heartland" |
| `source_event_id` | TEXT | No | Source's ID |
| `state` | TEXT | No | 2-letter code |
| `region` | TEXT | No | e.g., "Kansas City" |
| `raw_data` | JSONB | No | Original data |
| `processed` | BOOLEAN | No | Set true after validation |

---

## Integration Pipeline (V2)

### After Scraping

```bash
# 1. Process staging → production (Option A: fast bulk, Option B: full pipeline)
node scripts/maintenance/fastProcessStaging.cjs
# OR
node scripts/universal/dataQualityEngine.js --process-staging

# 2. Refresh materialized views
node scripts/refresh_views_manual.js
```

### What dataQualityEngine.js Does

1. **Reads staging_games** where `processed = false`
2. **Validates data**:
   - Parses dates
   - Validates scores (numeric or null)
   - Normalizes team names
3. **Resolves teams** (Session 89 Three-Tier Resolution):
   - **Tier 1:** Deterministic `source_entity_map` lookup (O(1), 100% accurate)
   - **Tier 2:** Canonical name match with NULL-tolerant birth_year fallback
   - **Tier 3:** Fuzzy name matching (last resort)
   - Creates new team if no match + registers source ID to prevent future duplicates
4. **Resolves events** (Same three-tier pattern):
   - Tier 1 source ID → Tier 2 canonical name → Tier 3 create new
5. **Inserts to matches_v2**:
   - With proper foreign keys
6. **Marks staging as processed**:
   - Sets `processed = true`
7. **Refreshes views** (if `--refresh-views`):
   - Calls `refresh_app_views()`

---

## Entity Resolution: Three-Tier Pattern (Session 89)

When data flows from staging to production, entities (teams, leagues, tournaments) are resolved using a deterministic three-tier system:

```
┌──────────────────────────────────────────────────────────────────┐
│  TIER 1: Source Entity Map (Deterministic, O(1))                  │
│  SELECT sv_id FROM source_entity_map                              │
│  WHERE entity_type='team' AND source_platform=$1                  │
│    AND source_entity_id=$2                                        │
│  → If found: Use this team. DONE. 100% accurate.                  │
├──────────────────────────────────────────────────────────────────┤
│  TIER 2: Canonical Name + NULL-Tolerant Metadata                  │
│  SELECT id FROM teams_v2                                          │
│  WHERE canonical_name=$1 AND gender=$2                            │
│    AND (birth_year=$3 OR birth_year IS NULL)                      │
│  → If found: Use this team + register source ID for Tier 1        │
├──────────────────────────────────────────────────────────────────┤
│  TIER 3: Create New Entity                                        │
│  INSERT INTO teams_v2 (...) RETURNING id                          │
│  INSERT INTO source_entity_map (entity_type, source_platform,     │
│    source_entity_id, sv_id)                                       │
│  → New entity + registered for future Tier 1 resolution           │
└──────────────────────────────────────────────────────────────────┘
```

**Key insight:** Tier 1 prevents duplicates with 100% accuracy. Every new source ID registered makes the system more accurate over time.

**Adapter requirement:** Emit `source_home_team_id` and `source_away_team_id` in `raw_data` JSONB for Tier 1 to work.

### source_entity_map Table

| Column | Type | Purpose |
|--------|------|---------|
| `entity_type` | TEXT | 'team', 'league', 'tournament', etc. |
| `source_platform` | TEXT | 'gotsport', 'htgsports', 'heartland' |
| `source_entity_id` | TEXT | Source's own ID for this entity |
| `sv_id` | UUID | SoccerView's authoritative UUID |

**UNIQUE constraint:** `(entity_type, source_platform, source_entity_id)`

---

## V2 Scraper Checklist

### Before Writing Code

```markdown
## Research Checklist
- [ ] Source has OUTDOOR soccer data (NO futsal/indoor)
- [ ] Source has data from Aug 2023+ (last 3 seasons)
- [ ] Data type identified: [ ] League  [ ] Tournament  [ ] Both
- [ ] Access method identified: [ ] HTML  [ ] API  [ ] ICS
- [ ] Source provides team IDs (for source_entity_map Tier 1)
```

### During Development

```markdown
## V2 Implementation Checklist
- [ ] Writes to `staging_games` (NOT matches_v2)
- [ ] Sets `source_platform` on every record
- [ ] Generates `source_match_key` for deduplication
- [ ] Preserves raw data in `raw_data` JSONB column
- [ ] Emits `source_home_team_id` / `source_away_team_id` in raw_data (Session 89)
- [ ] Emits `event_id` for league/tournament source ID (Session 89)
- [ ] Registers events in `staging_events`
- [ ] No data validation in scraper (pipeline handles it)
- [ ] Handles rate limits / delays
- [ ] Has checkpoint/resume capability
```

### After Scraping

```markdown
## Post-Scrape Checklist
- [ ] Run `dataQualityEngine.js --process-staging` (or `fastProcessStaging.cjs`)
- [ ] Check staging_games.processed = true for new records
- [ ] Verify matches appear in `matches_v2`
- [ ] Verify teams appear in `teams_v2`
- [ ] Verify source IDs registered in `source_entity_map`
- [ ] Refresh views: `refresh_app_views()`
- [ ] Test in app: matches visible, teams searchable
```

### Post-Expansion QC Protocol (Session 96 — MANDATORY)

**After onboarding ANY new state or league, run this QC checklist in the app.** Session 96 discovered 4 fixable issues that would have shipped to users without QC testing.

```markdown
## Post-Expansion QC Checklist (Run in Expo Go)

### Home Page
- [ ] Match count displays correctly (not "0 Matches")
- [ ] No console errors in fetchStats
- [ ] Date range shows current season matches

### Rankings Tab
- [ ] New state appears in state filter dropdown
- [ ] Teams from new source appear when state is filtered
- [ ] Rank numbers are sequential (no gaps from duplicates)
- [ ] Sort order is correct (state_rank when state filtered, national_rank otherwise)

### Teams Tab
- [ ] Teams from new source are searchable by name
- [ ] Team names display correctly (no double-prefix, no encoding issues)
- [ ] Birth year and gender metadata populated (not NULL)

### League Standings
- [ ] New league appears in league dropdown
- [ ] Division names are consistent and human-readable
- [ ] No unnecessary suffixes (e.g., "- Group A" when only one group exists)
- [ ] All teams in each division are displayed (compare to source)
- [ ] W-L-D and points match source data

### Team Detail (pick 3+ teams from new source)
- [ ] Matches appear in Recent section
- [ ] Upcoming/scheduled games appear (if applicable)
- [ ] Season stats (W-L-D) are accurate
- [ ] Power Rating is populated (ELO calculated)
- [ ] State is correct (not 'unknown')

### Data Quality Queries
- [ ] `SELECT COUNT(*) FROM teams_v2 WHERE state = '{STATE}'` — teams assigned correctly
- [ ] `SELECT COUNT(*) FROM teams_v2 WHERE state = 'unknown' AND id IN (...)` — no orphan state
- [ ] `SELECT display_name FROM teams_v2 WHERE display_name LIKE '%{ClubName} {ClubName}%'` — no double-prefix
- [ ] `SELECT DISTINCT division FROM league_standings WHERE league_id = ...` — divisions clean
```

**Common QC Issues Found (Session 96, universal lessons):**

| Issue | Root Cause | Fix | Prevention |
|-------|-----------|-----|------------|
| Teams have `state='unknown'` | `processStandings.cjs` didn't inherit league state | Propagate `leagueState` to team creation | `resolveTeam()` accepts `leagueState` param |
| Division names inconsistent | `mapTierToName()` mixed ordinal/cardinal styles | Source-specific naming in adapter config | Each adapter owns its `mapTierToName()` |
| "- Group A" suffix on all divisions | Unconditional group append | Only append when multiple groups exist | Post-processing group suffix logic |
| Double-prefix with diacritics | `removeDuplicatePrefix()` used `.toLowerCase()` | Unicode NFD normalization before comparison | `stripDiacritics()` in `cleanTeamName.cjs` |
| Home page "0 Matches" | PostgREST timeout filtering `home_score` on materialized view | Query `app_matches_feed` with date-only filter | App uses Layer 3 views, not Layer 2 tables |
| Abbreviated team names | Source data reality (sole source for state) | No fix needed — these ARE the official names | Document source data characteristics |

---

## Existing Scrapers

### Universal Framework Adapters (Session 57) - PREFERRED

| Adapter | Source | Technology | Status |
|---------|--------|------------|--------|
| `scripts/adapters/gotsport.js` | GotSport | Cheerio | ✅ Production |
| `scripts/adapters/htgsports.js` | HTGSports | Puppeteer | ✅ Production |
| `scripts/adapters/heartland.js` | Heartland CGI + Calendar | Puppeteer/AJAX | ✅ Production (Premier-only, v5.0) |
| `scripts/adapters/sincsports.js` | SINC Sports | Puppeteer | ✅ Production (Session 95) |
| `scripts/adapters/_template.js` | Template | — | Template |

### SINC Sports Adapter (Session 95)

**Platform:** SINC Sports (`soccer.sincsports.com`) — used by NC, TN, and other state associations.

**Key Technical Details:**

| Aspect | Details |
|--------|---------|
| DOM Structure | **Bootstrap grid (div-based)**, NOT HTML tables |
| Match selectors | `.game-row` → `.hometeam`/`.awayteam` divs → `<a>` tags for names/IDs |
| Score selectors | `.col-3 div[style*='color']` for completed, `.col-md-3` for scheduled |
| Standings selectors | `#divStds` container → `.std-heading` for group headers → `a[href*="team="]` for team rows → `.col.bigpad` for stats |
| Team ID extraction | `a[href*="teamid="]` or `a[href*="team="]` — URL params, not text |
| Time validation | Must validate hour (1-12) and minute (0-59) — SINC pages have corrupted times like "53:00" |

**Lessons Learned (Sessions 95-96):**
1. **Test small batches first** — always `--event SINGLE_ID` before `--active`
2. **SINC Sports uses responsive layouts** — team rows contain `.std-heading` (smallOnly) elements. Cannot filter by `.std-heading` class; instead identify team rows by `a[href*="team="]` presence.
3. **Stats filtering** — use `.closest('.std-heading')` to exclude stats inside responsive headers. Only count `.col.bigpad` elements NOT inside `.std-heading`.
4. **Group suffix is conditional** — only append "- Group A" when multiple groups exist for the same division within the same event. If only one group → no suffix. Prevents noise in single-group leagues.
5. **Division naming is source-specific** — NCYSA uses ordinal ("1st Division", "2nd Division"), Heartland uses cardinal ("Division 1", "Division 2"). The adapter's `mapTierToName()` controls this. Never apply one source's naming convention to another's data.
6. **Abbreviated team names ARE official** — SINC Sports is the sole data source for states like NC. Short names ("CSA Charlotte King", "WFC Silver") are the official NCYSA team names. There are no fuller equivalents to link to. Not a data quality bug — it's source data reality.
7. **State metadata must propagate** — League records have `state = 'NC'`, but `processStandings.cjs` was hardcoding `'unknown'` for newly created teams. Fix: inherit state from league metadata.
8. **Unicode diacritics in team names** — International club names (Barça, Atlético, München) require NFD normalization for duplicate prefix detection. Without it, "Barca Academy" ≠ "Barça Academy" and the prefix dedup algorithm fails.

**Supported Data:**
- Match results (completed + scheduled)
- League standings (with division/group structure)
- All 3 flows validated: Matches → ELO, Standings → League Page, Scheduled → Upcoming

**Current Events:**
| Event ID | Name | State | Matches | Standings |
|----------|------|-------|---------|-----------|
| NCFL | NCYSA Fall Classic League | NC | 4,303 | 805 |
| NCCSL | NC Classic Spring League | NC | 4,389 | — |

### Legacy Scrapers (Fallback)

| Scraper | Source | Status | Output |
|---------|--------|--------|--------|
| `scrapeHeartlandResults.js` | Heartland CGI | ✅ Fallback | staging_games |
| `scrapeHTGSports.js` | HTGSports | ✅ Fallback | staging_games |
| `scrapeHeartlandLeague.js` | Heartland calendar | ✅ Fallback | staging_games |
| `syncActiveEvents.js` | GotSport | ✅ Fallback | staging_games |

**Note:** GitHub Actions uses Universal Framework by default with auto-fallback to legacy on failure.

### Heartland Data Access Mechanisms (Session 87.2)

Heartland Soccer Association has **4 distinct data access mechanisms**. As of Feb 2026:

| # | Source | URL | Status | Data |
|---|--------|-----|--------|------|
| 1 | CGI Results | `heartlandsoccer.net/reports/cgi-jrb/subdiv_results.cgi` | **DEAD** (404 on www) | Match results with scores |
| 2 | CGI Standings | `heartlandsoccer.net/reports/cgi-jrb/subdiv_standings.cgi` | **ALIVE** (empty between seasons) | Team W-L-T-GF-GA-Pts |
| 3 | Calendar | `calendar.heartlandsoccer.net/team/` | **ALIVE** | Scheduled matches (NULL scores) |
| 4 | Season Archives | `/reports/seasoninfo/archives/standings/` | **ALIVE** | Historical standings (static HTML) |

**CGI Access via hs-reports WordPress Plugin:**
- Score-Standings page: `https://www.heartlandsoccer.net/league/score-standings/`
- Custom `<hs-reports>` web component intercepts form submissions
- Forms have `.ajax-submit` class, jQuery AJAX fetches CGI, results injected into iframe
- Use Puppeteer `page.evaluate(() => fetch(url))` for same-origin access (bypasses CORS)

**Between-Season Detection:**
- Fall season ends ~December, Spring starts ~March
- CGI returns HTTP 200 but 0 bytes between seasons
- heartland.js v5.0 probes standings CGI and exits immediately if empty

**Season Archives (Static HTML):**
- URL: `/reports/seasoninfo/archives/standings/{season}/{gender}_prem.html`
- Seasons: `2025_fall`, `2024_fall`, `2024_spring`, etc. back to Fall 2018
- Contains per-division team standings with IDs

**Current Data:** 9,932 Heartland matches in production (9,729 with scores)

### Session 95 Database Snapshot (Feb 15, 2026)

| Metric | Value |
|--------|-------|
| **matches_v2 (active)** | 411,641 |
| **matches_v2 (soft-deleted)** | ~5,468 |
| **teams_v2** | 146,505 |
| **Teams with ELO** | 52,853 |
| **ELO range** | 1,148 - 1,816 |
| **source_entity_map** | ~72,000+ |
| **league_standings** | 2,012 |
| **Unprocessed staging** | 0 |

**Key changes (Sessions 93-95):**
- 12,716 duplicate teams merged (Session 93)
- LEAST/GREATEST rank preservation across 8 files (Session 94)
- GotSport rankings pipeline integration with 68K+ source_entity_map entries (Session 94)
- SINC Sports adapter: NC Fall (4,303 matches) + NC Spring (4,389 matches) (Session 95)
- NC league standings: 805 entries across 15 divisions (Session 95)
- Division-seeded starting ELO: 2,012 teams seeded from standings (Session 95)
- fastProcessStaging.cjs: source_entity_map Tier 0 lookup + league/tournament classification by name (Session 95)

### staging_games Constraint (Session 87.2)

**CRITICAL:** `staging_games.source_match_key` MUST have a UNIQUE constraint for `ON CONFLICT` to work.

```sql
-- This constraint was added in Session 87.2
ALTER TABLE staging_games ADD CONSTRAINT staging_games_source_match_key_unique UNIQUE (source_match_key);
```

Without it, `coreScraper.js` staging inserts silently fail with:
> "there is no unique or exclusion constraint matching the ON CONFLICT specification"

### Fast Bulk Staging Processor (Session 87.2)

When `dataQualityEngine.js` is too slow (row-by-row team resolution), use:

```bash
node scripts/maintenance/fastProcessStaging.cjs [--source htgsports] [--limit 1000] [--dry-run]
```

- Universal: works for any source platform
- Uses dedicated client for pipeline auth (session variables are per-connection)
- Bulk team resolution + bulk match insert
- 7,200 records in 30 seconds vs DQE's 0 in 10+ minutes

---

## Data Quality Rules

### Handled by dataQualityEngine.js (replaces validationPipeline.js)

| Rule | Action |
|------|--------|
| Invalid date | Parse common formats, log if unparseable |
| Invalid score | Set null, flag for review |
| Empty team name | Skip match, log error |
| Duplicate source_match_key | Skip (idempotent) |
| Missing event | Create in leagues/tournaments |

### Quality Flags on teams_v2

| Flag | Meaning |
|------|---------|
| `data_quality_score` | 0-100 overall quality |
| `birth_year_source` | extracted_from_name/from_age_group/official/unknown |
| `gender_source` | parsed/inferred/official/unknown |
| `data_flags.needs_review` | Manual review needed |

### Birth Year Extraction Priority (Session 53)

The `dataQualityEngine.js` extracts birth_year from team names using this priority:

| Priority | Pattern | Example | Result |
|----------|---------|---------|--------|
| 1 | 4-digit year | "Sporting 2013B" | 2013 |
| 2 | 2-digit code (##B/G) | "Rush 14B" | 2014 |
| 3 | 2-digit code (B/G##) | "Rush B14" | 2014 |
| 4 | Age group | "Tigers U12" | 2026 - 12 = 2014 |

**Age Group Formula:** `age_group = 'U' || (season_year - birth_year)`

The season_year comes from the `seasons` table (dynamic, not hardcoded).

---

## Monitoring

### Check Staging Status

```sql
-- Unprocessed staging records
SELECT source_platform, COUNT(*), MAX(created_at)
FROM staging_games
WHERE processed = false
GROUP BY source_platform;
```

### Check Pipeline Results

```sql
-- Recent matches by source
SELECT source_platform, COUNT(*), MAX(created_at)
FROM matches_v2
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY source_platform;

-- Unlinked matches (need team creation)
SELECT source_platform, COUNT(*)
FROM matches_v2
WHERE home_team_id IS NULL
GROUP BY source_platform;
```

### Check App Views

```sql
-- View row counts
SELECT 'app_rankings' as view, COUNT(*) FROM app_rankings
UNION ALL
SELECT 'app_matches_feed', COUNT(*) FROM app_matches_feed
UNION ALL
SELECT 'app_league_standings', COUNT(*) FROM app_league_standings;
```

---

## Rollback & Recovery

### If Bad Data Reaches Production

```sql
-- Delete from matches_v2 by source and date
DELETE FROM matches_v2
WHERE source_platform = 'bad_source'
  AND created_at > '2026-01-28';

-- Re-run view refresh
SELECT refresh_app_views();
```

### If Validation Pipeline Fails

```sql
-- Reset staging to reprocess
UPDATE staging_games
SET processed = false
WHERE source_platform = 'source_name'
  AND created_at > '2026-01-28';

-- Then re-run pipeline
```

### Preserve Staging Data

Staging tables are NOT auto-cleared. This allows:
- Debugging issues
- Re-processing with fixes
- Auditing data sources

---

## Quick Reference

### Daily Sync Workflow (Session 92 QC — Dual-System)

```yaml
# GitHub Actions: daily-data-sync.yml
# TWO INDEPENDENT PIPELINES running in the same workflow

# ═══════════ SYSTEM 1: MATCH PIPELINE (Rankings/ELO) ═══════════

# Phase 1: Scrape matches (parallel) — Universal Framework + Fallback
sync-gotsport:    coreScraper.js --adapter gotsport (fallback: syncActiveEvents.js)
sync-htgsports:   coreScraper.js --adapter htgsports (fallback: scrapeHTGSports.js)
sync-heartland:   coreScraper.js --adapter heartland (fallback: legacy scripts)
sync-sincsports:  coreScraper.js --adapter sincsports --active

# Phase 2: Validate matches (sequential) — Heavy 3-tier resolver
validation-pipeline → matches_v2, teams_v2, leagues, tournaments

# Phase 2.5: Self-healing inference linkage
infer-event-linkage → Links orphaned matches by team patterns

# Phase 2.7: GotSport rankings refresh (Session 94)
refresh-gotsport-rankings → restoreGotSportRanks.cjs --cached

# Phase 3: ELO Calculation (with division seeding — Session 95)
recalculate-elo → Division seed → Process matches → Power ratings

# ═══════════ SYSTEM 2: STANDINGS ABSORPTION (League Page) ═══════════

# Phase 1.5: Scrape standings (parallel with Phase 1)
scrape-standings-heartland:   scrapeStandings.js --adapter heartland
scrape-standings-sincsports:  scrapeStandings.js --adapter sincsports

# Phase 2.6: Process standings — Lightweight resolver (NO fuzzy matching)
process-standings: processStandings.cjs → league_standings

# ═══════════ SHARED ═══════════

# Phase 5: Refresh ALL views (both systems)
refresh-views → app_rankings, app_matches_feed, app_league_standings, etc.
```

### Commands

```bash
# Run Universal Framework scraper (PREFERRED)
node scripts/universal/coreScraper.js --adapter gotsport --active

# Run legacy scraper (fallback)
node scripts/scrapers/scrapeHeartlandResults.js

# Process staging and refresh views
node scripts/universal/dataQualityEngine.js --process-staging
node scripts/refresh_views_manual.js

# Manual view refresh
psql $DATABASE_URL -c "SELECT refresh_app_views();"

# Check staging status
psql $DATABASE_URL -c "SELECT source_platform, COUNT(*) FROM staging_games WHERE processed=false GROUP BY 1;"
```

---

*This playbook follows V2 three-layer architecture with Universal Scraper Framework.*
*For architecture details, see [docs/ARCHITECTURE.md](ARCHITECTURE.md).*
*Session 57: Universal Framework added, source_match_key UNIQUE constraint enforced.*
