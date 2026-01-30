# SoccerView Universal Data Pipeline Specification
## Authoritative Technical Specification v1.0
### Date: January 29, 2026

---

## 🎯 PURPOSE

This document is the **single source of truth** for the Universal Data Pipeline architecture overhaul. Claude Code MUST reference this document throughout implementation and MUST NOT deviate from these specifications without explicit user approval.

---

## 📋 EXECUTIVE SUMMARY

**Goal:** Create a universal, scalable data ingestion framework that can handle 400+ data sources without requiring custom scripts for each source.

**Current State:** Database architecture is solid. The gap is in the scraper layer where each source requires a full custom script.

**Target State:** Source-specific logic lives in lightweight config/adapter files. Core engine is reusable.

---

## 🔴 CRITICAL REQUIREMENTS (NON-NEGOTIABLE)

### Requirement 1: Data Integrity is Priority #1

**Without accurate, reliable data, we have nothing.**

The entire app's value proposition depends on:
- Parents finding their kid's team with correct rankings
- Coaches trusting the data for competitive analysis  
- Tournament directors using it for seeding decisions

**Acceptance Criteria:**
- [ ] Zero data loss during migration
- [ ] All existing match linkages preserved
- [ ] ELO calculations produce identical results before/after
- [ ] Fuzzy matching accuracy maintained at 84.7%+

---

### Requirement 2: Overnight GitHub Actions Pipeline (The Engine)

**This is HOW and WHEN we gather and heal data.**

#### Current Nightly Pipeline Structure (PRESERVE THIS):
```
Phase 1: Data Collection (syncActiveEvents.js, scrapers)
Phase 2: Validation
Phase 2.5: Inference Linkage (inferEventLinkage.js) ← CRITICAL
Phase 3: ELO Calculation (recalculate_elo_v2.js)
Phase 4: Score Predictions (scorePredictions.js)
Phase 5: Summary
```

#### The `inferEventLinkage.js` Pattern (PROTECT THIS):
- Finds orphaned matches (no league_id, no tournament_id)
- Checks what events home_team and away_team both play in
- If both teams share a common event AND date fits → infers linkage
- Updates matches with inferred event
- **Self-healing**: Gets smarter over time as team-event relationships grow
- **Proven Results**: Reduced orphaned matches from 6,944 → 5,789 in first run

#### Nightly Cycle Must:
1. Hit every configured data source
2. Validate and clean incoming data
3. Run inference to heal orphaned/unlinked records
4. Recalculate ELO ratings with newly linked matches
5. Flow: Layer 1 (staging) → Layer 2 (processed) → Layer 3 (clean/read)
6. Complete before users wake up with fresh, healed data

**Acceptance Criteria:**
- [ ] Framework integrates with existing `.github/workflows/daily-data-sync.yml`
- [ ] All existing phases preserved
- [ ] New source adapters plug into Phase 1 seamlessly
- [ ] Inference linkage continues to work
- [ ] Pipeline completes within GitHub Actions timeout limits

---

### Requirement 3: Team Detail Page is the Core Product

**Every team MUST have a complete, accurate profile showing:**

| Data Type | Description | Source |
|-----------|-------------|--------|
| **League Matches** | Recurring season play (e.g., ECNL Fall 2024) | match_results WHERE source_type='league' |
| **Tournament Matches** | One-time competitions (e.g., Dallas Cup) | match_results WHERE source_type='tournament' |
| **Upcoming Schedule** | Future games with dates, opponents, venues | match_results WHERE match_date > NOW() |
| **Team Stats** | Wins, losses, draws, goals for/against, win % | Calculated from match_results |
| **Rankings** | Official (GotSport) + SoccerView Power Rating (ELO) | teams table |
| **Championship Badges** | Tournament wins, league titles | Historical achievements |

**Acceptance Criteria:**
- [ ] League and tournament matches categorized correctly
- [ ] Upcoming matches captured and queryable
- [ ] Team stats calculated accurately
- [ ] All data types flow through universal pipeline

---

### Requirement 4: Protect Existing Work (NON-NEGOTIABLE)

**DO NOT start from scratch.**

#### Existing Scripts to Preserve:
| Script | Purpose | Key Logic to Extract |
|--------|---------|---------------------|
| `linkTeams.js` | Link team names to team IDs | Suffix stripping regex, prefix matching cascade |
| `syncActiveEvents.js` | Re-scrape active events | Activity detection, group discovery |
| `recalculate_elo_v2.js` | Calculate ELO ratings | K-factor, expected score formula |
| `inferEventLinkage.js` | Self-healing orphan matches | Common event detection, date fitting |
| `scorePredictions.js` | Score user predictions | Scoring algorithm |
| `runTeamScraperBatch.js` | Batch team scraping | Checkpoint saving, resume logic |
| `runEventScraperBatch.js` | Batch event scraping | Error handling, retry logic |
| `fastLinkV3.js` | Fast team linking | Trigram matching, threshold tuning |

#### Patterns to Preserve:
- **Rate limiting**: Delays between requests, exponential backoff
- **Checkpoint saving**: Resume capability after interruption
- **Error handling**: Graceful failures, detailed logging
- **Fuzzy matching**: pg_trgm with 0.75 similarity threshold
- **Suffix stripping**: `REGEXP_REPLACE(name, '\\s*\\([^)]*\\)\\s*$', '')`

**Process Requirement - MANDATORY:**
1. Inventory all existing scrapers and their unique logic
2. Document edge cases each script handles
3. Create test cases from real data each script processes correctly
4. Only THEN design the universal framework to accommodate all patterns

**Acceptance Criteria:**
- [ ] Complete inventory of existing scripts created
- [ ] All edge case handlers documented
- [ ] Test cases created with real data
- [ ] No functionality regression after migration

---

## 🏗️ PROPOSED ARCHITECTURE

### Layer Model
```
┌─────────────────────────────────────────────────────────────┐
│                    LAYER 3: CLEAN (Read)                     │
│  teams, match_results (linked), team_elo, rankings          │
│  App reads from here                                         │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ Promotion Engine
                              │ (fuzzy match, dedup, link)
┌─────────────────────────────────────────────────────────────┐
│                   LAYER 2: PROCESSED                         │
│  staging_games, staging_teams, staging_events               │
│  Validated, normalized, ready for linking                   │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ Core Scraper Engine
                              │ (reads adapters, writes staging)
┌─────────────────────────────────────────────────────────────┐
│                     LAYER 1: RAW                             │
│  raw_data JSONB columns                                      │
│  Exactly what the source returned                           │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │
┌─────────────────────────────────────────────────────────────┐
│                   SOURCE ADAPTERS                            │
│  /adapters/gotsport.json                                    │
│  /adapters/sinc.json                                        │
│  /adapters/demosphere.json                                  │
│  Lightweight configs: URLs, selectors, field mappings       │
└─────────────────────────────────────────────────────────────┘
```

### Universal Framework Components

#### 1. Source Adapter (Config File)
```json
{
  "platform": "gotsport",
  "baseUrl": "https://system.gotsport.com",
  "endpoints": {
    "events": "/api/events",
    "matches": "/api/matches",
    "teams": "/api/teams"
  },
  "selectors": {
    "matchTable": "table.schedule-table",
    "homeTeam": "td:nth-child(2)",
    "awayTeam": "td:nth-child(4)",
    "score": "td:nth-child(3)"
  },
  "fieldMappings": {
    "home_team_name": "homeTeam",
    "away_team_name": "awayTeam",
    "match_date": "date"
  },
  "rateLimiting": {
    "requestsPerMinute": 30,
    "retryAttempts": 3,
    "backoffMs": 1000
  }
}
```

#### 2. Core Scraper Engine
- Reads adapter config
- Fetches data using adapter-defined endpoints/selectors
- Applies adapter-defined rate limiting
- Writes to staging tables with `source_platform` tag
- Preserves raw response in `raw_data` JSONB

#### 3. Promotion Engine
- Reads from staging tables
- Applies fuzzy matching (existing `linkTeams.js` logic)
- Deduplicates across sources
- Promotes to production tables
- Triggers inference linkage

---

## 📅 PHASED EXECUTION PLAN

### Phase 1: Audit & Document (DO THIS FIRST)
**Duration:** 1 session
**Deliverables:**
- [ ] Complete inventory of all existing scripts
- [ ] Document each script's unique logic and edge cases
- [ ] Create test cases from real data
- [ ] Gap analysis: what exists vs. what's needed

**MANDATORY:** Do not proceed to Phase 2 without user approval of Phase 1 deliverables.

### Phase 2: Design Framework Architecture
**Duration:** 1 session
**Deliverables:**
- [ ] Adapter schema specification
- [ ] Core engine design document
- [ ] Promotion engine design document
- [ ] Integration plan with existing GitHub Actions

**MANDATORY:** Do not proceed to Phase 3 without user approval of Phase 2 deliverables.

### Phase 3: Build Core Framework with ONE Adapter
**Duration:** 2-3 sessions
**Deliverables:**
- [ ] Core scraper engine (source-agnostic)
- [ ] GotSport adapter (first adapter, proving the pattern)
- [ ] Run ALONGSIDE existing scripts (not replacing)
- [ ] Validate output matches existing system

**MANDATORY:** Do not deprecate existing scripts until new framework produces identical results.

### Phase 4: Migrate Additional Sources
**Duration:** Ongoing (1 session per source)
**Process:**
- Create adapter config for source
- Test with small batch
- Validate against existing data
- Switch over when validated
- Deprecate old custom script

### Phase 5: Harden & Optimize
**Duration:** Ongoing
**Focus:**
- Performance tuning
- Error handling improvements
- Monitoring and alerting
- Documentation

---

## ✅ ACCEPTANCE CRITERIA CHECKLIST

Before considering any phase complete:

### Data Integrity
- [ ] Match counts identical before/after
- [ ] Team counts identical before/after
- [ ] Link rates maintained or improved
- [ ] ELO calculations produce same results
- [ ] No orphaned records created

### Functionality
- [ ] All existing scripts' functionality preserved
- [ ] GitHub Actions pipeline runs successfully
- [ ] Nightly cycle completes within timeout
- [ ] Inference linkage continues to heal data

### Architecture
- [ ] New sources can be added via config only
- [ ] No code changes required for new sources
- [ ] Staging → Production flow working
- [ ] Layer 1/2/3 separation maintained

---

## 🚫 ANTI-PATTERNS TO AVOID

1. **DO NOT** delete existing scripts until replacement is validated
2. **DO NOT** modify production tables without backup plan
3. **DO NOT** skip the audit phase
4. **DO NOT** build for hypothetical sources before real ones work
5. **DO NOT** optimize prematurely - correctness first
6. **DO NOT** ignore edge cases discovered in existing scripts
7. **DO NOT** proceed to next phase without explicit user approval

---

## 📁 KEY FILES REFERENCE

### Database Tables
- `staging_events` - Raw event data
- `staging_games` - Raw match data  
- `staging_teams` - Raw team data
- `match_results` - Production matches (456K rows)
- `teams` - Production teams (117K rows)
- `event_registry` - Tournaments/Leagues (1,761 rows)
- `platform_registry` - Data source registry
- `external_team_records` - Cross-platform team linking

### Scripts (Preserve These)
- `scripts/linkTeams.js`
- `scripts/syncActiveEvents.js`
- `scripts/recalculate_elo_v2.js`
- `scripts/inferEventLinkage.js`
- `scripts/scorePredictions.js`
- `scripts/runTeamScraperBatch.js`
- `scripts/runEventScraperBatch.js`
- `scripts/fastLinkV3.js`

### Workflows
- `.github/workflows/daily-data-sync.yml`

### Documentation
- `docs/DATA_PIPELINE_GUIDE.md`
- `docs/ARCHITECTURE.md`
- `docs/DATA_SCRAPING_PLAYBOOK.md`
- `CLAUDE.md`

---

## 📝 SESSION HANDOFF TEMPLATE

At the end of each session, document:

```markdown
## Session [N] Complete

### What Was Done:
- [List of completed items]

### What Was NOT Done:
- [List of items deferred]

### Current State:
- [Description of system state]

### Immediate Next Step:
- [Single, specific next action]

### Blockers/Risks:
- [Any issues discovered]

### Files Modified:
- [List of files changed]

### Validation Status:
- [ ] Data integrity verified
- [ ] No regressions introduced
- [ ] Tests passing
```

---

## 🔐 FINAL AUTHORITY

This specification document is authoritative. If there is any conflict between this document and other instructions:

1. This document takes precedence
2. User approval required to deviate
3. Any deviation must be documented with rationale

---

## ⚠️ MANDATORY FIRST ACTION

**Claude Code MUST acknowledge understanding of ALL requirements before taking ANY action:**

1. Read this entire document
2. Confirm understanding of all 4 critical requirements
3. Confirm understanding of phased execution plan
4. Confirm understanding of protection rules
5. Begin Phase 1 ONLY after acknowledgment

**Do not write any code until Phase 1 audit is complete and approved by user.**
