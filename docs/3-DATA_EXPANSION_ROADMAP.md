# SoccerView Data Expansion Roadmap

> **Version 6.0** | Updated: February 14, 2026 | Session 95 — Local-First Strategy
>
> Strategic guide for national expansion using the V2 dual-system architecture.
>
> **State-by-state tracking:** See [3-STATE_COVERAGE_CHECKLIST.md](3-STATE_COVERAGE_CHECKLIST.md) for the full 50-state + DC checklist.

---

## Strategic Principle: Local League Data IS The Product

### The Data Quality Hierarchy

```
TIER 1 (FOUNDATION): Local League Data — Division structure, standings, match results, schedules
TIER 2 (ELO FUEL):   Tournament Match Data — Cross-league matches for ELO calibration
TIER 3 (COMPLEMENT):  National Rankings — GotSport ranking badges as overlay
```

### Why Local-First?

GotSport provides ZERO individual match results, ZERO division structure, ZERO standings, ZERO scheduled games. It provides only pre-computed aggregate ranking badges (national_rank, state_rank, points).

**Local league data provides ALL FOUR pillars of the SoccerView experience:**

| Pillar | What It Powers | Source |
|--------|---------------|--------|
| **Division Context** | Division-seeded ELO (prevents Div 7 team ranking #1) | Local league only |
| **Official Standings** | League Standings page (AS-IS, not recalculated) | Local league only |
| **Match Results** | SoccerView Power Rating (ELO calculation) | Local league + tournaments |
| **Upcoming Games** | Team schedule display for parents | Local league only |

**Without local league data, a state has:** GotSport badge + tournament ELO only.
**With local league data, a state has:** Complete competitive picture — standings, divisions, schedules, accurate ELO.

### The Expansion Math

- **4 new adapters** (SINC Sports, Demosphere, SportsAffinity, Sports Connect) + **GotSport event discovery** = complete national coverage
- Each adapter covers 2-6 states
- Total: ~55 state/sub-region entries in the [checklist](3-STATE_COVERAGE_CHECKLIST.md)

---

## Three Data Flows (All Universal, All Required)

Every new league source provides data through THREE independent pipelines. All three must work for a state to reach PRODUCTION status.

### Flow 1: Match Results → SV Power Rating (ELO)

```
New Adapter → coreScraper.js → staging_games → DQE/fastProcessStaging → matches_v2
                                                  ↓
                                        Three-tier universal resolution:
                                        1. source_entity_map lookup (O(1))
                                        2. Canonical name + metadata match
                                        3. Create new + register for future
                                                  ↓
                                        recalculate_elo_v2.js → Power Rating
```

- All adapters produce the same staging format
- Entity resolution is source-agnostic
- ELO reads matches_v2 regardless of source_platform

### Flow 2: League Standings → AS-IS Display

```
New Adapter (standings) → scrapeStandings.js → staging_standings
                                                  ↓
                                      processStandings.cjs (lightweight resolver)
                                                  ↓
                                      league_standings (production)
                                                  ↓
                                      app_league_standings view (passthrough)
```

- **AS-IS principle**: W-L-D, points, position come directly from the official league
- SoccerView displays what the league published — NO recalculation
- Lightweight resolver: source_entity_map → exact match → create new (NO fuzzy matching)

### Flow 3: Scheduled/Upcoming Games

```
New Adapter (future matches, NULL scores) → same pipeline as Flow 1
                                                  ↓
                                      matches_v2 (NULL home_score/away_score)
                                                  ↓
                                      app_upcoming_schedule view
                                      (requires league_id OR tournament_id linkage)
```

- Same pipeline as completed matches, NULL scores preserved (Session 72 fix)
- Matches MUST be linked to a league or tournament to appear in "Upcoming"
- Parents plan weekends around this data — accuracy is critical

### Architecture Verification (Session 95)

Code audit confirmed:
- **ZERO instances** of `if (source_platform === ...)` in core pipeline
- All source-specific logic confined to adapter config files only
- All 3 data flows use identical code paths regardless of source
- **Core code changes needed for new sources: ZERO**

---

## Critical Rules

### Rule 1: PREMIER-ONLY — No Recreational or Indoor

| Type | Include? | Reason |
|------|----------|--------|
| **Premier/Competitive 11v11** | YES | Core competitive soccer |
| **Premier/Competitive 9v9** | YES | Youth competitive |
| **Premier/Competitive 7v7** | YES | Youth competitive |
| **Recreational leagues** | NO | Dilutes rankings (Session 84) |
| **Community programs** | NO | Not competitive level |
| **Indoor / Futsal** | NO | Different sport |

### Rule 2: Last 3 Seasons Only

| Season | Date Range | Include? |
|--------|------------|----------|
| 2025-26 (Current) | Aug 2025 - Jul 2026 | YES |
| 2024-25 | Aug 2024 - Jul 2025 | YES |
| 2023-24 | Aug 2023 - Jul 2024 | YES |
| Older | Before Aug 2023 | NO |

### Rule 3: Source Entity IDs Required (Session 89)

Every new adapter MUST emit source entity IDs for Tier 1 deterministic resolution:
- `source_home_team_id` / `source_away_team_id` — Source's team IDs
- `event_id` — Source's league/tournament ID
- `source_platform` — Platform identifier

### Rule 4: Dual-System Architecture (Session 92 QC)

Match data and standings data flow through SEPARATE resolvers:
- **Match pipeline**: Heavy 3-tier resolver (source map → canonical → fuzzy)
- **Standings pipeline**: Lightweight resolver (source map → exact → create, NO fuzzy)

Both configured in the same adapter file.

### Rule 5: Data Safety Guarantee

- New sources ADD data only. Existing data untouched.
- Soft delete only (Principle 30). Never hard delete.
- Source isolation via `source_platform` value. No cross-contamination.
- `staging_games` preserves raw data. `audit_log` captures all changes.
- Rollback always possible.

---

## Currently Integrated Sources

| Platform | Type | States | Matches | Standings | Schedules | Status |
|----------|------|--------|---------|-----------|-----------|--------|
| **GotSport** | Rankings | 50 | - | - | - | Ranking badges only |
| **HTGSports** | Tournaments | 26+ | PRODUCTION | - | - | Match data |
| **Heartland CGI** | League | KS, MO | PRODUCTION | PRODUCTION | PRODUCTION | Full pipeline |

---

## Expansion Waves

### Wave 1: SINC Sports Test (CURRENT — Session 95)

**Goal:** Validate architecture with 2 new leagues. One adapter, two states, two division schemes.

| State | League | Divisions | Purpose |
|-------|--------|-----------|---------|
| NC | NCYSA Classic League | Premier, 1st, 2nd, 3rd | Test new adapter end-to-end |
| TN | TN State League | Div 1, 2a, 2b, 3 | Validate same adapter, different naming |

Combined with existing Heartland = 3-league validation for division-seeded ELO.

### Wave 2: GotSport Event Discovery (Highest ROI — adapter already built)

30+ states use GotSport for league scheduling. Adapter exists. Just need event IDs.

**High-priority states:** FL, TX-N, TX-S, CA (3 sub-regions), GA, OH, MI, NJ, NY, PA-E, MD, IN, SC, AZ, AL

**Estimated:** ~30 min per state to discover and configure event IDs.

### Wave 3: Demosphere Adapter

| State | League | Impact |
|-------|--------|--------|
| VA + DC | NCSL | Large market, promo/relegation |
| IL | State Premiership | Major market |
| WI | WYSA | Midwest coverage |
| KY | Premier League | Regional fill |

### Wave 4: SportsAffinity Adapter

| State | League | Impact |
|-------|--------|--------|
| MN | MYSA (6 tiers) | Major market |
| UT | UYSA (320+ teams) | Western coverage |
| OR | OYSA | Pacific NW |
| NE | NYSL | Midwest fill |
| PA-W | PA West | Eastern fill |
| HI | Island leagues | Small market |

### Wave 5: Sports Connect Adapter

| State | League | Impact |
|-------|--------|--------|
| CO | CO Advanced (9 tiers!) | Major market |
| IA | Iowa Soccer | Midwest fill |
| CT | CJSA | Northeast fill |
| MA | NEP | Northeast fill |
| SD | Champions League | Small market |

---

## Adding a New Source (Quick Reference)

### Using Universal Framework Adapter (Preferred)

```bash
# 1. Copy template
cp scripts/adapters/_template.js scripts/adapters/newsource.js

# 2. Configure adapter (~50 lines):
#    - platform: unique name
#    - technology: "cheerio" | "puppeteer" | "api"
#    - baseUrl: source URL
#    - selectors: CSS selectors for match data
#    - standings: { discoverLeagues(), scrapeLeague() }
#    - rateLimit: delay between requests
#    - generateMatchKey: unique key function

# 3. Test
node scripts/universal/coreScraper.js --adapter newsource --event 12345 --dry-run

# 4. Run matches + standings
node scripts/universal/coreScraper.js --adapter newsource --active
node scripts/universal/scrapeStandings.js --adapter newsource
node scripts/maintenance/processStandings.cjs --verbose

# 5. Process through pipeline
node scripts/universal/dataQualityEngine.js --process-staging
```

**Session 57 impact:** New sources take ~1-2 hours (adapter config only) instead of days.

### Per-State Onboarding Checklist

See [3-STATE_COVERAGE_CHECKLIST.md](3-STATE_COVERAGE_CHECKLIST.md) — Verification Checklist section.

---

## Nightly Pipeline

```
Phase 1:   Scrape new data → staging_games
Phase 2:   Validate → matches_v2 (with linkage)
Phase 2.5: inferEventLinkage.js → Links orphans by team patterns
Phase 2.7: restoreGotSportRanks.cjs → Refresh GotSport ranking badges
Phase 3:   Recalculate ELO (with division seeding)
Phase 4:   Capture rank snapshot → rank_history_v2
Phase 5:   Refresh materialized views
Phase 6:   ensureViewIndexes.js → Self-healing index maintenance
```

### Maintenance Scripts

| Script | Purpose | Schedule |
|--------|---------|----------|
| `ensureViewIndexes.js` | Self-healing index maintenance | Nightly |
| `inferEventLinkage.js` | Self-healing match-event linkage | Nightly |
| `restoreGotSportRanks.cjs` | GotSport ranking refresh | Nightly |
| `processStandings.cjs` | Universal standings processor | After standings scrape |
| `fastProcessStaging.cjs` | Bulk staging processor (240x faster) | After bulk scrape |

---

## Success Metrics

### Current State

| Metric | Value |
|--------|-------|
| Total Matches | ~403K active |
| Total Teams | ~145K |
| States at PRODUCTION | 1 (KS) |
| States at PARTIAL | 1 (MO) |
| Data Sources | 3 (GotSport, HTGSports, Heartland) |
| Adapters Built | 3 |

### Wave 1 Target (After SINC Sports Test)

| Metric | Target |
|--------|--------|
| States at PRODUCTION | 3 (KS, NC, TN) |
| Adapters Built | 4 (+SINC Sports) |
| Division-seeded ELO | Validated across 3 leagues |

### National Target

| Metric | Target |
|--------|--------|
| Total Matches | 750K+ |
| States > 50% coverage | 45+ |
| States at PRODUCTION | 40+ |
| Adapters Built | 7 |
| Data Sources | 7+ |

---

## References

- [State Coverage Checklist](3-STATE_COVERAGE_CHECKLIST.md) — Master 50-state tracking
- [V2 Architecture](1.2-ARCHITECTURE.md) — Database schema
- [Data Scraping Playbook](3-DATA_SCRAPING_PLAYBOOK.md) — Adapter development guide
- [Ranking Methodology](2-RANKING_METHODOLOGY.md) — ELO calculation details
- [UI Patterns](3-UI_PATTERNS.md) — Display standards
- [Session History](1.3-SESSION_HISTORY.md) — Past work log

---

*Local league data is the foundation. Tournaments add ELO fuel. National rankings are the cherry on top.*
*Expand state by state, verify all 3 data flows, never lose existing data.*
