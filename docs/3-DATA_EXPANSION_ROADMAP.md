# SoccerView Data Expansion Roadmap

> **Version 8.0** | Updated: February 15, 2026 | Session 98 — National Expansion Sprint
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

- **2 new adapters needed** (Demosphere, Sports Connect) + **SportsAffinity expansion** + **GotSport event discovery** = complete national coverage
- 7 adapters built (GotSport, HTGSports, Heartland, SINC Sports, MLS Next, SportsAffinity, TGS/ECNL)
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
| **GotSport** | Leagues | AL, MI, 30+ | PRODUCTION | - | - | Event discovery expanding |
| **HTGSports** | Tournaments | 26+ | PRODUCTION | - | - | Match data |
| **Heartland CGI** | League | KS, MO | PRODUCTION | PRODUCTION | PRODUCTION | Full pipeline |
| **SINC Sports** | League | NC | PRODUCTION | PRODUCTION | PRODUCTION | Full pipeline (Session 95-96) |
| **MLS Next** | National | All (U13-U19) | PRODUCTION | - | - | 9,795 matches (Session 97) |
| **SportsAffinity** | League | GA (Boys) | PRODUCTION | - | - | 2,409 matches (Session 97) |
| **TGS/ECNL** | National | All | IN PROGRESS | - | - | Adapter needs fix (Session 98) |

---

## Expansion Waves

### Wave 1: Foundation Adapters (COMPLETE ✅)

**Goal:** Build all core adapters and validate architecture across multiple sources.

| Source | States | Status | Key Metrics |
|--------|--------|--------|-------------|
| Heartland CGI | KS, MO | ✅ PRODUCTION | 14 divisions, full 3-flow pipeline |
| SINC Sports | NC | ✅ PRODUCTION | 8,692 matches, 805 standings, 15 divisions |
| MLS Next | National (U13-U19) | ✅ PRODUCTION | 9,795 matches (Session 97) |
| SportsAffinity | GA (Boys) | ✅ PRODUCTION | 2,409 matches (Session 97) |
| GotSport Rankings | National | ✅ PRODUCTION | 64% match rate, 72K source mappings |

**7 adapters built. Architecture validated across 5 independent platforms. Zero source-specific code in core pipeline.**

#### NC Expansion Lessons Learned (Session 96 — UNIVERSAL)

The NC expansion was the first state onboarded through the SINC Sports adapter. QC testing revealed **5 universal issues** that now have permanent fixes in the architecture. These learnings apply to ALL future state expansions, not just SINC Sports.

**Lesson 1: State Metadata Must Propagate from League to Teams**

| Before | After |
|--------|-------|
| `processStandings.cjs` hardcoded `state = 'unknown'` for new teams | `resolveTeam()` accepts `leagueState` parameter, inherits from league record |

When `processStandings.cjs` creates a new team, it now inherits the league's state instead of defaulting to `'unknown'`. This is universal — works for any league from any state without source-specific code.

**Lesson 2: Division Naming Is Source-Configurable, Not Universal**

Each source has its own naming convention. The adapter's `mapTierToName()` function controls this:

| Source | Naming Convention | Example |
|--------|------------------|---------|
| NCYSA (SINC) | Ordinal: "Premier", "1st Division", "2nd Division" | `mapTierToName(3)` → "2nd Division" |
| Heartland | Cardinal: "Division 1", "Division 2" | Adapter doesn't use `mapTierToName()` |
| Future sources | Whatever the source uses | Configure per adapter |

**Anti-pattern:** Never apply one source's division naming scheme as a retroactive update to another source's data. Heartland "Division 1" is NOT the same naming convention as NCYSA "1st Division".

**Lesson 3: Group Suffixes Must Be Conditional**

Only append "- Group A" when a division actually has multiple groups (A, B, C, etc.). If only one group exists, the suffix is noise.

```javascript
// ✅ CORRECT: Post-processing conditional group suffix
const groupsPerDiv = {};  // { "Premier": Set(["A"]), "1st Division": Set(["A", "B"]) }
for (const s of allStandings) {
  if (s.extra_data?.group) {
    if (!groupsPerDiv[s.division]) groupsPerDiv[s.division] = new Set();
    groupsPerDiv[s.division].add(s.extra_data.group);
  }
}
for (const s of allStandings) {
  const group = s.extra_data?.group;
  if (group && groupsPerDiv[s.division]?.size > 1) {
    s.division = `${s.division} - ${group}`;  // Only when multiple groups
  }
}
```

This is universal — if a future source has Group B, the suffix appears automatically.

**Lesson 4: Unicode Diacritics in Team Name Normalization**

International club names contain diacritical marks: Barça, Atlético, São Paulo, München. The `removeDuplicatePrefix()` algorithm must use NFD normalization to strip these before comparison. Without it, "Barca Academy Barça Academy 2013" is NOT detected as a double-prefix.

Fix in `cleanTeamName.cjs` (single source of truth):
```javascript
function stripDiacritics(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
```

This is universal — handles ALL future international club names automatically.

**Lesson 5: PostgREST Timeout on Materialized View Column Filters**

Filtering on nullable columns (e.g., `.not('home_score', 'is', null)`) on materialized views can cause PostgREST statement timeout (error code `57014`). The `head: true` option masks this as an empty `{message: ''}` error.

| Pattern | Result |
|---------|--------|
| ❌ `matches_v2` with `.not('home_score', 'is', null)` | Works (has indexes) |
| ❌ `app_matches_feed` with `.not('home_score', 'is', null)` | TIMEOUT (no index on score columns in view) |
| ✅ `app_matches_feed` with date filters only | Works (view pre-filters completed matches) |

**Rule:** App queries should use Layer 3 views (Principle 16) with lightweight filters. Heavy column filters belong in the view definition, not in the app query.

**Lesson 6: Source Data Reality — Abbreviated Names Are Not Bugs**

SINC Sports is the sole data source for NC. Abbreviated team names ("CSA Charlotte King", "WFC Silver") ARE the official NCYSA team names. GotSport doesn't cover NC at all.

**Before investigating team name "issues", verify:**
1. Does GotSport cover this state? (Check GotSport rankings for the state)
2. Is there another source with fuller names? (Check all adapters)
3. Are these abbreviations the source's official names?

If the source uses short names and there's no alternative — document it and move on. Not every data characteristic is a bug.

### Wave 2: GotSport Event Discovery (IN PROGRESS — Highest ROI)

30+ states use GotSport for league scheduling. Adapter exists. Just need event IDs.

| State | Event IDs | Status |
|-------|-----------|--------|
| AL | 45401 (Fall), 51021 (Spring) | ✅ Scraping (Session 98) |
| MI | 46034 (MYSL), 50611 (MSPSP Spring) | ✅ Scraping (Session 98) |
| FL | FSPL | Discovering event IDs |
| TX-N | NTSSA | Discovering event IDs |
| TX-S | SCL | Discovering event IDs |
| CA-NC | NorCal Premier (3,000+ teams) | Next priority |
| CA-S | SOCAL Soccer League | Next priority |
| OH | OSSL + Buckeye Premier | Queued |
| NJ/NY/PA-E/MD/DE | EDP multi-state | Queued |
| IN | ISL | Queued |
| SC | SC Challenge + PMSL | Queued |
| AZ | APL/ASL1/ASL2 | Queued |
| LA | LCSL + PSL | Queued |

**Estimated:** ~30 min per state to discover and configure event IDs.

### Wave 3: SportsAffinity Expansion (adapter BUILT)

| State | League | Impact | Status |
|-------|--------|--------|--------|
| GA Girls | GPL Girls | Complete GA coverage | Next priority |
| MN | MYSA (6 tiers) | Major market | Discover events |
| UT | UYSA (320+ teams) | Western coverage | Discover events |
| OR | OYSA | Pacific NW | Discover events |
| NE | NYSL | Midwest fill | Discover events |
| PA-W | PA West | Eastern fill | Discover events |
| HI | Island leagues | Small market | Low priority |

### Wave 4: Demosphere Adapter (NOT BUILT)

| State | League | Impact |
|-------|--------|--------|
| VA + DC | NCSL | Large market, promo/relegation |
| IL | State Premiership | Major market |
| WI | WYSA | Midwest coverage |
| KY | Premier League | Regional fill |

### Wave 5: Sports Connect Adapter (NOT BUILT)

| State | League | Impact |
|-------|--------|--------|
| CO | CO Advanced (9 tiers!) | Major market |
| IA | Iowa Soccer | Midwest fill |
| CT | CJSA | Northeast fill |
| MA | NEP | Northeast fill |
| SD | Champions League | Small market |

### Wave 6: ECNL + TN Expansion

| Source | Status | Notes |
|--------|--------|-------|
| ECNL/ECRL via TGS | Adapter needs fix (Session 98) | 13 event IDs configured |
| TN State League via SINC | Deferred to March 2026 | Between seasons |

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

### Full State Expansion Lifecycle (Session 96)

Every new state expansion follows this lifecycle. Skipping QC (Phase 3) ships broken data to users.

```
Phase 1: SCRAPE — Configure adapter, run matches + standings
Phase 2: PROCESS — Pipeline processing, ELO calculation, view refresh
Phase 3: QC — Run Post-Expansion QC Checklist (see Playbook)
Phase 4: FIX — Address QC findings with UNIVERSAL fixes
Phase 5: PRODUCTION — Commit, push, verify in nightly pipeline
```

**Phase 3 is MANDATORY.** NC expansion (Session 96) found 4 fixable issues:
- 506 teams with `state='unknown'` (invisible in state filter)
- Division names inconsistent (mixed ordinal/cardinal)
- Noise suffixes ("- Group A" when only one group exists)
- 66 teams with diacritic double-prefix

All 4 were fixed universally and now prevent the same issues for future states.

**Time budget:** Plan ~2 hours for Phase 3+4 per new state. The issues compound if deferred.

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

### Current State (Session 98)

| Metric | Value |
|--------|-------|
| Total Matches | ~425K active |
| Total Teams | ~148K |
| States at PRODUCTION | 4 (KS, MO via Heartland; NC via SINC; national via MLS Next) |
| States at PARTIAL | 3 (GA, MI, AL — active scraping) |
| States at GS RANKS | 48 |
| Data Sources | 7 (GotSport, HTGSports, Heartland, SINC Sports, MLS Next, SportsAffinity, GotSport Rankings) |
| Adapters Built | 7 (+1 TGS/ECNL in progress) |
| National Programs | MLS Next (9,795 matches), ECNL (adapter in progress) |
| Post-expansion QC protocol | Established (Session 96) |

### Next Target (Wave 2: GotSport Discovery)

| Metric | Target |
|--------|--------|
| States at PRODUCTION/PARTIAL | 10+ (add FL, TX, CA, OH) |
| New matches | +50K from state leagues |
| GotSport events discovered | 30+ |

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
