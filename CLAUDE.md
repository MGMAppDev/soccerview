# CLAUDE.md - SoccerView Project Master Reference

> **Version 8.9** | Last Updated: February 2, 2026 | Session 79 Complete
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
| [docs/1.2-ARCHITECTURE.md](docs/1.2-ARCHITECTURE.md) | V2 database architecture (3-layer design) |
| [docs/1.3-SESSION_HISTORY.md](docs/1.3-SESSION_HISTORY.md) | All past session summaries |
| [docs/2-UNIVERSAL_DATA_QUALITY_SPEC.md](docs/2-UNIVERSAL_DATA_QUALITY_SPEC.md) | **ACTIVE** Data quality system spec |
| [docs/2-RANKING_METHODOLOGY.md](docs/2-RANKING_METHODOLOGY.md) | ELO ranking calculation methodology |
| [docs/3-DATA_SCRAPING_PLAYBOOK.md](docs/3-DATA_SCRAPING_PLAYBOOK.md) | How to add new data sources |
| [docs/3-DATA_EXPANSION_ROADMAP.md](docs/3-DATA_EXPANSION_ROADMAP.md) | Priority queue for expansion |
| [docs/3-UI_PATTERNS.md](docs/3-UI_PATTERNS.md) | Mandatory UI patterns |
| [docs/3-UI_PROTECTION_PROTOCOL.md](docs/3-UI_PROTECTION_PROTOCOL.md) | UI backup/recovery procedures |
| [docs/4-LAUNCH_PLAN.md](docs/4-LAUNCH_PLAN.md) | Marketing messages & launch checklist |
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
Scrapers → staging_games → validationPipeline.js → matches_v2 → app_views → App
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

---

## Quick Reference

### Database Status (V2 - Production)

| Table | Rows | Purpose |
|-------|------|---------|
| `teams_v2` | 148,391 | Team records (Session 77: -1,710 merged) |
| `matches_v2` | 314,852 | Match results |
| `clubs` | 124,650 | Club organizations |
| `leagues` | 280 | League metadata (38 with state) |
| `tournaments` | 1,728 | Tournament metadata |
| `canonical_events` | 1,795 | Canonical event registry (Session 62) |
| `canonical_teams` | 138,252 | Canonical team registry (Session 76: +118,977) |
| `canonical_clubs` | 7,301 | Canonical club registry (Session 62) |
| `learned_patterns` | 0+ | Adaptive learning patterns (Session 64) |
| `staging_games` | 86,491 | Staging area (7,940 unprocessed) |
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
| `teamNormalizer.js` | Standardize team names, extract birth_year/gender | 6/6 |
| `eventNormalizer.js` | Standardize event names, detect league/tournament | 6/6 |
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

### Maintenance (`scripts/maintenance/`)

Diagnostics, audits, and utilities.

| Script | Purpose |
|--------|---------|
| `ensureViewIndexes.js` | **NIGHTLY** Universal index maintenance for all views (Session 69) |
| `recalculateHistoricalRanks.cjs` | Recalculate rank_history with consistent baseline (Session 70) |
| `completeBirthYearCleanup.js` | Merge duplicates, fix birth_year mismatches |
| `linkUnlinkedMatches.js` | Link matches via exact source_match_key |
| `linkByEventPattern.js` | Link HTGSports/Heartland by event ID pattern |
| `linkFromV1Archive.js` | Link legacy gotsport via V1 archived data (67% success) |
| `inferEventLinkage.js` | **NIGHTLY** Infer event from team activity patterns |
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

# Run data quality engine (replaces validation pipeline)
node scripts/universal/dataQualityEngine.js --process-staging

# Run data quality engine (dry run)
node scripts/universal/dataQualityEngine.js --process-staging --dry-run --limit 1000

# Run deduplication reports
node scripts/universal/deduplication/matchDedup.js --report
node scripts/universal/deduplication/teamDedup.js --report
node scripts/universal/deduplication/eventDedup.js --report

# Legacy validation pipeline (fallback)
node scripts/daily/validationPipeline.js --refresh-views

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

### Session 79 - V2 Architecture Enforcement (February 2, 2026) - COMPLETE ✅

**Goal:** Build a scalable, repeatable system that enforces ONE entry point and ONE processing path for all data.

**Problem Statement:**
- 48+ scripts write to the database
- Multiple paths to production (validationPipeline, dataQualityEngine, batchProcessStaging, direct writes)
- No intake validation (garbage data enters staging)
- No integrity verification (issues caught by users, not system)

**Completed Phases:**

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 1 | Create Intake Validation Gate | ✅ COMPLETE |
| Phase 2 | Consolidate to ONE Processor | ✅ COMPLETE |
| Phase 3 | Block Direct Writes | ✅ COMPLETE |
| Phase 4 | Create Integrity Verification | ✅ COMPLETE |

**Phase 1: Intake Validation Gate**
Created `scripts/universal/intakeValidator.js`:
- Validates data BEFORE it enters staging_games
- Auto-fixes malformed source_match_keys (1,695 fixed)
- Rejects truly invalid data (EMPTY_TEAM_NAME, INVALID_DATE, INVALID_BIRTH_YEAR, etc.)
- Rejected data goes to `staging_rejected` table with reason

```bash
node scripts/universal/intakeValidator.js --report           # Data quality report
node scripts/universal/intakeValidator.js --clean-staging    # Move invalid to rejected
```

**Phase 2: Consolidate to ONE Processor**
- Archived `validationPipeline.js` → `scripts/_archive/`
- Archived `batchProcessStaging.js` → `scripts/_archive/`
- Archived `fastBulkProcess.js` → `scripts/_archive/`
- Updated GitHub Actions to use `dataQualityEngine.js` ONLY (no fallback)
- Updated workflow: intakeValidator → dataQualityEngine (single path)

**Phase 3: Block Direct Writes (Database Triggers)**
Created database triggers that block unauthorized writes to `teams_v2` and `matches_v2`:
- Trigger checks for session variable `app.pipeline_authorized`
- Authorized scripts call `SELECT authorize_pipeline_write()` before writes
- Emergency override: `SELECT disable_write_protection()` / `SELECT enable_write_protection()`

**Files Created:**
- `scripts/migrations/070_create_write_protection_triggers.sql` - Trigger definitions
- `scripts/migrations/run_migration_070.js` - Migration runner
- `scripts/migrations/test_write_protection.js` - Test script
- `scripts/universal/pipelineAuth.js` - Authorization helper module

**Scripts Updated with Authorization:**
- `dataQualityEngine.js` - Pipeline authorization added
- `recalculate_elo_v2.js` - Pipeline authorization added
- `mergeTeams.js` - Pipeline authorization added
- `mergeEvents.js` - Pipeline authorization added
- `inferEventLinkage.js` - Converted from Supabase to pg Pool + authorization
- `teamDedup.js`, `matchDedup.js`, `eventDedup.js` - Authorization added

**Usage:**
```bash
# Apply migration (required before triggers are active)
node scripts/migrations/run_migration_070.js

# Test the triggers
node scripts/migrations/test_write_protection.js

# In authorized scripts - call before writes
await pool.query('SELECT authorize_pipeline_write()');

# Emergency: Disable protection temporarily
await pool.query('SELECT disable_write_protection()');
await pool.query('SELECT enable_write_protection()');
```

**Phase 4: Integrity Verification System**
Created `scripts/daily/verifyDataIntegrity.js`:
- Runs after EVERY processing cycle
- Checks: Team stats consistency, duplicate source_match_keys, canonical registry coverage, birth year validity, orphan rate, staging backlog
- Added to GitHub Actions pipeline as Phase 2.75

**Updated Pipeline Flow:**
```
Phase 1:   Scrapers → staging_games
Phase 1.5: intakeValidator.js (reject garbage, fix malformed)
Phase 2:   dataQualityEngine.js (normalize, resolve, promote)
Phase 2.75: verifyDataIntegrity.js (automated checks)
Phase 3:   recalculate_elo_v2.js
Phase 4:   score_predictions.js
Phase 5:   refresh_app_views()
```

**Files Created:**
- [scripts/universal/intakeValidator.js](scripts/universal/intakeValidator.js) - Pre-staging validation
- [scripts/daily/verifyDataIntegrity.js](scripts/daily/verifyDataIntegrity.js) - Post-processing checks
- [scripts/migrations/060_create_staging_rejected.sql](scripts/migrations/060_create_staging_rejected.sql) - Rejected data table
- [scripts/migrations/070_create_write_protection_triggers.sql](scripts/migrations/070_create_write_protection_triggers.sql) - Write protection triggers
- [scripts/migrations/run_migration_070.js](scripts/migrations/run_migration_070.js) - Migration runner
- [scripts/migrations/test_write_protection.js](scripts/migrations/test_write_protection.js) - Trigger test script
- [scripts/universal/pipelineAuth.js](scripts/universal/pipelineAuth.js) - Authorization helper module

**Files Archived:**
- `validationPipeline.js` - Replaced by dataQualityEngine.js
- `batchProcessStaging.js` - Emergency tool, no longer needed
- `fastBulkProcess.js` - Emergency tool, no longer needed

**Key Metrics:**
- Malformed keys fixed: 1,695
- Records rejected: 1
- Unprocessed staging: 7,940 (clean, ready for dataQualityEngine)
- Write protection triggers: 6 (INSERT/UPDATE/DELETE on teams_v2 and matches_v2)

---

### Session 78 - Orphan Root Cause Analysis (February 2, 2026) - COMPLETE ✅

**Goal:** Universal fix for 16,823 orphan teams showing 0W-0L-0D.

**Initial Approach (WRONG - Abandoned):**
Attempted aggressive fuzzy matching to merge orphans with teams that have matches. This was **critically flawed** because:
- "2014B" = birth year 2014 = U12 in 2026
- "15" = birth year 2015 = U11 in 2026
- These are DIFFERENT TEAMS, not duplicates!

**Root Cause Analysis (Correct):**

The 16,823 orphans are NOT duplicates - they're teams playing in leagues we don't scrape.

| State | Coverage Rate | Orphan Rate |
|-------|---------------|-------------|
| Georgia | 20.2% | 80% orphans |
| South Carolina | 21.2% | 79% orphans |
| North Carolina | 22.3% | 78% orphans |
| Washington | 33.7% | 66% orphans |
| Michigan | 43.0% | 57% orphans |

**Kansas Specific Orphans:**
- "SOUTHWEST KANSAS GREAT BEND PANTHERS 15B" - 0 matches for ANY similar teams
- "SOUTHWEST KANSAS HALCONES LIBERAL 13B" - 0 matches for ANY similar teams
- These teams play in Southwest Kansas leagues we don't scrape

**Birth Year Inconsistencies (Secondary Issue):**
- 17,701 teams have conflicting birth year indicators in names
- Example: "2014B SDL ACADEMY (U11 Boys)" - name says 2014 but suffix says U11=2015
- This is GotSport data inconsistency, NOT something we can automatically fix
- Only 5% of orphans have this issue - not the root cause

**Key Findings:**

| Finding | Impact |
|---------|--------|
| Only 1 orphan has NULL birth_year | Birth_year fix won't help orphans |
| 95% of orphans are data coverage gaps | Need to scrape more leagues |
| Aggressive merging is DANGEROUS | Could merge different teams |

**New Principle Identified (Principle 24):**

### 24. Orphans Are Coverage Gaps - NOT Duplicates (Session 78)

**CRITICAL:** Teams with GotSport points but 0 matches are almost always playing in leagues we don't scrape - NOT duplicates of existing teams.

**DO NOT:**
- Aggressively merge orphans based on similar names
- Assume "2014B" and "15" are the same team (different birth years!)
- Trust database birth_year alone - verify against team name

**DO:**
- Expand data coverage to scrape more leagues (GA, SC, NC, WA priority)
- Keep orphan teams as-is until we have their match data
- Check internal name consistency before any merge (e.g., "2014B" should not have "(U11 Boys)")

**Correct Fix Strategy:**
1. **Expand coverage** - Add scrapers for states with <50% coverage
2. **Fix birth_year inconsistencies** - Only where name is internally consistent
3. **Orphans will resolve naturally** as we add data sources

**Scripts Created:**
- `scripts/_debug/analyze_orphan_root_cause.cjs` - Comprehensive coverage gap analysis
- `scripts/maintenance/fixBirthYearFromNames.cjs` - Safe birth_year fix with conflict detection

**Files Deleted:**
- `scripts/maintenance/aggressiveOrphanMerge.cjs` - Dangerous, could merge different teams

---

### Session 77 - NULL Metadata & Orphan Merge Fix (February 2, 2026) - COMPLETE ✅

**Goal:** Fix teams with GotSport points still showing 0W-0L-0D after Session 76 fixes.

**Root Causes Identified:**
1. **NULL Metadata:** Teams with matches had NULL birth_year/gender, preventing deduplication matching
2. **Multiple Duplicate Entries:** Same team existed under different names/states
3. **Suffix Mismatch:** Orphan names had "(U11 Boys)" suffix, match-having teams didn't

**User's Specific Case (Sporting BV Pre-MLS Next 15):**
- Had 4 separate team entries: 1 orphan (GS points), 3 with matches (NULL metadata)
- Merging algorithm couldn't match because of NULL gender and different canonical names

**Fixes Applied:**

| Phase | Action | Result |
|-------|--------|--------|
| Phase 1 | Fix NULL birth_year/gender using V2 normalizer | 10,571 teams fixed |
| Phase 2 | Merge orphans with match-having counterparts | 1,707 orphans merged |
| Phase 3 | Recalculate team stats | 16 teams updated |
| Manual | Merge Sporting BV 4 entries into 1 | Fixed specific case |

**Final Data State:**

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Total teams | 150,101 | **148,391** | -1,710 |
| NULL birth_year | 17,182 | **3,288** | -13,894 |
| NULL gender | 15,703 | **6,320** | -9,383 |
| Orphans (GS pts, no matches) | 18,531 | **16,823** | -1,708 |

**User's Team Fixed:**
- **Sporting BV Pre-MLS Next 15 (U11 Boys)**: GS pts 2169, MP 12, W-L-D 9-3-0 ✅

**Key Script Created:**
- `scripts/maintenance/fixNullMetadataAndMerge.cjs` - 3-phase fix: normalize → merge → stats

**New Principle Identified:**
Teams with NULL metadata can't be matched during deduplication. Phase 1 (fix NULL metadata) must complete BEFORE Phase 2 (merge orphans).

**Remaining Orphans (16,823):**
- Data coverage gaps - matches from leagues/tournaments we don't scrape yet
- Different team name patterns requiring more sophisticated matching
- Can be reduced incrementally as more data sources are added

---

### Session 76 - Data Integrity Fix: GotSport Rankings Bypass (February 2, 2026) - COMPLETE ✅

**Goal:** Fix teams appearing in rankings with 0 matches, 0W-0L-0D (user-reported issue).

**Root Cause Identified:**
GotSport rankings scraper (`scripts/_archive/scrape_gotsport_rankings.js`) wrote DIRECTLY to `teams_v2`, bypassing:
1. Staging tables
2. V2 normalizers (didn't remove duplicate prefixes like "One FC One FC")
3. Canonical registries (didn't register teams for deduplication)

This created 57,532 orphaned teams with GS rank but no matches.

**Fixes Applied (Using V2 Architecture):**

| Phase | Fix | Count | Speed |
|-------|-----|-------|-------|
| 1 | Team stats recalculated from matches_v2 | 42,674 | 1,215/sec |
| 2 | Birth year mismatches fixed | 25,659 | 1,271/sec |
| 3 | Exact-name duplicates merged | 11 | — |
| 4 | Canonical teams registry populated | **+118,977** | **11,000/sec** |
| 5 | Orphans merged via normalizer logic | **3,751** | 38/sec |
| Prior | Fuzzy-match merges | 1,756 | — |

**Final Data State:**

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Total teams | 155,608 | **150,101** | -5,507 |
| GS-ranked WITH matches | 63,556 | **64,874** | +1,318 |
| Orphaned (GS rank, no matches) | 57,532 | **52,025** | -5,507 |
| Canonical teams registry | 19,275 | **138,252** | +118,977 |

**Key Scripts Created:**
- `scripts/maintenance/populateCanonicalTeams.cjs` - Seed canonical registry (11K/sec)
- `scripts/maintenance/mergeOrphansByNormalizedName.cjs` - Merge via normalizer logic
- `scripts/maintenance/fixDataDisconnect.cjs` - Stats recalculation + birth_year fixes

**New Guardrails Added:**
- Created [GUARDRAILS](docs/1.1-GUARDRAILS_v2.md) v1.1 with Session 76 learnings
- Added canonical registry health check requirement
- Added speed optimization patterns with benchmarks
- Added duplicate prefix detection SQL patterns

**User-Reported Team Fixed:**
**Sporting Wichita 2015 Academy (U11 Girls)**: Now shows 7 matches, 5-0-2, ELO 1543 ✅

**Files Modified:**
- [GUARDRAILS](docs/1.1-GUARDRAILS_v2.md) - Added Session 76 learnings
- [CLAUDE.md](CLAUDE.md) - Added GUARDRAILS reference, Session 76 entry
- New maintenance scripts in `scripts/maintenance/`

---

### Session 75 - Real-Time Data Consistency Fix (February 2, 2026) - COMPLETE ✅

**Goal:** Fix Season Stats and Power Rating not matching actual database values on Team Details page.

**Problems Identified:**
1. Season Stats (14 matches, 6W-7L-1D) didn't match Match History (19 matches, 10W-7L-2D)
2. Power Rating showed stale ELO (1,469, #3,689) instead of current (1,528, #859)

**Root Cause Analysis:**

| Component | Data Source | Issue |
|-----------|-------------|-------|
| Season Stats | `teams_v2.matches_played` | Pre-computed by ELO script (STALE) |
| Match History | `matches_v2` direct query | Real-time (CURRENT) |
| Power Rating | `app_team_profile` view | Depends on view refresh (STALE) |

The ELO script (`recalculate_elo_v2.js`) hadn't run since Jan 30, with 269K+ matches added since.

**Impact:**
- 100+ teams with stats discrepancies
- Power Rating didn't reflect actual team performance
- Users see inconsistent data, lose trust in the app

**Universal Fix (Layer 3 - Presentation):**

Changed `app/team/[id].tsx` to query source tables directly:

```typescript
// ✅ Season Stats - Query matches_v2 directly
const { data: homeStats } = await supabase
  .from("matches_v2")
  .select("home_score, away_score")
  .eq("home_team_id", id)
  .not("home_score", "is", null)
  .gte("match_date", seasonStart);

// ✅ Power Rating - Query teams_v2 directly (bypass view)
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
| Layer 2 (Processing) | ELO Script | ✅ Ran manually, updated teams_v2 |
| Layer 3 (Presentation) | App | ✅ **FIXED** - Queries source tables |

**Results:**

| Metric | Before | After |
|--------|--------|-------|
| Season Stats | 14mp, 6W-7L-1D | **19mp, 10W-7L-2D** |
| ELO Rating | 1,469 | **1,528** |
| National Rank | #3,689 | **#859** ⬆️ 2,830 spots |
| State Rank | #57 | **#10** ⬆️ 47 spots |

**New Principle Added:**
- Principle 23: Real-Time Data for Team Details - Never Trust Pre-Computed Values

**Files Modified:**
- [app/team/[id].tsx](app/team/[id].tsx) - Real-time queries for Season Stats + Power Rating
- [CLAUDE.md](CLAUDE.md) - Added Principle 23, Session 75 entry

**Verification:**
- ✅ Season Stats matches Match History (19mp, 10W-7L-2D)
- ✅ Power Rating shows current ELO (1,528, #859 national)
- ✅ All data from source tables (matches_v2, teams_v2)
- ✅ Works for ANY team from ANY data source
- ✅ No dependency on view refresh timing

---

### Session 74 - HTGSports Division Detection Fix (February 2, 2026) - COMPLETE ✅

**Goal:** Fix HTGSports scraper missing 37 of 38 divisions in Sporting Classic 2025 tournament.

**Problem Identified:**
User reported "Sporting BV Pre-NAL 15 (U11 Boys)" team was missing Sporting Classic 2025 tournament matches. Investigation revealed the HTGSports scraper was only finding 1 division when 38 existed.

**Root Cause:**
The `divisionPattern` regex in `scripts/adapters/htgsports.js` required a hyphen in age groups:
```javascript
// BUG: Regex required "U-11" but site used "U11"
divisionPattern: /U-\d+|2017|2016|.../i
```

The HTGSports site uses formats like "Girls U09 Gold", "Boys U11 Gold" (no dash), but the regex only matched "U-11" (with dash).

**Fix Applied:**
```javascript
// FIXED: Made dash optional with U-?
divisionPattern: /U-?\d{1,2}\b|20[01]\d/i
```

Changed in 3 locations:
- Line 77: Config `divisionPattern`
- Line 345: `filter()` for division dropdown options
- Line 375: `some()` check for identifying division dropdown

**Results:**

| Metric | Before | After |
|--------|--------|-------|
| Divisions found | 1 | **38** |
| Matches scraped | ~10 | **336** |
| Matches processed | 0 | **335** |

**Additional Fixes:**

| Issue | Fix |
|-------|-----|
| Duplicate staging records | Deleted 4 duplicates causing batch insert failure |
| Team name mismatch | Merged "SBV Pre-NAL 15" → canonical "Sporting BV Pre-NAL 15" |
| Checkpoint logic | Only mark events processed when `matches.length > 0` |

**New Principles Added:**
- Principle 20: Division Detection Regex - Universal Pattern
- Principle 21: Checkpoint Logic - Only Mark Processed When Data Found
- Principle 22: Team Name Variations - Same Team, Different Names

**Files Modified:**
- [scripts/adapters/htgsports.js](scripts/adapters/htgsports.js) - Fixed division regex pattern (3 locations)
- [scripts/adapters/_template.js](scripts/adapters/_template.js) - Updated template with correct pattern
- [CLAUDE.md](CLAUDE.md) - Added Principles 20-22, Session 74 entry

**Verification:**
- ✅ Team "Sporting BV Pre-NAL 15" now shows 4 Sporting Classic matches
- ✅ All 38 divisions scraped from tournament
- ✅ Fix is universal - works for ANY source with "U11" or "U-11" format

**Full Lifecycle Audit (All 3 Layers):**

Audited the entire data architecture to ensure universal patterns flow correctly from scraping through presentation.

| Layer | Component | Pattern Used | Status |
|-------|-----------|--------------|--------|
| **Layer 1** | htgsports.js | `/U-?\d{1,2}\b\|20[01]\d/i` | ✅ Fixed |
| **Layer 1** | _template.js | `/U-?\d{1,2}\b\|20[01]\d/i` | ✅ Correct |
| **Layer 1** | scrapeHTGSports.js | `/U-?\d{1,2}\b\|20[01]\d/i` | ✅ Fixed |
| **Layer 1** | heartland.js | NULL score handling | ✅ Correct |
| **Layer 2** | validationPipeline.js | `/\bU[-\s]?(\d+)\b/i` | ✅ Correct |
| **Layer 2** | teamNormalizer.js | `/\bU[-\s]?(\d+)\b/i` (line 242) | ✅ Correct |
| **Layer 2** | clubNormalizer.js | `/^U-?\d+$/i` (line 25) | ✅ Correct |
| **Layer 2** | dataQualityEngine.js | Uses `birth_year` for matching | ✅ Correct |
| **Layer 3** | SQL views | `'U' \|\| (season_year - birth_year)` | ✅ Dynamic |
| **Layer 3** | App filters | Hardcoded U8-U19 (appropriate for UI) | ✅ Correct |

**Key Findings:**
1. All adapters and scrapers now use the universal optional-dash pattern
2. Validation layer uses `birth_year` (integer) for team matching, not `age_group` (string)
3. App views compute `age_group` dynamically from `birth_year + get_current_season_year()`
4. No hardcoded year calculations anywhere in the pipeline
5. Legacy scraper `scrapeHTGSports.js` was also fixed (fallback safety)

**Architecture Verification:**
```
Layer 1: Scrapers extract raw team names + division strings
    ↓ Uses regex: /U-?\d{1,2}\b|20[01]\d/i
Layer 2: Normalizers extract birth_year from patterns
    ↓ Uses regex: /\bU[-\s]?(\d+)\b/i
Layer 3: SQL views compute age_group dynamically
    ↓ Formula: 'U' || (get_current_season_year() - birth_year)
App: Displays pre-computed age_group from views
```

---

### Session 73 - VS Battle Page Fixes (February 2, 2026) - COMPLETE ✅

**Goal:** Fix multiple issues on the VS Battle (Predict) page reported via user screenshots.

**Issues Fixed:**

| Issue | Root Cause | Fix |
|-------|------------|-----|
| Team A card missing name | `loadTeamFromParams` didn't map `display_name` to `team_name` | Added `team_name: data.display_name` transformation |
| Gender showing "M" instead of "Boys" | Raw DB value displayed | Added `GENDER_DISPLAY` conversion throughout page |
| Search not returning results | Query used `team_name` but view has `display_name` | Changed to `.ilike("display_name", ...)` |
| Gender filter not defaulting | Passed DB format to modal expecting display format | Convert with `GENDER_DISPLAY` in `suggestedGender` prop |
| What If sliders not working | Incomplete useEffect dependency array | Added `showWhatIf, homeTeam, awayTeam` to dependencies |
| Team names truncated | `numberOfLines={2}` on Text components | Removed all `numberOfLines` per Principle 4 |
| State filter UX inconsistent | Different pattern than Rankings tab | Implemented type-ahead with chips (same as Rankings) |
| Analytical Factors unclear | Red/green bars had no team indicator | Added legend row showing team colors |

**Key Code Patterns:**

```typescript
// Gender conversion (universal pattern)
import { GENDER_DISPLAY, GENDER_FROM_DISPLAY, GenderType } from "../../lib/supabase.types";

// Display: DB format → UI format
{GENDER_DISPLAY[team.gender as GenderType] ?? team.gender}

// Query: UI format → DB format
const dbGender = GENDER_FROM_DISPLAY[selectedGender];
if (dbGender) dbQuery = dbQuery.eq("gender", dbGender);

// Transform query results
const transformed = (data || []).map((row: any) => ({
  ...row,
  team_name: row.display_name,
  gender: GENDER_DISPLAY[row.gender as GenderType] ?? row.gender,
}));
```

**Analytical Factors Legend:**
```
┌─────────────────────────────────────────┐
│  🟢 Team A Name   │   🔴 Team B Name    │
├─────────────────────────────────────────┤
│  ELO Rating    [██████     ]     -27%   │
│  Goal Diff     [           ]       0%   │
│  ...                                    │
└─────────────────────────────────────────┘
```

**Files Modified:**
- [app/predict/index.tsx](app/predict/index.tsx) - All VS Battle fixes + Analytical Factors legend

---

### Session 72 - NULL Score Fix for Scheduled Matches (February 2, 2026) - COMPLETE ✅

**Goal:** Fix the Upcoming section not showing scheduled matches for teams.

**Problem Identified:**
User reported "Sporting BV Pre-NAL 15 (U11 Boys)" showed 0 upcoming matches despite spring games being published. Investigation revealed a critical bug affecting ALL scheduled matches across the entire system.

**Root Cause:**
Both `validationPipeline.js` and `dataQualityEngine.js` were converting NULL scores to 0:
```javascript
// BUG (was in both files)
home_score: game.home_score ?? 0,  // NULL → 0
away_score: game.away_score ?? 0,  // NULL → 0
```

This made 9,210 scheduled matches appear as played 0-0 games, hiding them from the Upcoming section.

**App Logic:**
```javascript
// app/team/[id].tsx determines upcoming vs recent:
const hasScores = match.home_score !== null && match.away_score !== null &&
                  (match.home_score > 0 || match.away_score > 0);
// NULL scores + future date = upcoming
// 0-0 scores = appears played (wrong for scheduled!)
```

**Fixes Applied:**

| File | Fix |
|------|-----|
| `scripts/daily/validationPipeline.js` | Remove `?? 0` fallback, preserve NULL |
| `scripts/universal/dataQualityEngine.js` | Remove `?? 0` fallback, preserve NULL |
| `scripts/universal/dataQualityEngine.js` | Fix needsUpdate logic for score updates |
| `scripts/adapters/heartland.js` | Return NULL for matches without scores |
| Database schema | `ALTER TABLE matches_v2 ALTER COLUMN home_score DROP NOT NULL` |
| Database data | Updated 9,210 future 0-0 matches to NULL scores |

**Key Code Changes:**

```javascript
// validationPipeline.js lines 691-692 (FIXED)
home_score: game.home_score,  // Keep NULL for scheduled matches
away_score: game.away_score,  // Keep NULL for scheduled matches

// dataQualityEngine.js needsUpdate logic (FIXED)
const existingHasNoScores = existing.home_score === null || existing.away_score === null ||
                            (existing.home_score === 0 && existing.away_score === 0);
const newHasRealScores = (newHomeScore !== null && newHomeScore > 0) ||
                         (newAwayScore !== null && newAwayScore > 0);
```

**Impact:**
- 9,210 scheduled matches now correctly appear in Upcoming section
- Future scheduled matches will be preserved with NULL scores
- Teams now show their upcoming games properly

**Documentation Added:**
- New Principle 6b: "NULL Scores vs 0-0 Scores"
- Updated Principle 6: Changed "0-0 scores" to "NULL scores"

**Files Modified:**
- [scripts/daily/validationPipeline.js](scripts/daily/validationPipeline.js) - NULL score preservation
- [scripts/universal/dataQualityEngine.js](scripts/universal/dataQualityEngine.js) - NULL score preservation + update logic
- [scripts/adapters/heartland.js](scripts/adapters/heartland.js) - Capture scheduled matches with NULL scores
- [CLAUDE.md](CLAUDE.md) - Added Principle 6b documentation

---

### Session 71 - Compare Chart Fix (February 1, 2026) - COMPLETE ✅

**Goal:** Fix the Compare chart in the Ranking Journey feature to properly overlay SoccerView and GotSport ranking data.

**Problem:**
- gifted-charts LineChart failed to reliably render two overlaid lines
- 10+ hours of attempts with `dataSet`, `data`/`data2`, `interpolateMissingValues`, etc.
- Issues: disconnected dots, gray area fills, incorrect rendering on State scope

**Root Cause:**
react-native-gifted-charts has documented issues with multi-line charts of different data lengths (GitHub issue #975, fixed in v1.4.56, but still had rendering problems with our use case).

**Solution:**
Use `react-native-chart-kit` (ChartKitLineChart) for Compare view ONLY:
- SoccerView individual chart: Still uses gifted-charts ✅
- GotSport individual chart: Still uses gifted-charts ✅
- Compare chart: Uses chart-kit for reliable multi-line rendering ✅

**Key Implementation Details:**
```javascript
// Compare view uses ChartKitLineChart
<ChartKitLineChart
  data={{
    labels: dateLabels,  // ~7 sampled date labels
    datasets: [
      { data: svNormalizedData, color: () => "#3B82F6", strokeWidth: 2.5 },
      { data: gsNormalizedData, color: () => "#f59e0b", strokeWidth: 3 },
    ],
  }}
  bezier
  withDots={true}
  withShadow={false}
  formatYLabel={formatCompareYLabel}
/>
```

**Universal Design:**
- Combines dates from ANY sources dynamically
- Same normalization logic for all sources
- Same forward-fill algorithm for any dataset
- No source-specific conditionals
- Easily extensible to N sources

**Files Modified:**
- [app/team/[id].tsx](app/team/[id].tsx) - Compare chart now uses chart-kit

---

### Session 70 - Ranking Journey Chart Fix + Rank Calculation Methodology (February 1, 2026) - COMPLETE ✅

**Goal:** Fix Ranking Journey chart Y-axis issues and correct fundamental rank calculation methodology.

**Problem Identified:**
- Chart showed team at #1 rank when they were never #1
- Historical ranks were calculated against CHANGING pool (early season = few teams = artificially high ranks)
- Y-axis padding was based on range, causing #1 to appear when actual best was #304

**Root Cause Analysis:**
The historical rank backfill used pool-relative ranking: "rank among teams with snapshots on that date"
- Early season: 100 teams had entries → team ranked #5
- Current: 45,000 teams → same ELO ranks #3,551

**Solution - GotSport-Inspired Consistent Baseline:**
Adopted GotSport's approach: Use a CONSISTENT baseline for all historical ELO values.
- For each historical ELO, calculate rank against TODAY's full team pool
- This gives: "If your team had this ELO today, what rank would they be?"
- Results are meaningful and comparable across time

**Results (Sporting BV Pre-NAL 15):**

| Date | ELO | Nat Rank | State | Notes |
|------|-----|----------|-------|-------|
| 2025-08-08 | 1484 | #2,967 | #44 | Season start |
| 2025-10-04 | 1558 | **#304** | #6 | PEAK (top 7%) |
| 2025-11-09 | 1501 | #1,879 | #28 | After losses |
| 2026-02-01 | 1469 | #3,551 | #55 | Current |

**Chart Y-Axis Fix:**
```javascript
// OLD: 10% of RANGE (huge padding for large ranges)
const padding = Math.max(Math.ceil(range * 0.1), 1);

// NEW: 10% of actual VALUES (proportional padding)
const topPadding = Math.max(Math.ceil(minRank * 0.1), 1);
const bottomPadding = Math.max(Math.ceil(maxRank * 0.1), 5);
```

**Performance:**
- 193,399 rank records updated
- Processing time: ~5 minutes (650 records/second)
- Binary search + batch CASE updates

**Universal Solution Created:**
`scripts/maintenance/recalculateHistoricalRanks.cjs`
- Works for ANY team from ANY source
- Uses binary search (O(log n)) for fast rank lookup
- Batch updates (5000 rows per query)
- No hardcoded values or source-specific logic

**Files Modified:**
- [app/team/[id].tsx](app/team/[id].tsx) - Chart Y-axis padding fix
- [scripts/maintenance/recalculateHistoricalRanks.cjs](scripts/maintenance/recalculateHistoricalRanks.cjs) - Universal rank recalculation

---

### Session 69 - Home Tab Timeout Fix + Staging Backlog Clear (February 1, 2026) - COMPLETE ✅

**Issues Fixed:**

**1. Home Tab Timeout (PostgreSQL 57014)**
- Root cause: 9 missing indexes on materialized views
- Solution: `scripts/maintenance/ensureViewIndexes.js` - universal self-healing index maintenance
- Added to nightly pipeline for automatic repair

**2. Staging Backlog (31,421 unprocessed records)**
- Root cause: `learned_patterns` table missing, validation pipeline stalled
- Solution: Created table + bulk SQL processor

**Backlog Processing Results (27 seconds):**
| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Unprocessed staging | 31,421 | **0** | ✅ Cleared |
| teams_v2 | 147,794 | **155,408** | +7,614 |
| matches_v2 | 304,624 | **314,114** | +9,490 |

**V1→V2 Migration Audit:**
- V1 `match_results_deprecated`: 470,641 (archived)
- V2 `matches_v2`: 314,114 (production)
- Difference: 156K = intentional cleanup (duplicates, garbage dates, failed validation)

**Universal Solutions Created:**

| Script | Purpose | Speed |
|--------|---------|-------|
| `scripts/maintenance/ensureViewIndexes.js` | Self-healing index maintenance | <1 min |
| `scripts/_debug/fastBulkProcess.js` | Clear staging backlogs | 23K/27s |
| `scripts/migrations/040_create_learned_patterns.sql` | Adaptive learning table | — |

**Index Audit Results:**
| View | Expected | Before | After |
|------|----------|--------|-------|
| app_rankings | 5 | 2 | **5** |
| app_team_profile | 7 | 1 | **7** |
| Others | 9 | 9 | 9 |
| **Total** | **21** | **12** | **21** |

**Files Created/Modified:**
- `scripts/maintenance/ensureViewIndexes.js` - Universal index maintenance
- `scripts/_debug/fastBulkProcess.js` - Bulk staging processor (23K records in 27s)
- `scripts/_debug/investigateStagingBacklog.js` - Diagnostic tool
- `.github/workflows/daily-data-sync.yml` - Added index check to pipeline
- All docs synced with accurate row counts

---

### Session 68 - Rating Journey Chart Redesign + QC (January 31 - February 1, 2026) - COMPLETE ✅

**Goal:** Redesign Rating Journey widget with two-level filter system for world-class UX.

**Features Implemented:**

| Feature | Description |
|---------|-------------|
| Source Selector | Segmented control: SV \| GotSport \| Both (Compare) |
| Scope Selector | Toggle: National \| State |
| Gradient Fills | Subtle fills under chart lines (GotSport: amber 15%, Compare: green 10%) |
| Dynamic Stats | Labels update to show "National" or "State" based on scope |
| Normalized Compare | Both datasets scaled 0-100 for overlay comparison |

**Source Selector UI:**
- Clean segmented control (replaced cramped pills)
- Short labels: "SV", "GotSport", "Both"
- Icon + text layout with active state colors
- SoccerView (blue), GotSport (amber), Both (green)

**QC Session (February 1, 2026):**

| Fix | Description |
|-----|-------------|
| Chart Y-Axis Alignment | Charts now show RANK values (#3,689) not ELO (1469) |
| Vertical Scale Added | All charts display rank values on Y-axis with `formatYLabel` |
| Inverted Charts | Up = better rank (#1 at top, not bottom) |
| Compare Stats Simplified | Only "SoccerView" and "GotSport" labels in Compare mode |
| Rank History Backfill | Re-ran backfillRankHistory.js - 389,846 records across 150 dates |
| Today's Snapshot | Captured accurate rank snapshot (124,178 teams) |

**Chart Y-Axis Solution:**
```javascript
// Invert ranks: lower rank (better) appears higher on chart
const rawRanks = sampled.map((p) => getSVRank(p) || 1);
const maxRank = Math.max(...rawRanks);
const minRank = Math.min(...rawRanks);
const data = rawRanks.map((r) => maxRank + minRank - r);

// Format Y-axis to show actual rank values
formatYLabel: (val) => `#${formatNumber(maxRank + minRank - Number(val))}`
```

**Data Verification (Sporting BV Pre-NAL 15):**
- teams_v2: National #3,689, State #57 ✓
- rank_history_v2 (Feb 1): National #3,689, State #57 ✓
- Chart displays aligned with stats ✓

**Files Modified:**
- [app/team/[id].tsx](app/team/[id].tsx) - Rating Journey with QC fixes
- [scripts/onetime/backfillRankHistory.js](scripts/onetime/backfillRankHistory.js) - Historical rank calculation
- [scripts/daily/captureRankSnapshot.js](scripts/daily/captureRankSnapshot.js) - v3.1 with SoccerView ranks

---

### Session 67 - Team Details UI Refinements (January 31, 2026) - COMPLETE ✅

**Goal:** Polish Team Details page UI based on user feedback and screenshots.

**Changes Implemented:**

| Component | Fix | Details |
|-----------|-----|---------|
| Season Stats | Fixed 4-box layout | `width: "23%"` + `justifyContent: "space-between"` - all on one row |
| Gender display | M→Boys, F→Girls | Conversion logic in `getTeamMeta()` function |
| GotSport Rankings card | Aligned headers | Both sections use identical `gotsportHeader` style |
| Ranking Journey icon | Custom bar chart | Gold outlined 3-bar icon with glow effect |
| Help icons | Standardized size | All help icons now `size={18}` across page |
| Icon containers | Fixed alignment | 28x24 container ensures icons align left-to-right |

**Custom Bar Chart Icon:**
```javascript
barChartIcon: {
  flexDirection: "row", alignItems: "flex-end", gap: 2,
  width: 22, height: 22, justifyContent: "center",
  shadowColor: "#f59e0b", shadowOpacity: 0.6, shadowRadius: 4,
},
barChartBar: {
  width: 6, backgroundColor: "transparent",
  borderWidth: 1.5, borderColor: "#f59e0b", borderRadius: 2,
},
```

**Files Modified:**
- [app/team/[id].tsx](app/team/[id].tsx) - All UI refinements

**UI Protection Protocol:** Backups created before all modifications per Principle 17.

---

### Session 66 - V1→V2 UI Migration Fix (January 31, 2026) - COMPLETE ✅

**Goal:** Fix Team Details page crash caused by V1 table references after database migration.

**Problem Identified:**
- Team Details page crashed with: "Could not find the table 'public.team_elo'"
- App code was still using V1 tables that were archived/deleted in Session 50
- Uncommitted UI features (League/Tournament grouping) were lost during troubleshooting

**Root Cause:**
The app's `app/team/[id].tsx` was never updated when V1 tables were archived:
- `team_elo` → archived to `team_elo_deprecated` then dropped
- `match_results` → archived to `match_results_deprecated`
- `rank_history` → migrated to `rank_history_v2`

**Solution Implemented:**

| V1 Reference | V2 Replacement | Notes |
|--------------|----------------|-------|
| `team_elo` | `app_team_profile` | Map `display_name` → `team_name` |
| `match_results` | `matches_v2` + joins | Join teams_v2 for names |
| `rank_history` | `rank_history_v2` | Map missing fields to null |

**UI Features Restored:**
- Team name display (was showing "Unknown")
- Match history with proper team names
- League/Tournament grouping with event cards
- Win-loss-draw records per event
- Date ranges for events

**Files Modified:**
- [app/team/[id].tsx](app/team/[id].tsx) - Complete V1→V2 migration + restored grouping UI

**New Principle Added:**
- Principle 16: "App UI Must Use V2 Views - NEVER V1 Tables"

**Lessons Learned:**
1. NEVER run `git checkout` on files with uncommitted features without checking first
2. Database migrations MUST include app code updates in same PR
3. Add schema validation tests to catch V1 references

---

### Session 65 - Ranking Journey Chart Fix (January 31, 2026) - COMPLETE ✅

**Goal:** Fix the "My Team's Journey" chart to show historical ranking data instead of just today's snapshot.

**Problem Identified:**
- Chart showed "Rank history coming soon" message despite having a V2 snapshot system
- App was reading from V1 `rank_history` table (deprecated/deleted)
- V2 `rank_history_v2` table exists and is populated by nightly `captureRankSnapshot.js`
- GotSport ranks are external data - cannot be backfilled (only captured via daily snapshots)

**Solution Implemented:**

| Change | Description |
|--------|-------------|
| Fixed data source | Changed from `rank_history` (V1) to `rank_history_v2` (V2) |
| ELO history backfill | Created and ran `backfillEloHistory.js` - 171,712 records |
| Historical coverage | ELO data now spans Aug 1, 2025 → Jan 31, 2026 (6 months) |

**Data State After Fix:**

| Metric | Records | Date Range |
|--------|---------|------------|
| ELO History | 416,904 | 2025-08-01 → 2026-01-31 |
| GotSport Rank | 242,198 | 2026-01-30 only (accumulating) |

**Why GotSport Rank Can't Be Backfilled:**
GotSport ranks are external data from their proprietary algorithm. Unlike ELO (which we calculate from matches), we cannot reconstruct historical GotSport ranks. The chart will populate as daily snapshots accumulate.

**Files Created/Modified:**
- [scripts/onetime/backfillEloHistory.js](scripts/onetime/backfillEloHistory.js) - NEW: Replay ELO from match history
- [app/team/[id].tsx](app/team/[id].tsx) - Fixed data source to V2 table

**Chart Behavior:**
- Shows "Rank history coming soon" until 2+ days of GotSport rank data exists
- Will automatically populate as nightly `captureRankSnapshot.js` runs
- By next week, meaningful trend line will be visible

---

### Session 64 - Adaptive Learning Integration (January 31, 2026) - COMPLETE ✅

**Goal:** Wire adaptive learning INTO the data quality pipeline so the system improves over time.

**Context:** The adaptive learning INFRASTRUCTURE existed but was NOT integrated:
- `scripts/universal/adaptiveLearning.js` - EXISTS (364 lines)
- `scripts/migrations/040_create_learned_patterns.sql` - EXISTS
- Normalizers - DID NOT use adaptive learning
- dataQualityEngine.js - DID NOT call feedback functions

**Integration Completed:**

| Component | Change |
|-----------|--------|
| `adaptiveLearning.js` | Fixed `supabase.raw()` calls (invalid method) → proper update patterns |
| `teamNormalizer.js` | Added `initializeLearnedPatterns()` + `extractClubName()` checks learned prefixes first |
| `eventNormalizer.js` | Added `initializeLearnedPatterns()` + `determineEventType()` checks learned keywords first |
| `dataQualityEngine.js` | Imports + initializes learned patterns before processing |
| `dataQualityEngine.js` | Records `recordSuccess()` on canonical match |
| `dataQualityEngine.js` | Records `recordFailure()` on duplicate not prevented by registry |
| `daily-data-sync.yml` | Added "Learn Patterns (Weekly)" step to weekly-dedup-check job |
| `daily-data-sync.yml` | Added "Adaptive Learning" section to summary |

**The Feedback Loop:**

```
Data In → Normalize (uses patterns) → Resolve (uses canonical) → Create/Match → Learn → Prevent Future Duplicates
     ↑                                                                                          │
     └─────────────────────────── Patterns feed back ───────────────────────────────────────────┘
```

**Key Design Decisions:**
- **Non-blocking feedback**: `recordSuccess`/`recordFailure` use `.catch(() => {})` - never slow down processing
- **Sync performance preserved**: Patterns loaded once async before bulk ops, then used synchronously
- **Graceful degradation**: If learned_patterns table doesn't exist, normalizers work normally
- **Weekly learning**: Patterns re-learned every Sunday from existing data

**New CLI Commands:**
```bash
# Bootstrap patterns from existing data (run after deploying migration)
node scripts/universal/adaptiveLearning.js --learn-teams --source all
node scripts/universal/adaptiveLearning.js --learn-events --source all
```

**Files Modified:**
- [scripts/universal/adaptiveLearning.js](scripts/universal/adaptiveLearning.js) - Fixed Supabase methods
- [scripts/universal/normalizers/teamNormalizer.js](scripts/universal/normalizers/teamNormalizer.js) - Adaptive learning integration
- [scripts/universal/normalizers/eventNormalizer.js](scripts/universal/normalizers/eventNormalizer.js) - Adaptive learning integration
- [scripts/universal/dataQualityEngine.js](scripts/universal/dataQualityEngine.js) - Pattern init + feedback
- [.github/workflows/daily-data-sync.yml](.github/workflows/daily-data-sync.yml) - Learn Patterns step

**DEPLOYMENT REQUIRED:**
Run migration before next nightly sync:
```sql
-- In Supabase SQL Editor, run contents of:
-- scripts/migrations/040_create_learned_patterns.sql
```

Then bootstrap patterns:
```bash
node scripts/universal/adaptiveLearning.js --learn-teams --source all
node scripts/universal/adaptiveLearning.js --learn-events --source all
```

**Verification Checklist:**
- [ ] `learned_patterns` table exists
- [ ] `node scripts/universal/dataQualityEngine.js --process-staging --limit 10 --dry-run` shows "Patterns loaded"
- [ ] Weekly GitHub Actions shows "Adaptive Learning" section in summary

---

### Session 63 - QC Testing & Universal Discovery (January 30, 2026) - COMPLETE ✅

**Goal:** Complete QC testing, fix League Standings page errors, verify data integrity, and make event discovery truly universal.

**Issues Fixed:**

| Issue | Root Cause | Fix |
|-------|------------|-----|
| Season Stats math discrepancy | Used stored `team.matches_played` | Calculate from actual matches |
| League Standings crash | Typo `tournament.season_id_id` | Fixed to `tournament.season_id` |
| League Standings column error | Wrong column `season` | Changed to `season_id` |
| HTGSports static event list | Manual maintenance required | Universal database-based discovery |

**Universal Event Discovery (NEW):**

Added `discoverEventsFromDatabase()` to core engine - works for ANY source:

```javascript
// Extracts prefix from matchKeyFormat (e.g., "htg-{eventId}" -> "htg")
const matchKeyPrefix = this.adapter.matchKeyFormat?.split('-')[0];
const sourcePattern = `${matchKeyPrefix}-%`;

// Finds events with recent activity filtered by source
await supabase.from("matches_v2")
  .select("league_id, tournament_id")
  .like("source_match_key", sourcePattern);
```

**Discovery by source:**
| Source | Matches | Prefix |
|--------|---------|--------|
| gotsport | 9,268 | `gotsport` |
| htgsports | 5,224 | `htg` |
| heartland | 5,129 | `heartland` |

**Adaptive Learning Infrastructure (NEW):**

Created future-proof adaptive learning system:

| Component | Purpose |
|-----------|---------|
| `scripts/universal/adaptiveLearning.js` | Core learning engine |
| `scripts/migrations/040_create_learned_patterns.sql` | Database schema |
| `learned_patterns` table | Stores patterns with confidence scores |

**Learning Types:**
- Team name patterns (club prefixes, birth year formats, gender indicators)
- Event classification (league vs tournament keywords)
- Feedback loop (success/failure adjusts confidence)
- Auto-cleanup (low-confidence patterns removed)

**Usage:**
```bash
node scripts/universal/adaptiveLearning.js --learn-teams --source htgsports
node scripts/universal/adaptiveLearning.js --classify "KC Spring Classic 2026"
```

**Files Created/Modified:**
- `scripts/universal/coreScraper.js` - Added universal `discoverEventsFromDatabase()`
- `scripts/universal/adaptiveLearning.js` - **NEW** Adaptive learning engine
- `scripts/migrations/040_create_learned_patterns.sql` - **NEW** Learning DB schema
- `scripts/adapters/*.js` - All adapters now use universal discovery
- `lib/leagues.ts` - Fixed column name typos
- `app/team/[id].tsx` - Fixed Season Stats calculation

**Verification:**
- ✅ Universal discovery works for ALL sources
- ✅ No manual static list maintenance needed
- ✅ Adaptive learning stores patterns for improvement
- ✅ Data integrity 100% vs official Heartland website
- ✅ No hardcoded source-specific logic

---

### Session 62 - Self-Learning Canonical Registries (January 30, 2026) - COMPLETE ✅

**Goal:** Fix the gap where canonical registries were built but empty, causing duplicates to be DETECTED but not PREVENTED.

**Problem Identified:**
- canonical_events: 4 rows (Heartland only)
- canonical_teams: 0 rows
- canonical_clubs: 0 rows

This meant every new data source would create the same duplicate problems because there was no "known good" reference data.

**Fixes Applied:**

| Fix | Description | Status |
|-----|-------------|--------|
| **Fix 1** | Self-learning in `mergeTeams.js` - auto-adds merged names to canonical_teams | ✅ |
| **Fix 1b** | Self-learning in `mergeEvents.js` - auto-adds merged names to canonical_events | ✅ |
| **Fix 2** | `seedCanonicalRegistries.js` - bulk SQL bootstrap (20K records in seconds) | ✅ |
| **Fix 3** | `dataQualityEngine.js` - adds new teams/events to registry after creation | ✅ |
| **Fix 4** | Confidence-based auto-merge in `teamDedup.js` (≥0.95 similarity) | ✅ |
| **Fix 5** | Weekly registry growth report in GitHub Actions | ✅ |

**Canonical Registry Results (Before → After):**
| Registry | Before | After | Change |
|----------|--------|-------|--------|
| canonical_teams | 0 | **19,271** | +19,271 |
| canonical_events | 4 | **1,795** | +1,791 |
| canonical_clubs | 0 | **7,301** | +7,301 |

**Key Technical Decisions:**
- Used bulk SQL `INSERT...SELECT` instead of row-by-row loops (20K records in 3 seconds vs 30+ minutes)
- Auto-merge threshold: ≥0.95 similarity + same birth_year + same gender
- Review threshold: 0.85-0.95 similarity (flagged for human review)

**Files Created/Modified:**
- `scripts/onetime/seedCanonicalRegistries.js` - Bulk SQL bootstrap script
- `scripts/maintenance/mergeTeams.js` - Added self-learning
- `scripts/maintenance/mergeEvents.js` - Added self-learning
- `scripts/universal/dataQualityEngine.js` - Added registry population on create
- `scripts/universal/deduplication/teamDedup.js` - Added auto-merge and review modes
- `.github/workflows/daily-data-sync.yml` - Added registry growth reporting

**New CLI Commands:**
```bash
# Bootstrap canonical registries (bulk SQL - fast)
node scripts/onetime/seedCanonicalRegistries.js --dry-run
node scripts/onetime/seedCanonicalRegistries.js

# Auto-merge high-confidence team duplicates
node scripts/universal/deduplication/teamDedup.js --auto-merge --dry-run
node scripts/universal/deduplication/teamDedup.js --auto-merge --execute

# Find duplicates needing human review (0.85-0.95 similarity)
node scripts/universal/deduplication/teamDedup.js --review-candidates
```

**Impact:** Future data sources will now benefit from the canonical registry:
1. When a new team comes in, it checks canonical_teams first
2. If found (exact or alias match), uses existing team_v2_id
3. If not found, creates new team AND adds to registry
4. When duplicates are merged, merged names become aliases for prevention

---

### Session 61 - Alphanumeric Team ID Fix (January 30, 2026) - COMPLETE ✅

**Goal:** Fix missing matches caused by restrictive regex that only matched numeric team IDs.

**Problem:** User reported that their son's team (Sporting BV Pre-NAL 15) showed 7 league matches instead of 8. TeamSnap screenshot proved the Sep 14, 2025 match against Union KC Jr Elite B15 existed (4-1 win).

**Root Cause:** `scripts/adapters/heartland.js` used regex `^\d+` which only matched numeric team IDs. The Sep 14 match had team ID "711A" (alphanumeric), causing it to be skipped.

**Fix Applied:**
```javascript
// Changed from: /^(\d+)\s+/  (only numeric)
// Changed to:   /^([A-Za-z0-9]+)\s+/  (alphanumeric)
```

**Results:**
| Metric | Before | After |
|--------|--------|-------|
| Team league matches | 7 | **8** |
| Record | 4W-0D-3L | **5W-0D-3L** |
| Points | 12 | **15** |

**Impact:** 64 matches per Heartland subdivision were being silently skipped due to alphanumeric team IDs.

**Documentation Updated:**
- [x] Added Principle 10 to CLAUDE.md (Alphanumeric Team ID Extraction)
- [x] Added anti-pattern #9 to UNIVERSAL_DATA_QUALITY_SPEC.md
- [x] Added adapter guideline to DATA_SCRAPING_PLAYBOOK.md
- [x] Added Session 61 entry to SESSION_HISTORY.md

---

### Session 60 - Universal Data Quality System (January 30, 2026) - COMPLETE ✅

**Goal:** Implement Universal Data Quality System per `docs/2-UNIVERSAL_DATA_QUALITY_SPEC.md`

**Constraint:** Backend only - NO changes to /app/ or /components/

**ALL PHASES COMPLETE - VERIFIED IN PRODUCTION:**

| Phase | Description | Status |
|-------|-------------|--------|
| **Phase 0** | Immediate Fixes | ✅ COMPLETE |
| **Phase 1** | Canonical Registries | ✅ COMPLETE |
| **Phase 2** | Normalizers | ✅ COMPLETE |
| **Phase 3** | Core Engine | ✅ COMPLETE |
| **Phase 4** | Deduplication | ✅ COMPLETE |
| **Phase 5** | Infrastructure Population | ✅ COMPLETE |
| **Phase 6** | Pipeline Integration | ✅ VERIFIED |

**Production Verification:**
- Workflow Run: Daily Data Sync #18
- Duration: 39m 1s
- Status: SUCCESS
- Engine: dataQualityEngine.js (universal)

**Phase 5 Deliverables:**
- [x] `scripts/onetime/populateClubs.js` - Populate clubs from team names
- [x] `scripts/onetime/rebuildLeagues.js` - Normalize league metadata
- [x] 100% teams_v2.club_id linked (was 93%, now 100%)
- [x] 2,232 new clubs created
- [x] 38 leagues updated with state/region metadata

**Phase 5 Results:**
| Metric | Before | After |
|--------|--------|-------|
| Teams with club_id | 137,357 (93%) | **147,706 (100%)** |
| Clubs | 122,418 | **124,650** |
| Leagues with state | ~0 | **35** |

**Phase 4 Deliverables:**
- [x] `scripts/universal/deduplication/matchDedup.js` - Detect/resolve duplicate matches
- [x] `scripts/universal/deduplication/teamDedup.js` - Detect/resolve duplicate teams
- [x] `scripts/universal/deduplication/eventDedup.js` - Detect/resolve duplicate events
- [x] `scripts/maintenance/mergeTeams.js` - Manual team merge utility
- [x] `scripts/maintenance/mergeEvents.js` - Manual event merge utility

**CLI Usage:**
```bash
# Populate clubs (one-time or catch-up)
node scripts/onetime/populateClubs.js --dry-run
node scripts/onetime/populateClubs.js

# Rebuild leagues (normalize metadata)
node scripts/onetime/rebuildLeagues.js --dry-run
node scripts/onetime/rebuildLeagues.js

# Deduplication reports
node scripts/universal/deduplication/matchDedup.js --report
node scripts/universal/deduplication/teamDedup.js --report
node scripts/universal/deduplication/eventDedup.js --report

# Manual merge utilities
node scripts/maintenance/mergeTeams.js --find "team name"
node scripts/maintenance/mergeTeams.js --keep <uuid> --merge <uuid1,uuid2> --execute
node scripts/maintenance/mergeEvents.js --type league --find "Heartland"
```

**Phase 6 Deliverables:**
- [x] `.github/workflows/daily-data-sync.yml` updated to use dataQualityEngine
- [x] New job: `weekly-dedup-check` runs Sundays (match/team/event dedup reports)
- [x] Legacy fallback: validationPipeline.js runs if dataQualityEngine fails
- [x] New workflow input: `run_dedup` to manually trigger dedup check
- [x] Summary section updated with engine info and dedup results

**Nightly Pipeline (Updated):**
```
Phase 1: Data Collection (parallel scrapers → staging_games)
Phase 2: Data Quality Engine (dataQualityEngine.js → matches_v2)
Phase 2.25: Weekly Dedup Check (Sundays only)
Phase 2.5: Inference Linkage (inferEventLinkage.js)
Phase 3: ELO Calculation (recalculate_elo_v2.js)
Phase 4: Prediction Scoring (scorePredictions.js)
Phase 5: Refresh Views (refresh_app_views())
```

**Database State (Final - Verified):**
| Table | Rows | Notes |
|-------|------|-------|
| teams_v2 | 147,794 | 100% have club_id |
| matches_v2 | 304,624 | All linked |
| clubs | 124,650 | — |
| leagues | 280 | 38 with state metadata |
| tournaments | 1,728 | — |
| canonical_events | 1,795 | Event registry |
| staging_games | 75,215 | 31,421 unprocessed |

**Universal Data Quality System - FULLY OPERATIONAL**

The nightly pipeline now:
1. Scrapes data from 3 sources (GotSport, HTGSports, Heartland)
2. Processes staging via `dataQualityEngine.js`
3. Falls back to legacy pipeline if needed
4. Runs weekly deduplication checks (Sundays)
5. Recalculates ELO ratings
6. Refreshes all materialized views

---

### Session 59 - Heartland League Duplicate Fix (January 30, 2026) - COMPLETE

**Goal:** Fix duplicate Heartland leagues appearing on Team Details page.

**Problem Identified:**
Two different scrapers created separate league entries for the same real-world league:
- `scrapeHeartlandLeague.js` → "Heartland Soccer League 2025" (source_event_id: `heartland-league-2025`)
- `scrapeHeartlandResults.js` → "Heartland Premier League 2025" (source_event_id: `heartland-premier-2025`)

This caused teams (e.g., Sporting BV Pre-NAL 15) to show TWO Heartland leagues in their Match History.

**Root Cause Analysis:**
- Same match recorded twice with different `source_match_key` formats
- Different team name formatting led to different `team_id` lookups
- Both matches linked to same away team but different home team entries

**Fix Applied:**

| Action | Count |
|--------|-------|
| Duplicate matches deleted | 1,581 |
| Unique matches migrated | 446 |
| League entry deleted | "Heartland Soccer League 2025" |

**Script Created:** `scripts/maintenance/mergeHeartlandLeagues.js`
- Dry-run mode: `--dry-run`
- Matches duplicates using Heartland source IDs from `source_match_key`
- Deletes duplicates, migrates unique matches, removes empty league

**Database Impact:**
- `matches_v2`: 300,564 → 295,575 (-4,989 from duplicates + other cleanup)
- `leagues`: 280 → 279 (removed "Heartland Soccer League 2025")

**Documentation Updated:**
- Added Principle 9: "Prevent Duplicate League Entries"
- Added `mergeHeartlandLeagues.js` to maintenance scripts

---

### Session 58 - GitHub Actions Fixes & Security Hardening (January 30, 2026) - COMPLETE

**Goal:** Fix failing GitHub Actions workflows and address Supabase security vulnerabilities.

**Issue 1: Daily Data Sync Failures** ✅ FIXED
| Problem | Root Cause | Fix |
|---------|------------|-----|
| GotSport timeout (45 min) | CLI flag mismatch `--active` vs `--active-only` | Fixed flag in workflow |
| Refresh Views crash | Missing `refresh_views_manual.js` + ESM issue | Committed missing file |
| Rank Snapshot crash | Wrong script path + ESM dotenv | Fixed path + import |

**Issue 2: Supabase Security (27 errors + 32 warnings)** ✅ FIXED
| Category | Count | Fix |
|----------|-------|-----|
| RLS disabled | 15 tables | Enabled RLS + created policies |
| Security Definer views | 6 views | (Lower priority - read-only) |
| Function search paths | 23 functions | `SET search_path = public` |
| Permissive RLS policies | 3 policies | Dropped overly permissive policies |

**Issue 3: Performance Optimization** ✅ COMPLETE
Rewrote `syncActiveEvents.js` v3.0 with parallel processing:

| Before (v2.0) | After (v3.0) |
|---------------|--------------|
| Sequential events | **5 concurrent** events |
| Sequential groups | **3 concurrent** groups per event |
| Fixed 1500-3000ms delay | **Reactive 300ms** base (backs off on 429) |
| Per-event DB writes | **Single bulk insert** at end |
| ~45 min for 79 events | **Target: 10-20 min** |

**Files Created/Modified:**
- `scripts/migrations/enable_rls_security.sql` - RLS migration (run in Supabase)
- `scripts/daily/syncActiveEvents.js` - v3.0 parallel scraper
- `scripts/refresh_views_manual.js` - View refresh script
- `.github/workflows/daily-data-sync.yml` - Fixed flags + timeout (90 min)
- `.github/workflows/capture-rank-snapshot.yml` - Fixed script path

**Database Changes:**
- RLS enabled on all 43 tables
- Policies created for public read, service role write
- Staging tables restricted to service role only

---

### Session 57 - Universal Data Pipeline Framework (January 30, 2026) - COMPLETE

**Goal:** Build a source-agnostic Universal Data Pipeline per specification doc.

**Phase 1: Audit** ✅ COMPLETE
- Analyzed 135+ scripts across 6 directories
- Documented 12 critical patterns to preserve
- Created [docs/PHASE1_AUDIT_REPORT.md](docs/PHASE1_AUDIT_REPORT.md)

**Phase 2: Framework Design** ✅ COMPLETE
- Designed adapter schema specification
- Designed core engine architecture
- Created [docs/PHASE2_FRAMEWORK_DESIGN.md](docs/PHASE2_FRAMEWORK_DESIGN.md)

**Phase 3: Build Framework** ✅ COMPLETE

| File | Purpose | Status |
|------|---------|--------|
| `scripts/adapters/_template.js` | Template for new sources | ✅ Created |
| `scripts/adapters/gotsport.js` | GotSport adapter | ✅ Created |
| `scripts/adapters/htgsports.js` | HTGSports adapter (Puppeteer) | ✅ Created |
| `scripts/adapters/heartland.js` | Heartland adapter (Cheerio) | ✅ Created |
| `scripts/universal/coreScraper.js` | Core engine (841 lines) | ✅ Validated |

**Phase 4: Database Migration** ✅ COMPLETE

| Task | Count | Status |
|------|-------|--------|
| Backfill NULL source_match_key | 286,253 | ✅ Complete |
| Deduplicate match keys | 3,562 removed | ✅ Complete |
| Add UNIQUE constraint | source_match_key | ✅ Enforced |
| Drop unique_match constraint | (legacy) | ✅ Removed |

**Phase 5: Integration Test** ✅ COMPLETE
- Parallel comparison: 100% match parity with legacy scrapers
- Mt Olive Cup test: 207 matches successfully inserted
- 2 matches skipped (fuzzy matching same-team issue, logged as errors)
- Validation pipeline updated with same-team detection

**Phase 6: GitHub Actions** ✅ COMPLETE

New workflow inputs:
| Input | Default | Purpose |
|-------|---------|---------|
| `use_universal_framework` | `true` | Use new adapter-based scrapers |
| `fallback_on_error` | `true` | Auto-fallback to legacy if universal fails |

Summary report now shows which framework was used (universal vs legacy) for each source.

**Key Achievement:** Adding a new data source now requires only a ~50 line config file, not a custom 200+ line script.

**Files Created This Session:**
- `docs/PHASE1_AUDIT_REPORT.md` - Script inventory and patterns
- `docs/PHASE2_FRAMEWORK_DESIGN.md` - Architecture design
- `scripts/adapters/_template.js` - Adapter template
- `scripts/adapters/gotsport.js` - GotSport adapter
- `scripts/adapters/htgsports.js` - HTGSports adapter
- `scripts/adapters/heartland.js` - Heartland adapter
- `scripts/universal/coreScraper.js` - Core engine
- `scripts/migrations/backfillSourceMatchKey.js` - Backfill NULL keys
- `scripts/migrations/deduplicateMatchKeys.js` - Remove duplicates
- `scripts/migrations/applyConstraint.js` - Add UNIQUE constraint

---

### Session 56 - Complete Unlinked Match Remediation (January 29, 2026) - COMPLETE

**Starting Point (from Session 55):**
17,347 unlinked matches identified across multiple platforms.

**Actions Completed:**

| Action | Count | Status |
|--------|-------|--------|
| Delete garbage matches (2027+) | 51 | ✅ Deleted |
| Link HTGSports matches | 2,228 | ✅ Linked (13 tournaments created) |
| Link Heartland matches | 48 | ✅ Linked to Heartland Premier League 2026 |
| Investigate legacy gotsport | 15,020 | ⚠️ Cannot fix (see below) |

**Final State:**

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Total unlinked | 17,347 | **~5,789** | -11,558 (67% fixed) |
| HTGSports unlinked | 2,228 | **0** | ✅ All fixed |
| Heartland unlinked | 48 | **0** | ✅ All fixed |
| Gotsport legacy | 15,071 | **~5,789** | 10,097 via V1 + 1,155 inferred |
| Garbage deleted | 51 | — | ✅ Removed |

**HTGSports Tournaments Created:**

| Tournament | Matches | Dates |
|------------|---------|-------|
| 2025 Border Battle | 536 | Feb-Mar 2025 |
| HTGSports Event 12093 | 591 | Nov 2024 |
| HTGSports Event 12092 | 441 | Nov 2024 |
| + 10 more | 660 | Various |

**V1 Archive Linkage (linkFromV1Archive.js):**

Discovered V1 archived tables contain event linkage data. Joined matches_v2 to match_results_deprecated by date+team IDs.

| Metric | Count |
|--------|-------|
| V1 matches indexed | 165,000+ |
| V2 legacy matches | 15,020 |
| Successfully matched | 10,097 (67.2%) |
| Events created | 203 (123 tournaments, 80 leagues) |

**CRITICAL FIX: app_upcoming_schedule View**

Discovered that scheduled future matches were NOT showing in the Upcoming section because:
- `app_upcoming_schedule` only read from `schedules` table (906 rows)
- But scrapers put scheduled games into `matches_v2` with 0-0 scores

**Solution:** Updated view to UNION both sources, but with DATA INTEGRITY filter:
```sql
-- Part 1: schedules table (original)
-- Part 2: matches_v2 future matches WITH KNOWN EVENTS ONLY
WHERE (m.league_id IS NOT NULL OR m.tournament_id IS NOT NULL)
```

| Metric | Before | After |
|--------|--------|-------|
| app_upcoming_schedule rows | 906 | **4,753** |
| Verified matches only | No | **Yes** |

**Key Decision:** Unlinked matches EXCLUDED from Upcoming for user trust.

**Inference Linkage (inferEventLinkage.js):**

Created inference script that links orphaned matches by analyzing team activity patterns:
- If Team A and Team B both play in "Kansas Premier League"
- And they have an unlinked match within that date range
- The script infers that match belongs to Kansas Premier League

| Run | Matches Fixed |
|-----|---------------|
| Initial run | 1,155 |
| Nightly (ongoing) | Incrementally improves |

**Added to nightly pipeline** - As more data is collected, we learn more team-event relationships, allowing more orphaned matches to find their home.

**Remaining Unlinked (~5,789 after inference):**
- ⚠️ Do NOT appear in app_upcoming_schedule (data integrity)
- ✅ Still counted in ELO calculations (if played with scores)
- ⚠️ Show as "Other Matches" in Team Details
- ✅ Will shrink over time as nightly inference learns more

**Scripts Created/Updated:**
- `scripts/maintenance/linkByEventPattern.js` - Links by event ID pattern (HTGSports/Heartland)
- `scripts/maintenance/linkFromV1Archive.js` - Links legacy via V1 archived data (67% success)
- `scripts/maintenance/inferEventLinkage.js` - **NIGHTLY** Infers event from team patterns
- `scripts/maintenance/cleanupGarbageMatches.js` - Deletes 2027+ dated matches
- `scripts/migrations/run_session56_migration.js` - **CRITICAL** Fixes app_upcoming_schedule view
- `.github/workflows/daily-data-sync.yml` - Added inference linkage phase

**Documentation Updated:**
- Added Principle 6: "Scheduled Matches Are Critical"
- Fixed ARCHITECTURE.md: Changed 2026+ to 2027+ for garbage threshold
- Updated DATA_SCRAPING_PLAYBOOK.md: Emphasized collecting scheduled matches
- All docs now emphasize: **0-0 scored matches populate Upcoming section, never delete them**

**Previous Session (55):**
- Fixed 9,955 matches via source_match_key linkage
- Identified 17,347 total unlinked

**Previous Session (54):**
- Complete birth_year data cleanup
- Merged 982 duplicate teams

**Previous Session (53):**
- Dynamic age_group architecture
- `get_current_season_year()` SQL function

### Database Architecture

```
Layer 1: Staging (staging_games, staging_teams, staging_events)
    ↓ validationPipeline.js
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
