> ?? **CRITICAL WARNING (Jan 30, 2026):** Some numbers in this spec are STALE.
> ALWAYS verify actual database state before acting:
> - clubs: 122,418 ? ALREADY POPULATED - DO NOT REBUILD
> - leagues: 279 ? ALREADY POPULATED - DO NOT REBUILD  
> - seasons: 3 ? ALREADY POPULATED
> - staging_games: ~32K (verify actual count)
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

### Database Inventory (January 30, 2026)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ LAYER 1: STAGING                                                        │
│   staging_games:  38,197 (BACKLOG - should be 0 after nightly run)     │
│   staging_teams:  0                                                     │
│   staging_events: 193                                                   │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ LAYER 2: PRODUCTION                                                     │
│   matches_v2:     295,575                                               │
│   teams_v2:       172,723                                               │
│   tournaments:    1,718                                                 │
│   leagues:        5 (should be ~280 per ARCHITECTURE.md)                │
│   clubs:          0 (EMPTY - should have 32K+)                          │
│   seasons:        0 (EMPTY - critical for age calculation)              │
│   venues:         0 (EMPTY)                                             │
│   rank_history_v2: 124,184                                              │
│   audit_log:      2,727,146                                             │
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

### Issues to Resolve

| Issue | Impact | Priority |
|-------|--------|----------|
| 38,197 staging_games unprocessed | Data not flowing to production | P0 |
| Duplicate events (Heartland example) | Team pages show duplicate leagues | P0 |
| seasons table empty | Age group calculation broken | P1 |
| clubs table empty | Club info not displaying | P2 |
| leagues only 5 rows (should be 280) | League data incomplete | P2 |
| Duplicate teams (name variations) | Fragmented team history | P2 |

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

### PHASE 0: IMMEDIATE FIXES (Pre-requisite)
**Duration:** 1 session
**Purpose:** Fix critical blockers before building new systems

**Deliverables:**
- [ ] Execute Heartland league merge (already built)
  ```bash
  node scripts/maintenance/mergeHeartlandLeagues.js
  ```
- [ ] Populate seasons table (critical for age calculation)
  ```sql
  INSERT INTO seasons (name, start_date, end_date, year, is_current) VALUES
  ('2023-24 Season', '2023-08-01', '2024-07-31', 2024, false),
  ('2024-25 Season', '2024-08-01', '2025-07-31', 2025, false),
  ('2025-26 Season', '2025-08-01', '2026-07-31', 2026, true);
  ```
- [ ] Create get_current_season_year() function
- [ ] Diagnose 38K staging backlog (report before action)

**Exit Criteria:**
- Heartland shows 1 league on team detail page
- seasons table has 3 rows
- Staging backlog diagnosis complete

---

### PHASE 1: CANONICAL REGISTRIES
**Duration:** 1-2 sessions
**Purpose:** Create single source of truth for entity names

**Deliverables:**
- [ ] Create canonical_events table
- [ ] Create canonical_teams table
- [ ] Create canonical_clubs table
- [ ] Create resolve_canonical_event() function
- [ ] Create resolve_canonical_team() function
- [ ] Seed canonical_events with known Heartland mappings
- [ ] Document registry maintenance process

**Exit Criteria:**
- All canonical tables created with indexes
- Lookup functions working
- Heartland variants mapped to canonical names

---

### PHASE 2: NORMALIZERS
**Duration:** 2 sessions
**Purpose:** Build pluggable normalization modules

**Deliverables:**
- [ ] scripts/universal/normalizers/teamNormalizer.js
- [ ] scripts/universal/normalizers/eventNormalizer.js
- [ ] scripts/universal/normalizers/matchNormalizer.js
- [ ] scripts/universal/normalizers/clubNormalizer.js
- [ ] Unit tests for each normalizer
- [ ] Test with real staging_games data

**Exit Criteria:**
- All normalizers pass test cases
- Can normalize sample of 1000 staging records
- Performance < 1 second per 1000 records

---

### PHASE 3: CORE ENGINE
**Duration:** 2-3 sessions
**Purpose:** Build universal data quality engine

**Deliverables:**
- [ ] scripts/universal/dataQualityEngine.js
- [ ] Integration with normalizers
- [ ] Integration with canonical registries
- [ ] Staging → Production promotion logic
- [ ] Audit logging for all actions
- [ ] Dry-run mode
- [ ] Process 38K staging backlog

**Exit Criteria:**
- staging_games backlog = 0
- All processed records in matches_v2
- Full audit trail
- No duplicate records created

---

### PHASE 4: DEDUPLICATION
**Duration:** 2 sessions
**Purpose:** Build deduplication detection and resolution

**Deliverables:**
- [ ] scripts/universal/deduplication/matchDedup.js
- [ ] scripts/universal/deduplication/teamDedup.js
- [ ] scripts/universal/deduplication/eventDedup.js
- [ ] scripts/maintenance/mergeEvents.js (generic utility)
- [ ] scripts/maintenance/mergeTeams.js (generic utility)
- [ ] Scan and report existing duplicates

**Exit Criteria:**
- Dedup modules detect known duplicates
- Merge utilities work with dry-run
- Existing duplicates catalogued

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

### PHASE 6: PIPELINE INTEGRATION
**Duration:** 1-2 sessions
**Purpose:** Integrate with nightly pipeline

**Deliverables:**
- [ ] Update .github/workflows/daily-data-sync.yml
- [ ] Add Phase 2 (Data Quality Engine)
- [ ] Add Phase 2.25 (Dedup Check - weekly)
- [ ] End-to-end test
- [ ] Monitoring/alerting for failures
- [ ] Update documentation

**Exit Criteria:**
- Nightly pipeline runs successfully
- New data normalized and deduplicated
- Alerts on failure
- ARCHITECTURE.md updated

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

### Data Quality Metrics

| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| Staging backlog | 38,197 | 0 | `SELECT COUNT(*) FROM staging_games WHERE processed = false` |
| Duplicate events | ~20 est | 0 | `SELECT name, COUNT(*) FROM leagues GROUP BY name HAVING COUNT(*) > 1` |
| Duplicate teams | ~500 est | 0 | Canonical registry coverage |
| Match linking rate | 85.6% | 92%+ | `SELECT COUNT(*) WHERE league_id IS NOT NULL OR tournament_id IS NOT NULL` |
| Orphaned matches | 5,789 | <500 | `SELECT COUNT(*) WHERE league_id IS NULL AND tournament_id IS NULL` |

### Infrastructure Metrics

| Table | Current | Target |
|-------|---------|--------|
| seasons | 0 | 3 |
| clubs | 0 | 10,000+ |
| leagues | 5 | 100+ |
| canonical_events | - | 500+ |
| canonical_teams | - | 5,000+ |

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



