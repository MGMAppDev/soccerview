# SoccerView Ranking Methodology

> **Version 1.1** | Updated: February 3, 2026 | Session 84 (Premier-Only Policy)
>
> Authoritative specification for the SoccerView Power Rating (ELO-based) system.
> This document supplements ARCHITECTURE.md and defines how rankings are calculated.
>
> **⚠️ SCOPE: SoccerView rankings cover PREMIER/COMPETITIVE youth soccer ONLY.**
> Recreational and community-level teams are excluded (Session 84).

---

## Table of Contents

1. [Overview](#overview)
2. [Integration with V2 Architecture](#integration-with-v2-architecture)
3. [ELO Calculation Formula](#elo-calculation-formula)
4. [Rank Calculation Methodology](#rank-calculation-methodology)
5. [Consistent Baseline Principle](#consistent-baseline-principle)
6. [Industry Comparison](#industry-comparison)
7. [Implementation Files](#implementation-files)
8. [Future Enhancements](#future-enhancements)

---

## 1. Overview {#overview}

SoccerView provides **two competing ranking systems**:

| System | Source | Method | Visual Style |
|--------|--------|--------|--------------|
| **Official Rankings** | GotSport | Points accumulation | Gold/Amber with 🏆 |
| **SoccerView Power Rating** | Proprietary | ELO algorithm | Blue with ⚡ |

**Marketing Message:** SoccerView Power Rating uses the same ELO methodology FIFA adopted for World Rankings in 2018.

### Why Two Systems?

- **Official Rankings** = What tournament directors use for seeding
- **SoccerView Power Rating** = Real-time strength indicator based on ALL matches

Users can compare both and form their own opinion on which better reflects reality.

---

## 2. Integration with V2 Architecture {#integration-with-v2-architecture}

Ranking data flows through the standard 3-layer architecture:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ LAYER 2: PRODUCTION (Where ELO & Ranks are calculated/stored)          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   teams_v2                       rank_history_v2                        │
│   ────────────────               ──────────────────                     │
│   • elo_rating                   • snapshot_date                        │
│   • elo_national_rank            • elo_rating (at that date)            │
│   • elo_state_rank               • elo_national_rank                    │
│   • matches_played               • elo_state_rank                       │
│   • wins / losses / draws        • national_rank (GotSport)             │
│                                  • state_rank (GotSport)                │
│                                                                         │
│   Populated by:                  Populated by:                          │
│   recalculate_elo_v2.js          captureRankSnapshot.js (nightly)       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼ refresh_app_views()
┌─────────────────────────────────────────────────────────────────────────┐
│ LAYER 3: APP VIEWS (Pre-computed for app consumption)                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   app_team_profile (JSONB includes rank_history[])                      │
│   ────────────────────────────────────────────────                      │
│   • rank_history[] embedded for ranking journey chart                   │
│   • ELO rating, national rank, state rank                               │
│   • Used by: Team Detail page rank chart                                │
│                                                                         │
│   app_rankings (For rankings list page)                                 │
│   ─────────────────────────────────────                                 │
│   • Pre-joined team data with ELO + official ranks                      │
│   • Indexed for search and filters                                      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Key Tables

| Table | Purpose | Updated By |
|-------|---------|------------|
| `teams_v2` | Current ELO rating + ranks | `recalculate_elo_v2.js` |
| `rank_history_v2` | Historical snapshots for charts | `captureRankSnapshot.js` |
| `seasons` | Season boundaries | Manual / migration |

---

## 3. ELO Calculation Formula {#elo-calculation-formula}

### Current Implementation (v2.1)

**File:** `scripts/daily/recalculate_elo_v2.js`

```javascript
// Constants
const K_FACTOR = 32;
const STARTING_ELO = 1500;

// Expected score (standard ELO formula)
const expHome = 1.0 / (1.0 + Math.pow(10, (awayElo - homeElo) / 400.0));

// New rating after match
const newHomeElo = homeElo + K_FACTOR * (actHome - expHome);
const newAwayElo = awayElo + K_FACTOR * (actAway - (1.0 - expHome));

// actHome/actAway: 1.0 = win, 0.5 = draw, 0.0 = loss
```

### Formula Breakdown

```
P_new = P_old + K × (W - W_e)

Where:
  P_new = New rating
  P_old = Old rating
  K     = K-factor (32)
  W     = Actual result (1=win, 0.5=draw, 0=loss)
  W_e   = Expected result from: 1 / (1 + 10^((P_opponent - P_team)/400))
```

### Season Handling

- **Season boundaries** from `seasons` table (single source of truth)
- **Current season:** August 1, 2025 - July 31, 2026
- **All teams reset to 1500** at season start
- **Only current season matches** are processed

**Rationale:** Youth soccer teams completely change rosters annually through tryouts. A cumulative ELO across seasons would be meaningless.

### ELO Grade Scale

| Grade | ELO Range | Description | Percentile |
|-------|-----------|-------------|------------|
| A+ | 1650+ | Elite national contender | Top 1% |
| A | 1600-1649 | Top tier competitor | Top 3% |
| A- | 1550-1599 | Strong regional team | Top 7% |
| B+ | 1525-1549 | Competitive | Top 15% |
| B | 1500-1524 | Above average | Top 30% |
| B- | 1475-1499 | Solid | Top 45% |
| C+ | 1450-1474 | Average | Top 60% |
| C | 1425-1449 | Below average | Top 75% |
| C- | 1400-1424 | Developing | Top 85% |
| D+ | 1375-1399 | Rebuilding | Top 92% |
| D | 1350-1374 | New/Struggling | Top 97% |
| D- | Below 1350 | Early stage | Bottom 3% |

---

## 4. Rank Calculation Methodology {#rank-calculation-methodology}

### Current Ranks (teams_v2)

Calculated in `recalculate_elo_v2.js` Step 5:

```sql
-- National rank: Position among all teams in same birth_year + gender
WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY birth_year, gender
      ORDER BY elo_rating DESC NULLS LAST
    ) as nat_rank
  FROM teams_v2
  WHERE matches_played > 0
)
UPDATE teams_v2 t SET elo_national_rank = r.nat_rank FROM ranked r WHERE t.id = r.id;

-- State rank: Position among teams in same state + birth_year + gender
WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY state, birth_year, gender
      ORDER BY elo_rating DESC NULLS LAST
    ) as st_rank
  FROM teams_v2
  WHERE matches_played > 0 AND state IS NOT NULL
)
UPDATE teams_v2 t SET elo_state_rank = r.st_rank FROM ranked r WHERE t.id = r.id;
```

### Historical Ranks (rank_history_v2)

Captured nightly by `captureRankSnapshot.js`:

```sql
INSERT INTO rank_history_v2 (team_id, snapshot_date, elo_rating, elo_national_rank, elo_state_rank)
SELECT id, CURRENT_DATE, elo_rating, elo_national_rank, elo_state_rank
FROM teams_v2
WHERE matches_played > 0 OR national_rank IS NOT NULL;
```

---

## 5. Consistent Baseline Principle {#consistent-baseline-principle}

### The Problem (Fixed in Session 70)

Historical ranks were calculated against the pool of teams **that had data on that specific date**. This caused:

| Date | ELO | Teams in Pool | Rank | Issue |
|------|-----|---------------|------|-------|
| Aug 8 | 1484 | 50 | #29 | ❌ Pool too small |
| Oct 4 | 1558 | 200 | #5 | ❌ Artificially high |
| Feb 1 | 1469 | 4,405 | #3,551 | ✅ Realistic |

A team showing "#5 nationally" in October was misleading—they were simply one of the first teams to have matches recorded.

### The Solution: Consistent Baseline

**For historical ranks:** Rank each historical ELO against the **CURRENT full team pool**.

```sql
-- For any historical ELO value, calculate what rank it would be TODAY
SELECT (
  SELECT COUNT(*) + 1
  FROM teams_v2 t2
  WHERE t2.birth_year = :birth_year
    AND t2.gender = :gender
    AND t2.matches_played > 0
    AND t2.elo_rating > :historical_elo_value
) as elo_national_rank;
```

### Corrected Results

| Date | ELO | National Rank | Description |
|------|-----|---------------|-------------|
| Aug 8 | 1484 | #2,967 | ✅ Reasonable start |
| Sep 27 | 1531 | #730 | ✅ Improving |
| Oct 4 | 1558 | #304 | ✅ Peak - Top 7% |
| Nov 9 | 1501 | #1,879 | ✅ After losses |
| Feb 1 | 1469 | #3,551 | ✅ Current |

**Result:** Rank changes now reflect actual ELO changes, not pool size changes.

### Implementation

**File:** `scripts/maintenance/recalculateHistoricalRanks.cjs`

- Processes by (birth_year, gender) groups
- Uses binary search for O(log n) rank lookup
- Batches updates for performance
- **DOES NOT DELETE DATA** - only updates rank columns

---

## 5.5 Division-Seeded Starting ELO (Session 95) {#division-seeded-starting-elo}

### The Closed-Pool Problem

ELO is zero-sum within a closed division pool. All teams start at 1500, and after a full season of intra-division play, the pool average remains 1500. **No amount of post-processing or SOS adjustment can distinguish pool quality** — external information is required.

**Real-world example:** Sporting City 15B Indigo-North (U11 Boys, KS) plays in Heartland Division 7 and went 8-0-0. The ELO system ranked them #1 in the state — ahead of Division 1 teams. This is incorrect: an 8-0 record against Division 7 opponents does not make a team stronger than competitive Division 1 teams.

**Root cause:** All teams start at 1500 regardless of competitive tier. An undefeated Division 7 team can reach ~1756 ELO by beating weak opponents, while a 6-2 Division 1 team might only reach ~1596 against much stronger competition.

### The Solution: Division-Seeded Starting ELO

Inject division tier as a prior into the ELO calculation:

```
seed_elo = 1500 + (median_division - team_division) * DIVISION_STEP
```

**Parameters:**
- `DIVISION_STEP = 15` — Conservative, tunable. 90-point spread for a 14-division league.
- `median_division` — Auto-calculated per league (center tier). Keeps overall average at ~1500.
- `team_division` — Numeric tier extracted from `league_standings.division`.

**Division extraction is universal** — handles all formats:

| Format | Example | Extraction |
|--------|---------|------------|
| Numeric | "Division 7", "Subdivision 3" | Regex: `/division\s*(\d+)/` |
| Named | "Premier", "Gold", "Silver" | NAMED_TIER_ORDINALS lookup |
| Ordinal | "1st Division", "3rd" | NAMED_TIER_ORDINALS lookup |
| Sub-tier | "Div 2a", "Div 2b" | Numeric part only (share tier) |

### Math Example (Heartland, 14 divisions)

| Division | Tier | Seed ELO | Description |
|----------|------|----------|-------------|
| Division 1 | 1 | **1598** | Top tier — 98 pts above baseline |
| Division 7 | 7 | **1508** | Middle tier — near baseline |
| Division 14 | 14 | **1403** | Bottom tier — 97 pts below |

After an 8-0 season, a Division 7 team gains ~256 ELO → final ~1764. A Division 1 team going 6-2 gains ~128 → final ~1726. **The gap narrowed but Division 1 maintains a meaningful advantage**, reflecting the harder competition.

### Implementation

**Step 1.5 in recalculate_elo_v2.js** (after reset, before match processing):

1. `buildDivisionSeedMap()` reads `league_standings.division` + `leagues`
2. Groups teams by league, extracts numeric tiers, calculates median
3. Applies formula: `1500 + (median - tier) * 15`
4. Batch-UPDATEs `teams_v2.elo_rating` with seeded values
5. ELO cache reads seeded values: `parseFloat(team.elo_rating) || 1500`

**Files:**
- `scripts/daily/divisionSeedElo.cjs` — Algorithm + seed map builder
- `scripts/daily/recalculate_elo_v2.js` — Step 1.5 integration

### Properties

- **Universal**: Zero source-specific code. Works for any league's division format.
- **Conservative**: DIVISION_STEP=15 produces subtle but meaningful differentiation.
- **Median-centered**: Overall ELO average stays at ~1500 per league.
- **No schema changes**: Uses existing `league_standings.division` column.
- **No UI changes**: Rankings display unchanged.
- **Tunable**: DIVISION_STEP can be adjusted based on empirical results.

---

## 6. Industry Comparison {#industry-comparison}

### GotSport Official Rankings

**Type:** Points Accumulation (NOT ELO)

- Teams earn points from tournament placements
- Flight value based on top 5 teams' national percentile
- Team deduction: 20% of current points (balancing mechanism)
- Bonus points for upsets

**Key Difference:** GotSport is tournament-centric; SoccerView covers ALL matches.

### FIFA World Rankings (Since 2018)

**Type:** ELO-based (called "SUM")

```
P_new = P_old + I × (W - W_e)
```

- Uses 600 divisor (vs our 400) for more stability
- Match importance weighting (8 tiers)
- No goal differential in their version

**SoccerView uses the same ELO foundation** as FIFA's current World Rankings.

### Comparison Table

| Feature | GotSport | FIFA | SoccerView |
|---------|----------|------|------------|
| **Method** | Points | ELO | ELO |
| **Updates** | After tournaments | After matches | After matches |
| **Margin of Victory** | N/A | No | No (future: yes) |
| **Match Importance** | Via flight value | 8 tiers | No (future: yes) |
| **Season Reset** | Varies | Never | Annual |
| **Coverage** | GotSport events only | International | All sources |

---

## 7. Implementation Files {#implementation-files}

### Core Scripts

| Script | Purpose | Schedule |
|--------|---------|----------|
| `scripts/daily/recalculate_elo_v2.js` | Calculate ELO + current ranks | Nightly |
| `scripts/daily/captureRankSnapshot.js` | Capture daily snapshot | Nightly |
| `scripts/maintenance/recalculateHistoricalRanks.cjs` | Fix historical ranks | On-demand |

### Database Tables

| Table | Columns Added/Used |
|-------|-------------------|
| `teams_v2` | elo_rating, elo_national_rank, elo_state_rank |
| `rank_history_v2` | snapshot_date, elo_rating, elo_national_rank, elo_state_rank |
| `seasons` | start_date, end_date, is_current |

### Nightly Pipeline Integration

```yaml
# Phase 3 in daily-data-sync.yml
calculate-elo:
  steps:
    - run: node scripts/daily/recalculate_elo_v2.js
    - run: node scripts/daily/captureRankSnapshot.js
```

---

## 8. Future Enhancements {#future-enhancements}

### Phase 2: Margin of Victory (Planned)

Add goal difference factor:

```javascript
function getGoalDifferenceFactor(goalDiff) {
  const diff = Math.abs(goalDiff);
  if (diff <= 1) return 1.0;
  if (diff === 2) return 1.25;
  if (diff === 3) return 1.5;
  return 1.5 + (diff - 3) * 0.1; // Diminishing returns
}
```

### Phase 3: Match Importance (Planned)

Weight matches by type:

| Match Type | Factor |
|------------|--------|
| Friendly / Scrimmage | 0.5 |
| League Match | 1.0 |
| Tournament Match | 1.25 |
| Championship Game | 1.5 |

**Requires:** `event_type` column in matches_v2

### Phase 4: Dynamic K-Factor (Considered)

Higher K for new teams (faster convergence):

```javascript
const K = team.matches_played < 10 ? 48 : 32;
```

---

## References

- [FIFA World Rankings Methodology](https://inside.fifa.com/fifa-world-ranking/procedure-men)
- [World Football Elo Ratings](https://en.wikipedia.org/wiki/World_Football_Elo_Ratings)
- [GotSport Ranking Points](https://support.gotsport.com/how-are-gotsoccer-ranking-points-calculated)

---

## Anti-Patterns to Avoid

1. **DO NOT delete rank_history_v2 data** — Only update rank columns
2. **DO NOT change UI code** — The chart already works
3. **DO NOT hardcode team pools** — Always query current pool dynamically
4. **DO NOT skip seasons table** — It's the single source of truth for dates
5. **DO NOT include recreational data (Session 84)** — Rankings are premier-level only

---

*This document is authoritative for SoccerView Power Rating methodology.*
*For architecture details, see [1.2-ARCHITECTURE.md](1.2-ARCHITECTURE.md).*
*For data quality, see [2-UNIVERSAL_DATA_QUALITY_SPEC.md](2-UNIVERSAL_DATA_QUALITY_SPEC.md).*
