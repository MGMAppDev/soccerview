# CLAUDE.md - SoccerView Project Master Reference

> **Version 14.1** | Last Updated: February 5, 2026 | Session 91b Complete
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

---

## Quick Reference

### Database Status (V2 - Production)

| Table | Rows | Purpose |
|-------|------|---------|
| `teams_v2` | 158,043 | Team records (~59,401 with ELO ratings) |
| `matches_v2` | 403,068 active | Match results (~5,468 soft-deleted) |
| `clubs` | 124,650 | Club organizations |
| `leagues` | 280 | League metadata |
| `tournaments` | 1,711 | Tournament metadata (17 dupes merged, 0 generic names) |
| `source_entity_map` | 3,253 | **NEW** Universal source ID mappings (Session 89) |
| `canonical_events` | 1,795 | Canonical event registry (Session 62) |
| `canonical_teams` | 138,252 | Canonical team registry (Session 76: +118,977) |
| `canonical_clubs` | 7,301 | Canonical club registry (Session 62) |
| `learned_patterns` | 0+ | Adaptive learning patterns (Session 64) |
| `staging_games` | 86,491 | Staging area (0 unprocessed) |
| `staging_rejected` | 1 | Rejected intake data (Session 79) |
| `seasons` | 3 | Season definitions |

### Materialized Views (App Queries)

| View | Purpose |
|------|---------|
| `app_rankings` | Rankings & Teams tabs |
| `app_matches_feed` | Matches tab |
| `app_league_standings` | League standings |
| `app_team_profile` | Team detail |
| `app_upcoming_schedule` | Future games |

### Data Sources

| Source | Status | Output |
|--------|--------|--------|
| GotSport | ✅ Production | staging_games |
| HTGSports | ✅ Production | staging_games |
| Heartland CGI | ✅ Production | staging_games |

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
| `recalculate_elo_v2.js` | ELO calculation |
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
| `scripts/universal/adaptiveLearning.js` | **NEW** Adaptive learning engine (Session 63) |
| `scripts/adapters/gotsport.js` | GotSport adapter config |
| `scripts/adapters/htgsports.js` | HTGSports adapter (Puppeteer for SPA) |
| `scripts/adapters/heartland.js` | Heartland adapter (Cheerio for CGI) |
| `scripts/adapters/_template.js` | Template for creating new adapters |

**Usage:**
```bash
# Scrape all active events (uses universal discovery)
node scripts/universal/coreScraper.js --adapter gotsport --active

# Scrape specific event
node scripts/universal/coreScraper.js --adapter htgsports --event 12345

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

### Maintenance (`scripts/maintenance/`)

Diagnostics, audits, and utilities.

| Script | Purpose |
|--------|---------|
| `ensureViewIndexes.js` | **NIGHTLY** Universal index maintenance for all views (Session 69) |
| `recalculateHistoricalRanks.cjs` | Recalculate rank_history with consistent baseline (Session 70) |
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

### Session 91b - League Standings Phase 9: Filter Polish + Division Data Backfill (February 5, 2026) - COMPLETE ✅

**Goal:** Fix 3 QC issues on League Standings page: filter chip visual lag, label truncation, and teams showing 0 points due to division data gap.

**Issues Fixed:**

| # | Issue | Root Cause | Fix |
|---|-------|-----------|-----|
| 1 | Filter chips stay grayed out | Nested ScrollView touch conflict | Gender: `View` replaces `ScrollView`. Age/Div: `nestedScrollEnabled={true}`. All: `activeOpacity={0.7}` |
| 2 | "Gender" label truncated | `filterLabel.width: 52` too narrow | Width 52→62, `numberOfLines={1}` on all labels |
| 3 | Teams show 0 points | Matches split between `division='Div 1'` and `NULL` → view GROUP BY creates 2 rows | 3-layer fix: backfill (790) + inference (2,352) + view refresh |

**Division Data Results:**

| Source | Before | After |
|--------|--------|-------|
| Heartland with division | 3,643 | **5,963** |
| HTGSports with division | ~6,000 | **6,292** |
| View rows with division | 0 | **1,688** |
| SBV Pre-NAL | Missing | **Division 1 \| 8GP \| 15pts \| #3** |

**CRITICAL ARCHITECTURAL INSIGHT — League Standings Should Be Passthrough:**
The current approach recomputes standings from match data via `app_league_standings` materialized view. This required complex division inference (7 iterative passes, COALESCE logic) that produced 176 multi-division artifacts and 5 NULL+division splits. **The league already publishes authoritative standings** (Heartland `subdiv_standings.cgi`). Next session should simplify: scrape standings directly, store as-is, display as-is. Don't reconstruct what the authority already publishes.

**Known Residual (Not Blocking):**
- 176 multi-division teams: inference assigns opponent's division for away matches
- 5 NULL+named division splits: calendar-only teams with 1-2 incorrectly inferred matches
- 161 Heartland league matches with NULL division (calendar-only, no CGI data for either team)

**Files Created:** `inferMatchDivision.cjs`
**Files Modified:** `app/league/[eventId].tsx` (UI fixes only)
**Data Scripts Run:** `backfillDivisionTier.cjs`, `inferMatchDivision.cjs` (7 passes), Migration 093 view refresh

---

### Session 91 - Generic Event Name Prevention + Display Utility Integration (February 5, 2026) - COMPLETE ✅

**Goal:** Eliminate generic tournament/league names from production data AND consolidate duplicate display utility functions into shared modules. Zero UI design changes.

**Root Cause:** 215 tournaments had generic names ("GotSport Event 12093", "Event 39064") because no layer in the pipeline rejected them. Also, 3 local patch functions in `app/match/[id].tsx` duplicated logic available in shared modules.

**5-Layer Defense Architecture (NEW):**

```
Layer 0: Scraper emits raw data to staging_games
Layer 1: intakeValidator.js — rejects INVALID data (null dates, rec, etc.)
Layer 2: eventNormalizer.js — rejects GENERIC names → canonical_name: null    ← NEW
Layer 3: DQE findOrCreateEvent() — null canonical_name → skip (line 787)     ← EXISTING
Layer 4: Fast processors — own isGeneric() guards                             ← NEW
Layer 5: DB CHECK constraint — blocks generic INSERTs (migration 091)         ← NEW
```

**Completed:**

| Step | Description | Result |
|------|-------------|--------|
| 1A | Retroactive data fix | 215 generic tournament names resolved (4-tier: staging, canonical_events, web, NULL) |
| 1B | DB CHECK constraints | Migration 091 blocks future generic INSERTs on tournaments + leagues |
| 1C | Pipeline guards | `resolveEventName.cjs` integrated in fastProcessStaging, linkByEventPattern, linkFromV1Archive, coreScraper |
| 2A | Shared display utils | `lib/matchUtils.ts` — `getMatchStatus()` + `getEventTypeBadge()` |
| 2B | match/[id].tsx cleanup | 3 local patch functions removed → shared imports |
| 2C | team/[id].tsx cleanup | Inline gender formatting → `getGenderDisplay()` |
| 3 | eventNormalizer guard | `isGeneric()` rejection → DQE auto-skips with ZERO DQE changes |
| 4 | linkUnlinkedMatches guard | `isGeneric()` guard before event creation |
| 5 | Archive dead code | `fastProcessHTG.cjs` → `scripts/_archive/` (superseded by fastProcessStaging) |

**Key Architecture Insight:** `eventNormalizer.js` is the architecturally correct validation point. DQE `findOrCreateEvent()` already handles `canonical_name: null` at line 787 → returns `{ league_id: null, tournament_id: null }` → match created unlinked. Fixing the normalizer protects ALL DQE code paths with zero DQE changes.

**Files Created:** `resolveEventName.cjs`, `fixGenericEventNames.cjs`, `091_block_generic_event_names.sql`, `lib/matchUtils.ts`
**Files Modified:** `eventNormalizer.js`, `linkUnlinkedMatches.js`, `fastProcessStaging.cjs`, `linkByEventPattern.js`, `linkFromV1Archive.js`, `coreScraper.js`, `app/match/[id].tsx`, `app/team/[id].tsx`
**Files Archived:** `fastProcessHTG.cjs` → `scripts/_archive/`

---

### Session 90 - Fix Cross-Import Duplicate Matches (February 5, 2026) - COMPLETE ✅

**Goal:** Fix duplicate matches in Team Detail tournament sections caused by V1 migration + scraper cross-import.

**Root Cause:** V1 migration (Session 82) and scrapers both imported the same real-world games, but resolved opponent teams to different `teams_v2` records (different name normalization → different IDs). Semantic uniqueness constraint couldn't catch these.

**Fix:** `scripts/maintenance/fixCrossImportDuplicates.cjs` — 6-layer false-positive protection, soft-delete legacy copies.

| Metric | Before | After |
|--------|--------|-------|
| Active matches | 405,595 | 403,068 |
| Cross-import duplicates soft-deleted | 0 | 2,527 |
| SBV Pre-NAL 15 tournament matches | 6 | 3 |
| ELO matches | 192,689 | 187,913 |
| ELO teams | 60,864 | 59,295 |

**Files Created:** `fixCrossImportDuplicates.cjs`, `SESSION_90_CROSS_IMPORT_DUPLICATES.md`

**Prevention:** Already handled by `source_entity_map` (Session 89). This fix is purely retroactive.

---

### Session 89 - Universal Entity Resolution + Source ID Architecture (February 5, 2026) - COMPLETE ✅

**Goal:** Eliminate all duplicate matches caused by V1-legacy duplicate teams. Build permanent prevention via source_entity_map.

**Root Cause:** V1 migration created 7,253 duplicate team records with NULL/incomplete metadata. 100% involved v1-legacy data.

**Completed:**

| Step | Description | Result |
|------|-------------|--------|
| 1 | Fix teamDedup.js (4 bugs) | Soft-delete first, AND→OR, deleted_at filter |
| 2 | Migration 089 | source_entity_map table + state normalization |
| 3 | Backfill source entity IDs | 3,253 mappings (1,244 teams + 274 leagues + 1,735 tournaments) |
| 4 | Retroactive team merge | 7,253 v1-legacy duplicates merged via bulk SQL |
| 5 | Tournament dedup | 17 duplicate groups merged, 0 remaining |
| 6-7 | DQE pipeline prevention | Tier 1/2/3 resolution in findOrCreateTeam/Event |
| 8 | fastProcessStaging prevention | Bulk source ID lookup + NULL-tolerant fallback |
| 9 | Adapter enhancement | coreScraper emits source_home/away_team_id |
| 10 | Post-fix cleanup | ELO recalc (189,971 matches, 59,401 teams) + view refresh |

**Key Architecture Changes:**
- `source_entity_map` table: Universal (entity_type, source_platform, source_entity_id) → SV UUID
- Partial unique index `unique_match_semantic` replaces constraint (allows soft-deleted duplicates)
- Three-tier resolution in all pipeline paths (DQE, fastProcessStaging)
- Adapters emit source entity IDs for Tier 1 deterministic resolution

**Database After Session 89:**
- teams_v2: 158,043 (down from 160,705 — 7,253 merged)
- matches_v2: 405,595 active (~2,941 soft-deleted)
- source_entity_map: 3,253 mappings
- tournaments: 1,711 (17 dupes merged)
- 0 remaining v1-legacy duplicate pairs

**Files Modified:** `teamDedup.js`, `dataQualityEngine.js`, `fastProcessStaging.cjs`, `coreScraper.js`, `1.2-ARCHITECTURE.md`, `3-DATA_EXPANSION_ROADMAP.md`, `3-DATA_SCRAPING_PLAYBOOK.md`, `CLAUDE.md`
**Files Created:** `089_universal_source_entity_map.sql`, `backfillSourceEntityMap.cjs`, `mergeV1LegacyDuplicates.cjs`, `SESSION_89_UNIVERSAL_ENTITY_RESOLUTION.md`

---

### Session 88 - Universal QC Fix (4 Issues) (February 5, 2026) - COMPLETE ✅

**Goal:** Fix 4 QC issues found during app review. All fixes are data-layer only. ZERO UI design changes.

**QC Issues Fixed:**

| # | Issue | Root Cause | Fix | Scale |
|---|-------|-----------|-----|-------|
| 1 | Birth year/age group mismatch | Hardcoded `SEASON_YEAR = 2026` in 4 pipeline files | Dynamic season year from DB `seasons` table | Prevention for 22K+ teams |
| 2 | Rank badge discrepancy | Rankings SELECT missing `elo_national_rank`, `elo_state_rank` columns | Added 2 columns to Supabase SELECT query | All SoccerView mode users |
| 3 | Wrong state assignment | GotSport importer used unreliable `STATE_ASSOCIATION_MAP` | `fixTeamStates.cjs` + `inferStateFromName()` in pipeline | 526 teams corrected |
| 4 | Duplicate matches in Team Details | Reverse matches (swapped home/away) + missing `deleted_at IS NULL` | Soft-delete filters + reverse match detection + pipeline prevention | 749 reverse dupes removed |

**Key Innovations:**
- `deleted_at IS NULL` added to ALL match queries (app, views, ELO, pipeline)
- Reverse match detection in `matchDedup.js` (conservative: score-consistent only)
- State inference from team display names (`inferStateFromName()`)
- Dynamic `SEASON_YEAR` from DB for zero-code season rollover

**Database After Session 88:**
- teams_v2: 160,705 | matches_v2: 407,896 active (2,423 soft-deleted)
- ELO: 192,172 matches, 60,817 teams (range 1157-1782)
- 0 score-consistent reverse duplicates | 0 semantic duplicate groups

**Files Modified:** `app/team/[id].tsx`, `rankings.tsx`, `recalculate_elo_v2.js`, `fastProcessStaging.cjs`, `dataQualityEngine.js`, `matchDedup.js`, `teamNormalizer.js`
**Files Created:** `fixReverseMatches.cjs`, `fixTeamStates.cjs`, `088_add_deleted_at_filters.sql`
**Session Docs:** `SESSION_88_UNIVERSAL_QC_FIX.md`, `SESSION_88_QC3_STATE_FIX.md`, `SESSION_88_QC4_DUPLICATE_MATCHES.md`

---

### Session 87.2 - HTGSports Scraping + Pipeline Fixes (February 4, 2026) - COMPLETE ✅

**Goal:** Complete HTGSports scraping, fix staging pipeline constraints, create universal bulk processor.

---

### Session 87 - Universal Canonical Resolver & Gender Fix (February 4, 2026) - COMPLETE ✅

**Goal:** Fix cross-gender team merging bug in teamDedup.js.

**Problem:** teamDedup.js was merging teams across genders (Boys merged with Girls). Fixed by adding gender and birth_year as exact-match constraints before fuzzy name matching.

**Key Principle:** Fuzzy matching MUST be constrained by exact-match fields (gender, birth_year) before comparing names.

---

### Session 86 - Match Recovery & Soft Delete Architecture (February 4, 2026) - COMPLETE ✅

**Problem:** Session 85's matchDedup.js hard-deleted 9,160 matches. These were NOT duplicates -- they were the same match from different sources.

**Recovery:**
- Recovered 6,053 matches from audit_log
- Added soft-delete columns: `deleted_at`, `deletion_reason`
- Updated matchDedup.js to use `UPDATE SET deleted_at` instead of `DELETE`
- Ran semantic dedup: 1,660 true duplicates soft-deleted
- Recalculated ELO + refreshed all views

**Key Architecture Change:** Match deduplication MUST use soft delete, not hard delete. See Principle 30.

---

### Session 85 - Universal SoccerView ID Architecture (February 4, 2026) - COMPLETE ✅

Changed match uniqueness from `source_match_key` to semantic `(match_date, home_team_id, away_team_id)`. See Principle 29. Note: Hard-delete approach was corrected in Session 86 with soft-delete pattern.

---

### Previous Sessions (84 and Earlier)

**For detailed session history, see [docs/1.3-SESSION_HISTORY.md](docs/1.3-SESSION_HISTORY.md).**

**Recent Key Sessions:**

| Session | Date | Focus | Key Outcome |
|---------|------|-------|-------------|
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
> "Resume SoccerView. Check current status in CLAUDE.md. Architecture docs in docs/."

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
