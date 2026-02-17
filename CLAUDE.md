# CLAUDE.md - SoccerView Project Master Reference

> **Version 23.7** | Last Updated: February 17, 2026 | Session 107 Complete
>
> This is the lean master reference. Detailed documentation in [docs/](docs/).

---

## 🚨 READ FIRST: [GUARDRAILS](docs/1.1-GUARDRAILS_v2.md)

**MANDATORY pre-flight checklist before ANY action.** Contains absolute rules, universal patterns, and common mistakes to avoid.

---

## Quick Links to Documentation

| Document | Purpose |
|----------|---------|
| [docs/1.1-GUARDRAILS_v2.md](docs/1.1-GUARDRAILS_v2.md) | **🚨 MANDATORY** Pre-flight checklist & absolute rules |
| [docs/DATA_ISSUE_PROTOCOL.md](docs/DATA_ISSUE_PROTOCOL.md) | **📋 DATA FIX** Prompt template & fix protocol |
| [docs/1.2-ARCHITECTURE.md](docs/1.2-ARCHITECTURE.md) | V2 database architecture (3-layer design) |
| [docs/1.3-SESSION_HISTORY.md](docs/1.3-SESSION_HISTORY.md) | All past session summaries |
| [docs/2-UNIVERSAL_DATA_QUALITY_SPEC.md](docs/2-UNIVERSAL_DATA_QUALITY_SPEC.md) | **ACTIVE** Data quality system spec |
| [docs/2-RANKING_METHODOLOGY.md](docs/2-RANKING_METHODOLOGY.md) | ELO ranking calculation methodology |
| [docs/3-DATA_SCRAPING_PLAYBOOK.md](docs/3-DATA_SCRAPING_PLAYBOOK.md) | How to add new data sources |
| [docs/3-DATA_EXPANSION_ROADMAP.md](docs/3-DATA_EXPANSION_ROADMAP.md) | Priority queue for expansion |
| [docs/3-UI_PATTERNS.md](docs/3-UI_PATTERNS.md) | Mandatory UI patterns |
| [docs/3-UI_PROTECTION_PROTOCOL.md](docs/3-UI_PROTECTION_PROTOCOL.md) | UI backup/recovery procedures |
| [docs/4-LAUNCH_PLAN.md](docs/4-LAUNCH_PLAN.md) | Marketing messages & launch checklist |
| [docs/SESSION_88_UNIVERSAL_QC_FIX.md](docs/SESSION_88_UNIVERSAL_QC_FIX.md) | Session 88: QC Issues #1-2 (birth year, rank badge) |
| [docs/SESSION_88_QC3_STATE_FIX.md](docs/SESSION_88_QC3_STATE_FIX.md) | Session 88: QC Issue #3 (wrong state assignment) |
| [docs/SESSION_88_QC4_DUPLICATE_MATCHES.md](docs/SESSION_88_QC4_DUPLICATE_MATCHES.md) | Session 88: QC Issue #4 (duplicate matches) |
| [docs/SESSION_90_CROSS_IMPORT_DUPLICATES.md](docs/SESSION_90_CROSS_IMPORT_DUPLICATES.md) | Session 90: Cross-import duplicate fix |
| [docs/_archive/](docs/_archive/) | Completed project documents |

---

## Project Overview

SoccerView is a React Native/Expo app providing national youth soccer rankings:

1. **Official Rankings** (Gold/Amber) - GotSport national rankings
2. **SoccerView Power Rating** (Blue) - Proprietary ELO-based algorithm

### Target Users
- Youth soccer parents seeking team performance insights
- Coaches tracking competitive landscape
- Tournament directors using rankings for seeding

### Competitive Advantage
- Modern dark-themed UI
- Dual ranking system
- AI-powered match predictions
- League Standings feature

---

## Critical Principles

### 1. Nomenclature (ALWAYS USE)

| Term | Definition | Duration |
|------|------------|----------|
| **LEAGUE** | Regular season play | Weeks/months |
| **TOURNAMENT** | Short competition | Weekend (1-3 days) |

**"Events" is BANNED** - Use "leagues" or "tournaments" only.

### 2. Single Source of Truth

```
Scrapers → SoccerView DB → ELO Calculation → App
```

- All teams from ALL sources are first-class entities
- Every team gets SoccerView ELO rating
- 100% link rate target

### 3. V2 Architecture Data Flow

```
Scrapers → staging_games → dataQualityEngine.js → matches_v2 → app_views → App
```

See [docs/1-ARCHITECTURE.md](docs/1-ARCHITECTURE.md) for full details.

### 4. Team Names Never Truncate

Team names must ALWAYS be fully visible. Cards expand to fit.

```typescript
// ❌ WRONG
<Text numberOfLines={2}>{team.name}</Text>

// ✅ CORRECT
<Text>{team.name}</Text>
```

### 5. Data Quality IS The Product

**The app's core promise:** A parent searches for their kid's team and finds it with accurate rankings.

Every data decision must pass this test:
- **Will the team appear in the correct age group filter?** (birth_year must be accurate)
- **Will there be one canonical team entry?** (no duplicates splitting match history)
- **Will the ranking reflect all matches played?** (matches must link to correct team)
- **Will search results be clean?** (no garbage data cluttering results)
- **Will upcoming games show on the team detail page?** (scheduled matches need proper linkage)

**Priority order for data issues:**
1. **Duplicates** — Merge them. Fragmented match history = wrong rankings.
2. **Wrong age group** — Fix birth_year mismatches. Team in wrong filter = invisible to user.
3. **Missing from filters** — Fix NULL birth_year. Unfindable team = broken promise.
4. **Unlinked matches** — Fix league/tournament linkage. Affects "Upcoming" section display.
5. **Invalid data** — Remove or flag U1/U2/U20+ garbage. Cluttered results = unprofessional.

### 6. Scheduled Matches Are Critical

**Scheduled/future matches (NULL scores) are NOT garbage.** They populate:
- **Team Details "Upcoming" section** - Parents want to see next games
- **app_upcoming_schedule view** - Powers the upcoming matches feature

**NEVER delete a match just because it has no scores.** Only delete if:
- Match date is impossibly far in future (2027+)
- Match is clearly invalid (U1/U2 age groups, etc.)

### 6b. NULL Scores vs 0-0 Scores (Session 72)

**CRITICAL:** Scheduled matches MUST have NULL scores, not 0-0.

| Match Type | home_score | away_score | App Behavior |
|------------|------------|------------|--------------|
| Scheduled | `NULL` | `NULL` | Shows in "Upcoming" section |
| Played (0-0 tie) | `0` | `0` | Shows in "Recent" section |
| Played (with goals) | `3` | `1` | Shows in "Recent" section |

**Why this matters:**
The app determines upcoming vs recent matches using this logic:
```javascript
const hasScores = match.home_score !== null && match.away_score !== null &&
                  (match.home_score > 0 || match.away_score > 0);
if (hasScores || matchDate < now) {
  recent.push(match);  // Played match
} else {
  upcoming.push(match);  // Scheduled match (NULL scores + future date)
}
```

**Bug fixed in Session 72:**
- `validationPipeline.js` and `dataQualityEngine.js` were converting NULL to 0
- This made 9,210 scheduled matches appear as played 0-0 games
- Fix: Remove `?? 0` fallback, preserve NULL for scheduled matches

**Pipeline requirements:**
1. Scrapers/adapters: Return NULL for matches without scores
2. Validation pipeline: NEVER convert NULL to 0
3. Database schema: `home_score` and `away_score` columns allow NULL
4. App: Use NULL check to distinguish scheduled from played

### 7. Upcoming Section Data Integrity

**app_upcoming_schedule view ONLY shows matches linked to a league or tournament.**

Unlinked matches are EXCLUDED because:
- Parents plan weekends around this data - accuracy is critical
- Showing unverified "Scheduled Match" entries damages user trust
- If we don't know what event a match belongs to, it shouldn't appear in Upcoming

```sql
-- CRITICAL filter in app_upcoming_schedule view:
AND (m.league_id IS NOT NULL OR m.tournament_id IS NOT NULL)
```

**Result:** 4,753 verified matches in Upcoming (not 6,282 with unverified)

**When in doubt:** Would this data issue cause a frustrated parent to screenshot the app and post "This app is broken, my kid's team isn't even showing"? If yes, fix it before any other work.

A technically elegant architecture with widespread data issues is a failed product. A pragmatic data fix that helps thousands more parents find their kid's team is a success.

### 8. Fuzzy Matching Limitations (Session 57)

**Problem:** Very similar team names may incorrectly match to the same team:
- Color variants: "Sporting 2014 Blue" vs "Sporting 2014 White"
- Regional variants: "Red Bulls Long Island 2013" vs "Red Bulls Central 2013"

**Impact:** ~2% of matches with nearly identical team names

**Mitigation:** Validation pipeline now detects `home_team_id == away_team_id` and skips with error log instead of crashing.

### 9. Prevent Duplicate League Entries (Session 59)

**Problem:** Different scrapers can create multiple league entries for the same real-world league:
- `scrapeHeartlandLeague.js` created "Heartland Soccer League 2025"
- `scrapeHeartlandResults.js` created "Heartland Premier League 2025"

**Impact:** Team Details page shows same matches split across multiple leagues.

**Root Cause:** Inconsistent `source_event_id` naming between scrapers:
- Calendar scraper: `heartland-league-2025`
- Results scraper: `heartland-premier-2025`

**Prevention:**
1. All scrapers for a source MUST use identical `source_event_id` format
2. New adapters should follow the pattern in `scripts/adapters/_template.js`
3. Run `mergeHeartlandLeagues.js` pattern if duplicates are discovered

**Fix Script:** `scripts/maintenance/mergeHeartlandLeagues.js`

### 10. Alphanumeric Team ID Extraction (Session 61)

**Problem:** Heartland scraper was silently skipping matches because team IDs can be alphanumeric (e.g., "711A"), not just numeric (e.g., "7115").

**Root Cause:** The regex `^\d+` in `scripts/adapters/heartland.js` only matched pure numeric IDs.

**Impact:** 64 matches per Heartland subdivision were silently skipped, causing incomplete team records.

**Universal Fix:**
```javascript
// ❌ WRONG - Only matches numeric IDs
extractTeamId: (name) => name.match(/^(\d+)\s+/)?.[1]

// ✅ CORRECT - Matches all alphanumeric IDs
extractTeamId: (name) => name.match(/^([A-Za-z0-9]+)\s+/)?.[1]
```

**Prevention:** When writing adapters, ALWAYS use alphanumeric-capable regex patterns for ID extraction.

### 11. Build for N Sources, Not Current Sources

**Every system must work for ANY future data source with ZERO custom code.**

This applies to:
- **Scrapers** → Use universal adapter pattern (`scripts/adapters/`)
- **Data Quality** → Use canonical registries, not hardcoded mappings
- **Deduplication** → Use fuzzy matching algorithms, not source-specific rules
- **Validation** → Use configurable rules, not if/else by platform

**Test:** If adding MLS Next tomorrow requires writing source-specific logic anywhere except an adapter config file, the architecture is wrong.

**Anti-patterns to reject:**
- `if (source === 'gotsport') { ... }`
- Hardcoded team/event name mappings in JavaScript
- Source-specific normalizer functions
- Any code that "works for now" but won't scale

See [docs/2-UNIVERSAL_DATA_QUALITY_SPEC.md](docs/2-UNIVERSAL_DATA_QUALITY_SPEC.md) for full specification.

### 12. Optimize for Speed and Accuracy

**Process thousands of records per minute - not dozens.**

| Do This | Not This |
|---------|----------|
| Direct SQL with pg Pool | Supabase client for bulk operations |
| Bulk INSERT/UPDATE (1000+ rows) | Row-by-row loops |
| Batch processing with CASE statements | Individual UPDATE per record |
| PostgreSQL functions for complex logic | Round-trips from Node.js |

**Benchmark:** If processing 10K+ records takes more than a few minutes, you're doing it wrong.

**Example - ELO recalculation:**
```javascript
// ❌ WRONG - 3+ hours for 300K matches
for (const match of matches) {
  await supabase.from('teams').update({ elo: newElo }).eq('id', teamId);
}

// ✅ CORRECT - 6 minutes for 300K matches
const sql = `UPDATE teams_v2 SET elo_rating = CASE id ${cases} END WHERE id IN (${ids})`;
await pool.query(sql);
```

### 13. Universal, Not Specific

**Every fix must work for ANY data source - not just the one with the current problem.**

- No hardcoding
- No source-specific logic
- No shortcuts that "work for now"

**Before committing any data fix, ask:** Will this same code work correctly when we add MLS Next, ECNL, SINC Sports, or any of the other 400+ potential sources?

If the answer is "no" or "maybe" - rewrite it to be universal.

### 14. Schema Column Names Must Match Database (Session 63)

**Problem:** Supabase queries fail silently or crash when column names in `.select()` don't match the actual database schema.

**Common Mistakes:**
```typescript
// ❌ WRONG - Column doesn't exist on this table
.select('id, match_date, birth_year')  // birth_year is on teams_v2, not matches_v2

// ❌ WRONG - Typo creates undefined property
season: tournament.season_id_id  // Should be season_id

// ❌ WRONG - Wrong column name
.select('id, name, season, ...')  // Column is season_id, not season
```

**Correct Patterns:**
```typescript
// ✅ Use foreign key joins for related table columns
.select(`
  id, match_date,
  home_team:teams_v2!matches_v2_home_team_id_fkey(display_name, birth_year, gender)
`)

// ✅ Reference exact column names from schema
.select('id, name, season_id, state, region')
```

**Prevention:**
1. Verify column names against actual database schema before writing queries
2. Use TypeScript types that match schema (see `lib/supabase.types.ts`)
3. Test queries in isolation before integrating

### 15. Adaptive Learning - The System Gets Smarter Over Time

**Every fix should teach the system to prevent the same problem in the future.**

The data quality system must be SELF-IMPROVING, not just reactive:

| Action | Learning Outcome |
|--------|------------------|
| Merge duplicate teams | Add merged name to `canonical_teams.aliases` |
| Merge duplicate events | Add merged name to `canonical_events.aliases` |
| Create new team | Auto-register in `canonical_teams` for future matching |
| Successful fuzzy match | Increase confidence score in `learned_patterns` |
| Failed fuzzy match | Decrease confidence, flag for review |

**The Feedback Loop:**
```
New Data → Normalize → Check Canonical → Create/Match → Learn → Prevent Future Duplicates
     ↑                                                              │
     └──────────────── Patterns feed back ──────────────────────────┘
```

**Key Components:**
- `canonical_teams` / `canonical_events` / `canonical_clubs` - Known good entity names with aliases
- `learned_patterns` table - Stores patterns learned from successful operations
- `adaptiveLearning.js` - Pattern learning and application engine

**Test:** If the same duplicate is created twice, the system failed to learn. Every merge should prevent future occurrences of that same duplicate.

**Anti-patterns to reject:**
- One-time fixes that don't update canonical registries
- Manual mappings that aren't persisted to the database
- Fixes that solve today's problem but don't prevent tomorrow's

### 16. App UI Must Use V2 Views - NEVER V1 Tables (Session 66)

**CRITICAL:** The V1 tables have been archived/deleted. App code MUST use V2 views.

| V1 Table (DELETED) | V2 Replacement | Used By |
|-------------------|----------------|---------|
| `team_elo` | `app_team_profile` | Team Detail page |
| `match_results` | `matches_v2` + joins | Match queries |
| `rank_history` | `rank_history_v2` | Ranking Journey chart |

**Column Name Mapping:**
```typescript
// V1 → V2 mapping (app/team/[id].tsx)
team_name → display_name  // Map after fetch: { ...data, team_name: data.display_name }
```

**Match Query Pattern (V2):**
```typescript
const matchQuery = `
  id, match_date, match_time, home_score, away_score,
  home_team_id, away_team_id, league_id, tournament_id, status,
  home_team:teams_v2!matches_v2_home_team_id_fkey(display_name),
  away_team:teams_v2!matches_v2_away_team_id_fkey(display_name),
  league:leagues(name),
  tournament:tournaments(name)
`;
```

**Before ANY database query in app code, verify:**
1. Table/view exists in V2 schema (check `docs/1-ARCHITECTURE.md`)
2. Column names match V2 schema (not V1)
3. Use proper Supabase joins for related data

**Anti-patterns:**
- ❌ Using `team_elo`, `match_results`, or `rank_history` directly
- ❌ Assuming column names without checking schema
- ❌ Running `git checkout` on UI files without checking for uncommitted features

### 17. UI Protection Protocol (Session 67)

**UI files are PROTECTED ARTIFACTS.** Always backup before editing.

```bash
node scripts/ui-backup.js app/team/[id].tsx  # Before ANY edit
node scripts/ui-restore.js team-details golden  # Disaster recovery
```

See [docs/3-UI_PROTECTION_PROTOCOL.md](docs/3-UI_PROTECTION_PROTOCOL.md) for full protocol, locked files list, and recovery procedures.

### 18. Rank Calculation - Consistent Baseline (Session 70)

**Historical ranks MUST use a CONSISTENT BASELINE.**

| Approach | Problem | Correct |
|----------|---------|---------|
| Pool-relative | Early season = few teams = artificially high ranks | ❌ |
| Consistent baseline | Rank each ELO against TODAY's full pool | ✅ |

**Why:** A team's rank should reflect their strength relative to ALL teams, not just teams that happened to have data on that date.

**Implementation:**
```sql
-- For each historical ELO value, count teams with higher ELO in current pool
SELECT COUNT(*) + 1 as rank
FROM teams_v2
WHERE birth_year = $1 AND gender = $2
  AND matches_played > 0
  AND elo_rating > $historical_elo
```

**Result:** Rankings are meaningful and comparable across time.
- ELO 1558 → #304 (top 7% of 4,405 teams)
- ELO 1469 → #3,551 (bottom 20%)

**Script:** `scripts/maintenance/recalculateHistoricalRanks.cjs`

### 19. Library Selection - Switch When Failing (Session 71)

**When extensive debugging fails, switch libraries.**

| Situation | Action |
|-----------|--------|
| 2+ hours debugging library issues | Consider alternatives |
| GitHub issues show known problems | Use different library |
| Working code exists for similar task | Adapt existing pattern |

**Example (Session 71):**
- `react-native-gifted-charts` multi-line overlay: 10+ hours of failures
- `react-native-chart-kit` same task: Working in 30 minutes

**Chart Library Selection:**

| Use Case | Library |
|----------|---------|
| Single line chart | `react-native-gifted-charts` |
| Multi-line compare/overlay | `react-native-chart-kit` |
| Inverted Y-axis (rank charts) | Custom SVG |

**Anti-patterns:**
- ❌ Spending 10+ hours making a library do something it struggles with
- ❌ Ignoring GitHub issues documenting known problems
- ❌ Not checking if another library is already imported and working

### 20. Division Detection Regex - Universal Pattern (Session 74)

**Problem:** HTGSports scraper only found 1 division when 38 existed because the regex required a dash (`U-11`) but the site used format without dash (`U11`).

**Root Cause:** Regex `/U-\d+|2017|2016.../` required hyphen. Many sources use `U11`, `U09` (no dash).

**Universal Pattern:**
```javascript
// ❌ WRONG - Only matches "U-11" with required dash
divisionPattern: /U-\d+|2017|2016|2015|2014|2013|2012|2011|2010/i

// ✅ CORRECT - Matches both "U11" AND "U-11" with optional dash
divisionPattern: /U-?\d{1,2}\b|20[01]\d/i
```

**Pattern breakdown:**
- `U-?` - "U" followed by optional dash
- `\d{1,2}` - One or two digits (U9 through U19)
- `\b` - Word boundary (prevents matching "U115" in a team name)
- `20[01]\d` - Birth years 2000-2019

**Impact:** Scraper now finds all 38 divisions instead of 1. This is a universal fix for ANY source.

**Prevention:**
1. Always use `?` for optional characters in division patterns
2. Use `\b` word boundary to avoid partial matches
3. Test regex against real page content before deployment

### 21. Checkpoint Logic - Only Mark Processed When Data Found (Session 74)

**Problem:** Scraper marked events as "processed" even when 0 matches were found, causing them to be skipped on future runs.

**Root Cause:** Checkpoint update happened unconditionally after scraping each event, regardless of whether matches were found.

**Universal Fix:**
```javascript
// ❌ WRONG - Marks processed even with no data
await scrapeEvent(eventId);
checkpoint.processedEvents.push(eventId);  // Always marks processed

// ✅ CORRECT - Only mark processed when data found
const matches = await scrapeEvent(eventId);
if (matches.length > 0) {
  checkpoint.processedEvents.push(eventId);  // Only if data exists
}
```

**Why this matters:**
- Network issues may cause temporary empty results
- Page structure changes may cause scraper to find 0 matches
- Incorrect checkpoint = event never scraped again = permanent data loss

**Prevention:**
1. Checkpoint updates MUST be conditional on `matches.length > 0`
2. Log when 0 matches found for investigation
3. Consider retry logic before skipping events

### 22. Team Name Variations - Same Team, Different Names (Session 74)

**Problem:** Same team appears with different names across events:
- Tournament: "SBV Pre-NAL 15" (abbreviated)
- League: "Sporting Blue Valley SPORTING BV Pre-NAL 15 (U11 Boys)" (full)

**Impact:** Creates duplicate team entries with fragmented match history, causing incorrect rankings.

**Detection:**
When investigating missing matches, check for name variations:
```javascript
// Look for partial matches
await supabase.from('teams_v2')
  .select('id, display_name')
  .ilike('display_name', '%SBV%Pre-NAL%15%');
```

**Resolution:**
Use `scripts/maintenance/mergeTeams.js`:
```bash
node scripts/maintenance/mergeTeams.js --find "SBV Pre-NAL 15"
# Shows both entries with match counts
node scripts/maintenance/mergeTeams.js --keep <canonical-id> --merge <duplicate-id> --execute
```

**Prevention:**
1. Canonical registry should store aliases for known variations
2. Fuzzy matching should catch common abbreviations
3. After tournament scrapes, run deduplication check

**Common Abbreviation Patterns:**
- "Sporting Blue Valley" → "SBV"
- "Kansas City" → "KC"
- "FC" sometimes omitted or added

### 23. Real-Time Data for Team Details - Never Trust Pre-Computed Values (Session 75)

**Problem:** Team Details page showed inconsistent data because different sections used different data sources:
- Season Stats: Used pre-computed `teams_v2.matches_played/wins/losses/draws` (batch-computed)
- Match History: Queried `matches_v2` directly (real-time)
- Power Rating: Used `app_team_profile` view (depends on view refresh)

**Impact:** When ELO script or view refresh hasn't run, users see different numbers in different sections.

**Example:**
- Season Stats: 14 matches (6W-7L-1D) - STALE
- Match History: 19 matches (10W-7L-2D) - REAL-TIME
- Power Rating: ELO 1,469, #3,689 - STALE (should be 1,528, #859)

**Root Cause:** App relied on batch-computed values and materialized views instead of querying source tables.

**Universal Fix - Layer 3 (Presentation):**
All data that can be stale must be fetched directly from source tables:

```typescript
// ✅ Season Stats - Query matches_v2 directly
const { data: homeStats } = await supabase
  .from("matches_v2")
  .select("home_score, away_score")
  .eq("home_team_id", id)
  .not("home_score", "is", null)
  .gte("match_date", seasonStart);

// Calculate W-L-D from real match data
homeStats.forEach(m => {
  if (m.home_score > m.away_score) statsWins++;
  else if (m.home_score < m.away_score) statsLosses++;
  else statsDraws++;
});

// ✅ Power Rating - Query teams_v2 directly (bypass stale view)
const { data: eloData } = await supabase
  .from("teams_v2")
  .select("elo_rating, elo_national_rank, elo_state_rank")
  .eq("id", id)
  .single();

if (eloData) {
  setTeam(prev => ({ ...prev, ...eloData }));
}
```

**Three-Layer Verification:**

| Layer | Component | Status |
|-------|-----------|--------|
| Layer 1 (Intake) | Scrapers | ✅ Correctly insert to staging |
| Layer 2 (Processing) | ELO Script | ✅ Runs nightly, updates teams_v2 |
| Layer 3 (Presentation) | App | ✅ **FIXED** - Queries source tables directly |

**Why This Is Universal:**
1. Works for ANY team from ANY data source
2. Always reflects current database state
3. Bypasses materialized views that can be stale
4. No dependency on view refresh timing
5. Lightweight queries (no joins) for performance

**Files Modified:**
- [app/team/[id].tsx](app/team/[id].tsx) - Real-time queries for Season Stats + Power Rating

### 24. Orphans Are Coverage Gaps - NOT Duplicates (Session 78)

**CRITICAL:** Teams with GotSport points but 0 matches are almost always playing in leagues we don't scrape - NOT duplicates of existing teams.

**The Wrong Assumption:**
```
"Team has GotSport points but 0 matches"
→ "Must be a duplicate of a team we DO have matches for"
→ "Use fuzzy matching to merge them"
❌ WRONG - This merges DIFFERENT teams with DIFFERENT birth years!
```

**The Reality:**
```
"Team has GotSport points but 0 matches"
→ "Team plays in a league/tournament we don't scrape"
→ "No amount of merging will fix this"
✅ CORRECT - Need to expand data coverage to that league
```

**Evidence (Session 78 Analysis):**

| State | Teams with Matches | Orphans | Coverage |
|-------|-------------------|---------|----------|
| TX | 4,891 | 765 | 86.5% |
| KS | 879 | 175 | 83.4% |
| GA | 1,034 | 4,107 | **20.2%** |
| SC | 405 | 1,511 | **21.2%** |
| NC | 591 | 2,057 | **22.3%** |

States with low coverage contribute the most orphans. Merging won't fix this.

**Birth Year CANNOT Be Ignored:**
```javascript
// ❌ WRONG - These look similar but are DIFFERENT TEAMS
"Sporting BV Pre-NAL 2014B" → birth_year: 2014 → U12
"Sporting BV Pre-NAL 15"    → birth_year: 2015 → U11

// They play in DIFFERENT AGE GROUPS - never merge them!
```

**Correct Approach:**
1. **Fix birth_year inconsistencies** - Ensure team metadata is accurate
2. **Expand data coverage** - Scrape leagues in low-coverage states
3. **Accept some orphans** - Until coverage improves, some teams will remain orphans

**Anti-patterns to reject:**
- ❌ Fuzzy matching that ignores birth_year differences
- ❌ "Aggressive" merging based only on club name similarity
- ❌ Assuming all orphans have duplicates in the database
- ❌ One-time fixes instead of systemic coverage expansion

**Files Created:**
- `scripts/_debug/analyze_orphan_root_cause.cjs` - Diagnostic showing coverage gaps
- `scripts/maintenance/fixBirthYearFromNames.cjs` - Safe birth_year fix with conflict detection

### 25. ONE Pipeline, ONE Path - No Alternatives (Session 79)

**CRITICAL:** ALL data MUST flow through the same pipeline. No exceptions. No bypasses.

**The V2 Architecture Enforcement:**
```
Scrapers → staging_games → intakeValidator → dataQualityEngine → production
              ↓ (garbage)
         staging_rejected
```

**There is NO alternative path:**
- ❌ No direct writes to teams_v2/matches_v2
- ❌ No fallback to validationPipeline.js (archived)
- ❌ No emergency batchProcessStaging.js (archived)
- ❌ No "quick fix" scripts that bypass normalizers

**Enforcement Points:**
1. **Intake Validation Gate** - `intakeValidator.js` rejects garbage BEFORE staging
2. **Single Processor** - `dataQualityEngine.js` is THE ONLY staging→production path
3. **Integrity Verification** - `verifyDataIntegrity.js` catches issues AUTOMATICALLY

**Why This Matters (Session 76 Root Cause):**
The GotSport rankings scraper wrote directly to teams_v2, bypassing:
- Normalizers (didn't remove duplicate prefixes like "One FC One FC")
- Canonical registries (didn't register teams for deduplication)
- Result: 57,532 orphaned teams with GS rank but no matches

**Prevention:**
- ALL imports must go through staging → dataQualityEngine → production
- Database triggers can block unauthorized direct writes (Phase 3)
- Integrity verification catches issues before users report them

**Files for Pipeline Enforcement:**
- `scripts/universal/intakeValidator.js` - Pre-staging validation
- `scripts/universal/dataQualityEngine.js` - THE processor
- `scripts/daily/verifyDataIntegrity.js` - Post-processing checks

### 26. Git Hygiene - Commit Early, Commit Often (Session 80)

**Problem:** 280+ files accumulated over 30 sessions without being committed, creating risk of lost work and mismatch between local code and git history.

**Rule:** Claude MUST proactively manage git commits without waiting to be asked.

| Trigger | Action |
|---------|--------|
| Task completed | Commit with descriptive message |
| 10+ uncommitted files | Warn user, offer to commit |
| End of session | ALWAYS commit and push |
| Start of session | Check `git status` for uncommitted work |

**Claude should ask:** "I've completed [task]. Should I commit these changes now?"

**Never:**
- End a session with uncommitted work
- Let uncommitted files accumulate across sessions
- Wait for user to ask about commits
- Commit .env or other secrets

**Start of Session Check:**
```bash
git status  # Check for uncommitted work from previous sessions
```

If uncommitted changes exist, address them FIRST before starting new work.

### 27. Foundation First - Extract ALL Raw Data Before Daily Scrape (Session 83)

**CORE FOUNDATIONAL PRINCIPLE:** Get ALL raw data first, clean it to best V2 quality, then daily scrape builds upon this foundation.

**The Problem:**
- Session 82 migrated V1 matches to V2, but later discovered gaps
- V2 had MORE total records than V1, but V1 had data V2 was MISSING
- More records ≠ more complete. Always check for DISCREPANCIES.

**The Principle:**

```
ALL Historical Data → Clean via V2 Pipeline → Best Possible Foundation
                                                      ↓
                                            Daily Scrape Adds NEW Data
                                                      ↓
                                              Continuously Improving
```

**Key Rules:**

1. **Complete Extraction:** Before daily scrape can be trusted, ALL historical data must be extracted and cleaned
2. **Discrepancy Check:** Never assume "more records = complete". Compare V1 vs V2 for same dates/teams
3. **Fill Gaps First:** Identify and fill gaps BEFORE relying on daily incremental updates
4. **Foundation Quality:** The daily scrape BUILDS ON the foundation. Bad foundation = bad product.

**Example (Session 83):**
```
V1 rank_history: 966,809 records (9 dates)
V2 rank_history: 1,439,012 records (151 dates)

Initial assumption: V2 is superior (more records)
Reality: V1 has 49,729 entries MISSING from V2 for the same dates!
         3,180 teams have valid IDs but NO V2 rank history.

Lesson: Check discrepancies, not just volume.
```

**Files Created:**
- `scripts/audit/analyzeRankHistoryGap.cjs` - Discrepancy analysis tool
- `scripts/maintenance/migrateV1RankHistory.cjs` - Fill V1→V2 gaps

### 28. Premier-Only Data Policy (Session 84)

**SoccerView focuses exclusively on premier/competitive youth soccer.**

| Source | Level | Status |
|--------|-------|--------|
| GotSport | Premier (implicit) | Included |
| HTGSports | Premier (implicit) | Included |
| Heartland Premier | Premier | Included |
| Heartland Calendar | Premier filtered | Included (rec teams filtered) |
| Heartland Recreational | Recreational | **EXCLUDED** |

**Implementation:**
- Heartland adapter only scrapes Premier CGI results (v3.0)
- Calendar scraping filters out recreational teams by name pattern
- `intakeValidator.js` rejects any data matching recreational patterns
- Migration 080 removed all historical recreational data (648 matches)

**Why Premier-Only?**
- GotSport national rankings only cover premier teams
- Recreational teams lack competitive match data for meaningful ELO
- User value proposition is competitive team rankings
- Mixing levels dilutes rankings (rec teams appeared in top 10)

**Affected Teams:**
- 121 teams had ONLY recreational matches → now have 0 matches, won't appear in rankings
- 25 teams had BOTH premier and recreational → keep premier matches only
- All GotSport-ranked teams remain (even if no matches)

**Files Created/Modified:**
- `scripts/adapters/heartland.js` - Removed Recreational config
- `scripts/universal/intakeValidator.js` - Added `RECREATIONAL_LEVEL` rejection
- `scripts/migrations/080_remove_recreational_data.sql` - Cleanup migration
- `scripts/audit/verifyPremierOnly.cjs` - Verification script
- `docs/SESSION_84_PREMIER_ONLY_PLAN.md` - Full migration plan

**Anti-patterns:**
- ❌ Scraping recreational/community league data
- ❌ Including recreational teams in ELO calculations
- ❌ Mixing competition levels in rankings

### 29. Universal SoccerView ID Architecture (Session 85)

**ALL entities uniquely identified by SoccerView-controlled IDs, not source-specific keys.**

| Entity | Uniqueness Strategy | Uses SoccerView IDs? |
|--------|--------------------|--------------------|
| Teams | canonical_teams → team_v2_id | ✅ |
| Clubs | canonical_clubs → club_id | ✅ |
| Leagues | canonical_events → league_id | ✅ |
| Tournaments | canonical_events → tournament_id | ✅ |
| Schedules | (date, home_team_id, away_team_id) | ✅ |
| **Matches** | **(date, home_team_id, away_team_id)** | ✅ |

**Key Changes (Session 85):**
- `matches_v2` constraint changed from `source_match_key` to semantic uniqueness
- New constraint: `UNIQUE (match_date, home_team_id, away_team_id)`
- `source_match_key` remains for audit/tracing, NOT uniqueness
- Pipeline `ON CONFLICT` uses semantic key, not source-specific key

**Why This Matters:**
- Same match from different sources (V1 migration, GotSport, HTGSports) won't create duplicates
- Team Details page shows ONE entry per match, not duplicates
- Season Stats and ELO calculations are accurate (no inflated counts)

**Files Modified:**
- `scripts/migrations/085_add_semantic_match_constraint.sql` - Semantic constraint
- `scripts/universal/dataQualityEngine.js` - ON CONFLICT clause updated
- `scripts/universal/deduplication/matchDedup.js` - Semantic grouping
- `scripts/daily/verifyDataIntegrity.js` - Semantic duplicate check

**Anti-patterns:**
- ❌ Using `source_match_key` as primary uniqueness constraint
- ❌ ON CONFLICT clauses that don't use SoccerView Team IDs
- ❌ Creating matches without resolving to canonical team IDs first

### 30. Soft Delete for Matches - NEVER Hard Delete (Session 86)

**Match deduplication MUST use soft delete, not hard delete.**

Session 85 hard-deleted 9,160 matches as "duplicates". These were NOT duplicates - they were the same real-world match from different sources with different `source_match_key` values. Hard deletion caused ALL match history to disappear.

**Soft Delete Architecture:**

| Column | Type | Purpose |
|--------|------|---------|
| `deleted_at` | TIMESTAMPTZ | NULL = active, timestamp = soft-deleted |
| `deletion_reason` | TEXT | Why deleted (e.g., "Semantic duplicate of {id}") |

**In matchDedup.js:**
```javascript
// ❌ WRONG - Hard delete
DELETE FROM matches_v2 WHERE id = ANY($1);

// ✅ CORRECT - Soft delete
UPDATE matches_v2
SET deleted_at = NOW(),
    deletion_reason = 'Semantic duplicate of ' || $2
WHERE id = ANY($1);
```

**In queries:**
```sql
-- Always exclude soft-deleted in active queries
SELECT * FROM matches_v2 WHERE deleted_at IS NULL;
```

**Recovery:** All deleted data is preserved in `audit_log` AND in the table with `deleted_at` set. Recovery is always possible.

**Anti-patterns:**
- ❌ Using DELETE FROM matches_v2 in deduplication
- ❌ Forgetting `WHERE deleted_at IS NULL` in queries
- ❌ Assuming "duplicate" matches can be safely deleted

### 31. Reverse Match Detection - Same Game, Swapped Teams (Session 88)

**Problem:** The UNIQUE constraint `(match_date, home_team_id, away_team_id)` treats (date, A, B) and (date, B, A) as DIFFERENT tuples. Cross-source data records the same game with teams in different home/away positions, creating reverse duplicates.

**Impact:** Team Details page shows same match twice. Season Stats double-count W-L-D. ELO miscalculates.

**Detection:**
```sql
SELECT a.id, b.id FROM matches_v2 a
JOIN matches_v2 b ON a.match_date = b.match_date
  AND a.home_team_id = b.away_team_id
  AND a.away_team_id = b.home_team_id
  AND a.id < b.id
WHERE a.deleted_at IS NULL AND b.deleted_at IS NULL;
```

**Conservative Resolution (Session 88):**
- Only soft-delete score-consistent pairs (A's home_score = B's away_score AND vice versa)
- Skip different-score pairs (legitimate rematches on same date)
- Keep the record with event linkage, or earliest created

**Pipeline Prevention (Session 88):**
- `fastProcessStaging.cjs`: Within-batch reverse dedup + pre-insert DB check
- `dataQualityEngine.js`: Pre-insert reverse match check
- `matchDedup.js`: `detectReverseMatches()` + `resolveReverseMatches()` exports

**Scripts:**
- `scripts/maintenance/fixReverseMatches.cjs` - Retroactive reverse match cleanup
- `scripts/universal/deduplication/matchDedup.js` - Ongoing detection in pipeline

### 32. State Inference from Team Names (Session 88)

**Problem:** Teams had wrong state assignments (e.g., "Sporting Iowa" classified as KS). Caused by Session 76 GotSport rankings importer using unreliable `STATE_ASSOCIATION_MAP`.

**Fix Architecture:**
- **Retroactive:** `fixTeamStates.cjs` - Extracts US state names from display_name, corrects mismatches
- **Prevention:** `inferStateFromName()` in `teamNormalizer.js` - Infers state at team creation time

**Ambiguity Handling:**
- "Kansas City" → SKIP (ambiguous KS/MO)
- "Washington" → SKIP unless followed by "State"
- "West Virginia" before "Virginia" (longest match first)

**Pipeline Integration:**
- `fastProcessStaging.cjs`: Uses inferred state instead of hardcoded 'unknown'
- `dataQualityEngine.js`: Enhanced `inferStateFromRecord()` checks team names

### 33. deleted_at IS NULL - MANDATORY in ALL Match Queries (Session 88)

**Every query that reads `matches_v2` MUST include `deleted_at IS NULL`.**

| Layer | Component | Filter Required |
|-------|-----------|----------------|
| Layer 2 | Direct SQL queries | `AND deleted_at IS NULL` |
| Layer 2 | Supabase client queries | `.is("deleted_at", null)` |
| Layer 3 | Materialized views | `WHERE m.deleted_at IS NULL` in view SQL |
| App | Team Details match queries | `.is("deleted_at", null)` |
| Pipeline | ELO recalculation | `AND deleted_at IS NULL` |

**Session 88 added `deleted_at IS NULL` to:**
- `app/team/[id].tsx` - 4 Supabase queries (homeMatches, awayMatches, homeStats, awayStats)
- `scripts/daily/recalculate_elo_v2.js` - 2 SQL queries (count + fetch)
- Migration 088 - 3 materialized views (app_team_profile, app_matches_feed, app_league_standings)

### 34. Universal Source Entity Resolution - Three-Tier Deterministic (Session 89)

**Problem:** V1 migration created ~7,253 duplicate team records with NULL/incomplete metadata (birth_year=null, state='Unknown'). Same real-world team existed as two `teams_v2` records. Caused 1,412+ duplicate match pairs visible to users.

**Solution: `source_entity_map` table + Three-Tier Resolution**

```
Tier 1: source_entity_map lookup (deterministic, O(1), 100% accurate)
Tier 2: Canonical name + NULL-tolerant metadata match
Tier 3: Create new entity + register source ID for future Tier 1
```

**source_entity_map table:**
```sql
CREATE TABLE source_entity_map (
  entity_type TEXT NOT NULL,       -- 'team', 'league', 'tournament', etc.
  source_platform TEXT NOT NULL,   -- 'gotsport', 'htgsports', 'heartland'
  source_entity_id TEXT NOT NULL,  -- Source's own ID
  sv_id UUID NOT NULL,             -- SoccerView UUID
  UNIQUE (entity_type, source_platform, source_entity_id)
);
```

**Pipeline integration:**
- `dataQualityEngine.js`: `findOrCreateTeam()` and `findOrCreateEvent()` use Tier 1/2/3
- `fastProcessStaging.cjs`: Bulk source ID lookup before name-based resolution
- `coreScraper.js`: Emits `source_home_team_id` / `source_away_team_id` in raw_data

**Adapter requirement:** All adapters must include source entity IDs in `raw_data`.

**Retroactive fix:** 7,253 teams merged, 17 tournament groups merged, 3,253 source mappings backfilled.

**Anti-patterns:**
- Fuzzy matching without checking source_entity_map first
- Adapters that don't emit source team/event IDs
- Name-only team resolution (must check source IDs first)

### 35. Generic Event Name Prevention - 5-Layer Defense (Session 91)

**Problem:** 215 tournaments had generic names like "GotSport Event 12093" or "Event 39064". No pipeline layer rejected them.

**5-Layer Defense Architecture:**

| Layer | Component | What It Does |
|-------|-----------|-------------|
| 1 | `intakeValidator.js` | Rejects INVALID data (null dates, rec leagues) |
| 2 | `eventNormalizer.js` | Rejects GENERIC names → `canonical_name: null` |
| 3 | DQE `findOrCreateEvent()` | `null` canonical_name → skip (existing line 787) |
| 4 | Fast processors | Own `isGeneric()` / `resolveEventName()` guards |
| 5 | DB CHECK constraint | Blocks generic INSERTs (migration 091) |

**Key Design Decision:** Generic names are INCOMPLETE, not INVALID. They belong in the normalizer (Layer 2), not intakeValidator (Layer 1). Fixing the normalizer protects all DQE code paths automatically.

**`resolveEventName.cjs` Resolution Priority:**
1. Provided rawName (if non-generic)
2. `staging_games.event_name` (most recent non-generic for this event_id)
3. `canonical_events.canonical_name` (via source_entity_map)
4. GotSport web page embedded JSON (for gotsport/htgsports sources)
5. NULL (never return a generic name)

**`isGeneric()` patterns:**
- `/^(HTGSports |GotSport |Heartland )?Event \d+$/` — "GotSport Event 12093"
- `/^\d+$/` — Bare numbers like "39064"
- `/^(GotSport|HTGSports|Heartland)$/` — Bare platform names

**Anti-patterns:**
- Creating tournaments/leagues with generic names (blocked at DB level)
- Using raw event names without `isGeneric()` check
- Treating generic names as INVALID (wrong layer — they're INCOMPLETE)

### 36. Standings Data = Lightweight Absorption, Not Heavy Processing (Session 92 QC)

**Problem:** League standings page showed only 7 of 11 teams for U-11 Boys Division 1. 439 of 1,173 standings teams (37%) had NULL metadata, making them invisible in filtered views.

**Root Cause:** `processStandings.cjs` used the SAME heavy 3-tier entity resolution designed for messy match data, including pg_trgm fuzzy matching. This caused false positives and resolved teams to wrong records with NULL birth_year/gender.

**Solution: Dual-System Architecture — Two Pipelines, Two Resolvers**

| | System 1: Match Pipeline | System 2: Standings Absorption |
|-|--------------------------|-------------------------------|
| **Purpose** | Rankings, ELO, Teams, Matches | League Standings page ONLY |
| **Processor** | DQE / fastProcessStaging | processStandings.cjs |
| **Resolver** | Heavy 3-tier (source map → canonical → fuzzy) | Lightweight (source map + verify → exact → create) |
| **Fuzzy matching** | YES | NO (authoritative data) |
| **On failure** | Skip (importable later) | Create new team (safer) |

**Lightweight Resolver (processStandings.cjs):**
1. source_entity_map lookup + **METADATA VERIFICATION** (birth_year, gender)
2. Exact name + birth_year + gender match (prefer records WITH metadata)
3. Create new team with full metadata (trust the league — NO fuzzy matching)

**Metadata Enrichment:** When resolved team has NULL birth_year/gender, fill from authoritative standings data. Only fills NULLs — never overwrites existing data.

**Results:** NULL metadata: 439 → 17 (96% improvement). U-11 Boys Division 1: 7 → 11 teams.

**Anti-patterns:**
- Using pg_trgm fuzzy matching on authoritative standings data
- Resolving standings teams through the match pipeline's 3-tier system
- Allowing NULL-metadata resolution that makes teams invisible in filters

**Scale:** Designed for 200-400 league sources. Zero custom code per source.

### 37. CONCURRENTLY Requires Unique Index — No Exceptions (Session 92 QC Part 2)

**Problem:** `refresh_app_views()` SQL function used `REFRESH MATERIALIZED VIEW CONCURRENTLY` on `app_league_standings`, but the hybrid UNION ALL view (migration 094) has NO UNIQUE INDEX. CONCURRENTLY requires a unique index → the statement fails → PL/pgSQL rolls back the entire function → ALL 5 views stay stale → app shows "0 Matches" and timeouts.

**Fix:** Migration 095 — use non-concurrent refresh for `app_league_standings` only. All other views retain CONCURRENTLY (they have unique indexes).

**Prevention Rule:** When creating or redefining a materialized view:
1. Check if `refresh_app_views()` uses CONCURRENTLY for that view
2. If the view has no UNIQUE index → update the function to use non-concurrent
3. UNION ALL views typically cannot have unique indexes (row overlap risk)

**Related:** `refresh_views_manual.js` (line 49) already handled this correctly. The SQL function was the gap.

### 38. Single Source of Truth for Team Name Normalization (Session 93)

**Problem:** Three code paths create teams. Only one (DQE via `teamNormalizer.js`) removes duplicate prefixes. The normalizer itself only handled 1-2 word prefixes, missing 3+ word clubs like "Sporting Blue Valley".

**3-Gap Fix:**

| Gap | Component | Fix |
|-----|-----------|-----|
| Algorithm too narrow | `removeDuplicatePrefix()` only 1-2 words | N-word sliding window (1-5 words) |
| fastProcessStaging bypass | Creates teams with raw names | Imports shared `removeDuplicatePrefix` |
| processStandings bypass | Creates teams with raw names | Imports shared `removeDuplicatePrefix` |

**Architecture: One algorithm, one file, all paths unified.**

```
cleanTeamName.cjs  ← THE algorithm (N-word sliding window)
       │
       ├── teamNormalizer.js      imports it (ESM can import CJS)
       ├── fastProcessStaging.cjs requires it (CJS native)
       └── processStandings.cjs   requires it (CJS native)
```

**Why CJS:** `teamNormalizer.js` uses ESM (`export`). CJS files cannot `require()` ESM modules. Algorithm lives in CJS where all files can access it. Zero code duplication.

**Anti-patterns:**
- ❌ Duplicating the algorithm in multiple files
- ❌ Creating teams without calling `removeDuplicatePrefix` first
- ❌ Adding a new processor that doesn't import `cleanTeamName.cjs`
- ❌ Building team lookup keys from raw staging names before applying `removeDuplicatePrefix()` (Session 107 fix: latent bug caused 11,061 matches to fail silently when raw names had duplicate prefixes)

### 39. LEAST for Ranks, GREATEST for Points — Rank Preservation (Session 94)

**Problem:** 8 files used `COALESCE(a.rank, b.rank)` to merge rank values during team merges, dedup, or snapshot capture. COALESCE picks the first non-NULL value regardless of magnitude. For ranks where lower = better, this randomly overwrites a better rank (#4) with a worse one (#11).

**Universal Rule:**

| Value Type | Merge Function | Reason |
|------------|---------------|--------|
| Ranks (national, state) | `LEAST(a, b)` | Lower number = better rank |
| Points / ELO | `GREATEST(a, b)` | Higher number = better score |
| Timestamps | `COALESCE(a, b)` | Keep first non-NULL (order matters) |
| Text / IDs | `COALESCE(a, b)` | Keep first non-NULL |

**PostgreSQL behavior:** `LEAST(NULL, 4) = 4` and `GREATEST(NULL, 800) = 800` — NULLs are ignored, so these are safe replacements for COALESCE in rank/point contexts.

**Files Fixed (Session 94 Part 1):**
- `teamDedup.js` — team merge rank preservation
- `restoreGotSportRanks.cjs` — GotSport rank application
- `dataQualityEngine.js` — team creation/update ranks
- `fastProcessStaging.cjs` — bulk processing rank handling
- `processStandings.cjs` — standings team resolution
- `recalculate_elo_v2.js` — ELO recalculation rank writes
- `captureRankSnapshot.js` — daily rank snapshot capture
- `recalculateHistoricalRanks.cjs` — historical rank recalculation

**Anti-patterns:**
- ❌ Using `COALESCE` for rank values (picks first non-NULL, not best)
- ❌ Using `GREATEST` for ranks (picks worst rank)
- ❌ Using `LEAST` for points/ELO (picks worst score)

### 40. Event Classification — Leagues vs Tournaments (Session 95)

**Problem:** `fastProcessStaging.cjs` created ALL new events as tournaments, ignoring event names containing "League". NC leagues were misclassified as tournaments, blocking standings processing.

**Root Cause:** Fast processor bypassed `eventNormalizer.js` and had no classification logic for new events.

**Fix: 3-Layer Event Resolution in fastProcessStaging.cjs**

| Priority | Method | Example |
|----------|--------|---------|
| Tier 0 | `source_entity_map` lookup | Previously-seen events resolved instantly |
| Tier 1 | `tournaments` / `leagues` table lookup | Existing records matched |
| Tier 2 | **LEAGUE_KEYWORDS classification** | Name contains "league" → create as league |

**LEAGUE_KEYWORDS:** `['league', 'season', 'conference', 'division', 'premier']`

```javascript
const isLeague = LEAGUE_KEYWORDS.some(kw => lowerName.includes(kw));
if (isLeague) {
  // INSERT INTO leagues
} else {
  // INSERT INTO tournaments (default for tournaments/cups/classics)
}
```

**Dual source_entity_map Registration:**
When a source uses different IDs for matches vs standings (e.g., SINC Sports uses `'NCFL'` for matches but `'sincsports-ncfl-2025'` for standings), BOTH formats must be registered in `source_entity_map` pointing to the same league UUID.

**Anti-patterns:**
- ❌ Creating all new events as tournaments without checking the name
- ❌ Having only one source_entity_map entry when scrapers use different ID formats
- ❌ Bypassing eventNormalizer classification logic in bulk processors

### 41. Post-Expansion QC Protocol — Mandatory for Every New State (Session 96)

**Problem:** NC expansion (Session 95) shipped 4 fixable issues that would have affected users: 506 teams with `state='unknown'`, inconsistent division names, noise "- Group A" suffixes, 66 teams with diacritic double-prefix.

**Root Cause:** No formal QC checklist existed after onboarding a new state.

**Fix: Mandatory Post-Expansion QC Checklist** (see [3-DATA_SCRAPING_PLAYBOOK.md](docs/3-DATA_SCRAPING_PLAYBOOK.md))

After onboarding ANY new state or league, verify in Expo Go:
1. Home page match count displays correctly
2. New state appears in Rankings state filter, teams visible
3. Team names display correctly (no double-prefix, no encoding issues)
4. League standings show consistent division names, no noise suffixes
5. Team detail shows matches, correct state, ELO populated

**Universal Fixes Applied (Session 96):**

| Issue | Fix | Scope |
|-------|-----|-------|
| Teams get `state='unknown'` | `processStandings.cjs` inherits league state | All future leagues |
| Division naming inconsistent | Source-specific `mapTierToName()` in adapter | Per-adapter config |
| "- Group A" when only 1 group | Conditional group suffix (post-processing) | All standings scrapers |
| Diacritics break prefix dedup | `stripDiacritics()` via Unicode NFD in `cleanTeamName.cjs` | All team name paths |
| PostgREST timeout on view filters | App uses Layer 3 views with date-only filters | All app queries |

**Time budget:** Plan ~2 hours for QC + fixes per new state.

### 42. NEVER ACCEPT "BLOCKED" — Find the Back Door (Session 99)

**ABSOLUTE RULE: When a data source appears blocked, inaccessible, or difficult to scrape — FIND A WAY AROUND IT. No excuses. No deferring. No "we'll come back to it later."**

**Minimum 5 techniques before deferring ANY data source:**
1. Inspect Network tab for XHR/fetch API endpoints
2. Check page source for embedded JSON (`<script>`, `window.__INITIAL_STATE__`)
3. Try undocumented endpoints (`/api/`, `/json/`, `/data/`)
4. Use Puppeteer stealth (`puppeteer-extra-plugin-stealth`)
5. Check mobile endpoints and vary User-Agent strings
6. Look for embed/widget URLs with public access
7. Search WebSearch for API documentation by other developers
8. Check Wayback Machine for historical data
9. Search for alternative platforms hosting the same league data
10. PDF parsing, OCR, or other extraction methods

**"Between seasons" = TRY AGAIN LATER with specific retry date — NOT "skip permanently."**

**Before deferring:** Document every technique tried, explain why each failed, propose next steps, get USER APPROVAL.

**Anti-patterns (BANNED):**
- ❌ Accepting "blocked" without trying 5+ approaches
- ❌ Marking a state as "GS RANKS" when league data exists somewhere online
- ❌ Deferring without a specific retry plan and date
- ❌ Accepting empty scrape results without investigating why

See [docs/1.1-GUARDRAILS_v2.md](docs/1.1-GUARDRAILS_v2.md) Section 18 for full policy.

### 43. Season Awareness — ALWAYS Scrape the FULL Current Season (Session 99)

**The SoccerView season runs August 1 → July 31.** Every scraping task MUST ensure coverage of BOTH halves:

| Month | Season Phase | Scraping Action |
|-------|-------------|----------------|
| Aug-Nov | Fall (PEAK) | Scrape Fall events IMMEDIATELY |
| Dec-Jan | Winter break | Scrape winter leagues where active |
| Feb-Mar | Spring ramp-up | Discover Spring event IDs |
| Apr-Jun | Spring season | Scrape Spring events |
| Jul | Off-season | Plan next season |

**Critical Rules:**
1. NEVER look only at "current" or "upcoming" events — check Fall data too
2. "Between seasons" = look for the OTHER half, NOT "no data exists"
3. `year` field in staticEvents = season END year (2026), NOT calendar year
4. SportsAffinity uses DIFFERENT subdomains per season (e.g., `gs-fall25{orgcode}`)
5. GotSport uses SEPARATE event IDs for Fall vs Spring
6. 0 matches = investigate immediately — wrong season? wrong event ID?
7. Every new state MUST include BOTH Fall + Spring events

**Root Cause (Session 99):** Season was documented as a data property (ELO start date) but NOT as an operational requirement (must scrape both halves). An entire session was wasted configuring only Spring 2026 events while Fall 2025 was ignored.

See [docs/1.1-GUARDRAILS_v2.md](docs/1.1-GUARDRAILS_v2.md) Section 19 for full policy.

### 44. Session Checkpoint Discipline — Survive Rate Limits (Session 99)

**After every major task completion, update `.claude/hooks/session_checkpoint.md`.**

This file is:
- Read automatically on every session start/resume (via `session-start.sh`)
- Referenced after every context compaction (via `CRITICAL_RULES.md`)
- The ONLY reliable way to preserve progress across rate limits

**What to include:**
1. What was completed (with specific metrics/counts)
2. What's in progress (with current state)
3. Key findings that must not be lost (specific numbers, IDs, GUIDs)
4. Files modified this session

**Cost:** ~30 seconds per checkpoint write. **Value:** Prevents hours of repeated work.

---

## Quick Reference

### Database Status (V2 - Production)

| Table | Rows | Purpose |
|-------|------|---------|
| `teams_v2` | 177,565 | Team records (Session 107: +106 from staging recovery) |
| `matches_v2` | 520,376 active | Match results (~5,420 soft-deleted) |
| `clubs` | 124,650 | Club organizations |
| `leagues` | 462 | League metadata (Session 106: +26 — GA 4, USYS NL 21, misc 1) |
| `tournaments` | 1,798 | Tournament metadata (Session 106: +11 incl. USYS NL Winter) |
| `league_standings` | 2,012 | Scraped standings: Heartland (1,207) + NC SINC Sports (805) |
| `staging_standings` | 2,195 | Raw standings staging (Session 92+95) |
| `source_entity_map` | ~75,139+ | Universal source ID mappings |
| `canonical_events` | 1,795 | Canonical event registry (Session 62) |
| `canonical_teams` | 138,252 | Canonical team registry (Session 76: +118,977) |
| `canonical_clubs` | 7,301 | Canonical club registry (Session 62) |
| `learned_patterns` | 0+ | Adaptive learning patterns (Session 64) |
| `staging_games` | 253,198 | Staging area (0 unprocessed — Session 107 cleared all 11,061) |
| `staging_rejected` | 1 | Rejected intake data (Session 79) |
| `seasons` | 3 | Season definitions |

### Materialized Views (App Queries)

| View | Purpose |
|------|---------|
| `app_rankings` | Rankings & Teams tabs |
| `app_matches_feed` | Matches tab |
| `app_league_standings` | League standings (hybrid: scraped UNION computed — Session 92) |
| `app_team_profile` | Team detail |
| `app_upcoming_schedule` | Future games |

### Data Sources

| Source | Status | Output |
|--------|--------|--------|
| GotSport | ✅ Production | staging_games |
| HTGSports | ✅ Production | staging_games |
| Heartland CGI | ✅ Production | staging_games |
| SINC Sports | ✅ Production (Session 95) | staging_games + staging_standings |
| MLS Next | ✅ Production (Session 97) | staging_games (Puppeteer, Modular11) |
| SportsAffinity | ✅ Production (Session 97+105) | staging_games (Cheerio, GA/MN/UT/OR/NE/PA-W/IA/HI — 72 events) |
| TotalGlobalSports | ✅ Production (Session 100: 76 events, 33,567 matches) | staging_games (ECNL, Puppeteer+stealth) |
| PlayMetrics | ✅ Production (Session 102-104: CO CAL + SDL + WI WYSA/MAYSA/EC/CWSL, 16,602 matches) | staging_games (Puppeteer, Vue SPA) |
| Demosphere | ✅ Production (Session 103: NCSL VA/DC, 10,882 matches) | staging_games (Cheerio, JSON/XML endpoints) |
| Squadi | ✅ Production (Session 104: AR ACSL/NWAL/CAL, 1,637 matches) | staging_games (REST API, no browser needed) |

### source_match_key (CRITICAL - Session 57)

The authoritative unique identifier for matches in `matches_v2`.

| Aspect | Value |
|--------|-------|
| Constraint | `UNIQUE` (enforced) |
| Used for | Upsert conflict resolution |
| Coverage | 100% (no NULLs allowed) |

**Format by source:**
| Source | Format | Example |
|--------|--------|---------|
| GotSport | `gotsport-{eventId}-{matchNum}` | `gotsport-39064-91` |
| HTGSports | `htg-{eventId}-{matchId}` | `htg-12345-678` |
| Heartland | `heartland-{level}-{homeId}-{awayId}-{date}-{gameNum}` | `heartland-premier-abc123-def456-2025-03-15-1` |
| SINC Sports | `sincsports-{eventId}-{matchId}` | `sincsports-ncfl-12345` |
| MLS Next | `mlsnext-{matchId}` | `mlsnext-U13-2025-09-01-123` |
| SportsAffinity | `sportsaffinity-{matchId}` | `sportsaffinity-240621` |
| Legacy | `legacy-{eventId8}-{homeId8}-{awayId8}-{date}` | `legacy-b2c9a5aa-0bc3985a-3406f39e-2025-06-29` |

**Dropped Constraints:**
- `unique_match` - Was on `(match_date, home_team_id, away_team_id, home_score, away_score)`. Caused conflicts with source_match_key upserts. Removed in Session 57.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Mobile App | React Native + Expo (TypeScript) |
| Backend | Supabase (PostgreSQL) |
| Data Pipeline | Node.js + Puppeteer |
| Automation | GitHub Actions |
| Build | EAS Build |

### Environment Variables

```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_ANON_KEY
DATABASE_URL
```

### Preferred Libraries

| Category | Library |
|----------|---------|
| Charts (standard) | `react-native-gifted-charts` |
| Charts (inverted) | Custom SVG |
| Animations | `react-native-reanimated` |
| Gestures | `react-native-gesture-handler` |
| Navigation | `expo-router` |
| Icons | `@expo/vector-icons` |
| Haptics | `expo-haptics` |

### Project Tools & Integrations (Session 80)

**External Services:**

| Service | Purpose | Access |
|---------|---------|--------|
| **Supabase** | PostgreSQL database + Auth + Storage | [Dashboard](https://supabase.com/dashboard) - Project: soccerview |
| **GitHub** | Version control + CI/CD | [Repo](https://github.com/MGMAppDev/soccerview) - Branch: main |
| **GitHub Actions** | Daily data sync pipeline | Workflow: `daily-data-sync.yml` |
| **GitHub CLI** | Direct repo access from terminal | `gh` command - configured |
| **Sentry** | Error tracking + performance monitoring | @sentry/react-native in app |
| **EAS Build** | iOS/Android app builds | `eas build --platform [ios|android]` |
| **Expo Go** | Development testing on device | `npx expo start` |

**Development Tools:**

| Tool | Purpose | Notes |
|------|---------|-------|
| **VS Code** | Primary IDE | Extensions for TypeScript, React Native |
| **Claude Code** | AI development assistant | This assistant - follows CLAUDE.md |
| **TypeScript** | Type checking | v5.9.2 |
| **ESLint** | Code linting | expo-config-expo |

**Data Pipeline Tools:**

| Tool | Package | Purpose |
|------|---------|---------|
| **Puppeteer** | `puppeteer` | Browser automation for SPA scraping (GotSport, HTGSports) |
| **Cheerio** | `cheerio` | HTML parsing for server-rendered pages (Heartland CGI) |
| **pg Pool** | `pg` | Direct PostgreSQL for bulk operations |
| **Supabase JS** | `@supabase/supabase-js` | Simple CRUD queries from app |
| **dotenv** | `dotenv` | Environment variable management |
| **p-limit** | `p-limit` | Concurrency control for parallel operations |

**Monitoring Commands:**

```bash
# Check GitHub Actions workflow status
gh run list --repo MGMAppDev/soccerview --limit 5
gh run view <run-id> --repo MGMAppDev/soccerview

# Check Supabase database directly
psql $DATABASE_URL -c "SELECT COUNT(*) FROM teams_v2;"

# Start development server
npx expo start

# Build for production
eas build --platform ios
eas build --platform android
```

---

## App Structure

### Tab Navigation

| Tab | File | Purpose |
|-----|------|---------|
| Home | `app/(tabs)/index.tsx` | Stats, Latest Matches, Top Teams |
| Rankings | `app/(tabs)/rankings.tsx` | Official/SoccerView rankings |
| Teams | `app/(tabs)/teams.tsx` | Search & browse teams |
| Leagues | `app/(tabs)/leagues.tsx` | Search leagues, standings by age/division/gender |
| Matches | `app/(tabs)/matches.tsx` | Recent matches |

### Key Components

| Component | File |
|-----------|------|
| MatchCard | `components/MatchCard.tsx` |
| RankChart | `app/team/[id].tsx` |

---

## ELO Methodology

### Season Alignment

| Aspect | Value |
|--------|-------|
| Season Start | August 1 |
| Season End | July 31 |
| K-Factor | 32 |
| Starting ELO | 1500 |

**Why current season only?** GotSport resets annually. Using all-time would make comparisons meaningless.

### Grade Scale

| Grade | ELO Range |
|-------|-----------|
| A+ | 1650+ |
| A/A- | 1550-1649 |
| B+/B/B- | 1475-1549 |
| C+/C/C- | 1400-1474 |
| D+/D/D- | < 1400 |

---

## Key Scripts

### Daily Pipeline (`scripts/daily/`)

| Script | Purpose |
|--------|---------|
| `syncActiveEvents.js` | GotSport data collection |
| `verifyDataIntegrity.js` | **NEW (Session 79)** Post-processing checks |
| `recalculate_elo_v2.js` | ELO calculation (Session 95: division-seeded starting ELO) |
| `divisionSeedElo.cjs` | **NEW (Session 95)** Division seed mapping for ELO |
| `scorePredictions.js` | Score user predictions |
| `captureRankSnapshot.js` | Daily rank history |

**Archived (Session 79):** `validationPipeline.js` - replaced by dataQualityEngine.js

### Scrapers (`scripts/scrapers/`)

| Script | Source |
|--------|--------|
| `scrapeHTGSports.js` | HTGSports tournaments |
| `scrapeHeartlandLeague.js` | Heartland calendar |
| `scrapeHeartlandResults.js` | Heartland CGI (scores) |

### Universal Scraper Framework (`scripts/universal/` + `scripts/adapters/`)

**Session 57-63** - Source-agnostic scraping engine with universal discovery and adaptive learning.

| Script | Purpose |
|--------|---------|
| `scripts/universal/coreScraper.js` | Core engine + `discoverEventsFromDatabase()` |
| `scripts/universal/scrapeStandings.js` | **NEW** Universal standings scraper engine (Session 92) |
| `scripts/universal/adaptiveLearning.js` | **NEW** Adaptive learning engine (Session 63) |
| `scripts/adapters/gotsport.js` | GotSport adapter config |
| `scripts/adapters/htgsports.js` | HTGSports adapter (Puppeteer for SPA) |
| `scripts/adapters/heartland.js` | Heartland adapter (Cheerio for CGI + standings) |
| `scripts/adapters/sincsports.js` | SINC Sports adapter (Puppeteer + standings, Session 95) |
| `scripts/adapters/mlsnext.js` | **NEW (Session 97)** MLS Next adapter (Puppeteer, Modular11) |
| `scripts/adapters/sportsaffinity.js` | **NEW (Session 97+105)** SportsAffinity adapter (Cheerio, GA/MN/UT/OR/NE/PA-W/IA/HI) |
| `scripts/adapters/playmetrics.js` | **NEW (Session 102)** PlayMetrics adapter (Puppeteer, CO CAL + SDL + WI WYSA) |
| `scripts/adapters/demosphere.js` | **NEW (Session 103)** Demosphere/OttoSport adapter (Cheerio, NCSL VA/DC) |
| `scripts/adapters/squadi.js` | **NEW (Session 104)** Squadi adapter (REST API, AR ACSL/NWAL/CAL) |
| `scripts/adapters/risuperliga.js` | **NEW (Session 105)** RI Super Liga skeleton (Puppeteer, retry March 28, 2026) |
| `scripts/adapters/_template.js` | Template for creating new adapters |

**Usage:**
```bash
# Scrape all active events (uses universal discovery)
node scripts/universal/coreScraper.js --adapter gotsport --active

# Scrape specific event
node scripts/universal/coreScraper.js --adapter htgsports --event 12345

# Scrape league standings (Session 92)
node scripts/universal/scrapeStandings.js --adapter heartland
node scripts/maintenance/processStandings.cjs --verbose

# Learn patterns from existing data
node scripts/universal/adaptiveLearning.js --learn-teams --source htgsports

# Classify a new event
node scripts/universal/adaptiveLearning.js --classify "KC Spring Classic 2026"
```

### Universal Data Quality System (`scripts/universal/`)

**Sessions 60-79** - Complete data quality pipeline with intake validation, core engine, and normalizers.

**Core Components:**
| Script | Purpose |
|--------|---------|
| `intakeValidator.js` | **NEW (Session 79)** Pre-staging validation gate |
| `dataQualityEngine.js` | **THE orchestrator** - Normalize → Resolve → Deduplicate → Promote |
| `resolveEventName.cjs` | **NEW (Session 91)** Centralized event name resolver — NULL instead of generic |
| `testDataQualityEngine.js` | Integration test for full pipeline |

**Usage:**
```bash
# Intake validation (run BEFORE dataQualityEngine)
node scripts/universal/intakeValidator.js --report
node scripts/universal/intakeValidator.js --clean-staging

# Main processing (THE ONLY path from staging to production)
node scripts/universal/dataQualityEngine.js --process-staging
node scripts/universal/dataQualityEngine.js --process-staging --dry-run --limit 1000
node scripts/universal/dataQualityEngine.js --audit-report --days 30
```

**Normalizers (`scripts/universal/normalizers/`):**
Performance: 4.6ms per 1000 records.

| Script | Purpose | Tests |
|--------|---------|-------|
| `teamNormalizer.js` | Standardize team names, extract birth_year/gender/state | 6/6 |
| `eventNormalizer.js` | Standardize event names, reject generics, detect league/tournament | 6/6 |
| `matchNormalizer.js` | Parse dates/scores, generate source_match_key | 7/7 |
| `clubNormalizer.js` | Extract club name from team name | 7/7 |
| `cleanTeamName.cjs` | **Single source of truth** — N-word duplicate prefix removal (Session 93) | - |
| `testWithStagingData.js` | Integration test with real staging data | - |

**Canonical Registry Functions (DB):**
| Function | Purpose |
|----------|---------|
| `resolve_canonical_event()` | Fuzzy match event to canonical name |
| `resolve_canonical_team()` | Match team to canonical with birth_year/gender |
| `resolve_canonical_club()` | Match club to canonical |

### Database Migrations (`scripts/migrations/`)

| Script | Purpose |
|--------|---------|
| `run_phase1_functions.js` | Create canonical registry tables + resolve functions |
| `backfillSourceMatchKey.js` | Backfilled 286,253 NULL source_match_key values |
| `deduplicateMatchKeys.js` | Removed 3,562 duplicate source_match_key records |
| `applyConstraint.js` | Added UNIQUE constraint on source_match_key |
| `091_block_generic_event_names.sql` | **NEW (Session 91)** CHECK constraints blocking generic tournament/league names |
| `094_league_standings_passthrough.sql` | **NEW (Session 92)** staging_standings + league_standings + hybrid view |

### Maintenance (`scripts/maintenance/`)

Diagnostics, audits, and utilities.

| Script | Purpose |
|--------|---------|
| `ensureViewIndexes.js` | **NIGHTLY** Universal index maintenance for all views (Session 69) |
| `recalculateHistoricalRanks.cjs` | Recalculate rank_history with consistent baseline (Session 70) |
| `processStandings.cjs` | **NEW** Universal standings processor: staging → production (Session 92) |
| `fastProcessStaging.cjs` | **Universal bulk staging processor** - 7,200 matches/30s (Session 87.2) |
| `fixReverseMatches.cjs` | **Retroactive reverse match dedup** (Session 88) |
| `fixTeamStates.cjs` | **Retroactive state correction** from team names (Session 88) |
| `recoverSession85Matches.cjs` | Recover matches from audit_log (Session 86) |
| `recoverDeletedMatches.cjs` | General match recovery tool (Session 86) |
| `bulkMergeDuplicateTeams.cjs` | Universal bulk team deduplication (Session 86) |
| `completeBirthYearCleanup.js` | Merge duplicates, fix birth_year mismatches |
| `linkUnlinkedMatches.js` | Link matches via exact source_match_key |
| `linkByEventPattern.js` | Link HTGSports/Heartland by event ID pattern |
| `linkFromV1Archive.js` | Link legacy gotsport via V1 archived data (67% success) |
| `inferEventLinkage.js` | **NIGHTLY** Infer event from team activity patterns |
| `fixGenericEventNames.cjs` | **Retroactive generic tournament name fix** (Session 91) |
| `fixDoublePrefix.cjs` | **Retroactive double-prefix team name fix** (Session 93) |
| `mergeDuplicateRankedTeams.cjs` | Universal merge of duplicate ranked teams (Session 93) |
| `restoreGotSportRanks.cjs` | **NIGHTLY (Session 94)** GotSport rankings refresh — LEAST/GREATEST rank preservation |
| `cleanupGarbageMatches.js` | Delete future-dated matches (2027+) |
| `mergeHeartlandLeagues.js` | Merge duplicate league entries (Session 59) |

### Onetime Scripts (`scripts/onetime/`)

Rarely-run scripts for bootstrapping or one-time data operations.

| Script | Purpose |
|--------|---------|
| `backfillEloHistory.js` | Replay ELO from matches → populate rank_history_v2 (Session 65) |
| `backfillRankHistory.js` | Calculate historical rank positions from ELO data (Session 68) |
| `seedCanonicalRegistries.js` | Bulk SQL bootstrap of canonical registries (Session 62) |
| `populateClubs.js` | Create clubs from team names (Session 60) |
| `rebuildLeagues.js` | Normalize league metadata (Session 60) |

### Archived

See `scripts/_archive/` for deprecated V1 scripts.

---

## Operating Rules for Claude

### Core Principles

1. **Claude operates as SME** - Find info independently
2. **GOLD STANDARD ONLY** - Use world-class solutions
3. **Best-in-class libraries** - Never settle for "good enough"
4. **Deep research before claims** - Verify with code/database
5. **Complete file replacements** - Full files, not partial snippets

### Tool Usage

- **Web research:** Use `WebSearch` or `WebFetch` tools
- **Database queries:** Use node scripts with `pg` Pool (direct SQL via `DATABASE_URL`)
- **Database reads:** Use Supabase JS client for simple queries
- **File operations:** Use Read, Edit, Write, Glob, Grep tools

**Direct Database Access Pattern:**
```javascript
// For direct SQL (bulk operations, DDL, complex queries)
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const { rows } = await pool.query('SELECT * FROM teams_v2 LIMIT 10');

// For simple CRUD (app-style queries)
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data } = await supabase.from('teams_v2').select('*').limit(10);
```

**Available Environment Variables (.env):**
- `DATABASE_URL` - PostgreSQL connection string (for pg Pool)
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Admin access key

### Code Management

- Review existing code before rewriting
- Include verification for schema changes
- Maintain separation between dev and production

---

## Development Commands

```bash
# Start development
npx expo start

# Run data quality engine
node scripts/universal/dataQualityEngine.js --process-staging

# Fast bulk staging processor (240x faster than DQE for bulk)
node scripts/maintenance/fastProcessStaging.cjs --source gotsport
node scripts/maintenance/fastProcessStaging.cjs --source htgsports

# Run data quality engine (dry run)
node scripts/universal/dataQualityEngine.js --process-staging --dry-run --limit 1000

# Run deduplication reports
node scripts/universal/deduplication/matchDedup.js --report
node scripts/universal/deduplication/teamDedup.js --report
node scripts/universal/deduplication/eventDedup.js --report

# Recalculate ELO
node scripts/daily/recalculate_elo_v2.js

# Refresh views only
psql $DATABASE_URL -c "SELECT refresh_app_views();"

# Build for production
eas build --platform ios
eas build --platform android
```

### Season Rollover (Each August)

```sql
-- Step 1: Insert new season (run once)
INSERT INTO seasons (name, start_date, end_date, year, is_current)
VALUES ('2026-27 Season', '2026-08-01', '2027-07-31', 2027, false)
ON CONFLICT (start_date, end_date) DO NOTHING;

-- Step 2: Switch to new season (ONE COMMAND)
UPDATE seasons SET is_current = (year = 2027);

-- Step 3: Refresh all views
SELECT refresh_app_views();
```

Then run ELO recalculation: `node scripts/daily/recalculate_elo_v2.js`

---

## Current Session Status

### Session 107 - Universal Team Key Normalization Fix (February 17, 2026) - COMPLETE ✅

**Goal:** Fix systemic bug in `fastProcessStaging.cjs` where team lookup keys were built from raw staging names instead of cleaned names, causing silent match insertion failures when raw names contained duplicate club prefixes.

**Root Cause:** Lines 104-105 of `fastProcessStaging.cjs` used `makeTeamKey(row.home_team_name, ...)` (RAW name) while `teamMap` was populated with cleaned keys from DB `display_name`. When `removeDuplicatePrefix()` changed a raw name (e.g., "Suffolk FC Suffolk FC Raptors" → "Suffolk FC Raptors"), the raw key ≠ clean key → match insertion failed silently. Bug latent since Session 87.2 — only fired when raw name had duplicate prefix AND team was new.

**Fix:** 2-line change wrapping `removeDuplicatePrefix()` around raw names at key-building time. Aligns with established correct pattern in `processStandings.cjs`.

**Recovery Results:**

| Source | Records | Inserted | Failed |
|--------|---------|----------|--------|
| demosphere | 10,842 | 10,842 | **0** |
| gotsport | 207 | 207 | **0** |
| sincsports | 12 | 12 | **0** |
| **Total** | **11,061** | **11,061** | **0** |

**Key Metrics:**

| Metric | Session 106 | Session 107 | Delta |
|--------|-------------|-------------|-------|
| matches_v2 (active) | 511,282 | **520,376** | **+9,094** |
| teams_v2 | 177,459 | **177,565** | **+106** |
| unprocessed staging | 11,061 | **0** | **-11,061** |
| ELO matches processed | 231,728 | **235,488** | **+3,760** |
| ELO teams updated | 72,946 | **73,923** | **+977** |

**Spot-Check Verified:** Suffolk FC (VA) and Baystars FC (VA) — previously UNRESOLVED — now have matches and ELO ratings.

**Documentation Updates:** CLAUDE.md Principle 38 anti-pattern added, SESSION_89 "clean before key" rule added.

**Files Modified:** `scripts/maintenance/fastProcessStaging.cjs` (2 lines), `CLAUDE.md` (v23.7), `docs/SESSION_89_UNIVERSAL_ENTITY_RESOLUTION.md`, `.claude/hooks/session_checkpoint.md`
**Zero UI changes. Zero adapter changes. Pure data quality fix within universal V2 pipeline.**

---

### Session 106 - Girls Academy + USYS NL + NPL TCSL TX (February 17, 2026) - COMPLETE ✅

**Goal:** Scrape Girls Academy (GotSport), discover + scrape all USYS NL conference events (21 new), add TCSL NPL TX via TGS (event 3989). Reclassify all from tournament → league.

**Phase 1: Girls Academy**
- Scraped all 4 GA GotSport events: 42137 (GA Tier 1), 42138 (GA Aspire), 44874 (JGAL), 45530 (FL GA)
- 36 new staged (26 Aspire + 10 JGAL), rest already in DB as tournaments
- Reclassified all 4 GA events from tournament → league
- **GA Total: 528 league matches** (83 Tier 1 + 379 Aspire + 50 JGAL + 16 FL GA)

**Phase 2: USYS National League (21 new conferences)**
- Discovered 21 new GotSport event IDs across NL Team Premier (8), Club P1 (7), Club P2 (4), Winter (2)
- Scraped all conferences + processed via fastProcessStaging
- Reclassified all Team Premier + Club P1 + P2 from tournament → league
- Also reclassified existing: SA 15U-19U (44340), SA 13U-14U (50581), Sunshine P1 (43114), Sunshine P2 (43943)
- **USYS NL Total: ~1,151 league matches** (up from 30)
- Winter Events (50935, 50898) kept as tournaments (single-weekend showcases)

**Phase 3: NPL TCSL Texas (TGS event 3989)**
- Added event 3989 to `scripts/adapters/totalglobalsports.js` staticEvents
- **947 matches inserted** (10 age groups: B2008-B2013, G2009-G2013)
- STXCL NPL (AthleteOne platform) deferred to Session 110+

**Key Metrics:**

| Metric | Before Session 106 | After Session 106 |
|--------|-------------------|-------------------|
| matches_v2 (active) | 508,119 | **511,282** (+3,163) |
| teams_v2 | 174,768 | **177,459** (+2,691) |
| leagues | 436 | **462** (+26) |
| tournaments | 1,787 | **1,798** (+11) |
| GA league matches | 0 (tournaments) | **528** |
| USYS NL league matches | 30 | **~1,151** |
| TCSL NPL TX matches | 0 | **947** |

**Files Created:** `scripts/_debug/add_session106_gotsport_events.cjs`, `scripts/_debug/scrape_session106_gotsport.cjs`, `scripts/_debug/check_ga_db.cjs`, `scripts/_debug/check_usysnl_events.cjs`, `scripts/_debug/reclassify_ga_as_leagues.cjs`, `scripts/_debug/reclassify_usysnl_as_leagues.cjs`
**Files Modified:** `scripts/adapters/totalglobalsports.js` (+TCSL NPL TX event 3989), `docs/3-STATE_COVERAGE_CHECKLIST.md` (v5.5), `.claude/hooks/session_checkpoint.md`, `CLAUDE.md` (v23.6)
**Zero UI changes. All data flows through universal V2 pipeline.**

---

### Session 105 - HI Oahu League + RI Super Liga (February 17, 2026) - COMPLETE ✅

**Goal:** Build final 2 custom adapters: RI Super Liga (Cheerio/PHP) and HI Oahu League (Puppeteer/AngularJS).

**Key Discovery:** HI Oahu League uses SportsAffinity — same platform as 7 other states. No new adapter needed, just 4 config entries added to existing SA adapter. This eliminated the need for a custom HI adapter entirely.

**HI Results:**
- All 4 seasons scraped: Fall 2025/26 (1,069) + Spring 2025/26 (736) + Fall 2024/25 (963) + Spring 2024/25 (821)
- 3,589 matches inserted, 497 new teams, 4 new HI leagues
- Boys only (B07-B19), no Girls flights on Oahu League
- SportsAffinity subdomains: `ol-fall-25-26`, `ol-spring-25-26`, `ol-fallcomp24-25`, `ol-springcomp24-25`

**RI Results:**
- Site purges data between seasons — Fall 2025 data permanently lost
- Tried 5+ approaches per Principle 42 (Puppeteer, brute-force POST, Wayback Machine)
- Wayback found Sep/Oct 2025 snapshots with dropdown values but POST response data was never archived
- Built adapter skeleton at `scripts/adapters/risuperliga.js` for March 28, 2026 retry
- Updated GUARDRAILS Section 19 with DATA RETENTION WARNING for data-purging platforms
- Full adapter audit: ALL 10 existing adapters have Fall 2025 properly configured

**Key Metrics:**

| Metric | Before Session 105 | After Session 105 |
|--------|-------------------|-------------------|
| matches_v2 (active) | 504,530 | **508,119** (+3,589) |
| teams_v2 | 174,271 | **174,768** (+497) |
| leagues | 432 | **436** (+4) |
| SA adapter events | 68 | **72** (+4 HI) |
| HI league matches | 0 | **3,589** |
| HI teams | 0 | **761** |

**Files Created:** `scripts/adapters/risuperliga.js` (skeleton), `scripts/_debug/probe_hi_*.cjs` (4 probes), `scripts/_debug/probe_ri_*.cjs` (4 probes), `scripts/_debug/fix_hi_source_map.cjs`
**Files Modified:** `scripts/adapters/sportsaffinity.js` (+4 HI events), `docs/1.1-GUARDRAILS_v2.md` (DATA RETENTION WARNING), `docs/3-STATE_COVERAGE_CHECKLIST.md` (v5.4), `.claude/hooks/session_checkpoint.md`, `CLAUDE.md` (v23.5)
**Zero UI changes. All data flows through universal V2 pipeline.**

---

### Session 104 - IL/VA/WI Gap Fill + Squadi AR Adapter (February 17, 2026) - COMPLETE ✅

**Goal:** Scrape 17 discovered premier league event IDs (IL/VA/WI) from Session 103 research. Build 10th adapter for Arkansas (Squadi platform).

**Key Results:**
- All 17 discovered gaps from Session 103 SCRAPED and PROCESSED
- New Squadi adapter built — pure REST API, no browser, 68-second scrape
- Event classification fix: fastProcessStaging now checks staging_events.event_type before LEAGUE_KEYWORDS
- MAYSA (Madison Area Youth Soccer): 175 divisions, 5,064 matches — largest WI regional league

**Scraping Results:**

| Source | Events | Matches Staged | Matches Inserted | New Teams |
|--------|--------|---------------|-----------------|-----------|
| GotSport IL (5 events) | NISL NPL/Club, SLYSA | 488 | ~488 | — |
| GotSport VA (3 events) | VCSL, VPSL, TASL | 238 | ~137 | — |
| PlayMetrics WI (9 events) | WYSA/MAYSA/EC/CWSL | 7,095 | 7,092 | 2,599 |
| Squadi AR (6 events) | ACSL/NWAL/CAL/State Champs | 1,639 | 1,637 | 693 |
| **Total** | **23** | **9,460** | **9,354** | **~4,630** |

**Key Metrics:**

| Metric | Before Session 104 | After Session 104 |
|--------|-------------------|-------------------|
| matches_v2 (active) | 495,178 | **504,530** (+9,352) |
| teams_v2 | 169,641 | **174,271** (+4,630) |
| leagues | 414 | **432** (+18) |
| tournaments | 1,780 | **1,787** (+7) |
| Adapters built | 9 | **10** (added Squadi) |
| Pipeline sync jobs | 9 | **10** (added sync-squadi) |
| AR league matches | 0 | **1,637** |
| WI league matches | 4,516 | **~11,600** (+~7,092) |

**Files Created:** `scripts/adapters/squadi.js` (10th adapter), `scripts/_debug/add_session104_gotsport_events.cjs`, `scripts/_debug/scrape_session104_gotsport.cjs`, `scripts/_debug/probe_squadi_api.cjs`, `scripts/_debug/reclassify_squadi_leagues.cjs`, various WI debug scripts
**Files Modified:** `scripts/adapters/playmetrics.js` (+9 WI events), `scripts/universal/intakeValidator.js` (+squadi), `scripts/maintenance/fastProcessStaging.cjs` (event type classification fix), `.github/workflows/daily-data-sync.yml` (+sync-squadi), `.claude/hooks/session_checkpoint.md`, `CLAUDE.md` (v23.4)
**Zero UI changes. All data flows through universal V2 pipeline.**

---

### Session 103 - Wave 5 Demosphere Adapter + WI PlayMetrics (February 16-17, 2026) - COMPLETE ✅

**Goal:** Build Demosphere adapter for VA/DC (NCSL), expand WI via PlayMetrics, verify IL coverage. Complete Wave 5.

**Key Findings:**
- IL State Premiership uses GotSport (not Demosphere) — already has 7 leagues, 12,123 matches
- WI WYSA migrated from Demosphere to PlayMetrics (org 1014) — added to existing PlayMetrics adapter
- Demosphere JSON API: `elements.demosphere-secure.com/{orgId}/schedules/{seasonName}/{divisionId}.js`
- Demosphere standings XML provides team name → ID mappings (1,106 unique teams resolved)

**Bug Fixes (4 issues encountered and fixed):**

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| Team name regex matched 0 teams | XML has `code` attribute between `key` and `name` | Changed regex to `/<team\s+key="(\d+)"[^>]*?\s+name="([^"]+)"/g` |
| Batch UPDATE SQL failed | UUIDs contain hex (e.g., `6e4d`) treated as numeric | Replaced CASE SQL with individual parameterized queries |
| WI scrape truncated at 35/72 divisions | `\| head -100` pipe in bash command | Re-ran without pipe |
| Write protection blocked reclassification | Direct writes to matches_v2 blocked by trigger | Added `SELECT authorize_pipeline_write()` before updates |

**Scraping Results:**

| Source | Event | Matches Found | Matches Staged | Teams |
|--------|-------|--------------|----------------|-------|
| Demosphere | NCSL Fall 2025 (286 divs) | 14,750 | 5,516 | 2,932 new |
| Demosphere | NCSL Spring 2025 (322 divs) | 17,539 | 5,326 | (shared) |
| PlayMetrics | WYSA Fall 2025 (72 divs) | 2,169 | 2,164 | 2,110 new |
| PlayMetrics | WYSA Spring 2025 (72 divs) | 2,230 | 2,230 | (shared) |
| **Total** | | **36,688** | **15,236** | **5,042 new** |

**Key Metrics:**

| Metric | Before Session 103 | After Session 103 |
|--------|-------------------|-------------------|
| matches_v2 (active) | 479,910 | **495,178** (+15,268) |
| teams_v2 | 164,599 | **169,641** (+5,042) |
| leagues | 410 | **414** (+4) |
| tournaments | 1,777 | **1,780** (+3) |
| source_entity_map | ~74,874 | **75,139** (+265) |
| Adapters built | 8 | **9** (added Demosphere) |
| Pipeline sync jobs | 8 | **9** (added sync-demosphere) |
| VA league matches | ~125 | **11,000** |
| WI league matches | ~123 | **4,516** |

**Files Modified:** `scripts/adapters/demosphere.js` (v2.0), `scripts/adapters/playmetrics.js` (+WI WYSA events), `scripts/universal/intakeValidator.js` (+demosphere), `.github/workflows/daily-data-sync.yml` (+sync-demosphere job, updated PlayMetrics name), `.claude/hooks/session_checkpoint.md`, `docs/3-STATE_COVERAGE_CHECKLIST.md` (v5.1), `CLAUDE.md` (v23.3)
**Files Created:** `scripts/_debug/scrape_ncsl_all.cjs`, `scripts/_debug/discover_ncsl_divisions.cjs`, `scripts/_debug/resolve_ncsl_team_names.cjs`, `scripts/_debug/reclassify_ncsl_as_leagues.cjs`, `scripts/_debug/reclassify_wysa_as_leagues.cjs`
**Zero UI changes. All data flows through universal V2 pipeline.**

---

### Session 102 - Wave 4 PlayMetrics Adapter (February 16, 2026) - COMPLETE ✅

**Goal:** Complete Wave 4 — build PlayMetrics adapter, scrape CO Colorado Advanced League (9 tiers) + SDL Sporting Development League, add to daily pipeline.

**Bug Fixes (3 root causes from previous partial build):**

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| Batch INSERT: all matches got same key | `matchKeyFormat: "playmetrics-{gameId}"` but `generateMatchKey()` only replaces `{matchId}` | Changed to `"playmetrics-{eventId}-{matchId}"` |
| coreScraper reports wrong staged count | `result.rowCount \|\| batch.length` — 0 is falsy in JS | Changed to `result.rowCount` |
| Date extraction: only 1-2 dates captured | Body text regex instead of DOM-aware traversal | Rewrote to use `schedule__date` container traversal |

**Additional fixes:** parseDivision false gender match (`"Gold"` matched `G`), time validation (reject `"-"`, `"TBD"`), double-counting matchesStaged, TEAM DROP team filter, NULL date filter.

**Scraping Results:**

| Event | Divisions | Matches | Teams |
|-------|-----------|---------|-------|
| CO CAL Fall 2025 | 108 | 4,764 | 2,232 new |
| SDL Boys Fall 2025 | 2 (U11B, U12B) | 320 | 36 new |
| SDL Girls Fall 2025 | 1 (U12G) | 29 | — |
| **Total** | **111** | **5,113** | **2,272 new** |

**Key Metrics:**

| Metric | Before Session 102 | After Session 102 |
|--------|-------------------|-------------------|
| matches_v2 (active) | 474,797 | **479,910** (+5,113) |
| teams_v2 | 162,327 | **164,599** (+2,272) |
| leagues | 407 | **410** (+3) |
| Adapters built | 7 | **8** (added PlayMetrics) |
| Pipeline sync jobs | 7 | **8** (added sync-playmetrics) |
| CO teams in rankings | ~320 | **1,396** |

**Files Modified:** `scripts/adapters/playmetrics.js` (v2.0), `scripts/universal/coreScraper.js` (2 bug fixes), `.github/workflows/daily-data-sync.yml` (+1 sync job), `.claude/hooks/session_checkpoint.md`, `docs/3-STATE_COVERAGE_CHECKLIST.md` (v4.2), `CLAUDE.md` (v23.2)
**Files Created:** `scripts/_debug/probe_playmetrics_dates.cjs`, `scripts/_debug/probe_sdl_leagues.cjs`
**Zero UI changes. All data flows through universal V2 pipeline.**

---

### Session 101 - ECNL Future-Proofing + Wave 2d MD/DE/IA (February 16, 2026) - COMPLETE ✅

**Goal:** (1) ECNL future-proofing — add keywords to fastProcessStaging.cjs + backfill source_entity_map. (2) Wave 2d — discover and scrape events for MD, DE, IA, research ND and WV.

**ECNL Future-Proofing:**
- Added 'ecnl', 'ecrl', 'pre-ecnl' to LEAGUE_KEYWORDS in fastProcessStaging.cjs
- Backfilled 74 TGS source_entity_map entries → Tier 0 instant resolution for all ECNL events
- 3 events (3897, 3913, 3922) had 0 matches — will auto-create as leagues when matches appear

**Wave 2d Results:**

| State | Platform | Events Scraped | Matches |
|-------|----------|---------------|---------|
| MD | GotSport | EDP (44329: 496), ICSL (43667: 365), USYS NL SAC 15-19U (44340: 50), USYS NL SAC 13-14U (50581: 20), CPSL NPL (43268: 17) | 948 |
| DE | GotSport | ESPL (45707: 10), CLS (43731: 56) | 66 |
| IA | SA + GS + HTG | ISL Fall SA (349), ISL Spring SA (231), IDL GS (47441: 32), EIYSL HTG (0, between seasons) | 612 |
| ND | — | No state-specific league. Teams play USYS Midwest Conference. | — |
| WV | — | Season starts March 2026. Event ID behind registration hash. Deferred. | — |

**Key Metrics:**

| Metric | Before Session 101 | After Session 101 |
|--------|-------------------|-------------------|
| matches_v2 (active) | 473,756 | **474,797** (+1,041) |
| teams_v2 | 161,021 | **162,327** (+1,306) |
| leagues | 398 | **407** (+9) |
| TGS source_entity_map | 0 | **74** |
| SA adapter events | 64 | **66** (+2 IA) |
| HTG adapter events | ~40 | **+2** (EIYSL) |

**Files Modified:** `scripts/maintenance/fastProcessStaging.cjs` (ECNL keywords), `scripts/adapters/sportsaffinity.js` (+2 IA events), `scripts/adapters/htgsports.js` (+2 EIYSL events), `.claude/hooks/session_checkpoint.md`, `docs/3-STATE_COVERAGE_CHECKLIST.md` (v4.1), `CLAUDE.md` (v23.1)
**Files Created:** `scripts/_debug/backfill_ecnl_source_map.cjs`, `scripts/_debug/check_ecnl_linkage.cjs`, `scripts/_debug/add_wave2d_gotsport_events.cjs`
**Zero UI changes. All data flows through universal V2 pipeline.**

---

### Session 100 - Wave 8 ECNL Full Scrape + Pipeline Update (February 16, 2026) - COMPLETE ✅

**Goal:** Complete 4 priorities: (1) Fix PA-W GLC parser, (2) Discover GA Girls GUIDs, (3) Wave 8 ECNL full scrape, (4) Update daily-data-sync.yml with all new adapters.

**Results:**

| Priority | Outcome |
|----------|---------|
| PA-W GLC parser | NOT a parser bug. Entire PA-W SportsAffinity site has restricted access (all events redirect to UnPublishedPage.asp). 10 approaches tested per Principle 42. Deferred to March 2026. |
| GA Girls | NOT on SportsAffinity. Athena league ended on SA in 2021. GA Girls data (1,276 teams, 1,451 matches) comes via GotSport tournaments. No action needed. |
| ECNL full scrape | **MASSIVE SUCCESS** — ALL 76 ECNL/ECRL/Pre-ECNL events scraped (IDs 3880-3960). 32,068 matches found, 32,751 inserted, 79 reclassified to leagues. |
| daily-data-sync.yml | Added 3 new sync jobs (TGS, MLS Next, SportsAffinity). Total pipeline: 17→20 jobs, 4→7 sync sources. |

**ECNL Breakdown:**

| Program | Events | Matches |
|---------|--------|---------|
| ECNL Boys | 11 | 5,463 |
| ECNL Girls | 10 | 5,753 |
| ECNL RL Boys | 24 | 9,380 |
| ECNL RL Girls | 22 | 10,786 |
| Pre-ECNL Boys | 8 | 1,196 |
| Pre-ECNL Girls | 3 | 346 |
| **Total** | **76** | **32,068** |

**Key Metrics:**

| Metric | Before Session 100 | After Session 100 |
|--------|-------------------|-------------------|
| matches_v2 (active) | 440,898 | **473,756** (+32,858) |
| teams_v2 | 156,518 | **161,021** (+4,503) |
| leagues | 319 | **398** (+79 ECNL) |
| tournaments | 1,856 | **1,777** (-79 reclassified) |
| TGS events configured | 13 | **76** |
| Pipeline sync jobs | 4 | **7** |

**Files Modified:** `scripts/adapters/totalglobalsports.js` (13→76 staticEvents), `.github/workflows/daily-data-sync.yml` (+3 sync jobs), `.claude/hooks/session_checkpoint.md`, `docs/3-STATE_COVERAGE_CHECKLIST.md` (v4.0), `CLAUDE.md` (v23.0)
**Files Created:** `scripts/_debug/reclassify_ecnl_as_leagues.cjs`, `scripts/_debug/quick_tgs_probe.cjs`, `scripts/_debug/scrape_ecnl_batch.sh`, various debug/probe scripts
**Zero UI changes. All data flows through universal V2 pipeline.**

---

### Session 99 - Wave 3 SportsAffinity: Full State-Level League Scrape (February 16, 2026) - COMPLETE ✅

**Goal:** Scrape ALL planned SportsAffinity state-level leagues (MN, UT, OR, NE, PA-W) for both Fall 2025 and Spring 2026. Discover Fall 2025 GUIDs. Create session checkpoint system for rate-limit resilience.

**Wave 3 Results:**

| State | Before | After | Delta | SA Events Scraped |
|-------|--------|-------|-------|-------------------|
| MN | 828 | **940** | +112 | 3 (Fall Competitive, Metro Alliance, Summer 2025) |
| UT | 1,408 | **5,759** | **+4,351** | 6 (Premier PL/SCL/IRL/XL, SUIRL, UVCL, YDL, Platform, Challenger) |
| OR | 1,607 | **10,046** | **+8,439** | 6 (Fall League, Dev League, Founders Cup, Valley, Soccer 5, PYSA + Spring/Winter) |
| NE | 476 | **2,143** | **+1,667** | 4 (Premier Conf, Dev Conf, CYSL, Cornhusker) |
| PA | 8,421 | **10,857** | **+2,436** | 10 (Classic, Frontier, Div 4, Districts 1-5,7) |

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| matches_v2 (active) | 427,220 | **440,898** | **+13,678** |
| teams_v2 | ~150,111 | **156,518** | **+6,407** |
| leagues | 304 | **319** | +15 |
| SA adapter events | 35 | **64** | +29 (Fall 2025 GUIDs) |

**Files Modified:** `scripts/adapters/sportsaffinity.js` (35→64 events), `CLAUDE.md`, `docs/3-STATE_COVERAGE_CHECKLIST.md` (v3.2), `docs/1.1-GUARDRAILS_v2.md` (S19), `docs/3-DATA_SCRAPING_PLAYBOOK.md` (v8.0), `.claude/hooks/CRITICAL_RULES.md`, `.claude/hooks/session-start.sh`, `.claude/hooks/session-start.txt`
**Files Created:** `.claude/hooks/session_checkpoint.md`, `scripts/_debug/audit_season_coverage.cjs`, various debug scripts
**Zero UI changes. All data flows through universal V2 pipeline.**

---

### Session 98b - Fix App Bugs + Nationwide Coverage Master Plan (February 15, 2026) - COMPLETE ✅

**Goal:** Fix 3 app bugs discovered on device + verify ALL 55 state league platforms + create comprehensive nationwide data collection master plan with accountability framework.

**Bug Fixes:**

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| Home page "0 Matches" + console error | Migration 088 dropped `updated_at` from `app_team_profile` view. `fetchStats()` cascaded. | Isolated `lastUpdatedResult` from `Promise.all()`, query `teams_v2` directly. Migration 098b restores column. |
| Leagues tab shows only 2 leagues | `getLeaguesList()` fetches 19,858 rows; PostgREST caps response | Created `get_league_stats()` RPC function (server-side aggregation → 98 rows). Updated `lib/leagues.ts`. |

**Nationwide Research (Deep Research with 6+ agents):**

| Finding | Impact |
|---------|--------|
| SDL uses PlayMetrics with public URLs | PlayMetrics adapter unlocks SDL + Colorado (9 tiers!) |
| Arkansas migrated to Squadi (new platform) | New adapter needed for AR |
| 16 GotSport event IDs confirmed | 10 states ready for immediate scraping (Wave 2a) |
| 10 distinct platforms power US soccer | 12 total adapters needed (7 built, 5 to build) |
| 3 states have no statewide league (MS, SD, WY) | Captured through USYS multi-state conferences |
| Sports Connect being sunset 2027 → PlayMetrics | Updated platform tracking |

**Accountability Framework Added to STATE_COVERAGE_CHECKLIST.md:**
- Session Progress Log (append-only)
- Completion Targets with gap analysis
- Session Start/End protocols
- Wave Discipline + "Am I Drifting?" check

**Resume Prompt:** See STATE_COVERAGE_CHECKLIST.md for master tracking. Follow Wave plan.

**Files Modified:** `app/(tabs)/index.tsx`, `lib/leagues.ts`, `docs/3-STATE_COVERAGE_CHECKLIST.md` (v3.0), `CLAUDE.md` (v21.0)
**Files Created:** `scripts/migrations/098b_fix_app_bugs.sql`
**Zero data loss. All fixes universal.**

---

### Session 98 - Comprehensive Expansion Sprint: ECNL + FL + TX + MLS Next Fix (February 15, 2026) - COMPLETE ✅

**Goal:** QC fixes (MLS Next reclassification, double-prefix cleanup) + first ECNL scrape + Florida/Texas league expansion.

**QC Fixes:**

| Fix | Impact |
|-----|--------|
| MLS Next reclassified from tournament → league | 9,795 matches now display correctly under "Leagues" |
| 98 double-prefix teams cleaned | Retroactive fix for remaining prefix duplicates |
| MI + AL GotSport events scraped | 173 new matches from state discovery |

**ECNL Adapter Deployed (TotalGlobalSports):**
- Fixed 4 bugs in existing adapter: selectors, duplicate prefix in team names, division metadata, pagination
- Event 3933 (Girls Southwest): **816 matches** scraped and processed
- 102 ECNL teams resolved (99 new, 3 existing)
- Added `totalglobalsports` to KNOWN_PLATFORMS in intakeValidator.js
- **First ECNL data in SoccerView** — 7th data source

**Florida League Expansion (3 events):**

| League | Event ID | Matches |
|--------|----------|---------|
| FSPL 2025-26 | 80693 | 29 |
| EDP Florida League 2025-26 | 76361 | 180 |
| FCL NPL Florida 2025-26 | 79779 | 91 |
| **Total FL** | | **300** |

**Texas League Expansion (4 events):**

| League | Event ID | Matches |
|--------|----------|---------|
| State Classic League (SCL) 2025-26 | 78565 | 16 |
| EDPL Fall 2025 | 79367 | 223 |
| CCSAI Classic Boys Fall 2025 | 77871 | 127 |
| Girls Classic League 2024-25 | 75263 | 63 |
| **Total TX** | | **429** |

**Pipeline Processing:**
- fastProcessStaging: 481 GotSport + 816 TGS = 1,297 matches inserted
- ELO recalculated with all new data
- All 5 materialized views refreshed

**Results:**

| Metric | Before | After |
|--------|--------|-------|
| teams_v2 | 148,469 | **150,111** (+1,642) |
| matches_v2 (active) | 425,050 | **426,513** (+1,463) |
| leagues | 281 | **304** (+23) |
| Data sources | 6 | **7** (added TotalGlobalSports/ECNL) |

**Files Modified:** `totalglobalsports.js` (4 bug fixes), `intakeValidator.js` (add platform), `3-STATE_COVERAGE_CHECKLIST.md`, `3-DATA_EXPANSION_ROADMAP.md`
**Files Created:** `reclassifyMlsNextAsLeague.cjs`, 3 MLS Next debug scripts
**Zero UI Changes.** All data flows through universal V2 pipeline.

---

### Session 97 - National Expansion: MLS Next + SportsAffinity GA (February 15, 2026) - COMPLETE ✅

**Goal:** Build and deploy two new adapters (MLS Next, SportsAffinity) for national expansion. Research all state league platforms.

**Results:** +13,409 matches (9,795 MLS Next + 2,409 SportsAffinity GA + misc), 2 new adapters, 6→7 data sources.

**Files Created:** `sportsaffinity.js`, `mlsnext.js`, `totalglobalsports.js` (adapters), `fixLeagueStates.cjs`
**Zero UI Changes.** All data flows through universal V2 pipeline.

---

### Session 96 - NC Post-Expansion QC Fixes + Lessons Learned (February 15, 2026) - COMPLETE ✅

**Goal:** Fix QC issues discovered during NC expansion testing. Establish universal Post-Expansion QC Protocol.

**Fixes Applied (all universal):**

| Fix | Impact | Files |
|-----|--------|-------|
| Home page "0 Matches" | PostgREST timeout on materialized view filter → use `app_matches_feed` with date-only filter | `app/(tabs)/index.tsx` |
| Division naming consistency | `mapTierToName()` rewritten with `toOrdinal()` helper, consistent ordinal naming | `scripts/adapters/sincsports.js` |
| Conditional group suffix | Only append "- Group A" when multiple groups exist per division | `scripts/adapters/sincsports.js` |
| State metadata propagation | `processStandings.cjs` inherits league state instead of hardcoding 'unknown' | `scripts/maintenance/processStandings.cjs` |
| Unicode diacritics in prefix dedup | `stripDiacritics()` using NFD normalization before comparison | `scripts/universal/normalizers/cleanTeamName.cjs` |
| Retroactive data cleanup | 506 teams → state='NC', 805+984 standings → fixed division names, 66 teams → diacritics fixed | SQL + scripts |

**New Principle:** #41 — Post-Expansion QC Protocol (mandatory for every new state)

**Docs Updated:** `3-DATA_SCRAPING_PLAYBOOK.md` (v7.0) and `3-DATA_EXPANSION_ROADMAP.md` (v7.0) with NC lessons learned, QC checklist, expansion lifecycle.

**Architecture Readiness Audit:** Comprehensive 3-agent audit confirmed ALL systems READY for national expansion. Zero `if (source === ...)` hardcoding in universal pipeline. All layers scale to 500K+ matches, 200K+ teams.

**Zero UI Design Changes.** Zero data loss. All fixes universal.

---

### Session 95 - SINC Sports Adapter + Division-Seeded ELO + NC Data (February 14, 2026) - COMPLETE ✅

**Goal:** Fix the Sporting City 15B Indigo-North ranking bug (Div 7 team ranked #1 in KS), expand to NC via SINC Sports, implement division-seeded ELO.

**The Problem:** Sporting City 15B Indigo-North plays in Heartland Division 7 and is 8-0-0. ELO starts ALL teams at 1500, so closed division pools can't self-calibrate. Result: Div 7 team ranked #1 in state above Division 1 teams.

**Solution: Division-Seeded Starting ELO**
```
seed_elo = 1500 + (median_division - team_division) * DIVISION_STEP
```
DIVISION_STEP = 15, median-centered. Auto-calculated per league from `league_standings.division`.

**Phase A: 50-State Tracking + Roadmap**
- Created `docs/3-STATE_COVERAGE_CHECKLIST.md` — complete 50-state + DC checklist
- Updated `docs/3-DATA_EXPANSION_ROADMAP.md` — local-first expansion strategy
- Identified 4 new adapters needed for national coverage (SINC, Demosphere, SportsAffinity, Sports Connect)

**Phase B: SINC Sports Adapter + NC Data**
- Created `scripts/adapters/sincsports.js` — Puppeteer-based adapter for matches + standings
- Scraped NC Fall Classic League (NCFL): 4,303 matches
- Scraped NC Spring Classic League (NCCSL): 4,389 matches
- Scraped NC Fall standings: 984 entries across 15 divisions
- Fixed `fastProcessStaging.cjs`: source_entity_map Tier 0 lookup + LEAGUE_KEYWORDS classification
- Fixed `fix_nc_leagues.cjs`: converted misclassified tournaments to leagues, dual source_entity_map registration

**Phase C: Division-Seeded ELO**
- Created `scripts/daily/divisionSeedElo.cjs` — universal division tier extraction
- Modified `scripts/daily/recalculate_elo_v2.js` — Step 1.5 division seeding + cache init
- Updated `docs/2-RANKING_METHODOLOGY.md` — section 5.5 on closed-pool problem

**Key Result: Sporting City 15B Indigo-North**

| Metric | Before | After |
|--------|--------|-------|
| KS State Rank | #1 | **#3** |
| ELO | ~1756 | **1625** |
| Division 1 teams above | 0 | **2** |

**Division Seeding Stats:**
- Heartland: 14 tiers, seeds 1410-1605, 1,207 teams
- NCYSA Fall: 15 tiers, seeds 1395-1605, 805 teams
- Total: 2,012 teams seeded, 1,684 unique
- Overall avg ELO: 1500.4 (correctly centered)

**All 3 Data Flows Verified for NC:**
- Flow 1 (Matches → ELO): 8,692 NC matches, 318 NC teams with matches
- Flow 2 (Standings → League Page): 805 NC standings across 15 divisions
- Flow 3 (Scheduled → Upcoming): 3,800 future matches, all with league_id

**Regression: Zero Impact on Existing Data**
- teams_v2: 145,356 → 146,505 (only additions)
- matches_v2: 402,948 → 411,641 (only additions)
- GotSport ranks: unchanged
- Heartland data: unchanged

**Pipeline Integration:**
- Added `sync-sincsports` job to `daily-data-sync.yml`
- Added SINC Sports to `scrape-standings` job
- Updated validation-pipeline + summary to include SINC Sports

**Files Created:** `sincsports.js` (adapter), `divisionSeedElo.cjs`, `fix_nc_leagues.cjs`, `verify_nc_complete.cjs`, `3-STATE_COVERAGE_CHECKLIST.md`
**Files Modified:** `fastProcessStaging.cjs`, `recalculate_elo_v2.js`, `daily-data-sync.yml`, `3-DATA_SCRAPING_PLAYBOOK.md`, `3-DATA_EXPANSION_ROADMAP.md`, `2-RANKING_METHODOLOGY.md`

---

### Session 94 Part 2 - GotSport Rankings Matching + Pipeline Integration (February 9, 2026) - COMPLETE ✅

**Goal:** Improve restoreGotSportRanks.cjs matching rate and integrate as Phase 2.7 in nightly pipeline.

**Problem:** 49% match rate left gaps in GotSport rankings display (e.g., KS U11 Boys missing state ranks #4 and #11).

**Matching Fixes:**
- Added `removeDuplicatePrefix()` normalization (shared with rest of pipeline)
- Added Tier 2b/2c: team_name-only matching for non-repeating club prefixes
- Added Tier 3b: canonical team_name-only fallback
- Added `--cached` flag for fast reruns (2.5 min vs 50 min API fetch)
- Backfilled 68K+ `source_entity_map` entries for future Tier 1 instant resolution

| Metric | Before | After |
|--------|--------|-------|
| Match rate | 49% (52,360) | **64% (68,642)** |
| source_entity_map entries | 4,464 | **~72,000+** |
| KS U11 Boys rank gaps | #4, #11, #13 missing | **#4, #11 filled** (only #13 genuine coverage gap) |

**Pipeline Integration (Phase 2.7):**
- New `refresh-gotsport-rankings` job in `daily-data-sync.yml`
- Runs after validation (Phase 2), parallel with integrity checks, before ELO (Phase 3)
- LEAST/GREATEST safe — never overwrites a better rank
- `continue-on-error: true` — non-blocking for rest of pipeline
- Summary report with matched/not-found metrics

**Files Modified:** `restoreGotSportRanks.cjs`, `daily-data-sync.yml`
**Zero UI Changes. Zero match pipeline impact.**

---

### Session 94 Part 1 - LEAST/GREATEST Rank Preservation (February 9, 2026) - COMPLETE ✅

**Goal:** Fix rank preservation across all 8 files that merge or update rank values. Replace COALESCE with LEAST (ranks) or GREATEST (points).

**Problem:** `COALESCE(existing_rank, new_rank)` picks first non-NULL, not best. A team with national_rank=4 could be overwritten with 11 during merge. Session 93's 12,716 team merge exposed this: KS U11 Boys had gaps at #4, #11, #13.

**Universal Fix:** LEAST for ranks (lower = better), GREATEST for points (higher = better).

| File | Function |
|------|----------|
| `teamDedup.js` | Team merge rank preservation |
| `restoreGotSportRanks.cjs` | GotSport rank application |
| `dataQualityEngine.js` | Team creation/update ranks |
| `fastProcessStaging.cjs` | Bulk processing rank handling |
| `processStandings.cjs` | Standings team resolution |
| `recalculate_elo_v2.js` | ELO recalculation rank writes |
| `captureRankSnapshot.js` | Daily rank snapshot capture |
| `recalculateHistoricalRanks.cjs` | Historical rank recalculation |

**Files Modified:** All 8 above
**Zero UI Changes. Zero data loss. Permanent rank quality improvement.** See Principle 39.

---

### Session 93 - Double-Prefix Fix + Duplicate Team Merge + Rankings Sort (February 7, 2026) - COMPLETE ✅

**Goal:** Fix three QC issues: (1) Rankings sort order jumbled when state filter applied, (2) Double-prefix team names ("Kansas Rush Kansas Rush Pre-ECNL 14B"), (3) Duplicate team records causing duplicates in rankings (same team as two UUIDs).

**Issue 1 — Rankings Sort Order (UI fix):**
Rankings displayed state_rank but sorted by national_rank when state filter was active. Fixed in `rankings.tsx` with state-aware sort logic.

**Issue 2 — Double-Prefix Team Names (3-layer universal fix):**

Root cause: GotSport importer (Session 76, archived) concatenated club + team when API already included club. Normalizer only caught 1-2 word prefixes. Two bulk processors bypassed normalizer entirely.

**Architecture: Single Source of Truth (Principle 38)**

```
cleanTeamName.cjs  ← THE algorithm (N-word sliding window, 1-5 words)
       ├── teamNormalizer.js      (ESM import)
       ├── fastProcessStaging.cjs (CJS require)
       └── processStandings.cjs   (CJS require)
```

| Step | Description | Result |
|------|-------------|--------|
| 1 | Create `cleanTeamName.cjs` | Single source of truth, N-word algorithm |
| 2 | Rewire all 3 consumers | teamNormalizer, fastProcessStaging, processStandings |
| 3 | Create `fixDoublePrefix.cjs` | Retroactive fix with conflict avoidance + --case-insensitive |
| 4 | Execute retroactive fix (case-sensitive) | **18,135 teams_v2 + 14,434 canonical_teams fixed** |
| 5 | Execute retroactive fix (case-insensitive) | **1,266 teams_v2 + 57 canonical_teams fixed** |
| 6 | Cleanup remaining prefix teams | **421 renamed + 376 merged** (after duplicates cleared collision path) |

**Issue 3 — Duplicate Team Records (PRIMARY — data layer merge):**

Root cause: Same real-world team existed as TWO `teams_v2` UUIDs — one from GotSport rankings import (has rank data, 0 matches) and one from match scraping (has matches, no rank). Both appeared in app_rankings.

| Step | Description | Result |
|------|-------------|--------|
| 1 | Create `mergeDuplicateRankedTeams.cjs` | Universal merge: same display_name + birth_year + gender |
| 2 | Keeper selection | ROW_NUMBER by matches_played DESC, national_rank ASC, elo_rating DESC |
| 3 | Transfer GS rank to keepers | COALESCE — only fills NULLs |
| 4 | Collision-safe match re-pointing | Temp `_merge_map` table + comprehensive CTE projecting post-merge semantic keys |
| 5 | Handle all FK cascades | matches, source_entity_map, canonical_teams, league_standings, rank_history_v2 |
| 6 | Execute | **12,715 duplicate teams merged** (12,339 + 376 prefix residuals) |

**Collision Handling (critical for future reference):**
- `unique_match_semantic` — Project ALL post-merge semantic keys, rank, soft-delete non-winners before re-pointing
- `different_teams_match` CHECK — Detect intra-squad matches (both teams → same keeper), soft-delete before re-pointing
- `league_standings` FK — Delete conflicting entries, re-point rest (standings DATA untouched per Principle 36)

**Results:**

| Metric | Before | After |
|--------|--------|-------|
| teams_v2 | 158,072 | **145,356** (-12,716 duplicates merged) |
| matches_v2 (active) | 403,068 | **402,948** (-120 collision soft-deletes) |
| Double-prefix teams | 18,513 | **0** |
| Duplicate display_name groups | 11,689 | **0** |
| KS U11 Boys duplicates in rankings | 5+ pairs | **0** |
| Rank gaps in GotSport mode | Visible | **Sequential** |
| league_standings | 1,208 | **1,207** (1 collision, data untouched) |

**Files Created:** `cleanTeamName.cjs`, `fixDoublePrefix.cjs`, `mergeDuplicateRankedTeams.cjs`
**Files Modified:** `teamNormalizer.js`, `fastProcessStaging.cjs`, `processStandings.cjs`, `rankings.tsx`
**Zero UI Design Changes (except rankings sort).** Zero data loss. Pure data quality improvement.

---

### Previous Sessions (92 QC P2 and Earlier)

**For detailed session history, see [docs/1.3-SESSION_HISTORY.md](docs/1.3-SESSION_HISTORY.md).**

**Recent Key Sessions:**

| Session | Date | Focus | Key Outcome |
|---------|------|-------|-------------|
| 92 QC P2 | Feb 7 | Fix refresh_app_views() + RLS | 50/50 architecture health, Migration 095 |
| 92 QC | Feb 6 | Lightweight Standings Resolver | Dual-system architecture (Principle 36), NULL metadata 439→17 |
| 92 | Feb 6 | League Standings Passthrough | Hybrid view, scrapeStandings.js, processStandings.cjs |
| 91b | Feb 5 | Filter Polish + Division Backfill | Division data backfill, standings passthrough insight |
| 91 | Feb 5 | Generic Event Name Prevention | 5-layer defense, resolveEventName.cjs, Migration 091 |
| 90 | Feb 5 | Cross-Import Duplicate Fix | 2,527 cross-import dupes soft-deleted |
| 89 | Feb 5 | Universal Entity Resolution | source_entity_map table, 7,253 teams merged |
| 88 | Feb 5 | Universal QC Fix (4 Issues) | deleted_at IS NULL, reverse match detection, state inference |
| 87.2 | Feb 4 | HTGSports Scraping + Pipeline | Universal bulk processor (fastProcessStaging.cjs) |
| 87 | Feb 4 | Canonical Resolver & Gender Fix | Gender/birth_year exact-match constraints on fuzzy matching |
| 86 | Feb 4 | Match Recovery & Soft Delete | Soft-delete architecture (Principle 30), 6,053 matches recovered |
| 85 | Feb 4 | Universal SoccerView ID Architecture | Semantic match uniqueness (Principle 29) |
| 84 | Feb 3 | Premier-Only Data Policy | Removed recreational data |
| 83 | Feb 3 | Foundation First Principle | Complete V1 extraction |
| 82 | Feb 3 | V1 Archive Migration | +93,984 matches to V2 |
| 81 | Feb 3 | Pipeline Reliability | Unified Heartland adapter |
| 80 | Feb 3 | Git Hygiene | 380 files committed |
| 79 | Feb 2 | V2 Architecture Enforcement | Write protection triggers |
| 78 | Feb 2 | Orphan Root Cause Analysis | Coverage gaps, not duplicates |
| 77 | Feb 2 | NULL Metadata Fix | 10,571 teams fixed |
| 76 | Feb 2 | GotSport Rankings Bypass | +118,977 canonical_teams |
| 75 | Feb 2 | Real-Time Data Consistency | Source table queries |

---

### Database Architecture

```
Layer 1: Staging (staging_games, staging_teams, staging_events)
    ↓ dataQualityEngine.js (or fastProcessStaging.cjs for bulk)
Layer 2: Production (teams_v2, matches_v2, leagues, tournaments)
    ↓ refresh_app_views()
Layer 3: App Views (app_rankings, app_matches_feed, etc.)
```

### Resume Prompt

When starting a new session:
> "Resume SoccerView Session 108. Read CLAUDE.md (v23.7), .claude/hooks/session_checkpoint.md, and docs/3-STATE_COVERAGE_CHECKLIST.md. Current: 520,376 active matches, 177,565 teams, 462 leagues, 10 adapters. Session 107 COMPLETE — Fixed systemic team key normalization bug in fastProcessStaging.cjs, recovered 11,061 stuck staging records (+9,094 new matches). **Next priority: PA-W GLC — MUST SOLVE per Principle 42. Try 5+ new approaches.** Also: STXCL NPL needs AthleteOne adapter (defer to Session 110+). Zero UI changes needed."

---

## File Structure

```
soccerview/
├── app/
│   ├── (tabs)/           # Tab screens
│   ├── team/[id].tsx     # Team detail
│   ├── league/[eventId].tsx  # League detail
│   └── _layout.tsx       # Root layout
├── components/
│   └── MatchCard.tsx     # Shared match card
├── lib/
│   ├── supabase.ts       # Supabase client
│   ├── matchUtils.ts     # Shared match display utilities (Session 91)
│   └── leagues.ts        # League functions
├── scripts/
│   ├── daily/            # GitHub Actions pipeline
│   ├── universal/        # Universal Scraper Framework (NEW)
│   ├── adapters/         # Source adapters (NEW)
│   ├── scrapers/         # Legacy data collection
│   ├── maintenance/      # Diagnostics & utilities
│   ├── onetime/          # Rarely used
│   ├── migrations/       # DB migrations
│   ├── _archive/         # Deprecated V1 scripts
│   └── _debug/           # Debug output files
├── docs/
│   ├── ARCHITECTURE.md   # V2 schema
│   ├── DATA_SCRAPING_PLAYBOOK.md
│   ├── DATA_EXPANSION_ROADMAP.md
│   ├── UI_PATTERNS.md
│   ├── SESSION_HISTORY.md
│   └── _archive/         # Completed docs
├── CLAUDE.md             # THIS FILE
└── package.json
```

---

## UI Design System

| Element | Color | Hex |
|---------|-------|-----|
| Background | Black | #000000 |
| Card | Dark Gray | #111111 |
| Primary Blue | Blue | #3B82F6 |
| Amber/Gold | Amber | #F59E0B |
| Success | Green | #10B981 |
| Error | Red | #EF4444 |

See [docs/3-UI_PATTERNS.md](docs/3-UI_PATTERNS.md) for all patterns.

---

*This document is the master reference for all Claude interactions.*
*Detailed documentation is in the docs/ folder.*
*Update at the end of each session.*
