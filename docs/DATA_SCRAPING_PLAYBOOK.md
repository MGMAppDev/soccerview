# SoccerView Data Scraping Playbook

> **Version 2.0** | Updated: January 28, 2026 | V2 Architecture
>
> Comprehensive, repeatable process for expanding the SoccerView database.
> Execute this playbook to add new data sources following V2 architecture.

---

## Quick Start

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    V2 DATA SCRAPING WORKFLOW                            │
│                                                                         │
│   1. SCRAPE → Write to staging_games (no constraints)                   │
│   2. VALIDATE → Run validationPipeline.js                               │
│   3. REFRESH → Run refresh_app_views()                                  │
│   4. VERIFY → Check app displays new data                               │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## V2 Architecture Overview

### Data Flow

```
Scrapers → staging_games → validationPipeline.js → matches_v2 → app_views → App
```

### Key Tables

| Layer | Table | Purpose |
|-------|-------|---------|
| **Staging** | `staging_games` | Raw match data from scrapers |
| **Staging** | `staging_teams` | Raw team data from scrapers |
| **Staging** | `staging_events` | Raw event data from scrapers |
| **Production** | `matches_v2` | Validated match data |
| **Production** | `teams_v2` | Validated team data |
| **Production** | `leagues` | League metadata |
| **Production** | `tournaments` | Tournament metadata |
| **App Views** | `app_matches_feed` | Pre-computed for app |
| **App Views** | `app_rankings` | Pre-computed for app |

### Why Staging Tables?

1. **No constraints** - Scrapers NEVER fail due to data issues
2. **All data captured** - Bad data is reviewed, not lost
3. **Validation centralized** - One pipeline handles all sources
4. **Debugging easier** - Raw data preserved for investigation

---

## V2 Scraper Template

```javascript
/**
 * Example V2 Scraper
 * Writes to staging_games (NOT matches_v2)
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const CONFIG = {
  SOURCE_PLATFORM: "new_source",
  BATCH_SIZE: 500,
};

async function main() {
  const matches = []; // Scrape matches here

  // Transform to staging_games schema
  const stagingGames = matches.map(m => ({
    match_date: m.date,         // TEXT - no parsing required
    match_time: m.time,         // TEXT
    home_team_name: m.home,     // TEXT NOT NULL
    away_team_name: m.away,     // TEXT NOT NULL
    home_score: m.homeScore,    // TEXT
    away_score: m.awayScore,    // TEXT
    event_name: m.eventName,    // TEXT
    event_id: m.eventId,        // TEXT
    venue_name: m.venue,        // TEXT
    division: m.division,       // TEXT
    source_platform: CONFIG.SOURCE_PLATFORM,  // REQUIRED
    source_match_key: `${CONFIG.SOURCE_PLATFORM}-${m.id}`,  // For dedup
    raw_data: m,                // JSONB - preserve original
    processed: false,           // Will be true after validation
  }));

  // Insert in batches
  for (let i = 0; i < stagingGames.length; i += CONFIG.BATCH_SIZE) {
    const batch = stagingGames.slice(i, i + CONFIG.BATCH_SIZE);
    const { error } = await supabase.from("staging_games").insert(batch);
    if (error) console.error("Insert error:", error.message);
  }

  console.log(`✅ Staged ${stagingGames.length} matches`);
  console.log("📋 Next: Run validationPipeline.js to process");
}

main();
```

---

## Staging Table Schema

### staging_games

| Column | Type | Required | Notes |
|--------|------|----------|-------|
| `id` | BIGSERIAL | Auto | Primary key |
| `match_date` | TEXT | Yes | Any format - validation handles parsing |
| `match_time` | TEXT | No | Any format |
| `home_team_name` | TEXT | Yes | Raw name from source |
| `away_team_name` | TEXT | Yes | Raw name from source |
| `home_score` | TEXT | No | Can be "2", "TBD", null |
| `away_score` | TEXT | No | Can be "2", "TBD", null |
| `event_name` | TEXT | No | Human readable |
| `event_id` | TEXT | No | Source's event ID |
| `venue_name` | TEXT | No | Venue/location |
| `field_name` | TEXT | No | Specific field |
| `division` | TEXT | No | Age group + gender |
| `source_platform` | TEXT | Yes | e.g., "heartland", "gotsport" |
| `source_match_key` | TEXT | No | For deduplication |
| `raw_data` | JSONB | No | Original data preserved |
| `processed` | BOOLEAN | No | Set true after validation |
| `created_at` | TIMESTAMPTZ | Auto | Insertion timestamp |

### staging_events

| Column | Type | Required | Notes |
|--------|------|----------|-------|
| `event_name` | TEXT | Yes | Human readable |
| `event_type` | TEXT | No | "league" or "tournament" |
| `source_platform` | TEXT | Yes | e.g., "heartland" |
| `source_event_id` | TEXT | No | Source's ID |
| `state` | TEXT | No | 2-letter code |
| `region` | TEXT | No | e.g., "Kansas City" |
| `raw_data` | JSONB | No | Original data |
| `processed` | BOOLEAN | No | Set true after validation |

---

## Integration Pipeline (V2)

### After Scraping

```bash
# 1. Run validation pipeline (handles staging → production)
node scripts/validationPipeline.js

# 2. Refresh materialized views
# (validationPipeline.js can do this with --refresh-views flag)
node scripts/validationPipeline.js --refresh-views
```

### What validationPipeline.js Does

1. **Reads staging_games** where `processed = false`
2. **Validates data**:
   - Parses dates
   - Validates scores (numeric or null)
   - Normalizes team names
3. **Creates/links teams**:
   - Finds existing team in teams_v2
   - Or creates new team with quality flags
4. **Creates events**:
   - Creates league or tournament entry
5. **Inserts to matches_v2**:
   - With proper foreign keys
6. **Marks staging as processed**:
   - Sets `processed = true`
7. **Refreshes views** (if `--refresh-views`):
   - Calls `refresh_app_views()`

---

## V2 Scraper Checklist

### Before Writing Code

```markdown
## Research Checklist
- [ ] Source has OUTDOOR soccer data (NO futsal/indoor)
- [ ] Source has data from Aug 2023+ (last 3 seasons)
- [ ] Data type identified: [ ] League  [ ] Tournament  [ ] Both
- [ ] Access method identified: [ ] HTML  [ ] API  [ ] ICS
```

### During Development

```markdown
## V2 Implementation Checklist
- [ ] Writes to `staging_games` (NOT matches_v2)
- [ ] Sets `source_platform` on every record
- [ ] Generates `source_match_key` for deduplication
- [ ] Preserves raw data in `raw_data` JSONB column
- [ ] Registers events in `staging_events`
- [ ] No data validation in scraper (pipeline handles it)
- [ ] Handles rate limits / delays
- [ ] Has checkpoint/resume capability
```

### After Scraping

```markdown
## Post-Scrape Checklist
- [ ] Run `validationPipeline.js`
- [ ] Check staging_games.processed = true for new records
- [ ] Verify matches appear in `matches_v2`
- [ ] Verify teams appear in `teams_v2`
- [ ] Refresh views: `refresh_app_views()`
- [ ] Test in app: matches visible, teams searchable
```

---

## Existing V2 Scrapers

| Scraper | Source | Status | Output |
|---------|--------|--------|--------|
| `scrapeHeartlandResults.js` | Heartland CGI | ✅ V2 | staging_games |
| `scrapeHTGSports.js` | HTGSports | ⚠️ Needs update | staging_games |
| `scrapeHeartlandLeague.js` | Heartland calendar | ⚠️ Needs update | staging_games |
| `syncActiveEvents.js` | GotSport | ⚠️ Needs update | staging_games |

---

## Data Quality Rules

### Handled by validationPipeline.js

| Rule | Action |
|------|--------|
| Invalid date | Parse common formats, log if unparseable |
| Invalid score | Set null, flag for review |
| Empty team name | Skip match, log error |
| Duplicate source_match_key | Skip (idempotent) |
| Missing event | Create in leagues/tournaments |

### Quality Flags on teams_v2

| Flag | Meaning |
|------|---------|
| `data_quality_score` | 0-100 overall quality |
| `birth_year_source` | parsed/inferred/official/unknown |
| `gender_source` | parsed/inferred/official/unknown |
| `data_flags.needs_review` | Manual review needed |

---

## Monitoring

### Check Staging Status

```sql
-- Unprocessed staging records
SELECT source_platform, COUNT(*), MAX(created_at)
FROM staging_games
WHERE processed = false
GROUP BY source_platform;
```

### Check Pipeline Results

```sql
-- Recent matches by source
SELECT source_platform, COUNT(*), MAX(created_at)
FROM matches_v2
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY source_platform;

-- Unlinked matches (need team creation)
SELECT source_platform, COUNT(*)
FROM matches_v2
WHERE home_team_id IS NULL
GROUP BY source_platform;
```

### Check App Views

```sql
-- View row counts
SELECT 'app_rankings' as view, COUNT(*) FROM app_rankings
UNION ALL
SELECT 'app_matches_feed', COUNT(*) FROM app_matches_feed
UNION ALL
SELECT 'app_league_standings', COUNT(*) FROM app_league_standings;
```

---

## Rollback & Recovery

### If Bad Data Reaches Production

```sql
-- Delete from matches_v2 by source and date
DELETE FROM matches_v2
WHERE source_platform = 'bad_source'
  AND created_at > '2026-01-28';

-- Re-run view refresh
SELECT refresh_app_views();
```

### If Validation Pipeline Fails

```sql
-- Reset staging to reprocess
UPDATE staging_games
SET processed = false
WHERE source_platform = 'source_name'
  AND created_at > '2026-01-28';

-- Then re-run pipeline
```

### Preserve Staging Data

Staging tables are NOT auto-cleared. This allows:
- Debugging issues
- Re-processing with fixes
- Auditing data sources

---

## Quick Reference

### Daily Sync Workflow

```yaml
# GitHub Actions: daily-data-sync.yml

# Phase 1: Scrape (parallel)
sync-gotsport     → staging_games
sync-heartland    → staging_games
sync-htgsports    → staging_games

# Phase 2: Validate (sequential)
validation-pipeline → matches_v2, teams_v2, leagues, tournaments

# Phase 3: Refresh (sequential)
refresh-views → app_rankings, app_matches_feed, etc.
```

### Commands

```bash
# Run scraper
node scripts/scrapeHeartlandResults.js

# Run validation
node scripts/validationPipeline.js --refresh-views

# Manual view refresh
psql $DATABASE_URL -c "SELECT refresh_app_views();"

# Check staging status
psql $DATABASE_URL -c "SELECT source_platform, COUNT(*) FROM staging_games WHERE processed=false GROUP BY 1;"
```

---

*This playbook follows V2 three-layer architecture.*
*For architecture details, see [docs/ARCHITECTURE.md](ARCHITECTURE.md).*
