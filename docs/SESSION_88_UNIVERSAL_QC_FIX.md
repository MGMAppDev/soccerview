# Session 88: Universal QC Fix Plan

> **Date:** February 4, 2026 | **Status:** In Progress
>
> Two QC issues identified during app review. Deep 3-layer audit performed.
> All fixes are DATA-LAYER ONLY. **ZERO UI design changes.**

---

## QC Issue #1: Birth Year / Age Group Mismatch

**Symptom:** 2014 birth year team appearing in U11 (2015) filtered search on Rankings tab.
**Scale:** 22,056 teams affected systemically.
**Root cause:** Session 76 gotsport_rankings importer bypassed normalizers, set birth_year from GotSport age bracket instead of team display name.

### Already Fixed (Retroactive - Layers 2+3)

| Action | Result |
|--------|--------|
| `fixBirthYearFromDisplayName.cjs` executed | 22,048 of 22,056 teams corrected |
| All 5 materialized views | Already use `get_current_season_year()` for dynamic age_group |
| Write protection triggers | 6 triggers on teams_v2/matches_v2 block old bypass path |
| Old gotsport_rankings script | Archived in `scripts/_archive/`, cannot bypass pipeline |

### NOT Fixed (Prevention - Layer 1)

**Problem:** `SEASON_YEAR = 2026` is hardcoded in 4 pipeline files. When the season rolls to 2026-27 (August 2026), ALL new data will have birth_year off by 1 year, re-introducing the same bug.

| File | Line(s) | Hardcoded Value | Severity |
|------|---------|-----------------|----------|
| `scripts/universal/normalizers/teamNormalizer.js` | 13 | `const SEASON_YEAR = 2026` | **CRITICAL** - core pipeline |
| `scripts/maintenance/fastProcessStaging.cjs` | 330 | `return 2026 - age` | **CRITICAL** - bulk processor |
| `scripts/maintenance/fixBirthYearFromNames.cjs` | 26 | `const SEASON_YEAR = 2026` | HIGH - maintenance |
| `scripts/maintenance/fixBirthYearFromDisplayName.cjs` | 204 | `2026 -` in SQL | HIGH - maintenance |

### Existing Dynamic Infrastructure (already built, just not wired in)

- **DB function:** `get_current_season_year()` - queries `seasons.year WHERE is_current = true`, date-based fallback
- **DB table:** `seasons` - `{name: '2025-26 Season', year: 2026, is_current: true}`
- **SQL views:** All 5 already use `get_current_season_year()` correctly
- **Other scripts:** `recalculate_elo_v2.js`, `backfillEloHistory.js` already query `seasons` table dynamically

### Fix Plan

**Fix 1a: `teamNormalizer.js`** (ES Module - core pipeline)
- Line 13: `const SEASON_YEAR = 2026` -> `let SEASON_YEAR = 2026` (fallback default)
- Add exported `initializeSeasonYear(year)` function (follows existing `initializeLearnedPatterns()` pattern)
- Lines 102, 109, 247 already reference `SEASON_YEAR` - no changes needed

**Fix 1a-caller: `dataQualityEngine.js`** (DQE startup)
- Import `initializeSeasonYear` from teamNormalizer.js
- Query `SELECT year FROM seasons WHERE is_current = true LIMIT 1` at startup
- Call `initializeSeasonYear(year)` alongside existing `initTeamPatterns()`

**Fix 1b: `fastProcessStaging.cjs`** (CommonJS - bulk processor)
- Add module-level `let SEASON_YEAR = 2026`
- Query seasons table after pipeline auth at startup
- Line 330: Replace `2026` with dynamic variable

**Fix 1c: `fixBirthYearFromNames.cjs`** (CommonJS - maintenance)
- Line 26: `const` -> `let`
- Query seasons table at start of `main()`

**Fix 1d: `fixBirthYearFromDisplayName.cjs`** (SQL - maintenance)
- Line 204: Replace `2026` with `get_current_season_year()` in the SQL string

---

## QC Issue #2: Rank Badge Discrepancy

**Symptom:** Rankings tab badge shows #19 (list position) but Team Detail shows GotSport #3,273 National / #18 State.
**Root cause:** Badge always showed `index + 1` instead of actual database rank.

### Already Fixed (Partial)

- `rankings.tsx` lines 662-670 and 717-719: Logic changed to use actual DB rank values
- GotSport mode: **WORKS** - `national_rank` and `state_rank` are in the SELECT query

### CRITICAL BUG FOUND - Fix is INCOMPLETE

**The Supabase SELECT query at line 152 does NOT fetch `elo_national_rank` or `elo_state_rank`:**

```
Current SELECT (line 152):
"id, name, display_name, club_name, birth_year, gender, age_group, state,
 elo_rating, national_rank, state_rank, gotsport_rank, gotsport_points,
 matches_played, wins, losses, draws, has_matches"

MISSING: elo_national_rank, elo_state_rank
```

**Consequence:** In SoccerView mode, `team.elo_national_rank` is always `undefined`. The expression `undefined ?? index + 1` evaluates to `index + 1`. SoccerView mode still shows list position.

**Evidence chain:**
- `app_rankings` view includes these columns (migration 023, lines 41-42)
- `AppRankingsRow` TypeScript type includes them (supabase.types.ts, lines 135-136)
- `transformAppRankingsRow` maps them (rankings.tsx, lines 89-90)
- SELECT query does NOT request them (rankings.tsx, line 152) **<-- THE GAP**
- Rank logic references them (rankings.tsx, lines 667-668, 717-718) but they're undefined

### Secondary: Inconsistent Operators

- Line 667 (rankedTeams useMemo): Uses `??` (nullish coalescing) - correct
- Line 718 (renderLeaderboardItem): Uses `||` (logical OR) - treats `0` as falsy
- Same result since ranks start at 1, but should be consistent for correctness

### Fix Plan

**Fix 2a: `rankings.tsx` line 152** - Add missing columns to SELECT:
```
"id, name, display_name, club_name, birth_year, gender, age_group, state,
 elo_rating, national_rank, state_rank, elo_national_rank, elo_state_rank,
 gotsport_rank, gotsport_points, matches_played, wins, losses, draws, has_matches"
```

**Fix 2b: `rankings.tsx` line 718** - Standardize `||` to `??`:
```typescript
const rank = mode === "national"
  ? (selectedStates.length > 0 ? (item.elo_state_rank ?? index + 1) : (item.elo_national_rank ?? index + 1))
  : (selectedStates.length > 0 ? (item.state_rank ?? index + 1) : (item.national_rank ?? index + 1));
```

**UI Impact:** ZERO design changes. Same badge, same colors, same layout, same fonts. Only the NUMBER displayed inside the existing badge changes to show the actual rank from the database.

---

## Files Modified (Complete List)

| # | File | Change Type | UI Design Impact |
|---|------|------------|-----------------|
| 1 | `app/(tabs)/rankings.tsx` | Add 2 columns to SELECT + standardize `??` | **NONE** - data query only |
| 2 | `scripts/universal/normalizers/teamNormalizer.js` | Add `initializeSeasonYear()` export | None (pipeline) |
| 3 | `scripts/universal/dataQualityEngine.js` | Import + call `initializeSeasonYear()` | None (pipeline) |
| 4 | `scripts/maintenance/fastProcessStaging.cjs` | Query season year, use dynamic var | None (pipeline) |
| 5 | `scripts/maintenance/fixBirthYearFromNames.cjs` | Query season year, use dynamic var | None (maintenance) |
| 6 | `scripts/maintenance/fixBirthYearFromDisplayName.cjs` | Use `get_current_season_year()` in SQL | None (maintenance) |

---

## What's Already Correct (No Changes Needed)

| Component | Status |
|-----------|--------|
| All 5 materialized views | Use `get_current_season_year()` dynamically |
| `get_current_season_year()` DB function | Reads `seasons` table with date-based fallback |
| `recalculate_elo_v2.js` | Queries `seasons` table dynamically |
| Write protection triggers (6) | Block unauthorized writes to teams_v2/matches_v2 |
| `resolve_canonical_team()` | Requires exact birth_year match |
| `teamDedup.js` | Session 87 fix enforces gender+birth_year constraints |
| App UI layout/design | NOT TOUCHED - all changes are data/query layer |

---

## Verification Plan

### QC Issue #2 (Rank Badge)
1. SoccerView mode: Badges show actual ELO rank (not sequential 1,2,3...)
2. State filter: Badges show state-specific rank
3. GotSport mode: Badges show national_rank
4. Click team -> Team Detail: Rank matches badge
5. TypeScript compile: `npx tsc --noEmit`

### QC Issue #1 (Birth Year Prevention)
1. Run normalizer tests: `node scripts/universal/normalizers/teamNormalizer.js`
2. DQE dry run: `node scripts/universal/dataQualityEngine.js --process-staging --dry-run --limit 10`
   - Confirm log: "Season year: 2026" (from DB)
3. Data regression check:
   ```sql
   SELECT COUNT(*) FROM teams_v2
   WHERE display_name ~ '201[0-9]'
     AND birth_year != (regexp_match(display_name, '(201[0-9])'))[1]::int
     AND canonical_name NOT LIKE '%_merged_%'
   ```
   Expected: 8 (known edge cases)
4. DB function: `SELECT get_current_season_year()` -> 2026

### Season Rollover Readiness (August 2026)
After these fixes, rollover requires ONLY:
```sql
INSERT INTO seasons (name, start_date, end_date, year, is_current)
VALUES ('2026-27 Season', '2026-08-01', '2027-07-31', 2027, false);
UPDATE seasons SET is_current = (year = 2027);
SELECT refresh_app_views();
```
Zero JavaScript code changes needed.

---

## 2nd and 3rd Order Effects

| Effect | Assessment |
|--------|-----------|
| ELO calculation | No impact - already reads season from DB |
| Daily pipeline (GitHub Actions) | No impact - DQE initializes season year at startup |
| View refresh | No impact - views already dynamic |
| Rank history capture | No impact - uses materialized view values |
| Team search/filtering | POSITIVE - SoccerView mode ranks now correct |
| Existing 410K+ matches | No impact - retroactive fix already applied |
| Future data ingestion | POSITIVE - birth_year correct for any season |
| Season rollover | POSITIVE - zero-code-change rollover |
| App performance | Negligible - one extra SELECT at pipeline startup |
| UI Design | **ZERO CHANGES** - all fixes are data/query layer |
