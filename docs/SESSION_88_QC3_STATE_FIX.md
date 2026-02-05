# Session 88 QC Issue #3: Wrong State Assignment Fix

> **Date:** February 4, 2026 | **Status:** COMPLETE
>
> Teams appearing in wrong state filter on SoccerView Rankings.
> All fixes are DATA-LAYER ONLY. **ZERO UI design changes.**

---

## The Problem

**Symptom:** "Sporting Iowa ECNL-RL U15B" appears in SoccerView Rankings when filtering by Kansas (KS). Team label shows "U11 Boys · KS" but team name explicitly says "Iowa".

**Mode:** SoccerView Rankings (ELO-based proprietary rankings).

**Scale:** 3,012 teams affected (1,216 wrong state + 1,796 unknown→inferred).

**Secondary finding:** Same team shows "U11 Boys" but name says "U15B" — birth_year extraction edge case (separate from state issue).

---

## Root Cause

Session 76's GotSport rankings importer (`scripts/_archive/scrape_gotsport_rankings.js`) used a `STATE_ASSOCIATION_MAP` to infer state from GotSport API's `team_association` field. This was unreliable — teams registered with cross-border associations got wrong states.

**Example:** Iowa team registered with Kansas association "KSE" → state='KS'.

### How State Gets Set (Current Pipeline)

| Component | State Value | Method |
|-----------|-------------|--------|
| **Archived GotSport rankings scraper** (Session 76) | Real 2-letter codes (KS, IA, TX...) | `STATE_ASSOCIATION_MAP[team.team_association]` — often WRONG |
| **fastProcessStaging.cjs** | `'unknown'` | Hardcoded default (line 115) |
| **dataQualityEngine.js** | `'XX'` | `inferStateFromRecord()` returns 'XX' — staging_games has no state column |
| **staging_games table** | N/A | **No state column exists** |
| **teamNormalizer.js** | N/A | **No state extraction logic** |

**Key gap:** ZERO state inference in the current pipeline. States are either wrong (from archived scraper) or unknown.

### Data Flow to App

```
teams_v2.state → app_rankings materialized view (line 37: t.state)
                → rankings.tsx query (line 166-168: .in("state", states))
                → SoccerView Rankings state filter
```

---

## Fix Architecture

**2-phase fix: Retroactive (correct existing data) + Prevention (improve pipeline).**

### Phase 1: Retroactive — `fixTeamStates.cjs`

New maintenance script that:
1. Extracts US state names from team `display_name` (e.g., "Iowa" → IA)
2. Identifies mismatches where name-inferred state ≠ current state column
3. Updates state with UNIQUE constraint conflict handling (merge if needed)
4. Also upgrades 'unknown'/'XX' states where name provides evidence

**Ambiguity handling:**
- "Kansas City" → SKIP (ambiguous KS/MO)
- "Washington" → SKIP unless "Washington State" present
- "West Virginia" checked before "Virginia" (longest match first)
- "Georgia" → 'GA' (youth soccer context, not country)

### Phase 2: Prevention — Pipeline Enhancement

| File | Change |
|------|--------|
| `teamNormalizer.js` | Add `inferStateFromName()` export |
| `fastProcessStaging.cjs` | Use inferred state instead of hardcoded 'unknown' |
| `dataQualityEngine.js` | Enhance `inferStateFromRecord()` with name-based fallback |

---

## Files Modified

| # | File | Type | UI Impact |
|---|------|------|-----------|
| 1 | `scripts/maintenance/fixTeamStates.cjs` | **NEW** — retroactive state correction | None |
| 2 | `scripts/universal/normalizers/teamNormalizer.js` | Add `inferStateFromName()` | None |
| 3 | `scripts/maintenance/fastProcessStaging.cjs` | Use inferred state | None |
| 4 | `scripts/universal/dataQualityEngine.js` | Enhance state inference | None |

**UI Impact: ZERO. All changes are data-layer only.**

---

## Execution Results

```
BEFORE: 3,012 teams with state issues
  - 1,216 mismatches (wrong state, e.g., Iowa team with state='KS')
  - 1,796 upgrades (state='unknown'/'XX' with state name in display_name)

AFTER:
  - Direct state updates: 2,998
  - Merges (conflict resolution): 14
  - Iowa teams with wrong state: 0
  - Views refreshed: app_rankings, app_matches_feed
```

## Verification

1. Dry run: `node scripts/maintenance/fixTeamStates.cjs --dry-run` — identified 3,012 fixes
2. Execute: `node scripts/maintenance/fixTeamStates.cjs --execute` — all corrected
3. Specific team: All "Sporting Iowa" teams now state='IA'
4. Universal: 0 Iowa teams with wrong state
5. Views refreshed: app_rankings + app_matches_feed
6. teamNormalizer tests: 9/9 passed (no regressions)

---

## 2nd/3rd Order Effects

| Effect | Assessment |
|--------|-----------|
| ELO calculation | No impact — doesn't use state |
| State-filtered rankings | POSITIVE — correct teams in correct states |
| Team Detail page | POSITIVE — correct state shown |
| Unique constraint | Handled — merge conflicts resolved in script |
| Matches | Transferred during merges — no data loss |
| Future team creation | POSITIVE — pipeline infers state from name |
| Teams with no state in name | Unchanged — remain 'unknown'/'XX' |
