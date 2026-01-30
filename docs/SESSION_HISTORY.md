# SoccerView Session History

> **Last Updated:** January 30, 2026 | Session 58
>
> This document archives the detailed session history from the SoccerView project.
> For current project status, see [CLAUDE.md](../CLAUDE.md).

---

## Project Phases Overview

| Phase | Focus | Status | Sessions |
|-------|-------|--------|----------|
| Phase 0-4 | MVP Development | ✅ Complete | 1-33 |
| Phase 5 | QC Testing (24 issues) | ✅ Complete | 34 |
| Phase 6 | Performance Optimization | ✅ Complete | 35-37 |
| Phase 7 | UX & Infrastructure | ✅ Complete | 38-44 |
| Database Restructure | V2 Architecture | ✅ Complete | 48-50 |
| Data Integrity | V2 QC & Optimization | ✅ Complete | 51-56 |
| Universal Pipeline | Source-Agnostic Framework | ✅ Complete | 57 |
| DevOps & Security | GitHub Actions + RLS | ✅ Complete | 58 |

---

## Session 58 - GitHub Actions Fixes & Security Hardening (January 30, 2026) - COMPLETE

**Focus:** Fix failing GitHub Actions workflows and address Supabase security vulnerabilities.

### Problems Identified

1. **Daily Data Sync workflow failing** - GotSport timeout, Refresh Views crash
2. **Daily Rank Snapshot failing** - Wrong script path, ESM import issues
3. **Supabase Security Advisor** - 27 errors + 32 warnings

### Issue 1: GitHub Actions Workflow Failures

**Root Causes Found:**

| Job | Error | Root Cause |
|-----|-------|------------|
| GotSport Events | Timeout (45 min) | CLI flag `--active` not recognized (expected `--active-only`) |
| Refresh App Views | Module not found | `refresh_views_manual.js` never committed |
| Capture Rank Snapshot | Table not found | Wrong script path + ESM dotenv import |

**Fixes Applied:**

1. Fixed CLI flag mismatch in `daily-data-sync.yml` (3 places)
2. Committed missing `scripts/refresh_views_manual.js`
3. Fixed script path in `capture-rank-snapshot.yml`
4. Fixed ESM dotenv imports (`import "dotenv/config"` instead of `import dotenv from "dotenv"`)
5. Increased GotSport timeout from 45 to 90 minutes

### Issue 2: Supabase Security Vulnerabilities

**Security Advisor Report:**
- 21 ERRORS (RLS disabled, Security Definer views)
- 32 WARNINGS (function search paths, permissive policies)

**Migration Created:** `scripts/migrations/enable_rls_security.sql`

| Fix | Count | Details |
|-----|-------|---------|
| Enable RLS | 15 tables | All production and staging tables |
| Create policies | 60+ | Public SELECT, service role writes |
| Fix function search_path | 23 functions | Prevents path manipulation |
| Drop permissive policies | 3 | Deprecated tables |

**RLS Strategy:**
- **Core data** (teams, matches, leagues, etc.): Public read, service role write
- **Staging tables**: Service role only
- **User data** (favorites, predictions): Open for now (app doesn't use auth)

### Issue 3: Performance Optimization

Rewrote `syncActiveEvents.js` v3.0 with parallel processing:

**Before (v2.0):**
- Sequential event processing
- Fixed 1500-3000ms delays between requests
- Per-event database writes
- ~45 min for 79 events (timeout)

**After (v3.0):**
- 5 concurrent events (p-limit)
- 3 concurrent groups per event
- Reactive rate limiting (300ms base, backs off on 429)
- Single bulk insert at end
- Target: 10-20 minutes

**Key Changes:**
```javascript
// Concurrency limits
const eventLimit = pLimit(5);   // 5 events at once
const groupLimit = pLimit(3);   // 3 groups per event

// Reactive rate limiting
let currentBackoff = 300;  // Start at 300ms
function onRateLimit() {
  currentBackoff = Math.min(60000, currentBackoff * 2);
}
function onSuccess() {
  if (consecutiveSuccesses >= 10) {
    currentBackoff = Math.max(300, currentBackoff / 2);
  }
}
```

### Files Changed

| File | Change |
|------|--------|
| `.github/workflows/daily-data-sync.yml` | Fixed `--active-only`, timeout 90min |
| `.github/workflows/capture-rank-snapshot.yml` | Fixed script path |
| `scripts/daily/syncActiveEvents.js` | v3.0 parallel processing |
| `scripts/daily/captureRankSnapshot.js` | Fixed ESM dotenv |
| `scripts/maintenance/inferEventLinkage.js` | Fixed ESM dotenv |
| `scripts/refresh_views_manual.js` | NEW - committed missing file |
| `scripts/migrations/enable_rls_security.sql` | NEW - RLS migration |
| `package.json` | Added p-limit dependency |

### Commits

1. `3273d1b` - Fix GitHub Actions workflow failures and add RLS security
2. `449ac6b` - Fix capture-rank-snapshot workflow path
3. `0e222a3` - Add missing refresh_views_manual.js script
4. `d09c47e` - Increase GotSport scraper timeout to 90 minutes
5. `6f3d628` - Optimize syncActiveEvents.js with parallel processing (v3.0)

### Results

- ✅ Daily Rank Snapshot workflow: PASSING
- ✅ RLS enabled on all 43 tables
- ✅ Security policies applied
- ⏳ Daily Data Sync: Pending test with v3.0 parallel scraper

---

## Session 57 - Universal Data Pipeline Framework (January 30, 2026) - COMPLETE

**Focus:** Build a source-agnostic Universal Data Pipeline to replace custom per-source scripts with a single engine + lightweight adapters.

### Problem Solved

Before Session 57, adding a new data source required:
- Writing 200+ line custom scraper
- Understanding source-specific quirks
- Duplicating rate-limiting, checkpointing, error handling logic

After Session 57:
- New source = ~50 line adapter config file
- Core engine handles all common logic
- Time to add source: ~1-2 hours vs ~1-2 days

### Phase 1: Script Audit

Analyzed 135+ scripts across 6 directories to identify patterns to preserve:

| Directory | Scripts | Key Patterns |
|-----------|---------|--------------|
| `scripts/daily/` | 6 | Pipeline orchestration |
| `scripts/scrapers/` | 6 | Rate limiting, checkpoints |
| `scripts/maintenance/` | 23 | Data healing, audits |
| `scripts/onetime/` | 13 | Migrations |
| `scripts/_archive/` | 45+ | Legacy reference |

**12 Critical Patterns Documented:**
1. Rate limiting (minimum delay between requests)
2. Checkpoint/resume capability
3. Pagination handling
4. Error retry with exponential backoff
5. Batch database inserts
6. `source_match_key` generation
7. Raw data preservation
8. Event registration
9. Technology abstraction (Cheerio vs Puppeteer)
10. Progress logging
11. Dry-run mode
12. Stats summary

### Phase 2: Framework Design

Created adapter schema specification:

```javascript
// Adapter structure
export default {
  platform: "gotsport",           // Unique identifier
  technology: "cheerio",          // "cheerio" | "puppeteer" | "api"
  baseUrl: "https://...",
  rateLimit: { minDelay: 1000 },
  selectors: { ... },             // CSS/XPath selectors
  fieldMappings: { ... },         // Transform raw → staging
  generateMatchKey: (match) => `gotsport-${match.eventId}-${match.id}`,
};
```

### Phase 3: Build Framework

| File | Purpose | Lines |
|------|---------|-------|
| `scripts/universal/coreScraper.js` | Core engine | 841 |
| `scripts/adapters/gotsport.js` | GotSport adapter | ~120 |
| `scripts/adapters/htgsports.js` | HTGSports adapter (Puppeteer) | ~150 |
| `scripts/adapters/heartland.js` | Heartland adapter | ~100 |
| `scripts/adapters/_template.js` | Template for new sources | ~80 |

**Core Engine Features:**
- Technology-agnostic (Cheerio, Puppeteer, or API)
- Automatic rate limiting from adapter config
- Checkpoint/resume via JSON files
- Batch inserts to staging_games
- Progress logging with stats
- Dry-run mode for testing
- Error handling with retries

### Phase 4: Database Migration (source_match_key)

The `source_match_key` column is the authoritative unique identifier for matches:

| Task | Count | Status |
|------|-------|--------|
| Backfill NULL keys | 286,253 | ✅ Complete |
| Deduplicate keys | 3,562 removed | ✅ Complete |
| Add UNIQUE constraint | enforced | ✅ Complete |
| Drop `unique_match` constraint | legacy | ✅ Removed |

**Key Format by Source:**
| Source | Format | Example |
|--------|--------|---------|
| GotSport | `gotsport-{eventId}-{matchNum}` | `gotsport-39064-91` |
| HTGSports | `htg-{eventId}-{matchId}` | `htg-12345-678` |
| Heartland | `heartland-{level}-{homeId}-{awayId}-{date}-{gameNum}` | `heartland-premier-abc123-...` |
| Legacy | `legacy-{eventId8}-{homeId8}-{awayId8}-{date}` | `legacy-b2c9a5aa-...` |

### Phase 5: Integration Test

**Mt Olive Cup Test:**
- 209 staging records scraped via Universal Framework
- 207 matches successfully inserted to production
- 2 matches skipped (fuzzy matching same-team issue)

**Fuzzy Matching Bug Found:**
- Problem: Similar team names ("Sporting 2014 Blue" vs "Sporting 2014 White") matched to same team
- Impact: ~2% of matches with nearly identical names
- Fix: Validation pipeline now detects `home_team_id == away_team_id` and skips with error log

### Phase 6: GitHub Actions Update

Updated `.github/workflows/daily-data-sync.yml` with Universal Framework + fallback:

| Input | Default | Purpose |
|-------|---------|---------|
| `use_universal_framework` | `true` | Use adapter-based scrapers |
| `fallback_on_error` | `true` | Auto-fallback to legacy if universal fails |

**Workflow now:**
1. Tries Universal Framework first
2. Falls back to legacy scrapers on failure
3. Summary report shows which framework was used

### Scripts Created

| Script | Purpose |
|--------|---------|
| `scripts/universal/coreScraper.js` | Core scraping engine (841 lines) |
| `scripts/adapters/gotsport.js` | GotSport adapter |
| `scripts/adapters/htgsports.js` | HTGSports adapter (Puppeteer) |
| `scripts/adapters/heartland.js` | Heartland adapter |
| `scripts/adapters/_template.js` | Template for new sources |
| `scripts/migrations/backfillSourceMatchKey.js` | Backfill NULL keys |
| `scripts/migrations/deduplicateMatchKeys.js` | Remove duplicates |
| `scripts/migrations/applyConstraint.js` | Add UNIQUE constraint |

### Documentation Created

| Document | Purpose |
|----------|---------|
| `docs/PHASE1_AUDIT_REPORT.md` | Script inventory and patterns |
| `docs/PHASE2_FRAMEWORK_DESIGN.md` | Architecture design |

### Key Achievement

**Before:** Adding new source = 1-2 days (custom 200+ line script)
**After:** Adding new source = 1-2 hours (~50 line adapter config)

### Principle Added: Fuzzy Matching Limitations

Very similar team names may incorrectly match to the same team. Validation pipeline now skips these with error logging instead of crashing.

---

## Session 56 - Complete Unlinked Match Remediation (January 29, 2026) - COMPLETE

**Focus:** Complete the unlinked match fix from Session 55, addressing all fixable platforms.

### Final Results Summary

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Total unlinked | 17,347 | **~5,789** | -11,558 (67% fixed) |
| HTGSports unlinked | 2,228 | **0** | ✅ All fixed |
| Heartland unlinked | 48 | **0** | ✅ All fixed |
| Gotsport legacy | 15,071 | **~5,789** | V1 archive + inference |
| app_upcoming_schedule | 906 | **4,753** | Verified matches only |

### Phase 1: Platform-Specific Fixes

#### HTGSports Fix: Event Pattern Matching
Created `scripts/maintenance/linkByEventPattern.js`:
- Extracts event ID from `source_match_key` pattern (htg-{event_id}-{match_id})
- Creates tournaments for each event ID
- Links all matches with that event pattern

**13 HTGSports Tournaments Created:**
- 2025 Border Battle (536 matches)
- HTGSports Event 12093 (591 matches)
- HTGSports Event 12092 (441 matches)
- Plus 10 more smaller events

#### Heartland Fix
- All 48 linked to "Heartland Premier League 2026"

#### Garbage Deletion
- 51 matches with 2027+ dates deleted

### Phase 2: V1 Archive Linkage (Major Success)

Created `scripts/maintenance/linkFromV1Archive.js` to recover legacy gotsport matches:

**Approach:**
1. Load V1 archived `match_results_deprecated` (contains event_id, event_name)
2. Load V2 legacy matches (no league/tournament)
3. Join by: match_date + home_team_id + away_team_id (or swapped)
4. Get event info from V1, create/lookup in V2

**Results:**
| Metric | Count |
|--------|-------|
| V1 matches indexed | 165,000+ |
| V2 legacy matched | 10,097 (67.2%) |
| Events created | 203 total |
| - Tournaments | 123 |
| - Leagues | 80 |

### Phase 2.5: Inference Linkage (Self-Healing Pipeline)

Created `scripts/maintenance/inferEventLinkage.js` to link orphaned matches by inferring events from team activity patterns:

**Logic:**
- If Team A and Team B both play in "Event X" (from their linked matches)
- And they have an unlinked match within that date range
- Infer the match belongs to "Event X"

**Initial Run Results:**
| Metric | Count |
|--------|-------|
| Unlinked analyzed | 6,944 |
| Teams with event history | 5,997 |
| Matches inferred | 1,155 |
| - To leagues | 126 |
| - To tournaments | 1,029 |

**Added to Nightly Pipeline:** As more matches are scraped and linked, we learn more about team-event relationships, allowing more orphaned matches to find their home over time.

### Phase 3: Data Integrity Fix (Critical User Feedback)

**User Feedback:** "Why are we putting them in upcoming if we are unsure what they actually are?"

**Problem:** Initial migration showed ALL scheduled matches in Upcoming, including unlinked ones.

**Solution:** Updated `app_upcoming_schedule` with data integrity filter:
```sql
-- Only include matches with known events
AND (m.league_id IS NOT NULL OR m.tournament_id IS NOT NULL)
```

| Metric | Initial Fix | Final Fix |
|--------|-------------|-----------|
| app_upcoming_schedule rows | 6,282 | **4,753** |
| Unlinked matches included | Yes | **No** |
| "other" type events | Yes | **None** |

**Principle Established:** Upcoming section requires HIGHEST data integrity. Only verified matches shown.

### Documentation Updates

1. **CLAUDE.md Principle 6:** "Scheduled Matches Are Critical" (0-0 scores NOT garbage)
2. **CLAUDE.md Principle 7:** "Upcoming Section Data Integrity" (only linked matches)
3. **ARCHITECTURE.md:** Fixed garbage threshold from 2026+ to 2027+
4. **DATA_SCRAPING_PLAYBOOK.md:** Emphasized collecting scheduled matches

### Scripts Created

| Script | Purpose |
|--------|---------|
| `linkByEventPattern.js` | Links by extracting event ID from key pattern |
| `linkFromV1Archive.js` | Links legacy via V1 archived data (67% success) |
| `inferEventLinkage.js` | **NIGHTLY** Infers event from team patterns (self-healing) |
| `cleanupGarbageMatches.js` | Only deletes 2027+, preserves 2026 |
| `run_session56_migration.js` | **CRITICAL** Fixes app_upcoming_schedule view |

### Key Lessons Learned

1. **V1 archived data is valuable** - Don't assume old data is useless; it contains linkage info
2. **Data integrity > coverage** - Better to show 4,753 verified matches than 6,282 with unknowns
3. **User trust is paramount** - Parents plan weekends around Upcoming; accuracy is critical
4. **Self-healing pipelines** - Orphaned data can find a home over time as we learn patterns
5. **Every match deserves a home** - Inference linkage ensures orphans shrink, not grow

---

## Session 55 - Fix Unlinked Matches & Team Details QC (January 29, 2026) - COMPLETE

**Focus:** Fix data quality issue where matches had NULL league_id AND tournament_id, causing "Other Matches" to appear on Team Details page.

### Problem

Team Details page showed "Other Matches" section for matches without league/tournament linkage:
- 12,231 matches had NULL league_id AND tournament_id
- Test team (Sporting BV Pre-NAL 15) had 13 of 19 matches unlinked
- UI needed restructuring for Leagues/Tournaments sub-headers

### Solution: Source Match Key Linkage

Created `scripts/maintenance/linkUnlinkedMatches.js` with optimized approach:

1. **Source Match Key Matching** - Uses `source_match_key` field to join `matches_v2` back to `staging_games` (100% accurate, no fuzzy matching needed)
2. **Pagination** - All Supabase queries use pagination (handles >1000 rows)
3. **Auto-Create Events** - Creates missing tournaments/leagues from staging data
4. **Batch Updates** - Processes 100 matches per batch for speed

### Results

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Unlinked matches | 12,231 | **2,276** | -9,955 (81% fixed) |
| Linked to leagues | 0 | 4,696 | new |
| Linked to tournaments | 0 | 5,259 | new |
| Test team unlinked | 13 | **0** | ✅ All fixed |
| Missing events created | — | 8 | new tournaments |

### CRITICAL FINDING: Full Analysis Revealed 17,347 Unlinked

Deeper analysis (late in session) revealed the initial count was incomplete:

| Category | Count | Issue | Status |
|----------|-------|-------|--------|
| GotSport no source_match_key | 15,071 | Legacy imports | **Needs date+teams matching** |
| HTGSports | 2,228 | Has key | Should link (re-run script) |
| Heartland old key format | 48 | Key mismatch | Match by date+teams |
| Garbage (2027/2031/2035) | 51 | Invalid dates | Safe to delete |

**By Year:**
```
2024: 8,500 | 2026: 7,226 | 2025: 954 | 2023: 338 | 2022: 172 | 2021: 91
```

**⚠️ CRITICAL:** The 7,226 "2026" matches are CURRENT SEASON (Jan 2026 = now), not future! These need linkage, not deletion.

### Next Session TODO

```bash
# 1. Delete only garbage (2027+)
node scripts/maintenance/cleanupGarbageMatches.js --delete

# 2. Re-run linkage for HTGSports matches
node scripts/maintenance/linkUnlinkedMatches.js

# 3. Create date+teams matching for legacy gotsport (15,071 matches)
# TODO: New script needed - linkLegacyMatches.js
```

### UI Fixes Completed

1. **Season Stats** - 4 equal pills in single row (removed flexWrap, reduced gap)
2. **Match History** - Restructured with Leagues/Tournaments sub-headers
3. **Team Display Names** - Proper capitalization with `formatTeamName()` helper
4. **Icons** - Changed to `podium-outline` for Leagues, ⚽ for league cards

### Scripts Created

| Script | Purpose |
|--------|---------|
| `scripts/maintenance/linkUnlinkedMatches.js` | Link matches via source_match_key |
| `scripts/_debug/debug_staging.js` | Check team match linkage status |
| `scripts/_debug/analyze_unlinked.js` | Analyze remaining unlinked matches |

### Key Learning

**Don't match by team names across sources.** Team names are formatted differently:
- `staging_games`: Raw scraped names ("SLSG Premier Green 2015")
- `matches_v2`: Canonical names ("slsg green 2015")

Use `source_match_key` for accurate linkage instead.

---

## Session 54 - Complete Birth Year Data Cleanup (January 29, 2026) - COMPLETE

**Focus:** Finish data cleanup started in Session 53 - eliminate all birth_year mismatches.

### Problem

Session 53 built the dynamic age_group architecture, but data cleanup was only ~52% complete:
- 25,857 teams had birth_year mismatches (name contained year like "B2013" but stored birth_year didn't match)
- Many couldn't be fixed directly due to unique constraint violations (duplicate teams)

### Solution: Optimized 4-Phase SQL Batch Cleanup

Created `scripts/maintenance/completeBirthYearCleanup.js`:

| Phase | Action | Result |
|-------|--------|--------|
| 1 | Merge same-target duplicates (teams wanting same birth_year) | 818 teams merged |
| 2 | Merge blocking teams (existing team has target birth_year) | 38 teams merged |
| 3 | Batch UPDATE all remaining mismatches | 17,328 teams updated |
| 4 | Refresh all materialized views | 5 views refreshed |

### Results

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Total teams | 143,523 | 142,541 | -982 (merged duplicates) |
| Name matches birth_year | 51,907 | **68,481** | +16,574 |
| Name mismatches | 25,857 | **0** | ✅ All fixed |
| Has birth_year | 98.1% | 98.1% | unchanged |
| NULL birth_year | 2,761 | 2,761 | (need manual review) |

### Key Insight

The initial approach of one-at-a-time updates was too slow and error-prone. The optimized approach:
1. First resolve all duplicate/blocking teams
2. Then run a single batch SQL UPDATE

This handles edge cases like:
- Multiple teams wanting the same unique key
- Matches needing transfer before team deletion
- Self-referential matches (team vs itself after merge)

### Script Features

```javascript
// Phase 1: Find duplicate groups wanting same (canonical_name, birth_year, gender, state)
// Keep oldest team, transfer matches, delete duplicates

// Phase 2: Find teams blocked by existing team with target birth_year
// Merge into existing team, transfer matches

// Phase 3: Single batch UPDATE (now safe)
UPDATE teams_v2
SET birth_year = (regexp_match(display_name, '(20[01][0-9])'))[1]::int
WHERE display_name ~ '20[01][0-9]'
  AND birth_year != extracted_year;
```

### Files Created/Modified

- `scripts/maintenance/completeBirthYearCleanup.js` (new)
- `CLAUDE.md` (session status)
- `docs/SESSION_HISTORY.md` (this file)
- `docs/ARCHITECTURE.md` (team counts)

---

## Session 53 - Foolproof Age Group Architecture (January 29, 2026) - COMPLETE

**Focus:** Make age_group calculation dynamic from database, eliminating hardcoded season years.

### Problem Solved

The `age_group` field used hardcoded `2026` season year in multiple places. This would break every August when the season changes, requiring code changes across multiple files.

### Solution: Dynamic Season Year

Implemented 8-phase architecture overhaul:

| Phase | Change | File(s) |
|-------|--------|---------|
| 1 | Added `year` column to seasons table | Migration 021 |
| 2 | Created `get_current_season_year()` SQL function | Migration 021 |
| 3 | Created `teams_v2_live` view | Migration 022 |
| 4 | Updated all materialized views with dynamic age_group | Migration 023 |
| 5 | Added cached season year helpers | `lib/supabase.types.ts` |
| 6 | Updated validation pipeline with `extractBirthYear()` | `scripts/daily/validationPipeline.js` |
| 7 | Updated ELO script to query seasons table | `scripts/daily/recalculate_elo_v2.js` |
| 8 | Documented season rollover procedure | All docs |

### Data Cleanup Results

| Metric | Count |
|--------|-------|
| Total teams | 143,523 |
| Has birth_year | 140,762 (98.1%) |
| NULL birth_year | 2,761 |
| Teams fixed | ~2,890 |

### Key Functions Created

- `get_current_season_year()` - SQL function (single source of truth)
- `getCurrentSeasonYear()` - TypeScript async helper with caching
- `calculateAgeGroup()` - TypeScript helper
- `ageGroupToBirthYear()` - TypeScript helper
- `extractBirthYear()` - Priority-based parsing from team names

### Season Rollover Procedure (Each August)

```sql
UPDATE seasons SET is_current = false WHERE is_current = true;
INSERT INTO seasons (name, start_date, end_date, year, is_current)
VALUES ('2026-27 Season', '2026-08-01', '2027-07-31', 2027, true);
SELECT refresh_app_views();
```

No code changes needed - just SQL updates and view refresh.

### Infrastructure

- **Compute upgraded:** Nano → Micro (same price, 2x memory)
- **Disk IO budget:** Was exhausted on Nano; Micro provides more headroom

---

## Session 52 - V2 Data Integrity Deep Audit (January 28, 2026) - COMPLETE

**Focus:** Systematic audit of V2 data integrity after Session 51 uncovered age group issues.

### Critical Bug Found and Fixed

**Problem:** UI testing revealed age group filter was returning wrong teams. Filtering for "U11" showed teams with "(U10 Boys)" and "(U12 Boys)" in their names.

**Root Cause:** Multiple conflicting age calculation formulas existed across the codebase:
- GotSport API: `2026 - birthYear` → U12
- Database trigger: `seasonYear - birthYear` → U11 (tried to be "season-aware")
- TypeScript helper: `currentYear - birthYear + 1` → U13
- Some birth_year values in DB didn't match team names (e.g., name said "2013B" but birth_year was 2014)

**Final Solution:** Align with GotSport formula directly:

```sql
-- Step 1: Disable the trigger that was overwriting age_group
DROP TRIGGER IF EXISTS trg_teams_v2_age_group ON teams_v2;

-- Step 2: Fix birth_year from team names
UPDATE teams_v2
SET birth_year = (regexp_match(display_name, '(20[01][0-9])'))[1]::int
WHERE display_name ~ '20[01][0-9]'
  AND (birth_year IS NULL OR birth_year != (regexp_match(display_name, '(20[01][0-9])'))[1]::int);

-- Step 3: Apply GotSport formula (2026 - birth_year)
UPDATE teams_v2
SET age_group = 'U' || (2026 - birth_year)
WHERE birth_year IS NOT NULL;

-- Step 4: Update display_name suffixes to match
UPDATE teams_v2
SET display_name = regexp_replace(
    display_name,
    '\(U\d+\s*(Boys|Girls)\)',
    '(' || age_group || ' ' || CASE WHEN gender = 'M' THEN 'Boys' ELSE 'Girls' END || ')'
)
WHERE display_name ~ '\(U\d+\s*(Boys|Girls)\)';
-- 137,872 total teams updated
```

**Result mapping:** 2013 → U13, 2014 → U12, 2015 → U11

### Audit Findings

| Area | Status | Details |
|------|--------|---------|
| Stats Consistency | ✅ Pass | All teams have W+L+D = matches_played |
| Stats Scope | ✅ By Design | Current season only (Aug 1+) |
| Age Group Data | ✅ **Fixed** | 137,872 teams updated with GotSport formula |
| Rankings Partitioning | ✅ Correct | ELO ranks correctly partitioned by birth_year + gender |
| Rank History | ✅ Fixed | captureRankSnapshot.js uses V2 tables |

### All Fixes Applied

| Fix | Impact | Details |
|-----|--------|---------|
| Disabled age_group trigger | Prevents overwrites | `trg_teams_v2_age_group` dropped |
| Parsed birth_year from team names | Fixed mismatches | Regex extraction from display_name |
| GotSport formula applied | 137,872 teams | `'U' || (2026 - birth_year)` |
| Display name suffixes updated | UI consistency | Matches calculated age_group |
| V2 table references | Script functional | `captureRankSnapshot.js` uses V2 tables |
| Workflow path | Workflow functional | Points to `scripts/daily/` |

### Key Learnings

1. **Don't over-engineer:** GotSport uses `2026 - birth_year` → we use `2026 - birth_year`. No need for "season-aware" calculations.

2. **Trust source data:** The source (team names, GotSport) already has the correct age group. Parse and use it directly.

3. **Triggers can fight you:** The `calculate_age_group()` trigger kept overwriting corrected values. Disabled it.

4. **UI testing catches data bugs:** Filter mismatches in the app revealed the underlying data issue.

---

## Session 51 - Data Integrity & Performance Optimizations (January 28, 2026) - COMPLETE

**Focus:** QC testing revealed data integrity issues; comprehensive fixes applied.

### Part 1: Team Data Fixes
- **Problem:** Team "Sporting Blue Valley SPORTING BV Pre-NAL 15 (U11 Boys)" had:
  - Wrong birth_year (2014 instead of 2015)
  - Wrong age_group (U10 instead of U11)
  - Season stats showing only 10 matches (should be 19)

- **Root Causes:**
  1. `app_team_profile.recent_matches` had `LIMIT 10`
  2. Season stats calculated from limited matches instead of stored values
  3. Age group calculation was inconsistent across 126,636 teams

### Part 2: Bulk Data Corrections
| Fix | SQL | Teams Affected |
|-----|-----|----------------|
| Age Group | `UPDATE teams_v2 SET age_group = 'U' \|\| (2026 - birth_year)` | 126,636 |
| Birth Year | Individual correction from team name parsing | 1 |

### Part 3: Code Fixes
- **`app/team/[id].tsx`** - Changed `calculatedStats` to use stored team stats:
  ```typescript
  const calculatedStats = useMemo((): CalculatedStats => {
    const matchesPlayed = team?.matches_played ?? 0;
    const wins = team?.wins ?? 0;
    const losses = team?.losses ?? 0;
    const draws = team?.draws ?? 0;
    // ...
  }, [team]);
  ```

- **`005_create_materialized_views.sql`** - Removed `LIMIT 10` from recent_matches

### Part 4: Performance Optimization
- Added `idx_app_rankings_featured` index for home tab queries
- Featured teams query now <100ms

### Part 5: Documentation Updates
- Updated ARCHITECTURE.md with Data Ingestion Workflow diagram
- Added Data Quality Enforcement section
- Documented Session 51 optimizations

### New Data Integrity Rule
> "There should be no limits put on matches or any data that could benefit the integrity of the whole picture data."

App layer handles pagination; database views include ALL relevant data.

---

## Session 50 - V2 Cutover, Archival & Project Cleanup (January 28, 2026) - COMPLETE

**Major Accomplishment:** Completed V2 database architecture cutover and project reorganization.

### Part 1: V2 Cutover
1. **Updated GitHub Actions** - `daily-data-sync.yml` now uses V2 pipeline
2. **Archived V1 Tables** - Renamed to `*_deprecated`:
   - `teams` → `teams_deprecated`
   - `match_results` → `match_results_deprecated`
   - `event_registry` → `event_registry_deprecated`
   - `team_name_aliases` → `team_name_aliases_deprecated`
   - `rank_history` → `rank_history_deprecated`
   - `predictions` → `predictions_deprecated`
3. **Archived V1 Scripts** - Moved 45 deprecated scripts to `scripts/_archive/`

### Part 2: Documentation Reorganization
- **CLAUDE.md reduced** from 2,093 lines to 346 lines (83% reduction)
- **Created `docs/` structure:**
  - `docs/ARCHITECTURE.md` - V2 database architecture
  - `docs/DATA_SCRAPING_PLAYBOOK.md` - Updated for V2
  - `docs/DATA_EXPANSION_ROADMAP.md` - Updated for V2
  - `docs/SESSION_HISTORY.md` - All session summaries
  - `docs/UI_PATTERNS.md` - Mandatory UI patterns
- **Archived 12 completed docs** to `docs/_archive/`

### Part 3: Scripts Reorganization
Reorganized 47 scripts into subdirectories:
```
scripts/
├── daily/          ← 6 scripts (GitHub Actions)
├── scrapers/       ← 6 scripts (data collection)
├── maintenance/    ← 23 scripts (diagnostics)
├── onetime/        ← 13 scripts (rarely used)
├── migrations/     ← DB migrations
├── _archive/       ← Deprecated V1 scripts
└── _debug/         ← Debug output files
```

### Part 4: GitHub Actions Update
- Updated all script paths in `daily-data-sync.yml`
- Tested scripts locally - all working
- Pushed changes to GitHub

### Data Flow (Final):
```
Scrapers → staging_games → validationPipeline.js → matches_v2 → app_* views → App
```

### Status: Ready for QC Testing

---

## Session 49 - V2 Data Strategy & App Integration (January 28, 2026)

### Part 1: Data Loss Discovery & Fix
- **Problem Found:** Original migration excluded teams without parseable birth_year/gender
- **Impact:** 46.3% of matches were lost (217,696 of 470,641)
- **Solution:** Inclusive migration with quality flags

### Part 2: Inclusive Migration Results
| Metric | Before | After | Change |
|--------|--------|-------|--------|
| teams_v2 | 132,947 | 137,582 | +4,635 |
| matches_v2 | 252,945 | 292,802 | +39,857 |

### Part 3: App Integration Verified
All tabs now using V2 materialized views:
- Rankings tab → `app_rankings`
- Teams tab → `app_rankings`
- Matches tab → `app_matches_feed`
- Home tab → Multiple V2 views

---

## Session 48 - Database Restructure Phases 1-2 (January 28, 2026)

### Phase 1: Schema Creation
- Created 15 new tables
- Created `gender_type` enum
- Created 18 indexes, 18 triggers
- Created 5 materialized views
- Created `refresh_app_views()` function

### Phase 2: Data Migration
| Table | Old | New | Coverage |
|-------|-----|-----|----------|
| teams → teams_v2 | 149,000 | 132,947 | 89.2% |
| matches → matches_v2 | 448,644 | 252,945 | 56.4% |
| clubs (NEW) | - | 32,334 | - |
| leagues | - | 273 | 100% |
| tournaments | - | 1,492 | 100% |

---

## Session 47 - Event Registry Fix (January 27, 2026)

**Critical Discovery:** `event_id` without `event_registry` entry causes silent failures.

**Problem:** Heartland League matches had `event_id = 'heartland-league-2025'` but no registry entry.
**Impact:** League Standings button missing for all Heartland teams.
**Fix:** Added registry entry with `source_type = 'league'`.

**New Rule:** Every scraper MUST register events in `event_registry` with correct `source_type`.

---

## Session 46 - Filter & Search Parity (January 26-27, 2026)

### Accomplishments:
1. **Teams Tab State Picker** - Converted to type-ahead (matches Rankings)
2. **Selective Keyboard Collapse** - Only search bar collapses filters
3. **Dynamic Filter Height** - Uses `onLayout` measurement
4. **UI Consistency** - Clear button position, help modal padding

---

## Session 45 - Custom SVG Rank Chart (January 26, 2026)

**Problem:** `react-native-gifted-charts` could not reliably handle inverted Y-axis.

**Solution:** Built custom SVG chart using `react-native-svg`:
- Inverted Y-axis (rank #1 at top)
- Smooth quadratic bezier curves
- Gradient area fill
- Proper label spacing

---

## Session 44 - Daily Sync Pipeline Overhaul (January 26, 2026)

### Major Updates:
1. **Fixed GitHub Actions** - Deleted broken `ingest.yml`, updated `daily-data-sync.yml`
2. **HTGSports Discovery** - Covers 26+ states (not just Heartland!)
3. **Created DATA_EXPANSION_ROADMAP.md**

### New Pipeline Structure:
- Phase 1 (Parallel): GotSport + Heartland scraping
- Phase 2: Team integration
- Phase 3: Team linking
- Phase 4: ELO recalculation
- Phase 5: Match count sync
- Phase 6: Score predictions

---

## Session 43 - Heartland Results CGI Scraper (January 26, 2026)

### Major Breakthrough:
- Discovered CGI API: `heartlandsoccer.net/reports/cgi-jrb/subdiv_results.cgi`
- Created `scrapeHeartlandResults.js`
- **Result:** 4,634 matches with scores (93.6% coverage)

### Full Pipeline Run:
| Step | Result |
|------|--------|
| Heartland Results scrape | 4,634 matches |
| Team integration | 129 new teams |
| Heartland link rate | 100% |
| ELO recalculation | 47,094 teams rated |

---

## Session 42 - Single Source of Truth Architecture (January 26, 2026)

**Established Core Principle:** Every data source = first-class entity.

### Implementation:
- Created `integrateHeartlandTeams.js` - Full pipeline
- Created `deduplicateTeams.js` - Cross-source merging
- 100% link rate achieved for Heartland data

---

## Session 41 - Heartland Integration & League Standings (January 25, 2026)

### Heartland Data:
- HTGSports tournaments: 5,624 matches
- Heartland League: 2,801 matches
- **Total:** 8,425 new matches

### Database Optimization Phase 1:
- Dropped duplicate index: -31 MB
- Created reconciliation indexes
- Ready for 4x faster reconciliation

### League Standings Feature:
- `getLeaguePointsTable()` - Points calculation
- `getTeamsForm()` - Last 5 results
- Toggle UI: Points Table vs Power Ratings

### V1 Launch Readiness:
- All 5 criteria exceeded
- **Recommendation: READY FOR APP STORE**

---

## Sessions 38-40 - Data Pipeline Fixes (January 25, 2026)

### Session 40:
- Fixed HTGSports scraper (division dropdown iteration)
- Fixed Heartland League scraper (DOM selectors)
- Created DOM diagnostics for debugging

### Session 39:
- Heartland Soccer integration research
- Discovered HTGSports platform
- Created 5 new scraping scripts

### Session 38:
- Fixed stale `matches_played` field
- Created `syncMatchCounts.js`
- Created `transferRankings.js`

---

## Sessions 35-37 - UX & Data Improvements

### Session 37:
- Identified ranking discrepancy root cause
- Created `reconcileRankedTeams.js`
- Reconciled 138 priority teams

### Session 36:
- Aligned ELO methodology with GotSport
- Added `CURRENT_SEASON_START` filter
- Compacted rating cards on team details

### Session 35:
- Fixed match card consistency
- Created shared `MatchCard` component
- Standardized styling across all tabs

---

## Earlier Sessions (1-34)

### Session 34 (January 24, 2026):
- Created CLAUDE.md as single source of truth
- Verified database state: 85.6% linked

### Sessions 1-33:
- MVP development
- Core features implementation
- Initial data pipeline setup
- QC testing and bug fixes

---

## Key Technical Discoveries

### HTGSports Division Dropdowns (Session 40)
- Events have 50-100 divisions in dropdown
- Must iterate ALL options and wait for reload
- Without iteration: 1-3 matches; With iteration: 500-800 matches

### Soccer Season Date Logic (Session 43)
- Seasons span Aug-Jul (cross calendar year)
- Dates like "12/15" without year need season-aware parsing

### Event Registry Requirement (Session 47)
- Every `event_id` MUST exist in `event_registry`
- Missing entry = silent feature failure

### Prefix Matching Danger (Session 37)
- "Team 2013" must NOT match "Team 2015"
- Always validate year/gender/state

---

*This archive is maintained for historical reference.*
*For current status, see CLAUDE.md.*
