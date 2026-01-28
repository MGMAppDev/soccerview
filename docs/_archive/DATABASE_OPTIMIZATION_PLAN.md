# Database Optimization Plan - SoccerView

> **Version:** 1.0
> **Created:** January 25, 2026
> **Status:** Analysis Complete - Ready for Implementation
> **Priority:** HIGH - Critical for Scalability

---

## Executive Summary

### Current Database State

| Table | Size | Rows | Status |
|-------|------|------|--------|
| **match_results** | 430 MB | 467,001 | ✅ Well-indexed |
| **teams** | 355 MB | 145,214 | ⚠️ Duplicate indexes found |
| **team_name_aliases** | 165 MB | 352,560 | ⚠️ Fuzzy matching bottleneck |
| **rank_history** | 174 MB | N/A | ✅ Historical data |

### Performance Issues Identified

| Issue | Impact | Priority | Est. Improvement |
|-------|--------|----------|------------------|
| Duplicate trigram indexes on `teams` | Wasted 100+ MB | 🟠 MEDIUM | -100 MB storage |
| Missing composite index for league queries | Slow league standings (500ms+) | 🔴 HIGH | 500ms → 50ms (10x) |
| Missing composite index for ELO queries | Slow ELO recalc (2-3 min) | 🔴 HIGH | 3 min → 1 min (3x) |
| Unoptimized fuzzy matching on 352K aliases | Linking timeout issues | 🔴 CRITICAL | 45s → 8s (5x) |
| No index on teams reconciliation filters | Reconciliation crashes | 🔴 CRITICAL | 10-12 hrs → 2-3 hrs (4x) |

**Total Expected Improvement:**
- Query performance: **3-10x faster**
- Storage savings: **~100 MB**
- Reconciliation time: **10-12 hrs → 2-3 hrs**
- Linking time: **45s/batch → 8s/batch**

---

## Table of Contents

1. [Current Index Analysis](#current-index-analysis)
2. [Performance Bottlenecks](#performance-bottlenecks)
3. [Optimization Recommendations](#optimization-recommendations)
4. [Implementation Plan](#implementation-plan)
5. [Benchmark Tests](#benchmark-tests)
6. [Rollback Strategy](#rollback-strategy)

---

## 1. Current Index Analysis

### 1.1 match_results Table (430 MB, 467K rows)

**Existing Indexes (16 total):**

| Index Name | Type | Columns | Usage | Status |
|------------|------|---------|-------|--------|
| `idx_match_results_date` | BTREE | `match_date` | ELO calc, recent matches | ✅ GOOD |
| `idx_match_results_home_team` | BTREE | `home_team_id` | Team lookups | ✅ GOOD |
| `idx_match_results_away_team` | BTREE | `away_team_id` | Team lookups | ✅ GOOD |
| `idx_match_results_event` | BTREE | `event_id` | League queries | ✅ GOOD |
| `idx_match_results_status` | BTREE | `status` | Filter completed matches | ✅ GOOD |
| `idx_match_results_season` | BTREE | `season` | Season filtering | ✅ GOOD |
| `idx_match_results_source_platform` | BTREE | `source_platform` | Multi-source | ✅ GOOD |
| `idx_match_results_home_name` | BTREE | `lower(home_team_name)` | Name lookups | ✅ GOOD |
| `idx_match_results_away_name` | BTREE | `lower(away_team_name)` | Name lookups | ✅ GOOD |
| `idx_match_results_recent_scored` | BTREE | `match_date DESC` WHERE ... | Recent matches | ✅ GOOD |
| `match_results_source_match_key_unique` | UNIQUE | `source_match_key` | Deduplication | ✅ GOOD |

**Analysis:**
- ✅ Good coverage for basic queries
- ⚠️ **MISSING:** Composite indexes for complex queries (see recommendations)
- ⚠️ **MISSING:** Index for league standings calculation
- ⚠️ **MISSING:** Index for ELO recalculation optimization

**Current Query Patterns:**
```sql
-- ELO Recalculation (recalculate_elo_v2.js)
SELECT id, home_team_id, away_team_id, home_score, away_score, match_date
FROM match_results
WHERE home_team_id IS NOT NULL
  AND away_team_id IS NOT NULL
  AND home_score IS NOT NULL
  AND away_score IS NOT NULL
  AND status = 'completed'
  AND match_date >= '2025-08-01'
ORDER BY match_date ASC NULLS LAST, id ASC;
-- ⚠️ Uses: idx_match_results_date + filters (not optimal)

-- League Standings (lib/leagues.ts)
SELECT ...
FROM match_results
WHERE event_id = $1
  AND home_team_id IS NOT NULL
  AND away_team_id IS NOT NULL
  AND home_score IS NOT NULL
  AND away_score IS NOT NULL
ORDER BY match_date;
-- ⚠️ Uses: idx_match_results_event + date sort (not optimal)
```

### 1.2 teams Table (355 MB, 145K rows)

**Existing Indexes (22 total):**

| Index Name | Type | Columns | Usage | Status |
|------------|------|---------|-------|--------|
| `idx_teams_name_trgm` | GIN | `team_name gin_trgm_ops` | Fuzzy matching | ✅ GOOD |
| `idx_teams_team_name_trgm` | GIN | `team_name gin_trgm_ops` | Fuzzy matching | ⚠️ **DUPLICATE** |
| `idx_teams_lower_name` | BTREE | `lower(team_name)` | Exact lookups | ✅ GOOD |
| `idx_teams_elo_rating` | BTREE | `elo_rating DESC` | Rankings | ✅ GOOD |
| `idx_teams_elo_national_rank` | BTREE | `elo_national_rank` | Rankings | ✅ GOOD |
| `idx_teams_national_rank` | BTREE | `national_rank` | Official rankings | ✅ GOOD |
| `idx_teams_state` | BTREE | `state` | State filters | ✅ GOOD |
| `idx_teams_gender` | BTREE | `gender` | Gender filters | ✅ GOOD |
| `idx_teams_age_group` | BTREE | `age_group` | Age filters | ✅ GOOD |
| `idx_teams_composite_filters` | BTREE | `state, gender, age_group` WHERE ... | Multi-filter | ✅ GOOD |
| `idx_teams_ranked` | BTREE | `id` WHERE national_rank IS NOT NULL | Reconciliation | ⚠️ PARTIAL |

**⚠️ CRITICAL ISSUE: Duplicate Indexes**
```sql
-- DUPLICATE 1:
idx_teams_name_trgm        ON teams USING gin (team_name gin_trgm_ops)
idx_teams_team_name_trgm   ON teams USING gin (team_name gin_trgm_ops)
-- These are IDENTICAL - wasting ~100 MB storage + write overhead

-- DUPLICATE 2 (minor):
idx_teams_elo_rating       ON teams (elo_rating DESC NULLS LAST)
idx_teams_rating           ON teams (elo_rating DESC)
-- Slightly different but redundant
```

**Missing Index for Reconciliation:**
```sql
-- Current reconciliation query (reconcileRankedTeams.js):
SELECT id, team_name, national_rank, state_rank, age_group, gender, state, matches_played
FROM teams
WHERE national_rank IS NOT NULL AND matches_played = 0
ORDER BY national_rank ASC;
-- ⚠️ Uses: idx_teams_ranked (partial) + table scan for matches_played = 0
-- NEEDS: Composite index on (national_rank, matches_played)
```

### 1.3 team_name_aliases Table (165 MB, 352K rows)

**Existing Indexes (6 total):**

| Index Name | Type | Columns | Usage | Status |
|------------|------|---------|-------|--------|
| `idx_alias_name_trgm` | GIN | `alias_name gin_trgm_ops` | Fuzzy matching | ✅ GOOD |
| `idx_alias_name_lookup` | BTREE | `alias_name` | Exact lookups | ✅ GOOD |
| `idx_alias_team_id` | BTREE | `team_id` | Team lookups | ✅ GOOD |
| `team_name_aliases_alias_name_key` | UNIQUE | `alias_name` | Uniqueness | ✅ GOOD |

**Analysis:**
- ✅ Good trigram coverage for fuzzy matching
- ⚠️ **352,560 rows is HUGE** - Every fuzzy query scans entire table
- ⚠️ **MISSING:** Pre-filter optimization (state, gender, age_group)
- ⚠️ **MISSING:** Composite index for filtered fuzzy matching

**Current Query Pattern (fastLinkV3.js):**
```sql
-- Fuzzy match query (runs 1000s of times):
SELECT team_id, alias_name, similarity(alias_name, $1) as sim
FROM team_name_aliases
WHERE alias_name % $1  -- Trigram similarity operator
ORDER BY sim DESC
LIMIT 1;
-- ⚠️ Scans ALL 352K rows for every query!
-- OPTIMIZATION: Pre-filter by state/gender before fuzzy matching
```

---

## 2. Performance Bottlenecks

### 2.1 ELO Recalculation (recalculate_elo_v2.js)

**Current Performance:**
- Total time: **2-3 minutes**
- Processes: 169,141 current season matches
- Bottleneck: Sequential processing with individual team lookups

**Query Analysis:**
```sql
-- Initial match fetch (runs once):
SELECT id, home_team_id, away_team_id, home_score, away_score, match_date
FROM match_results
WHERE home_team_id IS NOT NULL
  AND away_team_id IS NOT NULL
  AND home_score IS NOT NULL
  AND away_score IS NOT NULL
  AND status = 'completed'
  AND match_date >= '2025-08-01'
ORDER BY match_date ASC NULLS LAST, id ASC;

-- Current index usage:
-- Primary: idx_match_results_date (match_date)
-- Filters: Table scan for team_id IS NOT NULL checks
-- Sort: Index scan on match_date

-- EXPLAIN ANALYZE result (estimated):
-- Planning time: 2ms
-- Execution time: 450ms (acceptable)
-- ✅ This query is already well-optimized
```

**Optimization Opportunity:**
```sql
-- Create composite index for this exact query pattern:
CREATE INDEX idx_match_results_elo_calc ON match_results (
  match_date ASC NULLS LAST,
  id ASC
) WHERE home_team_id IS NOT NULL
  AND away_team_id IS NOT NULL
  AND home_score IS NOT NULL
  AND away_score IS NOT NULL
  AND status = 'completed';

-- Expected improvement: 450ms → 150ms (3x faster)
```

### 2.2 League Standings Calculation (Future Feature)

**Projected Query:**
```sql
-- Points table calculation (FEATURE_SPEC_LEAGUE_STANDINGS.md):
SELECT
  t.id, t.name, t.club_name, t.age_group, t.gender,
  COUNT(*) AS games_played,
  SUM(CASE WHEN home_score > away_score THEN 1 ELSE 0 END) AS wins,
  -- ... more aggregations
FROM match_results mr
JOIN teams t ON t.id = mr.home_team_id
WHERE mr.event_id = $1
  AND mr.home_team_id IS NOT NULL
  AND mr.away_team_id IS NOT NULL
  AND mr.home_score IS NOT NULL
  AND mr.away_score IS NOT NULL
GROUP BY t.id, t.name, t.club_name, t.age_group, t.gender
ORDER BY points DESC, goal_difference DESC;

-- Current index usage:
-- Primary: idx_match_results_event (event_id)
-- Join: idx_match_results_home_team (home_team_id)
-- ⚠️ NO composite index for (event_id, home_team_id, away_team_id)

-- Expected performance WITHOUT optimization: 500-800ms
-- Expected performance WITH optimization: 50-100ms (5-8x faster)
```

**Optimization:**
```sql
CREATE INDEX idx_match_results_league_standings ON match_results (
  event_id,
  home_team_id,
  away_team_id,
  match_date
) WHERE home_score IS NOT NULL AND away_score IS NOT NULL;

-- Covers:
-- 1. Event filtering (WHERE event_id = $1)
-- 2. Team joins (ON home_team_id / away_team_id)
-- 3. Date sorting (ORDER BY match_date for form calculation)
-- 4. Partial index (only completed matches with scores)
```

### 2.3 Fuzzy Matching (fastLinkV3.js)

**Current Performance:**
- Average: **45 seconds per 1000 unique names**
- Total linking time: **4-5 hours for 76K unlinked matches**
- Bottleneck: Full table scan of 352K aliases for EACH fuzzy query

**Query Breakdown:**
```sql
-- Runs thousands of times (once per unique team name):
SELECT team_id, alias_name, similarity(alias_name, $1) as sim
FROM team_name_aliases
WHERE alias_name % $1  -- GIN index scan (352K rows)
ORDER BY sim DESC
LIMIT 1;

-- Current execution plan:
-- 1. GIN index scan using idx_alias_name_trgm (fast trigram lookup)
-- 2. Calculate similarity for matching candidates (~10-50 rows)
-- 3. Sort by similarity
-- 4. Return top result

-- Execution time per query: 40-80ms
-- Total for 1000 names: 40-80 seconds
```

**Optimization Strategy:**

**Option A: Add team_id to Trigram Index (NOT POSSIBLE)**
- GIN indexes don't support composite columns with operators
- Would need separate filtering step

**Option B: Pre-filter by Team Metadata (RECOMMENDED)**
```sql
-- Step 1: Add metadata columns to team_name_aliases
ALTER TABLE team_name_aliases
  ADD COLUMN state VARCHAR(2),
  ADD COLUMN gender VARCHAR(10),
  ADD COLUMN age_group VARCHAR(10);

-- Step 2: Populate from teams table
UPDATE team_name_aliases tna
SET
  state = t.state,
  gender = t.gender,
  age_group = t.age_group
FROM teams t
WHERE tna.team_id = t.id;

-- Step 3: Create composite index
CREATE INDEX idx_alias_metadata_trgm ON team_name_aliases (
  state, gender, age_group, alias_name
);

-- Step 4: Modify query to pre-filter:
SELECT team_id, alias_name, similarity(alias_name, $1) as sim
FROM team_name_aliases
WHERE state = $2       -- Reduce from 352K to ~7K rows (50x reduction)
  AND gender = $3      -- Further reduce to ~3.5K rows (100x reduction)
  AND alias_name % $1  -- Fuzzy match on much smaller set
ORDER BY sim DESC
LIMIT 1;

-- Expected improvement:
-- Before: 40-80ms per query (352K row scan)
-- After: 5-10ms per query (3.5K row scan)
-- Total linking: 45s/1000 → 8s/1000 (5-6x faster)
```

**Option C: Materialized Similarity Cache (Advanced)**
```sql
-- For frequently matched names, cache similarity scores
CREATE TABLE team_name_similarity_cache (
  name1 TEXT,
  name2 TEXT,
  similarity FLOAT,
  team_id UUID,
  PRIMARY KEY (name1, name2)
);

-- Pre-compute similarities for top 10K most common team names
-- Lookup cache first, fall back to fuzzy matching
-- Expected improvement: 10-20x for cached names
```

### 2.4 Team Reconciliation (reconcileRankedTeams.js)

**Current Performance:**
- Total time: **10-12 hours** (crashes due to timeout)
- Processes: 42,898 ranked teams with 0 matches
- Bottleneck: No index on `(national_rank, matches_played)` filter

**Query Analysis:**
```sql
-- Fetch priority teams (runs once):
SELECT id, team_name, national_rank, state_rank, age_group, gender, state, matches_played
FROM teams
WHERE national_rank IS NOT NULL
  AND matches_played = 0
ORDER BY national_rank ASC;

-- Current index usage:
-- Primary: idx_teams_national_rank (national_rank IS NOT NULL)
-- Filter: Table scan for matches_played = 0
-- ⚠️ Scans all 108K ranked teams, filters to 42K

-- Then for EACH of 42K teams, runs fuzzy match:
SELECT id, team_name, state, gender, age_group, matches_played,
       similarity(team_name, $1) as sim
FROM teams
WHERE state = $2
  AND gender = $3
  AND matches_played > 0  -- Table scan!
  AND team_name % $1
ORDER BY sim DESC
LIMIT 5;

-- ⚠️ No index on matches_played > 0
-- Scans state/gender subset (~1-5K teams) for each query
```

**Optimization:**
```sql
-- Index 1: Priority team fetch
CREATE INDEX idx_teams_reconciliation_priority ON teams (
  national_rank ASC
) WHERE national_rank IS NOT NULL AND matches_played = 0;

-- Index 2: Fuzzy matching candidates
CREATE INDEX idx_teams_reconciliation_candidates ON teams (
  state,
  gender,
  age_group,
  team_name
) WHERE matches_played > 0;

-- Expected improvement:
-- Priority fetch: 2s → 100ms (20x faster)
-- Fuzzy match per team: 150ms → 30ms (5x faster)
-- Total: 10-12 hours → 2-3 hours (4x faster)
```

---

## 3. Optimization Recommendations

### Priority 1: CRITICAL (Implement Immediately)

#### REC-1: Remove Duplicate Trigram Index on teams
**Impact:** Save ~100 MB storage + reduce write overhead

```sql
-- Analysis: Verify they are identical
SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'teams'
  AND indexname IN ('idx_teams_name_trgm', 'idx_teams_team_name_trgm');

-- Result: Both are identical (team_name gin_trgm_ops)

-- Action: Drop duplicate
DROP INDEX IF EXISTS idx_teams_team_name_trgm;

-- Verification:
SELECT pg_size_pretty(pg_total_relation_size('teams'));
-- Expected: 355 MB → ~255 MB (-100 MB)
```

#### REC-2: Add Composite Index for Team Reconciliation
**Impact:** Reconciliation time 10-12 hrs → 2-3 hrs (4x faster)

```sql
-- Index for priority team fetch
CREATE INDEX idx_teams_reconciliation_priority ON teams (
  national_rank ASC
) WHERE national_rank IS NOT NULL AND matches_played = 0;

-- Index for candidate matching
CREATE INDEX idx_teams_reconciliation_candidates ON teams (
  state,
  gender,
  age_group,
  matches_played
) WHERE matches_played > 0;

-- Benefits:
-- 1. Fast fetch of teams needing reconciliation
-- 2. Fast pre-filtering of candidates by state/gender
-- 3. Avoids full table scans
```

#### REC-3: Add Metadata to team_name_aliases for Pre-filtering
**Impact:** Linking time 45s/batch → 8s/batch (5-6x faster)

```sql
-- Step 1: Add columns
ALTER TABLE team_name_aliases
  ADD COLUMN IF NOT EXISTS state VARCHAR(2),
  ADD COLUMN IF NOT EXISTS gender VARCHAR(10),
  ADD COLUMN IF NOT EXISTS age_group VARCHAR(10);

-- Step 2: Populate from teams
UPDATE team_name_aliases tna
SET
  state = t.state,
  gender = t.gender,
  age_group = t.age_group
FROM teams t
WHERE tna.team_id = t.id;

-- Step 3: Create index
CREATE INDEX idx_alias_metadata_filter ON team_name_aliases (
  state, gender
) WHERE state IS NOT NULL AND gender IS NOT NULL;

-- Step 4: Update NOT NULL constraints (after population)
ALTER TABLE team_name_aliases
  ALTER COLUMN state SET NOT NULL,
  ALTER COLUMN gender SET NOT NULL;

-- Benefits:
-- 1. Pre-filter 352K aliases to ~3-5K before fuzzy matching
-- 2. 100x reduction in rows to scan
-- 3. Dramatically faster linking
```

### Priority 2: HIGH (Implement Before V1.1 Release)

#### REC-4: Add Composite Index for League Standings
**Impact:** League query 500ms → 50ms (10x faster)

```sql
CREATE INDEX idx_match_results_league_standings ON match_results (
  event_id,
  home_team_id,
  away_team_id,
  match_date
) WHERE home_score IS NOT NULL
  AND away_score IS NOT NULL
  AND home_team_id IS NOT NULL
  AND away_team_id IS NOT NULL;

-- Benefits:
-- 1. Fast event filtering
-- 2. Efficient team joins
-- 3. Quick date sorting for form calculation
-- 4. Only indexes completed matches with scores
```

#### REC-5: Add Composite Index for ELO Recalculation
**Impact:** ELO query 450ms → 150ms (3x faster)

```sql
CREATE INDEX idx_match_results_elo_calc ON match_results (
  match_date ASC NULLS LAST,
  id ASC
) WHERE home_team_id IS NOT NULL
  AND away_team_id IS NOT NULL
  AND home_score IS NOT NULL
  AND away_score IS NOT NULL
  AND status = 'completed'
  AND match_date >= '2025-08-01';  -- Update annually

-- Benefits:
-- 1. Single index scan for entire query
-- 2. Pre-sorted by match_date + id
-- 3. Partial index only on current season
-- 4. Smaller index size (~30% of full table)

-- ⚠️ IMPORTANT: Update date filter annually (Aug 1)
```

### Priority 3: MEDIUM (Performance Enhancements)

#### REC-6: Create Covering Index for Team Search
**Impact:** Team search 200ms → 80ms (2.5x faster)

```sql
CREATE INDEX idx_teams_search_covering ON teams (
  lower(team_name),
  id,
  club_name,
  state,
  gender,
  age_group,
  elo_rating,
  national_rank,
  matches_played
) WHERE matches_played > 0;

-- Benefits:
-- 1. Index-only scan (no table access)
-- 2. All search result columns in index
-- 3. Faster app loading
```

#### REC-7: Add GIN Index for Event Name Search
**Impact:** Event search 300ms → 50ms (6x faster)

```sql
CREATE INDEX idx_event_registry_name_trgm ON event_registry
USING gin (event_name gin_trgm_ops);

-- Benefits:
-- 1. Fast fuzzy search for events
-- 2. Supports "ILIKE" queries
-- 3. Better UX for event discovery
```

### Priority 4: LOW (Nice to Have)

#### REC-8: Partition match_results by Season
**Impact:** Faster queries, easier archival

```sql
-- Create partitioned table (requires table rebuild)
CREATE TABLE match_results_new (
  -- Same schema as match_results
) PARTITION BY RANGE (match_date);

-- Create partitions
CREATE TABLE match_results_2024 PARTITION OF match_results_new
  FOR VALUES FROM ('2024-08-01') TO ('2025-08-01');

CREATE TABLE match_results_2025 PARTITION OF match_results_new
  FOR VALUES FROM ('2025-08-01') TO ('2026-08-01');

-- Benefits:
-- 1. Queries only scan relevant season
-- 2. Easy archival of old data
-- 3. Better vacuum performance

-- ⚠️ RISK: Major schema change, requires migration
-- DEFER: Not needed until 1M+ matches
```

---

## 4. Implementation Plan

### Phase 1: Immediate Fixes (This Week)

**Estimated Time:** 30 minutes
**Risk Level:** 🟢 LOW

```sql
-- Step 1: Remove duplicate index (5 min)
DROP INDEX IF EXISTS idx_teams_team_name_trgm;
ANALYZE teams;

-- Step 2: Add reconciliation indexes (10 min)
CREATE INDEX CONCURRENTLY idx_teams_reconciliation_priority ON teams (
  national_rank ASC
) WHERE national_rank IS NOT NULL AND matches_played = 0;

CREATE INDEX CONCURRENTLY idx_teams_reconciliation_candidates ON teams (
  state, gender, age_group, matches_played
) WHERE matches_played > 0;

ANALYZE teams;

-- Step 3: Verify (5 min)
SELECT
  schemaname,
  tablename,
  indexname,
  pg_size_pretty(pg_relation_size(indexrelid)) as index_size
FROM pg_stat_user_indexes
WHERE tablename = 'teams'
ORDER BY pg_relation_size(indexrelid) DESC;
```

**Expected Results:**
- ✅ 100 MB storage saved
- ✅ Reconciliation ready for overnight run (2-3 hrs instead of 10-12 hrs)
- ✅ No downtime (CONCURRENTLY)

### Phase 2: Fuzzy Matching Optimization (Next Week)

**Estimated Time:** 2 hours
**Risk Level:** 🟡 MEDIUM (schema change)

```sql
-- Step 1: Add metadata columns (5 min)
ALTER TABLE team_name_aliases
  ADD COLUMN IF NOT EXISTS state VARCHAR(2),
  ADD COLUMN IF NOT EXISTS gender VARCHAR(10),
  ADD COLUMN IF NOT EXISTS age_group VARCHAR(10);

-- Step 2: Populate from teams (30 min - 352K rows)
UPDATE team_name_aliases tna
SET
  state = t.state,
  gender = t.gender,
  age_group = t.age_group
FROM teams t
WHERE tna.team_id = t.id;

-- Monitor progress:
SELECT
  COUNT(*) FILTER (WHERE state IS NOT NULL) AS populated,
  COUNT(*) AS total,
  ROUND(100.0 * COUNT(*) FILTER (WHERE state IS NOT NULL) / COUNT(*), 1) AS pct
FROM team_name_aliases;

-- Step 3: Create index (15 min)
CREATE INDEX CONCURRENTLY idx_alias_metadata_filter ON team_name_aliases (
  state, gender, alias_name
) WHERE state IS NOT NULL AND gender IS NOT NULL;

ANALYZE team_name_aliases;

-- Step 4: Update linking scripts (30 min)
-- Modify fastLinkV3.js to use state/gender pre-filtering

-- Step 5: Test (30 min)
-- Run linking on 100 sample names, verify 5-6x speedup
```

**Expected Results:**
- ✅ Linking 45s/batch → 8s/batch (5-6x faster)
- ✅ Future linking runs complete in 1-2 hours instead of 4-5 hours
- ✅ Reconciliation fuzzy matching also faster

### Phase 3: League Standings Preparation (Before V1.1)

**Estimated Time:** 30 minutes
**Risk Level:** 🟢 LOW

```sql
-- Step 1: Create league standings index (15 min)
CREATE INDEX CONCURRENTLY idx_match_results_league_standings ON match_results (
  event_id,
  home_team_id,
  away_team_id,
  match_date
) WHERE home_score IS NOT NULL
  AND away_score IS NOT NULL
  AND home_team_id IS NOT NULL
  AND away_team_id IS NOT NULL;

ANALYZE match_results;

-- Step 2: Create ELO optimization index (15 min)
CREATE INDEX CONCURRENTLY idx_match_results_elo_calc ON match_results (
  match_date ASC NULLS LAST,
  id ASC
) WHERE home_team_id IS NOT NULL
  AND away_team_id IS NOT NULL
  AND home_score IS NOT NULL
  AND away_score IS NOT NULL
  AND status = 'completed'
  AND match_date >= '2025-08-01';

ANALYZE match_results;
```

**Expected Results:**
- ✅ League standings query 500ms → 50ms (ready for V1.1 feature)
- ✅ ELO recalc 3 min → 1 min (3x faster)
- ✅ No downtime

### Phase 4: Advanced Optimizations (Future)

**Estimated Time:** 4-6 hours
**Risk Level:** 🟡 MEDIUM

- Covering indexes for common queries
- GIN indexes for event search
- Query plan analysis and tuning
- Materialized views for expensive aggregations

---

## 5. Benchmark Tests

### Test 1: ELO Recalculation Performance

**Before Optimization:**
```bash
node scripts/recalculate_elo_v2.js
# Expected: 2-3 minutes
```

**After Optimization:**
```bash
node scripts/recalculate_elo_v2.js
# Expected: 1 minute (3x faster)
```

**Benchmark Script:**
```javascript
// scripts/benchmarkELO.js
const start = Date.now();
await runELORecalculation();
const elapsed = (Date.now() - start) / 1000;
console.log(`ELO recalculation: ${elapsed}s`);
// Target: <60s
```

### Test 2: Fuzzy Matching Performance

**Before Optimization:**
```bash
node scripts/fastLinkV3.js --limit 1000
# Expected: 40-80 seconds
```

**After Optimization:**
```bash
node scripts/fastLinkV3.js --limit 1000
# Expected: 8-15 seconds (5x faster)
```

**Benchmark Query:**
```sql
-- Test single fuzzy match
EXPLAIN ANALYZE
SELECT team_id, alias_name, similarity(alias_name, 'sporting kc 2009 boys') as sim
FROM team_name_aliases
WHERE state = 'KS'
  AND gender = 'Boys'
  AND alias_name % 'sporting kc 2009 boys'
ORDER BY sim DESC
LIMIT 1;

-- Target: <10ms execution time
```

### Test 3: League Standings Performance

**Benchmark Query:**
```sql
-- Test league standings calculation
EXPLAIN ANALYZE
SELECT
  t.id,
  t.name,
  COUNT(*) as gp,
  SUM(CASE WHEN mr.home_score > mr.away_score THEN 1 ELSE 0 END) as wins
FROM match_results mr
JOIN teams t ON t.id = mr.home_team_id
WHERE mr.event_id = '550c9e2e-7f18-48cd-82a8-c7ff991d5e7a'  -- Sample event
  AND mr.home_team_id IS NOT NULL
  AND mr.away_team_id IS NOT NULL
GROUP BY t.id, t.name
ORDER BY wins DESC;

-- Before: 500-800ms
-- After: 50-100ms (5-8x faster)
```

### Test 4: Team Reconciliation Performance

**Before Optimization:**
```bash
time node scripts/reconcileRankedTeams.js --limit 1000
# Expected: 2-3 hours
```

**After Optimization:**
```bash
time node scripts/reconcileRankedTeams.js --limit 1000
# Expected: 30-45 minutes (4x faster)
```

---

## 6. Rollback Strategy

### Rollback Scripts

Create rollback SQL for each phase:

**Phase 1 Rollback:**
```sql
-- Restore duplicate index if needed
CREATE INDEX idx_teams_team_name_trgm ON teams
USING gin (team_name gin_trgm_ops);

-- Drop reconciliation indexes
DROP INDEX IF EXISTS idx_teams_reconciliation_priority;
DROP INDEX IF EXISTS idx_teams_reconciliation_candidates;
```

**Phase 2 Rollback:**
```sql
-- Drop metadata columns
ALTER TABLE team_name_aliases
  DROP COLUMN IF EXISTS state,
  DROP COLUMN IF EXISTS gender,
  DROP COLUMN IF EXISTS age_group;

-- Drop index
DROP INDEX IF EXISTS idx_alias_metadata_filter;
```

**Phase 3 Rollback:**
```sql
-- Drop league/ELO indexes
DROP INDEX IF EXISTS idx_match_results_league_standings;
DROP INDEX IF EXISTS idx_match_results_elo_calc;
```

### Monitoring After Changes

```sql
-- Check index usage
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan DESC;

-- Check table bloat
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS total_size,
  pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) AS table_size,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) AS index_size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

---

## 7. Success Metrics

### Performance Targets

| Metric | Before | Target | Improvement |
|--------|--------|--------|-------------|
| **ELO Recalculation** | 2-3 min | 1 min | 3x faster |
| **Fuzzy Linking (1K names)** | 45s | 8s | 5-6x faster |
| **Team Reconciliation** | 10-12 hrs | 2-3 hrs | 4x faster |
| **League Standings Query** | 500ms | 50ms | 10x faster |
| **Storage (teams table)** | 355 MB | 255 MB | -100 MB |

### Monitoring Dashboard

Track these metrics weekly:

```sql
-- Query performance metrics
SELECT
  query,
  calls,
  mean_exec_time,
  max_exec_time
FROM pg_stat_statements
WHERE query LIKE '%match_results%'
  OR query LIKE '%teams%'
  OR query LIKE '%team_name_aliases%'
ORDER BY mean_exec_time DESC
LIMIT 20;

-- Index hit rate (should be >95%)
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan,
  ROUND(100.0 * idx_scan / NULLIF(idx_scan + seq_scan, 0), 1) AS index_hit_rate
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY index_hit_rate ASC;
```

---

## 8. Migration Checklist

### Pre-Implementation

- [ ] Backup database
- [ ] Test rollback scripts on staging
- [ ] Notify team of maintenance window (if needed)
- [ ] Document current performance baselines

### Implementation (Phase 1)

- [ ] Drop duplicate index: `idx_teams_team_name_trgm`
- [ ] Create: `idx_teams_reconciliation_priority`
- [ ] Create: `idx_teams_reconciliation_candidates`
- [ ] Run ANALYZE on teams table
- [ ] Verify index creation
- [ ] Run benchmark tests

### Implementation (Phase 2)

- [ ] Add metadata columns to team_name_aliases
- [ ] Populate metadata (352K rows - ~30 min)
- [ ] Create: `idx_alias_metadata_filter`
- [ ] Update fastLinkV3.js script
- [ ] Run ANALYZE on team_name_aliases
- [ ] Test linking on 100 sample names
- [ ] Verify 5-6x speedup

### Implementation (Phase 3)

- [ ] Create: `idx_match_results_league_standings`
- [ ] Create: `idx_match_results_elo_calc`
- [ ] Run ANALYZE on match_results
- [ ] Test league standings query
- [ ] Test ELO recalculation
- [ ] Verify performance targets met

### Post-Implementation

- [ ] Monitor query performance for 24 hours
- [ ] Check index usage statistics
- [ ] Verify no regressions
- [ ] Update CLAUDE.md with results
- [ ] Archive benchmark results

---

## Appendix A: SQL Execution Scripts

### Full Implementation Script

```sql
-- ============================================================
-- DATABASE OPTIMIZATION - FULL IMPLEMENTATION
-- ============================================================
-- Run each section separately, verify results before proceeding

-- ============================================================
-- PHASE 1: IMMEDIATE FIXES
-- ============================================================

-- 1.1 Remove duplicate trigram index
DROP INDEX IF EXISTS idx_teams_team_name_trgm;

-- 1.2 Add reconciliation indexes
CREATE INDEX CONCURRENTLY idx_teams_reconciliation_priority ON teams (
  national_rank ASC
) WHERE national_rank IS NOT NULL AND matches_played = 0;

CREATE INDEX CONCURRENTLY idx_teams_reconciliation_candidates ON teams (
  state, gender, age_group, matches_played
) WHERE matches_played > 0;

-- 1.3 Analyze
ANALYZE teams;

-- ============================================================
-- PHASE 2: FUZZY MATCHING OPTIMIZATION
-- ============================================================

-- 2.1 Add metadata columns
ALTER TABLE team_name_aliases
  ADD COLUMN IF NOT EXISTS state VARCHAR(2),
  ADD COLUMN IF NOT EXISTS gender VARCHAR(10),
  ADD COLUMN IF NOT EXISTS age_group VARCHAR(10);

-- 2.2 Populate metadata (may take 20-30 minutes)
UPDATE team_name_aliases tna
SET
  state = t.state,
  gender = t.gender,
  age_group = t.age_group
FROM teams t
WHERE tna.team_id = t.id;

-- 2.3 Create index
CREATE INDEX CONCURRENTLY idx_alias_metadata_filter ON team_name_aliases (
  state, gender, alias_name
) WHERE state IS NOT NULL AND gender IS NOT NULL;

-- 2.4 Analyze
ANALYZE team_name_aliases;

-- ============================================================
-- PHASE 3: LEAGUE STANDINGS & ELO OPTIMIZATION
-- ============================================================

-- 3.1 League standings index
CREATE INDEX CONCURRENTLY idx_match_results_league_standings ON match_results (
  event_id,
  home_team_id,
  away_team_id,
  match_date
) WHERE home_score IS NOT NULL
  AND away_score IS NOT NULL
  AND home_team_id IS NOT NULL
  AND away_team_id IS NOT NULL;

-- 3.2 ELO calculation index
CREATE INDEX CONCURRENTLY idx_match_results_elo_calc ON match_results (
  match_date ASC NULLS LAST,
  id ASC
) WHERE home_team_id IS NOT NULL
  AND away_team_id IS NOT NULL
  AND home_score IS NOT NULL
  AND away_score IS NOT NULL
  AND status = 'completed'
  AND match_date >= '2025-08-01';  -- UPDATE ANNUALLY

-- 3.3 Analyze
ANALYZE match_results;

-- ============================================================
-- VERIFICATION
-- ============================================================

-- Check all new indexes were created
SELECT
  schemaname,
  tablename,
  indexname,
  pg_size_pretty(pg_relation_size(indexrelid)) as index_size
FROM pg_stat_user_indexes
WHERE indexname IN (
  'idx_teams_reconciliation_priority',
  'idx_teams_reconciliation_candidates',
  'idx_alias_metadata_filter',
  'idx_match_results_league_standings',
  'idx_match_results_elo_calc'
)
ORDER BY tablename, indexname;
```

---

## Appendix B: Updated Script Examples

### fastLinkV3.js (with pre-filtering)

```javascript
// OLD QUERY (slow - 352K row scan):
const match = await client.query(`
  SELECT team_id, alias_name, similarity(alias_name, $1) as sim
  FROM team_name_aliases
  WHERE alias_name % $1
  ORDER BY sim DESC
  LIMIT 1
`, [nameLower]);

// NEW QUERY (fast - 3-5K row scan):
const match = await client.query(`
  SELECT team_id, alias_name, similarity(alias_name, $1) as sim
  FROM team_name_aliases
  WHERE state = $2
    AND gender = $3
    AND alias_name % $1
  ORDER BY sim DESC
  LIMIT 1
`, [nameLower, extractedState, extractedGender]);

// Expected: 40-80ms → 5-10ms per query (5-8x faster)
```

### reconcileRankedTeams.js (with optimized indexes)

```javascript
// Fetch priority teams (now uses idx_teams_reconciliation_priority)
const priorityTeams = await client.query(`
  SELECT id, team_name, national_rank, state, gender, age_group
  FROM teams
  WHERE national_rank IS NOT NULL
    AND matches_played = 0
  ORDER BY national_rank ASC
  LIMIT $1
`, [limit]);

// Find candidates (now uses idx_teams_reconciliation_candidates)
const candidates = await client.query(`
  SELECT id, team_name, similarity(team_name, $1) as sim
  FROM teams
  WHERE state = $2
    AND gender = $3
    AND matches_played > 0
    AND team_name % $1
  ORDER BY sim DESC
  LIMIT 5
`, [normalizedName, state, gender]);

// Expected: 150ms → 30ms per team (5x faster)
```

---

**Document Status:** ✅ Ready for Implementation
**Next Steps:** Execute Phase 1 (30 min), run reconciliation overnight
**Estimated Total Time:** 3-4 hours over 2 weeks
**Expected ROI:** 3-10x performance improvement, -100 MB storage

---

**Last Updated:** January 25, 2026
**Author:** Claude AI (SoccerView SME)
**Review Status:** Pending stakeholder approval
