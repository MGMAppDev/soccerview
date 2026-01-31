# CLAUDE.md - SoccerView Project Master Reference

> **Version 7.7** | Last Updated: January 31, 2026 | Session 67 Complete
>
> This is the lean master reference. Detailed documentation in [docs/](docs/).

---

## Quick Links to Documentation

| Document | Purpose |
|----------|---------|
| [docs/UNIVERSAL_DATA_QUALITY_SPEC.md](docs/UNIVERSAL_DATA_QUALITY_SPEC.md) | **ACTIVE** Data quality system spec |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | V2 database architecture (3-layer design) |
| [docs/DATA_SCRAPING_PLAYBOOK.md](docs/DATA_SCRAPING_PLAYBOOK.md) | How to add new data sources |
| [docs/DATA_EXPANSION_ROADMAP.md](docs/DATA_EXPANSION_ROADMAP.md) | Priority queue for expansion |
| [docs/PHASE1_AUDIT_REPORT.md](docs/PHASE1_AUDIT_REPORT.md) | Universal Pipeline audit (135+ scripts) |
| [docs/PHASE2_FRAMEWORK_DESIGN.md](docs/PHASE2_FRAMEWORK_DESIGN.md) | Universal Pipeline architecture |
| [docs/UI_PATTERNS.md](docs/UI_PATTERNS.md) | Mandatory UI patterns |
| [docs/SESSION_HISTORY.md](docs/SESSION_HISTORY.md) | All past session summaries |
| [docs/_archive/](docs/_archive/) | Completed project documents |
| [docs/LAUNCH_PLAN.md](docs/LAUNCH_PLAN.md) | Marketing messages & launch checklist |

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

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for full details.

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

**Scheduled/future matches (0-0 scores) are NOT garbage.** They populate:
- **Team Details "Upcoming" section** - Parents want to see next games
- **app_upcoming_schedule view** - Powers the upcoming matches feature

**NEVER delete a match just because it has 0-0 score.** Only delete if:
- Match date is impossibly far in future (2027+)
- Match is clearly invalid (U1/U2 age groups, etc.)

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

See [docs/UNIVERSAL_DATA_QUALITY_SPEC.md](docs/UNIVERSAL_DATA_QUALITY_SPEC.md) for full specification.

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
1. Table/view exists in V2 schema (check `docs/ARCHITECTURE.md`)
2. Column names match V2 schema (not V1)
3. Use proper Supabase joins for related data

**Anti-patterns:**
- ❌ Using `team_elo`, `match_results`, or `rank_history` directly
- ❌ Assuming column names without checking schema
- ❌ Running `git checkout` on UI files without checking for uncommitted features

### 17. UI Protection Protocol (Session 67)

**CRITICAL:** UI files are PROTECTED ARTIFACTS. They require mandatory backups before any modification.

**LOCKED UI COMPONENTS:**

| Component | File | Golden Archive |
|-----------|------|----------------|
| Team Details | `app/team/[id].tsx` | `ui-archives/team-details/v1.0_golden_2026-01-31.tsx` |
| Rankings | `app/(tabs)/rankings.tsx` | `ui-archives/rankings/v1.0_golden_2026-01-31.tsx` |
| Matches | `app/(tabs)/matches.tsx` | `ui-archives/matches/v1.0_golden_2026-01-31.tsx` |
| Teams | `app/(tabs)/teams.tsx` | `ui-archives/teams/v1.0_golden_2026-01-31.tsx` |
| Home | `app/(tabs)/index.tsx` | `ui-archives/home/v1.0_golden_2026-01-31.tsx` |

**MANDATORY PRE-EDIT PROTOCOL:**

Before touching ANY file in `/app/` or `/components/`:

1. **CREATE BACKUP**: `node scripts/ui-backup.js app/team/[id].tsx`
2. **READ FULL FILE**: Understand existing structure before changes
3. **MINIMAL CHANGES ONLY**: Fix specific issue, do NOT refactor
4. **TEST**: Verify UI renders correctly after each change

**FORBIDDEN OPERATIONS:**
- ❌ `git checkout HEAD -- app/**/*.tsx` (WIPES UNCOMMITTED WORK)
- ❌ `git reset` on UI files
- ❌ Rewriting entire components
- ❌ Changing data types/interfaces without mapping
- ❌ Removing features to "simplify"

**DISASTER RECOVERY:**
```bash
# List available versions
node scripts/ui-restore.js team-details

# Restore golden version
node scripts/ui-restore.js team-details golden
```

**Archive Location:** `ui-archives/ARCHIVE_INDEX.md`

---

## Quick Reference

### Database Status (V2 - Production)

| Table | Rows | Purpose |
|-------|------|---------|
| `teams_v2` | 147,794 | Team records (100% have club_id) |
| `matches_v2` | 304,624 | Match results |
| `clubs` | 124,650 | Club organizations |
| `leagues` | 280 | League metadata (38 with state) |
| `tournaments` | 1,728 | Tournament metadata |
| `canonical_events` | 1,795 | Canonical event registry (Session 62) |
| `canonical_teams` | 19,271 | Canonical team registry (Session 62) |
| `canonical_clubs` | 7,301 | Canonical club registry (Session 62) |
| `learned_patterns` | 0+ | Adaptive learning patterns (Session 64) |
| `staging_games` | 41,095 | Staging area (0 unprocessed) |
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
| `validationPipeline.js` | Staging → Production |
| `recalculate_elo_v2.js` | ELO calculation |
| `scorePredictions.js` | Score user predictions |
| `captureRankSnapshot.js` | Daily rank history |

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

**NEW in Session 60** - Complete data quality pipeline. Core engine + pure-function normalizers.

**Core Engine:**
| Script | Purpose |
|--------|---------|
| `dataQualityEngine.js` | **Main orchestrator** (680+ lines) - 4-step pipeline: Normalize → Resolve → Deduplicate → Promote |
| `testDataQualityEngine.js` | Integration test for full pipeline |

**Usage:**
```bash
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

- **Web research:** Use `web_search` directly
- **Database queries:** Use Supabase MCP
- **File operations:** Use filesystem MCP

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

**Goal:** Implement Universal Data Quality System per `docs/UNIVERSAL_DATA_QUALITY_SPEC.md`

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
| teams_v2 | 147,706 | 100% have club_id |
| matches_v2 | 304,293 | All linked |
| clubs | 124,650 | — |
| leagues | 280 | 38 with state metadata |
| tournaments | 1,727 | — |
| canonical_events | 4 | Heartland mappings |
| staging_games | 41,095 | 0 unprocessed |

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

See [docs/UI_PATTERNS.md](docs/UI_PATTERNS.md) for all patterns.

---

*This document is the master reference for all Claude interactions.*
*Detailed documentation is in the docs/ folder.*
*Update at the end of each session.*
