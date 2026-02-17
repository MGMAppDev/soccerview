# Session 89: Universal Entity Resolution + Source ID Architecture

> **Date:** February 5, 2026
> **Status:** COMPLETE
> **UI Changes:** ZERO

---

## Problem Statement

After Session 88's QC fixes, duplicate matches were still visible in Team Detail pages. Investigation revealed the root cause:

**V1 migration created ~7,253 duplicate team records** with NULL/incomplete metadata (birth_year=null, state='Unknown'/'XX'). Same real-world team existed as two `teams_v2` records. This caused:
- 1,412+ duplicate match pairs visible to users
- Inflated W-L-D stats
- ELO miscalculations
- Fragmented team search results

**100% of duplicates involved v1-legacy data.** Zero involved cross-source duplicates between GotSport/HTGSports/Heartland.

### Why Previous Fixes Failed

Sessions 86-88 addressed symptoms (match dedup, reverse matches, deleted_at filters) but not the root cause: **duplicate team records**. Name-based fuzzy matching couldn't distinguish teams with NULL metadata from the same team with proper metadata because it required exact-match on birth_year/gender — and one had NULL.

---

## Solution: Three-Tier Deterministic Entity Resolution

### Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  TIER 1: Source Entity Map (Deterministic, O(1))                  │
│  SELECT sv_id FROM source_entity_map                              │
│  WHERE entity_type='team' AND source_platform=$1                  │
│    AND source_entity_id=$2                                        │
│  → If found: Use this team. DONE. 100% accurate.                  │
├──────────────────────────────────────────────────────────────────┤
│  TIER 2: Canonical Name + NULL-Tolerant Metadata                  │
│  SELECT id FROM teams_v2                                          │
│  WHERE canonical_name=$1 AND gender=$2                            │
│    AND (birth_year=$3 OR birth_year IS NULL)                      │
│  → If found: Use this team + register source ID for Tier 1        │
├──────────────────────────────────────────────────────────────────┤
│  TIER 3: Create New Entity                                        │
│  INSERT INTO teams_v2 (...) RETURNING id                          │
│  INSERT INTO source_entity_map (...)                              │
│  → New entity + registered for future Tier 1 resolution           │
└──────────────────────────────────────────────────────────────────┘
```

### source_entity_map Table

```sql
CREATE TABLE source_entity_map (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('team', 'club', 'league', 'tournament', 'venue', 'schedule')),
  source_platform TEXT NOT NULL,
  source_entity_id TEXT NOT NULL,
  sv_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entity_type, source_platform, source_entity_id)
);
```

**Universal for ALL entity types.** One table maps any source entity to its SoccerView UUID.

---

## Implementation Steps

### Step 1: Fix teamDedup.js (4 Bugs)

| Bug | Location | Fix |
|-----|----------|-----|
| Detection too strict | Line 177 | `AND ... AND` → `AND (... OR ...)` for matches_played |
| Hard DELETE on conflicts | Lines 274-299 | Changed to soft-delete semantic duplicates BEFORE FK updates |
| Missing deleted_at filter | Line 303 | Added `AND deleted_at IS NULL` to COUNT |
| Same pattern in autoMerge | Lines 700-712 | Applied same soft-delete-first pattern |

### Step 2: Migration 089

- State normalization: `UPDATE teams_v2 SET state = 'unknown' WHERE state IN ('Unknown', 'XX', 'xx', 'UNKNOWN')`
- Created `source_entity_map` table with unique constraint and indexes
- Fixed DQE default state from 'XX' to 'unknown'

### Step 3: Backfill Source Entity IDs

Extracted existing source IDs from production data using bulk SQL:

| Source | Entity Type | Count | Method |
|--------|-------------|-------|--------|
| Heartland | Teams | 1,244 | Extracted from `source_match_key` patterns |
| Various | Leagues | 274 | From `leagues.source_event_id` |
| Various | Tournaments | 1,735 | From `tournaments.source_event_id` |
| **Total** | | **3,253** | |

### Step 4: Retroactive Team Merge (7,253 pairs)

**Bulk SQL approach** (user explicitly required bulk operations, not row-by-row):

1. Detect pairs via temp table with metadata scoring (keep team with most data)
2. Drop constraints temporarily
3. Soft-delete intra-squad matches (both teams merge to same keep team)
4. Soft-delete semantic duplicate matches (same date+home+away after FK update)
5. Bulk FK updates: `UPDATE matches_v2 SET home_team_id = keep_id WHERE home_team_id = merge_id`
6. Transfer metadata from merge → keep (fill NULL birth_year, gender, state)
7. Iterative cleanup for 3-way duplicates created by metadata transfer
8. Recreate constraints as partial unique indexes

**Key insight:** Semantic uniqueness constraint must be a **partial unique index** (`WHERE deleted_at IS NULL`) not a table constraint, because soft-deleted rows can legitimately share the same (date, home, away) key.

```sql
CREATE UNIQUE INDEX IF NOT EXISTS unique_match_semantic
ON matches_v2 (match_date, home_team_id, away_team_id)
WHERE deleted_at IS NULL;
```

### Step 5: Tournament Dedup

17 duplicate tournament groups merged (was estimated at 10). All matches updated to point to the kept tournament. 0 remaining duplicates.

### Steps 6-9: Pipeline Prevention

**dataQualityEngine.js:**
- `findOrCreateTeam()`: Tier 1 source_entity_map lookup → Tier 2 NULL-tolerant fallback → Tier 3 create + register
- `findOrCreateEvent()`: Same Tier 1/2/3 pattern for leagues and tournaments
- Source ID registration after every entity creation

**fastProcessStaging.cjs:**
- Bulk source ID extraction from Heartland source_match_key patterns
- Bulk `source_entity_map` lookup before name-based resolution
- Tier 2b: NULL-tolerant birth_year fallback query

**coreScraper.js:**
- Now emits `source_home_team_id` and `source_away_team_id` in raw_data JSONB

### Step 10: Post-Fix Cleanup

- ELO recalculation: 189,971 matches, 59,401 teams, range 1157-1782
- Materialized view refresh: All 5 views refreshed

---

## Database Before/After

| Metric | Before (Session 88) | After (Session 89) | Change |
|--------|---------------------|---------------------|--------|
| teams_v2 | 160,705 | 158,043 | -2,662 (merged) |
| matches_v2 (active) | 407,896 | 405,595 | -2,301 (soft-deleted dupes) |
| matches_v2 (soft-deleted) | 2,423 | ~2,941 | +518 |
| tournaments | 1,728 | 1,711 | -17 (merged) |
| source_entity_map | 0 | 3,253 | NEW |
| V1-legacy duplicate pairs | 7,253 | 0 | ELIMINATED |
| Tournament duplicate groups | 17 | 0 | ELIMINATED |
| ELO teams | 60,817 | 59,401 | -1,416 (merged) |
| ELO range | 1157-1782 | 1157-1782 | Same |

---

## Files Modified

| # | File | Type | Changes |
|---|------|------|---------|
| 1 | `scripts/universal/deduplication/teamDedup.js` | Bug fix | 4 bugs fixed (soft-delete, AND→OR, deleted_at) |
| 2 | `scripts/migrations/089_universal_source_entity_map.sql` | **NEW** | source_entity_map table + state normalization |
| 3 | `scripts/maintenance/backfillSourceEntityMap.cjs` | **NEW** | Bulk backfill from existing data |
| 4 | `scripts/maintenance/mergeV1LegacyDuplicates.cjs` | **NEW** | Retroactive bulk team merge |
| 5 | `scripts/universal/dataQualityEngine.js` | Prevention | Tier 1/2/3 in findOrCreateTeam + findOrCreateEvent |
| 6 | `scripts/maintenance/fastProcessStaging.cjs` | Prevention | Bulk source ID lookup + NULL-tolerant fallback |
| 7 | `scripts/universal/coreScraper.js` | Enhancement | Emit source_home/away_team_id in raw_data |
| 8 | `docs/1.2-ARCHITECTURE.md` | Doc update | source_entity_map section + resolution tiers |
| 9 | `docs/3-DATA_EXPANSION_ROADMAP.md` | Doc update | Rule 5: Source Entity IDs Required |
| 10 | `docs/3-DATA_SCRAPING_PLAYBOOK.md` | Doc update | Three-tier resolution pattern + updated checklists |
| 11 | `CLAUDE.md` | Doc update | Principle 34 + Session 89 status + DB counts |
| 12 | `docs/SESSION_89_UNIVERSAL_ENTITY_RESOLUTION.md` | **NEW** | This document |

---

## Verification: SBV Pre-NAL 15

The original symptom that triggered this session:

**Before:** "Sporting Blue Valley SPORTING BV Pre-NAL 15 (U11 Boys)" showed 27 matches with 8 duplicate pairs visible in Team Details.

**After:** Single team with 24 matches (3 soft-deleted as semantic duplicates). Zero duplicate pairs.

---

## Key Lessons

1. **Source IDs are the foundation** — Name-based matching will always have edge cases. Deterministic source ID mapping is 100% accurate.
2. **NULL metadata creates duplicates** — V1 migration teams with NULL birth_year/gender were invisible to exact-match dedup. NULL-tolerant matching is essential.
3. **Partial unique indexes > constraints** — Soft-deleted rows can legitimately share the same semantic key. Use `WHERE deleted_at IS NULL` partial index.
4. **Bulk SQL > row-by-row** — 7,253 merges in seconds with bulk SQL vs hours with individual transactions.
5. **Register source IDs at creation time** — Every entity created should immediately register its source ID to prevent future duplicates.
6. **Clean team names BEFORE building lookup keys** — `removeDuplicatePrefix()` must be applied to raw staging names BEFORE `makeTeamKey()`, not after. Building keys from raw names while storing cleaned names in `teamMap` creates a silent mismatch that causes match insertion to fail. (Session 107: 11,061 matches recovered after fixing this in `fastProcessStaging.cjs` lines 104-105.)
