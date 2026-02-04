> ✅ **STATUS UPDATE (Feb 4, 2026 - Session 85):** UNIVERSAL SOCCERVIEW ID ARCHITECTURE COMPLETE
>
> **Current Database State:**
> - staging_games: 86,491 total (7 unprocessed)
> - matches_v2: **402,887 rows** (Session 85: -8,251 duplicates removed)
> - teams_v2: **157,331 rows** (60,964 with matches)
> - clubs: 124,650 rows
> - leagues: 279 rows
> - tournaments: 1,728 rows
> - **canonical_events: 1,795 rows** (bulk seeded from leagues/tournaments)
> - **canonical_teams: 146,527 rows** (93.1% coverage)
> - **canonical_clubs: 7,301 rows** (bulk seeded from clubs with 3+ teams)
> - **learned_patterns: 0+ rows** (adaptive learning - grows weekly)
> - **staging_rejected: 84,045 rows** (V1 migration rejects)
> - seasons: 3 rows
>
> **Session 85 Universal SoccerView ID Architecture:**
> - Match uniqueness changed from `source_match_key` to semantic key `(match_date, home_team_id, away_team_id)`
> - 8,251 duplicate matches removed, 0 remaining
> - `dataQualityEngine.js` updated to use semantic ON CONFLICT
> - `verifyDataIntegrity.js` updated with semantic duplicate check
> - All entities now use SoccerView IDs as uniqueness anchor
>
> **⚠️ GUARDRAIL:** Always verify canonical registry health before deduplication work!
> See [GUARDRAILS](1.1-GUARDRAILS_v2.md) for mandatory pre-flight checklist.
> **📋 For data issues:** See [DATA_ISSUE_PROTOCOL](DATA_ISSUE_PROTOCOL.md) for prompt template.
>
> **🎉 Universal Data Quality System is SELF-IMPROVING + SELF-HEALING**
# SoccerView Universal Data Quality Specification
## Authoritative Technical Specification v1.0
### Date: January 30, 2026

---

## 🎯 PURPOSE

This document is the **single source of truth** for the Universal Data Quality System. Claude Code MUST reference this document throughout implementation and MUST NOT deviate from these specifications without explicit user approval.

**CRITICAL CONSTRAINT:** This specification covers BACKEND ONLY. No changes to `/app/` folder, React Native components, UI code, or visual design are permitted.

---

## 📋 EXECUTIVE SUMMARY

**Goal:** Create a universal, scalable data quality engine that normalizes, deduplicates, and validates data from ANY source through ONE system.

**Current State:** 
- 38,197 unprocessed staging records (backlog)
- Duplicate events from different scrapers (Heartland example)
- Duplicate teams from name variations
- Empty infrastructure tables (clubs, seasons, venues)
- Only 5 leagues vs expected 280+

**Target State:**
- Zero staging backlog after nightly runs
- No duplicate events, teams, or matches
- Canonical registries as single source of truth
- Infrastructure tables populated
- Self-healing, self-improving data quality

---

## 🔴 CRITICAL REQUIREMENTS (NON-NEGOTIABLE)

### Requirement 1: BACKEND ONLY - NO UI CHANGES

**The frontend visual design is COMPLETE and PROTECTED.**

```
FORBIDDEN - DO NOT TOUCH:
├── /app/                    ❌ ALL files off-limits
├── /components/             ❌ ALL files off-limits
├── Any .tsx files           ❌ NO modifications
├── Any styling              ❌ NO modifications
└── Any visual elements      ❌ NO modifications

PERMITTED - Work here only:
├── /scripts/                ✅ All work here
├── /docs/                   ✅ Documentation updates
├── /.github/workflows/      ✅ Pipeline updates
├── Database tables          ✅ Schema changes OK
└── SQL functions            ✅ New functions OK
```

**Acceptance Criteria:**
- [ ] Zero files modified in /app/ folder
- [ ] Zero files modified in /components/ folder
- [ ] Zero .tsx files modified anywhere
- [ ] All work contained to /scripts/, /docs/, database

---

### Requirement 2: Data Integrity Preservation

**Existing data must remain intact and accurate.**

Before ANY destructive operation (delete, merge, update):
1. Log current state to audit_log
2. Create rollback capability
3. Verify counts match expectations
4. Dry-run mode MUST be available

**Acceptance Criteria:**
- [ ] match_count stable or increasing (never decreasing without explicit approval)
- [ ] team_count stable or decreasing only due to verified duplicate merges
- [ ] ELO rankings unaffected (same algorithm, same inputs = same outputs)
- [ ] Full audit trail in audit_log table

---

### Requirement 3: Universal Single-Engine Architecture

**One engine handles ALL data quality for ALL sources.**

```
ANY Source → staging_games → dataQualityEngine.js → matches_v2
                                    │
                                    ├── teamNormalizer.js
                                    ├── eventNormalizer.js
                                    ├── matchNormalizer.js
                                    └── deduplication modules
```

**Acceptance Criteria:**
- [ ] New sources require ZERO custom quality code
- [ ] All normalization via pluggable normalizers
- [ ] All deduplication via universal engine
- [ ] Configuration-driven, not code-driven

---

### Requirement 4: Protect Existing Pipeline Components

**DO NOT break or replace working systems without validation.**

| Component | Status | Action |
|-----------|--------|--------|
| `inferEventLinkage.js` | ✅ Working | PRESERVE - integrate with |
| `recalculate_elo_v2.js` | ✅ Working | PRESERVE - runs after quality |
| `validationPipeline.js` | ⚠️ May need enhancement | ENHANCE - don't replace |
| `coreScraper.js` | ✅ Working | PRESERVE - feeds staging |
| `refresh_app_views()` | ✅ Working | PRESERVE - runs last |

**Acceptance Criteria:**
- [ ] All existing pipeline components still function
- [ ] New engine integrates WITH existing, not replaces
- [ ] Nightly pipeline completes successfully
- [ ] No regression in data processing

---

## 📊 CURRENT STATE ANALYSIS

### Database Inventory (Updated: January 30, 2026)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ LAYER 1: STAGING                                                        │
│   staging_games:  41,095 total (0 unprocessed - ✅ BACKLOG CLEARED)    │
│   staging_teams:  0                                                     │
│   staging_events: 193                                                   │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ LAYER 2: PRODUCTION                                                     │
│   matches_v2:     304,293 ✅                                            │
│   teams_v2:       147,706 ✅                                            │
│   tournaments:    1,726                                                 │
│   leagues:        280 ✅ (Fixed from 5)                                 │
│   clubs:          122,418 ✅ (Populated)                                │
│   seasons:        3 ✅ (Populated)                                      │
│   venues:         0 (Deferred - not critical)                           │
│   rank_history_v2: 416,904 ✅ (ELO backfilled Aug 2025 - Jan 2026)      │
│   audit_log:      2,727,146                                             │
│   canonical_events: 4 ✅ (Heartland mappings)                           │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ LAYER 3: APP VIEWS                                                      │
│   app_rankings:         142,576                                         │
│   app_matches_feed:     295,575                                         │
│   app_team_profile:     142,576                                         │
│   app_league_standings: 26,696                                          │
│   app_upcoming_schedule: 4,990                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Issues to Resolve (Updated Status)

| Issue | Impact | Priority | Status |
|-------|--------|----------|--------|
| ~~38,197 staging_games unprocessed~~ | ~~Data not flowing to production~~ | ~~P0~~ | ✅ FIXED (0 backlog) |
| ~~Duplicate events (Heartland example)~~ | ~~Team pages show duplicate leagues~~ | ~~P0~~ | ✅ FIXED (Session 59) |
| ~~seasons table empty~~ | ~~Age group calculation broken~~ | ~~P1~~ | ✅ FIXED (3 rows) |
| ~~clubs table empty~~ | ~~Club info not displaying~~ | ~~P2~~ | ✅ FIXED (122K rows) |
| ~~leagues only 5 rows~~ | ~~League data incomplete~~ | ~~P2~~ | ✅ FIXED (280 rows) |
| Duplicate teams (name variations) | Fragmented team history | P2 | 🔄 Phase 4 |

---

## 🏗️ TARGET ARCHITECTURE

### Universal Data Quality Engine

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     DATA SOURCES (Scrapers)                             │
│  GotSport │ HTGSports │ Heartland │ SINC │ Demosphere │ Future...      │
│                                                                         │
│  ALL use: coreScraper.js --adapter {name}                              │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  LAYER 1: STAGING TABLES (Accept Everything - No Validation)            │
│  staging_games, staging_teams, staging_events                           │
│  • ALL fields TEXT, NO constraints, NO foreign keys                     │
│  • Preserves raw_data JSONB for debugging                               │
│  • processed = false until quality engine runs                          │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  UNIVERSAL DATA QUALITY ENGINE                                          │
│  scripts/universal/dataQualityEngine.js                                 │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  STEP 1: NORMALIZE                                              │   │
│  │  ├── teamNormalizer.js    → Standardize team names              │   │
│  │  ├── eventNormalizer.js   → Standardize event names             │   │
│  │  ├── matchNormalizer.js   → Parse dates, scores, keys           │   │
│  │  └── clubNormalizer.js    → Extract/standardize clubs           │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              │                                          │
│                              ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  STEP 2: RESOLVE (Canonical Registries)                         │   │
│  │  ├── canonical_events    → Map to canonical event               │   │
│  │  ├── canonical_teams     → Map to canonical team                │   │
│  │  └── canonical_clubs     → Map to canonical club                │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              │                                          │
│                              ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  STEP 3: DEDUPLICATE                                            │   │
│  │  ├── matchDedup.js       → Detect duplicate matches             │   │
│  │  ├── teamDedup.js        → Detect duplicate teams               │   │
│  │  └── eventDedup.js       → Detect duplicate events              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              │                                          │
│                              ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  STEP 4: VALIDATE & PROMOTE                                     │   │
│  │  ├── Business rule validation                                   │   │
│  │  ├── Insert/update production tables                            │   │
│  │  ├── Mark staging as processed                                  │   │
│  │  └── Log to audit_log                                           │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  LAYER 2: PRODUCTION TABLES (Validated - Strict Constraints)            │
│  teams_v2, matches_v2, leagues, tournaments, clubs, seasons, venues     │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  EXISTING PIPELINE (PRESERVE)                                           │
│  ├── inferEventLinkage.js   → Self-healing orphan matches              │
│  ├── recalculate_elo_v2.js  → ELO ratings                              │
│  └── refresh_app_views()    → Materialized views                       │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  LAYER 3: MATERIALIZED VIEWS (App-Ready)                                │
│  app_rankings, app_matches_feed, app_team_profile, etc.                │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 📁 CANONICAL REGISTRY SYSTEM

### Purpose

Single source of truth for entity names across ALL data sources. Prevents duplicate creation by mapping variant names to canonical versions.

### canonical_events Table

```sql
CREATE TABLE IF NOT EXISTS canonical_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('league', 'tournament')),
  aliases TEXT[] NOT NULL DEFAULT '{}',
  source_patterns JSONB DEFAULT '{}',
  state TEXT,
  region TEXT,
  year INTEGER,
  league_id UUID REFERENCES leagues(id),
  tournament_id UUID REFERENCES tournaments(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(canonical_name, event_type, year)
);

-- Index for fast alias lookup
CREATE INDEX idx_canonical_events_aliases ON canonical_events USING GIN (aliases);
```

**Example Data:**
```sql
INSERT INTO canonical_events (canonical_name, event_type, aliases, year) VALUES
('Heartland Premier League 2025', 'league', 
 ARRAY['Heartland Soccer League 2025', 'Heartland League 2025', 'HPL 2025'], 
 2025),
('Dallas Cup 2025', 'tournament',
 ARRAY['Dr Pepper Dallas Cup 2025', 'Dallas Cup XXXVI'],
 2025);
```

### canonical_teams Table

```sql
CREATE TABLE IF NOT EXISTS canonical_teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name TEXT NOT NULL,
  club_name TEXT,
  birth_year INTEGER,
  gender gender_type,
  state TEXT,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  team_v2_id UUID REFERENCES teams_v2(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(canonical_name, birth_year, gender, state)
);

-- Index for fast alias lookup
CREATE INDEX idx_canonical_teams_aliases ON canonical_teams USING GIN (aliases);
```

**Example Data:**
```sql
INSERT INTO canonical_teams (canonical_name, birth_year, gender, state, aliases) VALUES
('KC Fusion 15B Gold', 2015, 'M', 'KS',
 ARRAY['KC Fusion 15B Gold (U11 Boys)', 'KC Fusion KC Fusion 15B Gold', 'KC Fusion KC Fusion 15B Gold (U11 Boys)']),
('Sporting BV Pre-NAL 15', 2015, 'M', 'KS',
 ARRAY['Sporting Blue Valley SPORTING BV Pre-NAL 15', 'Sporting Blue Valley SPORTING BV Pre-NAL 15 (U11 Boys)']);
```

### canonical_clubs Table

```sql
CREATE TABLE IF NOT EXISTS canonical_clubs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name TEXT NOT NULL UNIQUE,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  state TEXT,
  region TEXT,
  logo_url TEXT,
  club_id UUID REFERENCES clubs(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_canonical_clubs_aliases ON canonical_clubs USING GIN (aliases);
```

### Lookup Functions

```sql
-- Resolve event name to canonical version
CREATE OR REPLACE FUNCTION resolve_canonical_event(
  raw_name TEXT,
  p_event_type TEXT DEFAULT NULL
) RETURNS TABLE(
  canonical_id UUID,
  canonical_name TEXT,
  event_type TEXT,
  league_id UUID,
  tournament_id UUID
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ce.id,
    ce.canonical_name,
    ce.event_type,
    ce.league_id,
    ce.tournament_id
  FROM canonical_events ce
  WHERE 
    -- Exact match on canonical name
    ce.canonical_name = raw_name
    -- Or match in aliases
    OR raw_name = ANY(ce.aliases)
    -- Or fuzzy match (0.85 threshold)
    OR similarity(ce.canonical_name, raw_name) > 0.85
  ORDER BY 
    CASE WHEN ce.canonical_name = raw_name THEN 0
         WHEN raw_name = ANY(ce.aliases) THEN 1
         ELSE 2 END,
    similarity(ce.canonical_name, raw_name) DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Resolve team name to canonical version
CREATE OR REPLACE FUNCTION resolve_canonical_team(
  raw_name TEXT,
  p_birth_year INTEGER DEFAULT NULL,
  p_gender gender_type DEFAULT NULL
) RETURNS TABLE(
  canonical_id UUID,
  canonical_name TEXT,
  team_v2_id UUID
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ct.id,
    ct.canonical_name,
    ct.team_v2_id
  FROM canonical_teams ct
  WHERE 
    (ct.canonical_name = raw_name OR raw_name = ANY(ct.aliases))
    AND (p_birth_year IS NULL OR ct.birth_year = p_birth_year)
    AND (p_gender IS NULL OR ct.gender = p_gender)
  ORDER BY 
    CASE WHEN ct.canonical_name = raw_name THEN 0 ELSE 1 END
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;
```

---

## 🔧 NORMALIZER SPECIFICATIONS

### teamNormalizer.js

**Location:** `scripts/universal/normalizers/teamNormalizer.js`

**Purpose:** Standardize team names from any source to canonical format.

**Input:**
```javascript
{
  raw_name: "KC Fusion KC Fusion 15B Gold (U11 Boys)",
  source_platform: "gotsport"
}
```

**Output:**
```javascript
{
  canonical_name: "KC Fusion 15B Gold",
  club_name: "KC Fusion",
  birth_year: 2015,
  gender: "M",
  age_group: "U11",
  normalized: true,
  transformations: ["removed_duplicate_prefix", "extracted_suffix", "extracted_birth_year"]
}
```

**Normalization Rules (in order):**
1. Trim whitespace
2. Remove duplicate club prefix: `"KC Fusion KC Fusion"` → `"KC Fusion"`
3. Extract and remove age/gender suffix: `"(U11 Boys)"` → capture U11, M
4. Extract birth year from name: `"15B"` → 2015, `"2015"` → 2015
5. Extract gender: `"B"` → M, `"G"` → F, `"Boys"` → M, `"Girls"` → F
6. Normalize whitespace: multiple spaces → single space
7. Title case club names

**CRITICAL: Team ID Extraction (Session 61)**

When extracting team IDs from raw names (e.g., Heartland format "711A Union KC Jr Elite B15"):
- Team IDs can be **alphanumeric** (e.g., "711A", "12AB", "7115")
- Use regex `^([A-Za-z0-9]+)\s+` to extract the ID prefix
- **DO NOT** use `^\d+` which only matches pure numeric IDs
- This bug caused 64 matches per Heartland subdivision to be silently skipped

**Test Cases:**
```javascript
// Must pass these cases
assert(normalize("KC Fusion KC Fusion 15B Gold (U11 Boys)").canonical_name === "KC Fusion 15B Gold");
assert(normalize("Sporting Blue Valley SPORTING BV Pre-NAL 15 (U11 Boys)").canonical_name === "Sporting Blue Valley SPORTING BV Pre-NAL 15");
assert(normalize("Rush 2014B Select").birth_year === 2014);
assert(normalize("Tigers U12 Girls").gender === "F");
```

### eventNormalizer.js

**Location:** `scripts/universal/normalizers/eventNormalizer.js`

**Purpose:** Standardize event names and determine event type.

**Input:**
```javascript
{
  raw_name: "Heartland Soccer League 2025",
  source_platform: "heartland",
  source_event_id: "heartland-league-2025"
}
```

**Output:**
```javascript
{
  canonical_name: "Heartland Premier League 2025",
  event_type: "league",  // or "tournament"
  year: 2025,
  season: "2025-26",
  state: "KS",
  region: "Kansas City",
  normalized: true
}
```

**Normalization Rules:**
1. Check canonical_events registry first (return canonical if found)
2. Determine event_type:
   - Contains "league", "season", "conference" → league
   - Contains "cup", "classic", "showcase", "tournament", "shootout" → tournament
   - Single weekend date range → tournament
   - Multi-month date range → league
3. Extract year: `"2025"`, `"25-26"`, `"Fall 2025"`
4. Normalize common variations:
   - `"Soccer League"` → `"Premier League"` (for Heartland)
5. Extract state/region from name if present

### matchNormalizer.js

**Location:** `scripts/universal/normalizers/matchNormalizer.js`

**Purpose:** Parse and validate match data.

**Input:**
```javascript
{
  match_date: "01/30/2026",  // Various formats
  match_time: "3:00 PM",
  home_score: "3",
  away_score: "1",
  home_team_name: "Team A",
  away_team_name: "Team B",
  source_match_key: null,
  event_id: "12345",
  source_platform: "gotsport"
}
```

**Output:**
```javascript
{
  match_date: "2026-01-30",  // ISO format
  match_time: "15:00:00",    // 24-hour format
  home_score: 3,             // Integer or null
  away_score: 1,             // Integer or null
  source_match_key: "gotsport-12345-team-a-team-b-2026-01-30",
  is_scheduled: false,       // true if scores are 0-0 and future date
  is_valid: true,
  validation_errors: []
}
```

**Normalization Rules:**
1. Parse date (handle: MM/DD/YYYY, YYYY-MM-DD, "Jan 30, 2026", etc.)
2. Parse time to 24-hour format
3. Parse scores to integers (handle: "3", "TBD", "-", "", null)
4. Generate source_match_key if missing
5. Validate: home_team ≠ away_team
6. Validate: date within allowed range (2023-08-01 to 2027-07-31)
7. Flag scheduled matches (0-0 score, future date)

### clubNormalizer.js

**Location:** `scripts/universal/normalizers/clubNormalizer.js`

**Purpose:** Extract and normalize club names from team names.

**Input:**
```javascript
{
  team_name: "Sporting Blue Valley SPORTING BV Pre-NAL 15",
  state: "KS"
}
```

**Output:**
```javascript
{
  club_name: "Sporting Blue Valley",
  normalized_name: "sporting blue valley",
  state: "KS",
  aliases: ["Sporting BV", "SBV"]
}
```

**Extraction Rules:**
1. Check canonical_clubs registry first
2. Extract prefix before team identifier (year, age group)
3. Common patterns:
   - `"Club Name Team Name"` → Club Name
   - `"Club Name ABBREV Team"` → Club Name
4. Normalize: lowercase, remove special chars for matching

---

## 🔄 DEDUPLICATION SPECIFICATIONS

### matchDedup.js

**Location:** `scripts/universal/deduplication/matchDedup.js`

**Purpose:** Detect and handle duplicate matches.

**Detection Methods (in priority order):**

1. **Exact Key Match:**
   ```sql
   SELECT * FROM matches_v2 WHERE source_match_key = $1
   ```

2. **Strong Match (same teams, date, score):**
   ```sql
   SELECT * FROM matches_v2
   WHERE match_date = $1
     AND home_team_id = $2
     AND away_team_id = $3
     AND home_score = $4
     AND away_score = $5
   ```

3. **Fuzzy Match (similar teams, same date, score):**
   ```sql
   SELECT * FROM matches_v2 m
   JOIN teams_v2 ht ON m.home_team_id = ht.id
   JOIN teams_v2 at ON m.away_team_id = at.id
   WHERE m.match_date = $1
     AND m.home_score = $2
     AND m.away_score = $3
     AND (
       similarity(ht.canonical_name, $4) > 0.85
       OR ht.id IN (SELECT team_v2_id FROM canonical_teams WHERE $4 = ANY(aliases))
     )
     AND (
       similarity(at.canonical_name, $5) > 0.85
       OR at.id IN (SELECT team_v2_id FROM canonical_teams WHERE $5 = ANY(aliases))
     )
   ```

4. **Source ID Match (Heartland pattern):**
   ```sql
   -- Extract team IDs from source_match_key
   -- heartland-7112-7115-2025-09-27 matches heartland-premier-7112-7115-2025-09-27-3509
   ```

**Resolution Strategy:**
- Keep the record with more complete data (more non-null fields)
- Keep the record linked to the "primary" event (prefer league over duplicate league)
- Merge metadata from both records
- Delete duplicate
- Log action to audit_log

### teamDedup.js

**Location:** `scripts/universal/deduplication/teamDedup.js`

**Purpose:** Detect and merge duplicate team entries.

**Detection Methods:**

1. **Canonical Match:**
   ```sql
   SELECT * FROM teams_v2
   WHERE id IN (
     SELECT team_v2_id FROM canonical_teams
     WHERE canonical_name = $1 AND birth_year = $2 AND gender = $3
   )
   ```

2. **Exact Match (excluding suffix):**
   ```sql
   SELECT * FROM teams_v2
   WHERE canonical_name = $1
     AND birth_year = $2
     AND gender = $3
     AND state = $4
   ```

3. **Fuzzy Match:**
   ```sql
   SELECT * FROM teams_v2
   WHERE similarity(canonical_name, $1) > 0.90
     AND birth_year = $2
     AND gender = $3
   ```

**Merge Strategy:**
- Keep team with more matches
- Update all match foreign keys to point to kept team
- Merge known_aliases arrays
- Delete duplicate team
- Update canonical_teams registry
- Log action to audit_log

### eventDedup.js

**Location:** `scripts/universal/deduplication/eventDedup.js`

**Purpose:** Detect and merge duplicate event entries.

**Detection Methods:**

1. **Canonical Match:**
   ```sql
   SELECT * FROM resolve_canonical_event($1, $2)
   ```

2. **Name + Year Match:**
   ```sql
   SELECT * FROM leagues WHERE name = $1
   UNION
   SELECT * FROM tournaments WHERE name = $1
   ```

3. **Fuzzy + Date Overlap:**
   ```sql
   -- For tournaments with date ranges
   SELECT * FROM tournaments
   WHERE similarity(name, $1) > 0.85
     AND daterange(start_date, end_date) && daterange($2, $3)
   ```

**Merge Strategy:**
- Keep event with more matches
- Migrate all matches to kept event
- Update canonical_events registry
- Delete empty event
- Log action to audit_log

---

## 🗓️ IMPLEMENTATION PHASES

### PHASE 0: IMMEDIATE FIXES (Pre-requisite) ✅ COMPLETE
**Duration:** 1 session
**Purpose:** Fix critical blockers before building new systems
**Completed:** January 30, 2026

**Deliverables:**
- [x] Execute Heartland league merge (already built)
- [x] Populate seasons table (3 rows: 2023-24, 2024-25, 2025-26)
- [x] Create get_current_season_year() function
- [x] Diagnose staging backlog - Was 32,305 unprocessed records
- [x] Process staging backlog - Used ultraFastProcessor.js (3,226 matches/min)

**Exit Criteria:** ✅ ALL MET
- Heartland shows 1 league on team detail page
- seasons table has 3 rows
- Staging backlog: 0 unprocessed

---

### PHASE 1: CANONICAL REGISTRIES ✅ COMPLETE
**Duration:** 1 session
**Purpose:** Create single source of truth for entity names
**Completed:** January 30, 2026

**Deliverables:**
- [x] Create canonical_events table (with GIN index on aliases)
- [x] Create canonical_teams table (with GIN index on aliases)
- [x] Create canonical_clubs table (with GIN index on aliases)
- [x] Create resolve_canonical_event() function (fuzzy matching with pg_trgm)
- [x] Create resolve_canonical_team() function
- [x] Create resolve_canonical_club() function
- [x] Seed canonical_events with Heartland mappings (4 rows)

**Script:** `scripts/migrations/run_phase1_functions.js`

**Exit Criteria:** ✅ ALL MET
- All canonical tables created with GIN indexes
- Lookup functions working (tested with "Heartland Soccer League 2025" → "Heartland Premier League 2025")
- Heartland variants mapped to canonical names

---

### PHASE 2: NORMALIZERS ✅ COMPLETE
**Duration:** 1 session
**Purpose:** Build pluggable normalization modules
**Completed:** January 30, 2026

**Deliverables:**
- [x] scripts/universal/normalizers/teamNormalizer.js (6/6 tests passing)
- [x] scripts/universal/normalizers/eventNormalizer.js (6/6 tests passing)
- [x] scripts/universal/normalizers/matchNormalizer.js (7/7 tests passing)
- [x] scripts/universal/normalizers/clubNormalizer.js (7/7 tests passing)
- [x] Unit tests for each normalizer (26/26 total tests passing)
- [x] Integration test: scripts/universal/normalizers/testWithStagingData.js

**Performance Results:**
| Normalizer | Records | Time | Per 1000 |
|------------|---------|------|----------|
| Team | 2000 | 8.2ms | 4.1ms |
| Event | 60 unique | 0.3ms | N/A |
| Match | 1000 | 6.0ms | 6.0ms |
| Club | 500 | 1.8ms | 3.6ms |
| **TOTAL** | 3560 | 16.3ms | **4.6ms** |

**Exit Criteria:** ✅ ALL MET (125x faster than target)
- All normalizers pass test cases (26/26)
- Normalized 1000+ staging records successfully
- Performance: **4.6ms per 1000 records** (target was <1000ms)

---

### PHASE 3: CORE ENGINE ✅ COMPLETE
**Duration:** 1 session
**Purpose:** Build universal data quality engine
**Completed:** January 30, 2026

**Deliverables:**
- [x] scripts/universal/dataQualityEngine.js (680+ lines)
- [x] Integration with all 4 normalizers (teamNormalizer, eventNormalizer, matchNormalizer, clubNormalizer)
- [x] Integration with canonical registries (resolve_canonical_event, resolve_canonical_team, resolve_canonical_club)
- [x] Staging → Production promotion logic with batch processing
- [x] Audit logging for all CREATE/UPDATE actions
- [x] Dry-run mode (--dry-run flag)
- [x] scripts/universal/testDataQualityEngine.js - Integration test

**Engine Architecture:**
```
STEP 1: NORMALIZE   → All 4 normalizers (pure functions, ~5ms/1000 records)
STEP 2: RESOLVE     → Canonical registry batch lookups
STEP 3: DEDUPLICATE → source_match_key based duplicate detection
STEP 4: PROMOTE     → Validate, create teams/events, insert matches
```

**CLI Usage:**
```bash
node scripts/universal/dataQualityEngine.js --process-staging
node scripts/universal/dataQualityEngine.js --process-staging --dry-run --limit 1000
node scripts/universal/dataQualityEngine.js --audit-report --days 30
```

**Exit Criteria:** ✅ ALL MET
- staging_games backlog = 0 (was already cleared in Phase 0)
- Integration test passes: 3/3 test records processed
- Audit logs written: 5 entries for test run
- No duplicate records created (source_match_key dedup works)

---

### PHASE 4: DEDUPLICATION ✅ COMPLETE
**Duration:** 1 session
**Purpose:** Build deduplication detection and resolution
**Completed:** January 30, 2026

**Deliverables:**
- [x] scripts/universal/deduplication/matchDedup.js - Detect duplicate matches
- [x] scripts/universal/deduplication/teamDedup.js - Detect duplicate teams
- [x] scripts/universal/deduplication/eventDedup.js - Detect duplicate leagues/tournaments
- [x] scripts/maintenance/mergeTeams.js - Manual team merge utility
- [x] scripts/maintenance/mergeEvents.js - Manual event merge utility
- [x] scripts/universal/deduplication/index.js - Module exports

**Duplicate Analysis Results:**
| Entity | Duplicate Groups | Extra Records |
|--------|-----------------|---------------|
| Matches | 433 | 495 |
| Teams | 100+ | 215 |
| Leagues | 1 | 1 |
| Tournaments | 11 | 11 |

**CLI Usage:**
```bash
# Generate reports
node scripts/universal/deduplication/matchDedup.js --report
node scripts/universal/deduplication/teamDedup.js --report
node scripts/universal/deduplication/eventDedup.js --report

# Dry-run deduplication
node scripts/universal/deduplication/matchDedup.js
node scripts/universal/deduplication/teamDedup.js
node scripts/universal/deduplication/eventDedup.js

# Execute deduplication (with audit trail)
node scripts/universal/deduplication/matchDedup.js --execute

# Manual merges
node scripts/maintenance/mergeTeams.js --find "sporting bv"
node scripts/maintenance/mergeTeams.js --keep <uuid> --merge <uuid1,uuid2> --execute
node scripts/maintenance/mergeEvents.js --type league --find "Heartland"
```

**Exit Criteria:** ✅ ALL MET
- Dedup modules detect known duplicates (433 match groups, 100+ team groups, 12 event groups)
- Merge utilities work with dry-run and --execute
- Existing duplicates catalogued in reports

---

### PHASE 5: INFRASTRUCTURE POPULATION
**Duration:** 1-2 sessions
**Purpose:** Fill empty infrastructure tables

**Deliverables:**
- [ ] scripts/onetime/populateClubs.js
- [ ] scripts/onetime/rebuildLeagues.js
- [ ] clubs table populated from teams_v2
- [ ] leagues table rebuilt with proper entries
- [ ] teams_v2.club_id foreign keys updated
- [ ] Refresh materialized views

**Exit Criteria:**
- clubs table has 10,000+ rows
- leagues table has 100+ rows
- No orphaned foreign keys

---

### PHASE 6: PIPELINE INTEGRATION ✅ COMPLETE
**Duration:** 1 session
**Purpose:** Integrate with nightly pipeline
**Completed:** January 30, 2026

**Deliverables:**
- [x] Update .github/workflows/daily-data-sync.yml
- [x] Replace validation-pipeline step with dataQualityEngine.js
- [x] Add legacy fallback to validationPipeline.js if engine fails
- [x] Add Phase 2.25 (weekly-dedup-check job - runs Sundays)
- [x] Add `run_dedup` workflow input for manual dedup trigger
- [x] Update workflow summary with engine info and dedup results
- [x] Update CLAUDE.md documentation
- [x] Update this spec document

**Exit Criteria:** ✅ ALL MET
- Nightly pipeline uses dataQualityEngine.js as primary
- Legacy fallback available if needed
- Weekly dedup reports run on Sundays
- Documentation updated

---

## 📅 NIGHTLY PIPELINE (Target State)

```yaml
# .github/workflows/daily-data-sync.yml

jobs:
  # PHASE 1: Data Collection (parallel)
  sync-sources:
    strategy:
      matrix:
        adapter: [gotsport, htgsports, heartland]
    steps:
      - run: node scripts/universal/coreScraper.js --adapter ${{ matrix.adapter }} --active

  # PHASE 2: Data Quality Engine (sequential, after collection)
  data-quality:
    needs: sync-sources
    steps:
      - name: Run Data Quality Engine
        run: node scripts/universal/dataQualityEngine.js --process-staging
        
  # PHASE 2.25: Deduplication Check (weekly)
  dedup-check:
    needs: data-quality
    if: github.event.schedule == '0 6 * * 0'  # Sundays only
    steps:
      - run: node scripts/universal/dataQualityEngine.js --deduplicate-matches

  # PHASE 2.5: Inference Linkage (existing)
  infer-linkage:
    needs: data-quality
    steps:
      - run: node scripts/daily/inferEventLinkage.js

  # PHASE 3: ELO Calculation (existing)
  calculate-elo:
    needs: infer-linkage
    steps:
      - run: node scripts/daily/recalculate_elo_v2.js

  # PHASE 4: Score Predictions (existing)
  score-predictions:
    needs: calculate-elo
    steps:
      - run: node scripts/daily/scorePredictions.js

  # PHASE 5: Refresh Views
  refresh-views:
    needs: [calculate-elo, score-predictions]
    steps:
      - run: node scripts/refresh_views_manual.js
```

---

## ✅ SUCCESS CRITERIA

### Data Quality Metrics (Updated Jan 30, 2026)

| Metric | Current | Target | Status |
|--------|---------|--------|--------|
| Staging backlog | **0** | 0 | ✅ ACHIEVED |
| Duplicate events | **0** | 0 | ✅ ACHIEVED |
| Duplicate teams | ~500 est | 0 | 🔄 Phase 4 |
| Match linking rate | ~90% | 92%+ | 🔄 Ongoing |
| Orphaned matches | ~5,789 | <500 | 🔄 inferEventLinkage.js |

### Infrastructure Metrics (Updated Jan 30, 2026 - Session 62)

| Table | Current | Target | Status |
|-------|---------|--------|--------|
| seasons | **3** | 3 | ✅ ACHIEVED |
| clubs | **124,650** | 10,000+ | ✅ EXCEEDED |
| leagues | **280** | 100+ | ✅ EXCEEDED |
| canonical_events | **1,795** | 500+ | ✅ EXCEEDED (Session 62) |
| canonical_teams | **19,271** | 5,000+ | ✅ EXCEEDED (Session 62) |
| canonical_clubs | **7,301** | 5,000+ | ✅ EXCEEDED (Session 62) |

### Pipeline Metrics

| Metric | Target |
|--------|--------|
| Nightly completion | 100% success |
| Processing time | < 60 minutes total |
| New duplicates created | 0 |

---

## 🚫 ANTI-PATTERNS TO AVOID

1. **DO NOT modify any files in /app/ or /components/**
   - This spec is BACKEND ONLY

2. **DO NOT create source-specific quality code**
   - Use universal engine with normalizers

3. **DO NOT hardcode entity mappings in code**
   - Use canonical registry tables

4. **DO NOT skip staging layer**
   - ALL data flows through staging

5. **DO NOT delete without audit trail**
   - Log all destructive actions

6. **DO NOT skip dry-run testing**
   - All merge/delete operations need dry-run first

7. **DO NOT break existing pipeline components**
   - Integrate WITH existing, don't replace

8. **DO NOT proceed to next phase without exit criteria met**
   - Each phase has explicit deliverables

9. **DO NOT use restrictive regex patterns for team IDs (Session 61)**
   - Team IDs can be alphanumeric (e.g., "711A", "12AB", "7115")
   - **WRONG:** `^\d+` (only matches numeric IDs, misses "711A")
   - **CORRECT:** `^[A-Za-z0-9]+` (matches all alphanumeric IDs)
   - This caused missing matches in production - 64 matches per Heartland subdivision were silently skipped

10. **DO NOT use restrictive regex for division detection (Session 74)**
    - Age groups can be formatted as "U11" or "U-11" (with or without dash)
    - **WRONG:** `/U-\d+/` (requires dash, misses "U11")
    - **CORRECT:** `/U-?\d{1,2}\b/` (optional dash with word boundary)
    - This caused HTGSports scraper to find only 1 of 38 divisions in Sporting Classic 2025
    - The universal pattern is: `/U-?\d{1,2}\b|20[01]\d/i`

11. **DO NOT mark events as processed when 0 matches found (Session 74)**
    - Checkpoint updates MUST be conditional on `matches.length > 0`
    - **WRONG:** Always update checkpoint after scraping (marks empty results as "done")
    - **CORRECT:** Only checkpoint when data is actually found
    - This caused events to be permanently skipped even when scraper failed silently
    - Empty results may indicate network issues, page structure changes, or scraper bugs

12. **DO NOT assume team names are consistent across events (Session 74)**
    - Same team can have different names in different events:
      - Tournament: "SBV Pre-NAL 15" (abbreviated)
      - League: "Sporting BV Pre-NAL 15" (full)
    - This creates duplicate team entries fragmenting match history
    - Prevention: After scraping new events, run deduplication check for similar names
    - Resolution: Use `scripts/maintenance/mergeTeams.js` to merge duplicates

13. **DO NOT write directly to production tables from scrapers (Session 76)**
    - **WRONG:** `supabase.from('teams_v2').upsert(...)` directly from scraper
    - **CORRECT:** Write to staging → dataQualityEngine → production
    - Root cause of 57,532 orphaned teams: GotSport rankings bypassed the pipeline
    - ALL data must flow through staging tables for normalization and deduplication

14. **DO NOT use Supabase client for bulk operations (Session 76)**
    - **WRONG:** Row-by-row updates with Supabase client (hours for 100K records)
    - **CORRECT:** pg Pool with bulk SQL using unnest/CASE (seconds for 100K records)
    - Benchmark: 11,000+ records/second with direct SQL vs ~10 records/second with client
    - Speed mandate: "Process thousands per minute, not dozens"

15. **DO NOT assume canonical registry is populated (Session 76)**
    - **CRITICAL:** Check registry coverage BEFORE any deduplication work
    - **WRONG:** Assuming V2 architecture works without verification
    - **CORRECT:** `SELECT COUNT(*) FROM canonical_teams` should be ~90% of teams_v2
    - Session 76 found only 12% coverage (19K of 155K teams) - architecture was broken
    - Fix: Run `populateCanonicalTeams.cjs` after ANY direct database operations

16. **DO NOT ignore duplicate club prefixes in team names (Session 76)**
    - GotSport imports create: "One FC One FC B2015 PRE-MLS"
    - V2 normalizer produces: "One FC B2015 PRE-MLS"
    - These won't match because canonical_name differs
    - Detection: `split_part(name, ' ', 1) = split_part(name, ' ', 2)`
    - Fix: `mergeOrphansByNormalizedName.cjs` applies normalizer logic to orphans

17. **DO NOT scrape recreational or community-level data (Session 84)**
    - **SoccerView is PREMIER-ONLY** - recreational teams dilute rankings
    - **WRONG:** Scraping Heartland Recreational, community leagues, or dev/rec programs
    - **CORRECT:** Only scrape Premier/Competitive leagues and tournaments
    - Detection patterns: `/\brec\b/i`, `/recreational/i`, `/\bcomm\b/i`, `/community/i`
    - `intakeValidator.js` rejects any data matching RECREATIONAL_LEVEL patterns
    - If recreational data gets scraped, it will be blocked at intake validation gate

---

## 📝 SESSION HANDOFF TEMPLATE

```markdown
## Session [N] Complete - Universal Data Quality

### Phase: [Current Phase]

### What Was Done:
- [List of completed items]

### What Was NOT Done:
- [List of items deferred]

### Exit Criteria Status:
- [ ] Criteria 1: [status]
- [ ] Criteria 2: [status]

### Current State:
- staging_games backlog: [count]
- Canonical events registered: [count]
- Canonical teams registered: [count]

### Immediate Next Step:
- [Single, specific next action]

### Files Created/Modified:
- [List of files]

### Database Changes:
- [Tables created/modified]

### Blockers/Risks:
- [Any issues]
```

---

## 🔐 FINAL AUTHORITY

This specification document is authoritative for the Universal Data Quality System.

**Hierarchy:**
1. This document (UNIVERSAL_DATA_QUALITY_SPEC.md)
2. UNIVERSAL_DATA_PIPELINE_SPEC.md
3. ARCHITECTURE.md
4. Other documentation

**Critical Constraint Reminder:**
```
╔═══════════════════════════════════════════════════════════════════════════╗
║  NO CHANGES TO /app/ OR /components/ - BACKEND ONLY                       ║
║  This is a NON-NEGOTIABLE constraint. The UI is complete and protected.   ║
╚═══════════════════════════════════════════════════════════════════════════╝
```

---

## ⚠️ MANDATORY FIRST ACTIONS

Claude Code MUST:

1. **Read these documents first:**
   - docs/UNIVERSAL_DATA_QUALITY_SPEC.md (this document)
   - docs/ARCHITECTURE.md
   - docs/UNIVERSAL_DATA_PIPELINE_SPEC.md

2. **Acknowledge constraints:**
   - NO changes to /app/ or /components/
   - Backend work only

3. **Execute Phase 0 immediately:**
   - Run Heartland merge
   - Populate seasons table
   - Diagnose staging backlog

4. **Report Phase 0 status before proceeding**

**Do not proceed to Phase 1 until Phase 0 exit criteria are met.**



