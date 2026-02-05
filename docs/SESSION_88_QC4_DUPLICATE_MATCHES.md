# Session 88 QC Issue #4: Duplicate Matches in Team Details

> **Date:** February 4, 2026 | **Status:** COMPLETE
>
> Duplicate matches appearing in Team Details page.
> All fixes are DATA-LAYER ONLY. **ZERO UI design changes.**

---

## The Problem

**Symptom:** "Sporting Blue Valley SPORTING BV Pre-NAL 15 (U11 Boys)" Team Details page shows duplicate match entries — same opponent, same date, same score appearing twice. Affects both league and tournament matches.

**Mode:** Team Details page (Season Stats + Match History sections).

**Scale:** TBD at execution — must quantify. Affects Season Stats (inflated W-L-D), Match History (visual duplicates), AND ELO calculations (double-counted games).

**Screenshots show:**
- Aug 14 vs OP Academy 2015B (2-3) appears twice
- Aug 7 vs Sporting City 15 Pre MLSN-East (1-3) appears twice
- Oct 3 vs Toca FC B2015 Premier (3-2) appears twice
- Nov 6-7 tournament matches also duplicated

---

## Root Causes

### Root Cause #1: REVERSE MATCHES (Primary — Layer 2)

The same real-world game exists as two active records in `matches_v2` with home/away teams swapped:

```
Record A: date=Aug 14, home_team_id=SBV, away_team_id=OP_Academy, score=2-3
Record B: date=Aug 14, home_team_id=OP_Academy, away_team_id=SBV, score=3-2
```

The constraint `unique_match_semantic UNIQUE (match_date, home_team_id, away_team_id)` treats (date, A, B) and (date, B, A) as DIFFERENT tuples. Both insertions succeed.

**How it happens:** Different data sources (GotSport, V1 migration, HTGSports) record the same game with teams in different home/away positions. The pipeline had ZERO reverse-match detection.

### Root Cause #2: Missing `deleted_at IS NULL` Filters (Secondary — Layers 2+3)

Session 86 added soft-delete columns but `deleted_at IS NULL` filtering was NOT added to:
- Team Details match queries (`app/team/[id].tsx` lines 751-763)
- Team Details season stats queries (`app/team/[id].tsx` lines 796-810)
- ELO recalculation (`recalculate_elo_v2.js` lines 97-105, 128-143)
- 3 materialized views: `app_team_profile`, `app_matches_feed`, `app_league_standings`

---

## Fix Architecture

**3-phase fix: Defensive filtering + Retroactive dedup + Pipeline prevention.**

### Phase 1: Add `deleted_at IS NULL` Filters (Defensive)

| File | Change |
|------|--------|
| `app/team/[id].tsx` | Add `.is('deleted_at', null)` to 4 Supabase queries |
| `scripts/daily/recalculate_elo_v2.js` | Add `AND deleted_at IS NULL` to 2 SQL queries |
| `scripts/migrations/088_add_deleted_at_filters.sql` | Recreate 3 views with deleted_at filter |

### Phase 2: Reverse Match Dedup (Retroactive)

| File | Change |
|------|--------|
| `scripts/maintenance/fixReverseMatches.cjs` | **NEW** — detect + soft-delete reverse duplicates |

### Phase 3: Pipeline Prevention

| File | Change |
|------|--------|
| `scripts/universal/deduplication/matchDedup.js` | Add reverse match detection method |
| `scripts/maintenance/fastProcessStaging.cjs` | Add pre-insert reverse check |
| `scripts/universal/dataQualityEngine.js` | Add pre-insert reverse check |

---

## Files Modified

| # | File | Type | UI Impact |
|---|------|------|---------|
| 1 | `app/team/[id].tsx` | Add `.is('deleted_at', null)` to 4 queries | **ZERO** — data query only |
| 2 | `scripts/daily/recalculate_elo_v2.js` | Add `AND deleted_at IS NULL` to 2 queries | None |
| 3 | `scripts/migrations/088_add_deleted_at_filters.sql` | **NEW** — 3 views with deleted_at filter | None |
| 4 | `scripts/maintenance/fixReverseMatches.cjs` | **NEW** — reverse match dedup | None |
| 5 | `scripts/universal/deduplication/matchDedup.js` | Add reverse detection | None |
| 6 | `scripts/maintenance/fastProcessStaging.cjs` | Add reverse check | None |
| 7 | `scripts/universal/dataQualityEngine.js` | Add reverse check | None |

**UI Impact: ZERO. All changes are data-layer only.**

---

## Execution Results

```
Phase 1: Defensive Filtering
  - app/team/[id].tsx: 4 Supabase queries updated with .is('deleted_at', null)
  - recalculate_elo_v2.js: 2 SQL queries updated with AND deleted_at IS NULL
  - Migration 088: 3 materialized views recreated (app_team_profile, app_matches_feed, app_league_standings)

Phase 2: Retroactive Reverse Dedup (fixReverseMatches.cjs)
  - Total reverse pairs found: 5,656
  - Score-consistent (confirmed same game): 696
  - Score-inconsistent (legitimate rematches): 4,902 — SKIPPED
  - One-sided scores: 58
  - Ambiguous scheduled: 5 — SKIPPED
  - Confirmed reverse duplicates soft-deleted: 749 (2 bulk batches)
  - Remaining reverse pairs: 4,907 (legitimate different games)

Phase 3: Pipeline Prevention
  - matchDedup.js: Added detectReverseMatches() + resolveReverseMatches() exports
  - fastProcessStaging.cjs: Added within-batch reverse dedup + DB reverse check
  - dataQualityEngine.js: Added pre-insert reverse match check with bulk query
```

## Verification

1. Reverse match query returns 0 confirmed duplicates (4,907 remaining are legitimate rematches)
2. ELO recalculated with deleted_at IS NULL filter — no soft-deleted matches processed
3. All 3 materialized views recreated with deleted_at IS NULL filter
4. Pipeline prevention: both fastProcessStaging and DQE now detect reverse matches before insert
5. matchDedup.js --report now includes reverse match detection

---

## 2nd/3rd Order Effects

| Effect | Assessment |
|--------|-----------|
| ELO calculation | POSITIVE — correct match count, accurate ratings |
| Season Stats | POSITIVE — accurate W-L-D (no double-counting) |
| Match History | POSITIVE — no visual duplicates |
| League Standings | POSITIVE — accurate stats (views filter deleted) |
| Matches Feed | POSITIVE — no duplicate entries |
| Daily Pipeline | POSITIVE — future data won't create reverse duplicates |
| UI Design | **ZERO CHANGES** — all fixes are data/query layer |
