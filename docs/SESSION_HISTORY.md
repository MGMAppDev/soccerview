# SoccerView Session History

> **Last Updated:** January 28, 2026 | Session 50
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
