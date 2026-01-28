# SoccerView V2 Database Architecture

> **Version 2.0** | Last Updated: January 28, 2026 | Session 50
>
> This document describes the production V2 three-layer database architecture.
> For historical V1 architecture, see [docs/_archive/](docs/_archive/).

---

## Overview

SoccerView uses a three-layer database architecture designed for:
- **Scalable data ingestion** from multiple sources
- **Data quality validation** before production use
- **Fast app queries** via pre-computed materialized views

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      SOCCERVIEW V2 DATABASE ARCHITECTURE                        │
│                         Three-Layer Data Pipeline                               │
└─────────────────────────────────────────────────────────────────────────────────┘

                           ┌──────────────────────┐
                           │    DATA SOURCES      │
                           │  GotSport│HTGSports  │
                           │  Heartland│Future    │
                           └──────────┬───────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  LAYER 1: STAGING TABLES (Raw Ingestion - No Constraints)                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│   staging_teams          staging_games           staging_events                 │
│   ─────────────          ─────────────           ──────────────                 │
│   • All fields TEXT      • All fields TEXT       • All fields TEXT             │
│   • NO constraints       • NO constraints        • NO constraints              │
│   • NO foreign keys      • NO foreign keys       • NO foreign keys             │
│   • Batch ID tracking    • Batch ID tracking     • Batch ID tracking           │
│   • Source platform      • Source platform       • Source platform             │
│                                                                                 │
│   Purpose: Accept ANY data from ANY source without validation failures          │
│   Data flows in via: Scraper scripts (direct insert)                           │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ validationPipeline.js
                                      │ (Validates, transforms, moves to production)
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  LAYER 2: PRODUCTION TABLES (Validated Core - Strict Constraints)               │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│   teams_v2 (137,582)     matches_v2 (292,802)    clubs (32,334)                 │
│   ──────────────────     ──────────────────      ─────────────                  │
│   • UUID primary key     • Match date NOT NULL   • Normalized names            │
│   • gender_type enum     • home ≠ away team      • State tracking              │
│   • birth_year INT       • Composite unique      • Logo URLs                   │
│   • Proper FKs to clubs  • FKs to teams_v2       • Deduplication               │
│   • Quality score 0-100  • FKs to leagues/tourn                                │
│   • Unique constraints   • link_status tracking                                │
│                                                                                 │
│   leagues (273)          tournaments (1,492)     venues, schedules             │
│   ─────────────          ──────────────────      ──────────────────            │
│   • source_event_id      • source_event_id       • Location data               │
│   • Season tracking      • Date range            • Field names                 │
│                                                                                 │
│   Purpose: Clean, normalized, validated data with referential integrity         │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ refresh_app_views()
                                      │ (Refreshes materialized views)
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  LAYER 3: MATERIALIZED VIEWS (App-Ready Read Layer - Pre-computed)              │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│   app_rankings (137,582)           app_team_profile (137,582)                   │
│   ──────────────────────           ──────────────────────────                   │
│   • Pre-joined team data           • Full team detail with JSONB               │
│   • ELO + official ranks           • recent_matches[] embedded                 │
│   • Win/loss/draw stats            • upcoming_schedule[] embedded              │
│   • Age group calculated           • rank_history[] embedded                   │
│   • Indexed for search             • leagues[] embedded                        │
│                                                                                 │
│   app_matches_feed (292,802)       app_league_standings (25,898)               │
│   ──────────────────────────       ─────────────────────────────               │
│   • home_team JSONB embedded       • Points table calculation                  │
│   • away_team JSONB embedded       • Form (last 5 results)                     │
│   • event JSONB embedded           • Position ranking                          │
│   • venue JSONB embedded           • Goal difference                           │
│                                                                                 │
│   app_upcoming_schedule (908)                                                   │
│   ───────────────────────────                                                   │
│   • Future games only                                                           │
│   • Full team/venue details                                                     │
│                                                                                 │
│   Purpose: Zero-join queries for app, sub-100ms response times                  │
│   App queries ONLY these views - never touches Layer 1 or 2 directly            │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
                           ┌──────────────────────┐
                           │    MOBILE APP        │
                           │  Rankings│Teams│Home │
                           │  Matches│Team Detail │
                           └──────────────────────┘
```

---

## Layer 1: Staging Tables

### Purpose
Accept raw data from scrapers without any validation. This ensures:
- Scrapers never fail due to constraint violations
- All incoming data is captured for processing
- Bad data can be reviewed before entering production

### Tables

#### staging_games
```sql
CREATE TABLE staging_games (
  id BIGSERIAL PRIMARY KEY,
  match_date TEXT,
  match_time TEXT,
  home_team_name TEXT,
  away_team_name TEXT,
  home_score TEXT,
  away_score TEXT,
  event_name TEXT,
  event_id TEXT,
  venue_name TEXT,
  field_name TEXT,
  division TEXT,
  source_platform TEXT NOT NULL,
  source_match_key TEXT,
  raw_data JSONB,
  processed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### staging_teams
```sql
CREATE TABLE staging_teams (
  id BIGSERIAL PRIMARY KEY,
  team_name TEXT NOT NULL,
  club_name TEXT,
  birth_year TEXT,
  gender TEXT,
  state TEXT,
  source_platform TEXT NOT NULL,
  raw_data JSONB,
  processed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### staging_events
```sql
CREATE TABLE staging_events (
  id BIGSERIAL PRIMARY KEY,
  event_name TEXT NOT NULL,
  event_type TEXT,  -- 'league' or 'tournament'
  source_platform TEXT NOT NULL,
  source_event_id TEXT,
  state TEXT,
  region TEXT,
  raw_data JSONB,
  processed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Layer 2: Production Tables

### Purpose
Store validated, normalized data with proper constraints and relationships.

### Core Tables

#### teams_v2
```sql
CREATE TABLE teams_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_name TEXT NOT NULL,
  club_id UUID REFERENCES clubs(id),
  birth_year INTEGER,
  gender gender_type,  -- 'boys' or 'girls'
  state TEXT,
  elo_rating NUMERIC DEFAULT 1500,
  national_rank INTEGER,
  state_rank INTEGER,
  elo_national_rank INTEGER,
  elo_state_rank INTEGER,
  matches_played INTEGER DEFAULT 0,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  draws INTEGER DEFAULT 0,
  data_quality_score INTEGER DEFAULT 0,  -- 0-100
  birth_year_source TEXT,  -- parsed/inferred/official/unknown
  gender_source TEXT,
  data_flags JSONB,
  source_platform TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(team_name, birth_year, gender, state)
);
```

#### matches_v2
```sql
CREATE TABLE matches_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_date DATE NOT NULL,
  match_time TIME,
  home_team_id UUID REFERENCES teams_v2(id),
  away_team_id UUID REFERENCES teams_v2(id),
  home_team_name TEXT NOT NULL,
  away_team_name TEXT NOT NULL,
  home_score INTEGER,
  away_score INTEGER,
  league_id UUID REFERENCES leagues(id),
  tournament_id UUID REFERENCES tournaments(id),
  venue_id UUID REFERENCES venues(id),
  division TEXT,
  source_platform TEXT NOT NULL,
  source_match_key TEXT UNIQUE,
  link_status TEXT DEFAULT 'unlinked',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (home_team_id IS DISTINCT FROM away_team_id)
);
```

#### clubs
```sql
CREATE TABLE clubs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  state TEXT,
  logo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(normalized_name, state)
);
```

#### leagues
```sql
CREATE TABLE leagues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  source_event_id TEXT,
  source_platform TEXT,
  season TEXT,
  state TEXT,
  region TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### tournaments
```sql
CREATE TABLE tournaments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  source_event_id TEXT,
  source_platform TEXT,
  start_date DATE,
  end_date DATE,
  state TEXT,
  region TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Data Quality Score

Teams have a `data_quality_score` (0-100) calculated as:

| Component | Points | Logic |
|-----------|--------|-------|
| birth_year | +30 | If not null |
| gender | +30 | If not null |
| national_rank | +20 | If not null |
| matches_played | +10 | If > 0 |
| elo_rating | +10 | If ≠ 1500 (default) |

---

## Layer 3: Materialized Views

### Purpose
Pre-computed views for fast app queries. The app ONLY queries these views.

### View Definitions

#### app_rankings
Used by: Rankings tab, Teams tab
```sql
CREATE MATERIALIZED VIEW app_rankings AS
SELECT
  t.id,
  t.team_name,
  t.birth_year,
  t.gender,
  t.state,
  t.elo_rating,
  t.national_rank,
  t.state_rank,
  t.elo_national_rank,
  t.elo_state_rank,
  t.matches_played,
  t.wins,
  t.losses,
  t.draws,
  t.data_quality_score,
  c.name as club_name,
  c.logo_url as club_logo,
  -- Calculated age group
  CASE
    WHEN t.birth_year IS NOT NULL
    THEN 'U' || (EXTRACT(YEAR FROM CURRENT_DATE) - t.birth_year + 1)::TEXT
    ELSE NULL
  END as age_group
FROM teams_v2 t
LEFT JOIN clubs c ON t.club_id = c.id
WHERE t.matches_played > 0 OR t.national_rank IS NOT NULL;
```

#### app_matches_feed
Used by: Matches tab, Home tab carousels
```sql
CREATE MATERIALIZED VIEW app_matches_feed AS
SELECT
  m.id,
  m.match_date,
  m.match_time,
  m.home_score,
  m.away_score,
  m.division,
  -- Home team as JSONB
  jsonb_build_object(
    'id', ht.id,
    'name', ht.team_name,
    'elo', ht.elo_rating
  ) as home_team,
  -- Away team as JSONB
  jsonb_build_object(
    'id', at.id,
    'name', at.team_name,
    'elo', at.elo_rating
  ) as away_team,
  -- Event as JSONB
  COALESCE(
    jsonb_build_object('id', l.id, 'name', l.name, 'type', 'league'),
    jsonb_build_object('id', t.id, 'name', t.name, 'type', 'tournament')
  ) as event
FROM matches_v2 m
LEFT JOIN teams_v2 ht ON m.home_team_id = ht.id
LEFT JOIN teams_v2 at ON m.away_team_id = at.id
LEFT JOIN leagues l ON m.league_id = l.id
LEFT JOIN tournaments t ON m.tournament_id = t.id
WHERE m.match_date IS NOT NULL
ORDER BY m.match_date DESC;
```

#### app_league_standings
Used by: League detail page
```sql
CREATE MATERIALIZED VIEW app_league_standings AS
WITH match_stats AS (
  SELECT
    team_id,
    league_id,
    COUNT(*) as played,
    SUM(CASE WHEN won THEN 1 ELSE 0 END) as wins,
    SUM(CASE WHEN drawn THEN 1 ELSE 0 END) as draws,
    SUM(CASE WHEN lost THEN 1 ELSE 0 END) as losses,
    SUM(goals_for) as goals_for,
    SUM(goals_against) as goals_against
  FROM (
    -- Home matches
    SELECT home_team_id as team_id, league_id,
           home_score > away_score as won,
           home_score = away_score as drawn,
           home_score < away_score as lost,
           home_score as goals_for,
           away_score as goals_against
    FROM matches_v2 WHERE league_id IS NOT NULL AND home_score IS NOT NULL
    UNION ALL
    -- Away matches
    SELECT away_team_id as team_id, league_id,
           away_score > home_score as won,
           away_score = home_score as drawn,
           away_score < home_score as lost,
           away_score as goals_for,
           home_score as goals_against
    FROM matches_v2 WHERE league_id IS NOT NULL AND away_score IS NOT NULL
  ) sub
  GROUP BY team_id, league_id
)
SELECT
  ms.*,
  ms.wins * 3 + ms.draws as points,
  ms.goals_for - ms.goals_against as goal_difference,
  t.team_name,
  t.elo_rating,
  l.name as league_name
FROM match_stats ms
JOIN teams_v2 t ON ms.team_id = t.id
JOIN leagues l ON ms.league_id = l.id;
```

### Refreshing Views

Views are refreshed via the `refresh_app_views()` function:

```sql
CREATE OR REPLACE FUNCTION refresh_app_views()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY app_rankings;
  REFRESH MATERIALIZED VIEW CONCURRENTLY app_matches_feed;
  REFRESH MATERIALIZED VIEW CONCURRENTLY app_league_standings;
  REFRESH MATERIALIZED VIEW CONCURRENTLY app_upcoming_schedule;
  REFRESH MATERIALIZED VIEW CONCURRENTLY app_team_profile;
END;
$$ LANGUAGE plpgsql;
```

---

## Data Flow

### Scraper → App Pipeline

```
1. SCRAPER writes to staging_games
   ↓
2. validationPipeline.js runs:
   - Validates data quality
   - Normalizes team names
   - Creates/links teams in teams_v2
   - Inserts matches to matches_v2
   - Creates league/tournament entries
   ↓
3. refresh_app_views() refreshes materialized views
   ↓
4. App queries app_* views
```

### Daily Sync Workflow

```yaml
# .github/workflows/daily-data-sync.yml
jobs:
  # Phase 1: Scrape data to staging tables (parallel)
  sync-gotsport:        → staging_games
  sync-heartland:       → staging_games
  sync-htgsports:       → staging_games

  # Phase 2: Validate and move to production
  validation-pipeline:  → teams_v2, matches_v2, leagues, tournaments

  # Phase 3: Refresh app views
  refresh-views:        → app_rankings, app_matches_feed, etc.
```

---

## Key Scripts

| Script | Purpose | Layer |
|--------|---------|-------|
| `scrapeHeartlandResults.js` | Scrape Heartland matches | 1 (staging) |
| `scrapeHTGSports.js` | Scrape HTGSports tournaments | 1 (staging) |
| `syncActiveEvents.js` | Scrape GotSport events | 1 (staging) |
| `validationPipeline.js` | Validate & move to production | 1 → 2 |
| `recalculate_elo_v2.js` | Calculate ELO ratings | 2 |
| `refresh_app_views()` | Refresh materialized views | 2 → 3 |

---

## Migration from V1

### Archived Tables (V1)
The following tables were renamed to `*_deprecated` in Session 50:
- `teams` → `teams_deprecated`
- `match_results` → `match_results_deprecated`
- `event_registry` → `event_registry_deprecated`
- `team_name_aliases` → `team_name_aliases_deprecated`
- `rank_history` → `rank_history_deprecated`
- `predictions` → `predictions_deprecated`

### Why V2?
1. **Cleaner separation**: Staging vs production vs app-ready data
2. **Better data quality**: Quality scores, source tracking
3. **Faster queries**: Materialized views with embedded JSONB
4. **Easier debugging**: Staging tables preserve raw data
5. **Scalable ingestion**: No constraints on staging = no scraper failures

---

## Appendix: Type Definitions

### gender_type enum
```sql
CREATE TYPE gender_type AS ENUM ('boys', 'girls');
```

### link_status values
```sql
'unlinked'      -- Match has team names but no team_id links
'partial'       -- One team linked, one missing
'linked'        -- Both teams linked
'manual'        -- Manually verified link
```

---

*This document is the authoritative reference for SoccerView's database architecture.*
*For changes, update this document and notify the team.*
