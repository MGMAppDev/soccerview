# SoccerView V2 Comprehensive Data Strategy

> **Version 1.0** | Created: January 28, 2026 | Session 49
>
> This document defines the future-proof data architecture for SoccerView v2.

---

## Executive Summary

The initial v2 migration approach was **too restrictive**, excluding teams without parseable `birth_year` or `gender`, which created a **cascade effect** losing 46.3% of match data (217,696 matches).

### Key Problem

```
CURRENT APPROACH (Restrictive):
  Team without birth_year → EXCLUDED
  Team excluded → ALL matches involving that team → EXCLUDED
  Result: 46% match data LOST
```

### Solution Principle

```
NEW APPROACH (Inclusive + Quality Flags):
  1. INGEST all data (100% preservation)
  2. CLEAN with quality flags (not exclusion)
  3. FILTER at query time (not at ingest)
  Result: 0% data loss + quality visibility
```

---

## 1. Data Loss Analysis

### Current State

| Metric | V1 | V2 | Lost | % Lost |
|--------|----|----|------|--------|
| Teams | 149,000 | 132,947 | 16,053 | 10.8% |
| Matches | 470,641 | 252,945 | 217,696 | **46.3%** |
| Fully Linked Matches | 388,687 | 252,945 | 135,742 | 34.9% |

### Root Causes

1. **Strict Birth Year Requirement**: 62 excluded teams had no parseable birth year/age pattern
2. **Strict Gender Requirement**: 88 excluded teams had no parseable gender pattern
3. **Parser Bugs**: 43 teams HAD BOTH patterns but parser failed (false negatives)
4. **Cascade Effect**: Each excluded team causes ALL their matches to be excluded

### High-Value Data Lost

From the analysis of top 135 excluded teams (with match history):
- Teams with 500-1200+ matches were excluded
- 72 teams had GotSport official rankings
- Some ranked as high as #86, #94, #134 nationally

---

## 2. New Architecture: Inclusive + Quality Flags

### Core Principle

**"Never exclude data at ingest. Add quality metadata. Filter at query time."**

### Schema Changes

#### 2.1 teams_v2 Additional Columns

```sql
ALTER TABLE teams_v2 ADD COLUMN IF NOT EXISTS data_quality_score INTEGER DEFAULT 0;
ALTER TABLE teams_v2 ADD COLUMN IF NOT EXISTS birth_year_source VARCHAR(20) DEFAULT 'unknown';
ALTER TABLE teams_v2 ADD COLUMN IF NOT EXISTS gender_source VARCHAR(20) DEFAULT 'unknown';
ALTER TABLE teams_v2 ADD COLUMN IF NOT EXISTS data_flags JSONB DEFAULT '{}';

-- birth_year_source values:
-- 'parsed'     - Extracted from team name (e.g., "2015" from "Club 2015 Elite")
-- 'inferred'   - Inferred from age group (e.g., "U11" → 2015 in 2026)
-- 'official'   - From GotSport/source official data
-- 'unknown'    - Could not determine

-- gender_source values:
-- 'parsed'     - Extracted from team name (e.g., "Boys", "Girls", "(B)", "(G)")
-- 'inferred'   - Inferred from context (e.g., all opponents are same gender)
-- 'official'   - From GotSport/source official data
-- 'unknown'    - Could not determine

-- data_quality_score calculation:
-- +30 points: birth_year known (any source)
-- +30 points: gender known (any source)
-- +20 points: national_rank exists (GotSport ranking)
-- +10 points: matches_played > 0
-- +10 points: elo_rating != 1500 (has been rated)
-- Range: 0-100
```

#### 2.2 Data Quality Score Logic

```javascript
function calculateDataQualityScore(team) {
  let score = 0;

  if (team.birth_year && team.birth_year_source !== 'unknown') score += 30;
  if (team.gender && team.gender_source !== 'unknown') score += 30;
  if (team.national_rank) score += 20;
  if (team.matches_played > 0) score += 10;
  if (team.elo_rating !== 1500) score += 10;

  return score;
}
```

#### 2.3 data_flags Schema

```json
{
  "needs_review": boolean,        // Flagged for manual review
  "auto_merged": boolean,         // Result of deduplication
  "name_mismatch": boolean,       // Display name differs from parsed
  "year_mismatch": boolean,       // Birth year doesn't match age group
  "potential_duplicate": string,  // ID of suspected duplicate team
  "source_conflicts": string[]    // List of conflicting source data
}
```

### Migration Strategy

#### Phase A: Inclusive Re-Migration

1. **INCLUDE ALL TEAMS** from v1 teams table
   - Parse birth_year and gender where possible
   - Set `birth_year = NULL` if not parseable (not skip)
   - Set `gender = NULL` if not parseable (not skip)
   - Set `*_source = 'unknown'` for unparsed fields
   - Calculate `data_quality_score`

2. **INCLUDE ALL MATCHES** from v1 match_results table
   - Link to teams_v2 where possible
   - Keep unlinked matches with `home_team_id = NULL`
   - Add `link_status` column: 'full', 'partial', 'unlinked'

3. **PRESERVE ALL RANKINGS** from v1
   - Transfer `national_rank`, `state_rank`, `gotsport_points`
   - Even for teams with `birth_year = NULL`

#### Phase B: Quality Enhancement Pipeline

```
Daily Pipeline:
┌─────────────────────────────────────────────────────────────┐
│ 1. SCRAPE: Ingest new data from all sources                 │
│ 2. PARSE: Extract metadata, set quality flags               │
│ 3. LINK: Fuzzy match team names to existing teams           │
│ 4. INFER: Guess missing birth_year/gender from context      │
│ 5. DEDUPE: Identify and merge duplicate teams               │
│ 6. SCORE: Recalculate data_quality_score                    │
│ 7. REFRESH: Update materialized views                       │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Query-Time Filtering

### App Queries Use Quality Thresholds

Instead of excluding data at ingest, queries filter by quality:

```sql
-- Rankings tab: Show teams with full metadata
SELECT * FROM app_rankings
WHERE data_quality_score >= 60
  AND birth_year IS NOT NULL
  AND gender IS NOT NULL
ORDER BY national_rank ASC NULLS LAST;

-- Teams tab (search): Show all, sort by quality
SELECT * FROM app_rankings
WHERE name ILIKE '%search%'
ORDER BY data_quality_score DESC, matches_played DESC;

-- Team profile: Show even low-quality teams
SELECT * FROM app_team_profile
WHERE id = $1;
-- (Let user see the team, show "incomplete data" warning if quality < 50)
```

### UI Quality Indicators

```javascript
// In app, show quality badge
function QualityBadge({ score }) {
  if (score >= 80) return <Badge color="green">Complete</Badge>;
  if (score >= 50) return <Badge color="yellow">Partial</Badge>;
  return <Badge color="gray">Incomplete</Badge>;
}
```

---

## 4. Implementation Plan

### Migration Fix (Immediate)

Create `scripts/migrations/017_inclusive_migration.js`:

```javascript
/**
 * Inclusive Migration - Zero Data Loss
 *
 * 1. Add quality columns to teams_v2
 * 2. Re-migrate ALL teams from v1 (not just parseable ones)
 * 3. Re-migrate ALL matches from v1
 * 4. Calculate quality scores
 */
```

### Schema Changes (SQL)

```sql
-- Migration 017: Add quality metadata columns
ALTER TABLE teams_v2 ADD COLUMN IF NOT EXISTS data_quality_score INTEGER DEFAULT 0;
ALTER TABLE teams_v2 ADD COLUMN IF NOT EXISTS birth_year_source VARCHAR(20) DEFAULT 'unknown';
ALTER TABLE teams_v2 ADD COLUMN IF NOT EXISTS gender_source VARCHAR(20) DEFAULT 'unknown';
ALTER TABLE teams_v2 ADD COLUMN IF NOT EXISTS data_flags JSONB DEFAULT '{}';

-- Allow NULL birth_year and gender (remove NOT NULL constraints if present)
ALTER TABLE teams_v2 ALTER COLUMN birth_year DROP NOT NULL;
ALTER TABLE teams_v2 ALTER COLUMN gender DROP NOT NULL;

-- Add link_status to matches_v2
ALTER TABLE matches_v2 ADD COLUMN IF NOT EXISTS link_status VARCHAR(20) DEFAULT 'unknown';
-- Values: 'full' (both teams linked), 'partial' (one team), 'unlinked' (neither)

-- Index for quality filtering
CREATE INDEX IF NOT EXISTS idx_teams_v2_quality
ON teams_v2 (data_quality_score DESC, matches_played DESC);
```

### View Updates

Update materialized views to handle NULL birth_year/gender:

```sql
-- app_rankings: Include all teams, order by quality
CREATE OR REPLACE VIEW app_rankings AS
SELECT
    t.*,
    CASE
        WHEN t.birth_year IS NULL OR t.gender IS NULL THEN FALSE
        ELSE TRUE
    END as has_complete_metadata
FROM teams_v2 t
ORDER BY t.data_quality_score DESC, t.national_rank ASC NULLS LAST;
```

---

## 5. Data Quality Improvement Pipeline

### Automated Inference

```javascript
// Infer birth_year from opponents
async function inferBirthYearFromOpponents(teamId) {
  const matches = await getTeamMatches(teamId);
  const opponentBirthYears = matches
    .map(m => m.opponent_birth_year)
    .filter(y => y !== null);

  if (opponentBirthYears.length >= 3) {
    // If 80%+ opponents have same birth year, infer it
    const mode = getMode(opponentBirthYears);
    const confidence = opponentBirthYears.filter(y => y === mode).length / opponentBirthYears.length;

    if (confidence >= 0.8) {
      return { birth_year: mode, source: 'inferred' };
    }
  }
  return null;
}

// Infer gender from team name patterns
function inferGenderFromName(teamName) {
  const patterns = {
    male: [
      /\bboys?\b/i, /\(B\)/, /\sB$/, /\sB\s/,
      /U\d+B\b/, /\bmen\b/i, /\bmale\b/i
    ],
    female: [
      /\bgirls?\b/i, /\(G\)/, /\sG$/, /\sG\s/,
      /U\d+G\b/, /\bwomen\b/i, /\bfemale\b/i
    ]
  };

  for (const p of patterns.male) {
    if (p.test(teamName)) return { gender: 'M', source: 'parsed' };
  }
  for (const p of patterns.female) {
    if (p.test(teamName)) return { gender: 'F', source: 'parsed' };
  }
  return null;
}
```

### Manual Review Queue

For teams with `data_quality_score < 50` and `matches_played > 10`:
- Flag for admin review
- Show in admin dashboard
- Allow manual birth_year/gender assignment

---

## 6. Success Metrics

After implementing inclusive migration:

| Metric | Before | After | Target |
|--------|--------|-------|--------|
| Teams in v2 | 132,947 | 149,000 | 100% of v1 |
| Matches in v2 | 252,945 | 388,687+ | 100% linked matches |
| Data Quality Score Avg | N/A | Track | >60 |
| Ranked teams preserved | 119,952 | 125,349 | 100% |

---

## 7. Future-Proofing

### Principle: Data Quality Improves Over Time

1. **New scraper data** adds birth_year/gender from official sources
2. **Deduplication** merges teams, keeping best metadata
3. **Inference** fills gaps from opponent data
4. **Manual review** handles edge cases

### Never Exclude Data

The v2 architecture must NEVER exclude data based on quality. Instead:
- Include ALL data
- Tag with quality metadata
- Filter at query time
- Continuously improve quality scores

This ensures:
- Zero data loss
- Retroactive improvements apply to all historical data
- Users see complete picture (with appropriate warnings)
- ELO calculations include all available matches

---

## Appendix: Migration Script Pseudocode

```javascript
// 017_inclusive_migration.js

async function inclusiveMigration() {
  // 1. Add quality columns
  await addQualityColumns();

  // 2. Re-migrate ALL teams
  const v1Teams = await supabase.from('teams').select('*');
  for (const team of v1Teams) {
    // Parse what we can, but DON'T skip on failure
    const parsed = parseTeamMetadata(team.team_name);

    await supabase.from('teams_v2').upsert({
      id: team.id,
      canonical_name: normalize(team.team_name),
      display_name: team.team_name,
      birth_year: parsed.birth_year || null,  // NULL if not parseable
      gender: parsed.gender || null,           // NULL if not parseable
      birth_year_source: parsed.birth_year ? 'parsed' : 'unknown',
      gender_source: parsed.gender ? 'parsed' : 'unknown',
      // ... transfer all other fields
    });
  }

  // 3. Re-migrate ALL matches
  const v1Matches = await supabase.from('match_results')
    .select('*')
    .not('home_team_id', 'is', null)
    .not('away_team_id', 'is', null);

  for (const match of v1Matches) {
    await supabase.from('matches_v2').upsert({
      id: match.id,
      // ... all fields, linking to teams_v2 IDs
    });
  }

  // 4. Calculate quality scores
  await recalculateAllQualityScores();

  // 5. Refresh views
  await refreshMaterializedViews();
}
```

---

*This strategy ensures SoccerView v2 maintains 100% data integrity while providing visibility into data quality.*
