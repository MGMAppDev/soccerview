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

### Previous Sessions (78 and Earlier)

**For detailed session history, see [docs/1.3-SESSION_HISTORY.md](docs/1.3-SESSION_HISTORY.md).**

**Recent Key Sessions:**

| Session | Date | Focus | Key Outcome |
|---------|------|-------|-------------|
| 78 | Feb 2 | Orphan Root Cause Analysis | Orphans are coverage gaps, not duplicates (Principle 24) |
| 77 | Feb 2 | NULL Metadata Fix | 10,571 teams fixed, 1,707 orphans merged |
| 76 | Feb 2 | GotSport Rankings Bypass | +118,977 canonical_teams entries |
| 75 | Feb 2 | Real-Time Data Consistency | Season Stats now query source tables |
| 74 | Feb 2 | HTGSports Division Detection | Fixed regex `/U-?\d{1,2}\b/` (Principles 20-22) |
| 73 | Feb 2 | VS Battle Page Fixes | 8 UI issues resolved |
| 72 | Feb 2 | NULL Score Fix | 9,210 scheduled matches preserved |
| 71 | Feb 1 | Compare Chart Fix | Switched to chart-kit for multi-line |
| 70 | Feb 1 | Rank Calculation Methodology | Consistent baseline (GotSport-inspired) |
| 69 | Feb 1 | Index Maintenance | 9 missing indexes fixed, backlog cleared |
| 68 | Jan 31 | Rating Journey Redesign | Source/Scope selectors |
| 67 | Jan 31 | Team Details UI | Season Stats layout, custom icons |
| 66 | Jan 31 | V1→V2 UI Migration | Fixed Team Details crash |
| 65 | Jan 31 | Ranking Journey Chart | ELO history backfill |
| 64 | Jan 31 | Adaptive Learning | Pipeline integration |
| 63 | Jan 30 | Universal Discovery | Database-based event discovery |
| 62 | Jan 30 | Canonical Registries | Self-learning system seeded |
| 61 | Jan 30 | Alphanumeric Team ID Fix | 64 matches recovered (Principle 10) |
| 60 | Jan 30 | Universal Data Quality | Full pipeline integration |
| 57-59 | Jan 30 | Universal Pipeline | Adapter-based framework |
| 53-56 | Jan 29 | Data Integrity | Birth year cleanup, unlinked matches |
| 48-52 | Jan 28 | V2 Architecture | Database restructure complete |

---

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
