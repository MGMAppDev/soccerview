# Session 90: Fix Cross-Import Duplicate Matches

> **Date:** February 5, 2026
> **Type:** QC Data Fix (Data Layer Only)
> **UI Changes:** NONE

---

## Problem

Team Detail page shows duplicate matches in tournament sections. Example: "Sporting Blue Valley SPORTING BV Pre-NAL 15 (U11 Boys)" shows 6 matches in "2025 Heartland Invitational - Boys" when there should be 3.

## Root Cause

V1 migration (Session 82) + scrapers both imported the same real-world games. The V1 migration resolved opponent teams to different `teams_v2` records than the scrapers did (different name normalization → different IDs). The semantic uniqueness constraint `(match_date, home_team_id, away_team_id)` did not catch these because the team IDs differ.

**Pattern:**
```
Scraper:    SBV vs "Sporting City 2015 Pre MLS NEXT II - East"      (htg-13014-1356177)
V1 Legacy:  SBV vs "Sporting City Soccer Club 2015 Pre MLS NEXT..."  (v1-legacy-aecc8e38)
→ Same game, same date, same score (2-6), but different away_team_id
```

## Diagnostic Results

| Metric | Count |
|--------|-------|
| Active v1-legacy-* matches | 91,102 |
| Active legacy-* matches | 280,902 |
| Active non-legacy (scraper) matches | 33,591 |
| Cross-import duplicate pairs found | 3,590 |
| Unique legacy matches with scraper counterparts | 3,310 |
| Affected tournaments + leagues | 1,055+ |
| Legacy matches WITHOUT counterpart (keep!) | 368,694 |

### Platform Breakdown
- gotsport → gotsport: 2,148 pairs
- htgsports → htgsports: 799 pairs
- heartland → heartland: 595 pairs

### Top Affected Events
- Vegas Cup 2026: 699 pairs
- Heartland Premier League 2025: 614 pairs
- 2025 Heartland Invitational - Boys: 272 pairs
- Anaheim Cup 2026: 247 pairs

## Solution

### Fix Script: `scripts/maintenance/fixCrossImportDuplicates.cjs`

**Detection** (CTE-based SQL):
1. Split matches into `legacy_matches` and `scraper_matches` by source_match_key
2. Join: same date + same event + one shared team_id + compatible scores
3. 4 cases: shared_home, shared_away, shared_reversed (2 variants)

**False-Positive Protection (6 layers):**

| Layer | Filter | Purpose |
|-------|--------|---------|
| 1 | Same date | Temporal match |
| 2 | Same tournament_id or league_id | Event context |
| 3 | One shared team ID | Structural confirmation |
| 4 | Compatible scores | Prevents matching unrelated games |
| 5 | Same birth_year (±1) AND gender | Prevents cross-age/gender |
| 6 | pg_trgm similarity > 0.3 | Catches truly unrelated team names |

**Action:** Soft-delete legacy copy, keep scraper copy.

### Post-Fix Steps
1. ELO recalculation (`recalculate_elo_v2.js`)
2. View refresh (`refresh_views_manual.js`)

## Prevention

Already implemented via `source_entity_map` (Session 89). Tier 1 deterministic lookup ensures both V1 and scraper data resolve to the same team ID going forward. This fix is purely retroactive.

## Files

| File | Action |
|------|--------|
| `scripts/maintenance/fixCrossImportDuplicates.cjs` | **NEW** |
| `docs/SESSION_90_CROSS_IMPORT_DUPLICATES.md` | **NEW** |

## Database Before/After

| Metric | Before | After |
|--------|--------|-------|
| Active matches | 405,595 | 403,068 |
| Soft-deleted (cross-import) | 0 | 2,527 |
| SBV Pre-NAL 15 tournament matches | 6 | 3 |
| ELO matches processed | 192,689 | 187,913 |
| ELO teams | 60,864 | 59,295 |
| ELO range | 1157-1781 | 1157-1781 |

### Execution Details

**Main pass (fixCrossImportDuplicates.cjs --execute):**
- Candidate pairs: 3,041
- False positives filtered (pg_trgm): 495
- Confirmed duplicates: 2,546
- After dedup: 2,526 unique legacy matches soft-deleted
- By pair type: shared_home 1,260 / shared_away 1,250 / shared_reversed 36
- By platform: gotsport 1,732 / htgsports 550 / heartland 264

**Second pass (1 manual fix):**
- SBV vs "Supra United FC 12B" — V1 matched wrong age group (BY:2012 instead of BY:2015)
- Birth_year gap = 3 years, outside ±1 tolerance, so main pass missed it
- Manually soft-deleted with reason: "V1 wrong-age-group resolution"

**Post-fix:**
- ELO recalculated: 187,913 matches, 59,295 teams
- All 5 materialized views refreshed

## Verification

```sql
-- SBV Pre-NAL 15 in Heartland Invitational: CONFIRMED 3
SELECT COUNT(*) FROM matches_v2
WHERE deleted_at IS NULL
  AND tournament_id = '024236d3-12a9-499c-9443-ad1fb5b1ac83'
  AND (home_team_id = 'cc329f08-1f57-4a7b-923a-768b2138fa92'
    OR away_team_id = 'cc329f08-1f57-4a7b-923a-768b2138fa92');

-- Total active matches: 403,068
SELECT COUNT(*) FROM matches_v2 WHERE deleted_at IS NULL;
```

## Edge Case: Wide Birth_Year Gap

755 remaining candidate pairs exist with birth_year gaps > 1 year. Analysis confirmed these are overwhelmingly **false positives** (coincidental score matches between different-age/different-gender teams in the same event). Only the SBV/Supra case was a genuine V1 mismatch, handled manually above. The ±1 birth_year tolerance is the correct threshold for automated detection.
