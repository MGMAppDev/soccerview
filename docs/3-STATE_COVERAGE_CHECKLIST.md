# SoccerView State Coverage Checklist

> **Version 5.1** | Updated: February 17, 2026 | Session 103 COMPLETE
>
> **THE MASTER TRACKER** for national expansion. Every US state, every premier league, every platform, every action needed.
> **Updated every session.** This is the single source of truth for coverage status.
>
> **GUARANTEED END STATE:** All 55 entries at PRODUCTION — division structure, standings, matches, schedules for every premier league in every state.
>
> **SESSION 104 FOCUS:** Build Squadi adapter → AR to PRODUCTION

---

## Session Progress Log

| Session | Date | Accomplishments | Delta | Next Priority |
|---------|------|-----------------|-------|---------------|
| 95 | Feb 14 | SINC Sports adapter, NC data, division-seeded ELO | +8,692 matches, NC PRODUCTION | NC QC fixes |
| 96 | Feb 15 | NC QC fixes, Post-Expansion QC Protocol | 6 universal fixes | MLS Next + SportsAffinity |
| 97 | Feb 15 | MLS Next + SportsAffinity GA adapters | +12,204 matches, 2 new adapters | ECNL + FL/TX expansion |
| 98 | Feb 15 | ECNL first scrape + FL/TX leagues + MLS Next reclass | +1,545 matches, TGS adapter | Fix 3 app bugs |
| 98b | Feb 15 | Fixed 3 app bugs, verified all 55 state platforms, master plan | Bug fixes + research | Wave 2a GotSport discovery |
| 98b-2 | Feb 15 | Wave 2a: Scraped 14 GotSport events across 10 states | +493 matches, +1,186 teams, +4 leagues | Wave 2b event discovery |
| 98b-3 | Feb 15 | Wave 2b audit (34 states have data!) + Wave 2c (GA, USYS NL) | +87 matches, coverage audit | Wave 3 SportsAffinity |
| 99 | Feb 16 | **Wave 3 SA: Scraped all 5 states (Spring+Fall).** 29 Fall 2025 GUIDs discovered. Adapter 35→64 events. Season docs + checkpoint system. | **+13,678 matches, +6,407 teams, +15 leagues** | PA-W GLC fix, GA Girls, ECNL |
| 100 | Feb 16 | **Wave 8 ECNL FULL SCRAPE.** All 76 ECNL/ECRL/Pre-ECNL events (IDs 3880-3960). TGS adapter 13→76 events. 79 tournaments reclassified as leagues. daily-data-sync.yml +3 jobs. PA-W GLC investigated (restricted access). GA Girls resolved (not on SA). | **+32,858 matches, +4,503 teams, +79 leagues** | Commit+push, checklist v4.0, next wave |
| 101 | Feb 16 | **ECNL future-proofing** (LEAGUE_KEYWORDS + 74 SEM backfill). **Wave 2d: MD/DE/IA** — 12 events across 3 platforms (SA, GS, HTG). EDP League 44329 (496), ICSL 43667 (365), ISL IA (580), IDL (32), ESPL (10), CLS (56), USYS NL (70), CPSL (17). ND resolved (no state league). WV deferred (March). | **+1,041 matches, +1,306 teams, +9 leagues, +74 TGS SEM** | Wave 4 PlayMetrics (CO+SDL) |
| 102 | Feb 16 | **Wave 4: PlayMetrics adapter COMPLETE.** Fixed 3 root cause bugs (matchKey template, rowCount falsy, DOM date extraction). Scraped CO CAL Fall 2025 (4,764 matches, 108 divisions) + SDL Boys (320) + SDL Girls (29). Built 8th adapter. Added sync-playmetrics to pipeline. coreScraper.js bugs fixed. | **+5,113 matches, +2,272 teams, +3 leagues, +1 adapter, +1 pipeline job** | Wave 5 Demosphere (VA/DC+IL+WI) |
| 103 | Feb 16-17 | **Wave 5: Demosphere adapter COMPLETE + WI PlayMetrics.** Built Demosphere adapter v2.0 (Cheerio, JSON/XML endpoints). Discovered 608 NCSL divisions (286 Fall + 322 Spring). Scraped 32,289 matches → 10,842 unique staged. Resolved 1,106 team names from standings XML. WI WYSA via PlayMetrics: Fall 2,164 + Spring 2,230. IL confirmed on GotSport (7 leagues, 12K+ matches). 4 events reclassified as leagues (NCSL Fall/Spring + WYSA Fall/Spring). | **+15,268 matches, +5,042 teams, +4 leagues, +1 adapter, +1 pipeline job** | Wave 6 Squadi (AR) |

---

## Active Work Queue (Priority-Ordered Task List)

> **CRITICAL:** This section tracks ALL incomplete work in priority order. Every item MUST be completed — no deferrals without "MUST SOLVE" override.

### 🔴 Priority 1: CRITICAL PATH — Adapter Buildout (Sessions 103-105)
**Blocks 7 states from PRODUCTION**

#### Session 103: Demosphere Adapter (VA/DC, IL, WI) — COMPLETE ✅
- [x] **Phase 1: Research** — Discovered Demosphere JSON API (`elements.demosphere-secure.com/{orgId}/schedules/{seasonName}/{divisionId}.js`). NCSL org 80738, 608 divisions. IL confirmed on GotSport (not Demosphere). WI migrated to PlayMetrics (org 1014).
- [x] **Phase 2: Build Adapter** — Created `scripts/adapters/demosphere.js` v2.0 (Cheerio-based, JSON/XML endpoints). Added WI to PlayMetrics adapter.
- [x] **Phase 3: Scraping** — NCSL: 32,289 found → 10,842 unique staged. WI WYSA Fall: 2,164. WI WYSA Spring: 2,230. Team names resolved from standings XML (1,106 teams, 9,915 records).
- [x] **Phase 4: Pipeline Integration** — Processed through fastProcessStaging.cjs. Added 'demosphere' to KNOWN_PLATFORMS. 4 events reclassified as leagues.
- [x] **Phase 5: Production Deployment** — sync-demosphere job added to pipeline. ELO recalculated (225,171 matches). Views refreshed.
- [x] **Phase 6: Verification** — VA: 11,000 league matches. WI: 4,516 league matches. IL: unchanged (already 12,123 via GotSport).
- [x] **Phase 7: Documentation** — Checkpoint, checklist v5.1, CLAUDE.md v23.3 updated.

**Actual Results:** VA+DC+WI upgraded, **+15,268 matches, +5,042 teams, +4 leagues, 9th adapter, 9th pipeline job**

---

#### Session 104: IL/VA/WI Gap Fill + Squadi Adapter (AR)

**Phase 1: IL/VA/WI Gap Fill** (~1 hour) — Discovered via Session 103 research agents. DATA INTEGRITY demands we scrape known premier leagues, not skip them.

- [ ] **IL — Add 5 NISL + SLYSA events to GotSport adapter** (NISL = 17,000 players, 1,300 teams)
  - `44630` — NISL NPL Fall 2025
  - `40124` — NISL NPL Spring 2025
  - `44632` — NISL Club & Conference Fall 2025
  - `41112` — NISL Club & Conference Spring 2025
  - `45100` — SLYSA IL Central Division Fall 2025
  - Scrape all 5, process via fastProcessStaging
  - Expected: **+2,000-5,000 IL matches** (NISL is massive)

- [ ] **VA — Add 3 VCSL/VPSL/TASL events to GotSport adapter**
  - `44587` — VCSL (Virginia Club Soccer League) 2025-26 (20+ clubs)
  - `42891` — VPSL NPL Fall 2025 (major VA league)
  - `41359` — TASL Spring 2025 (Tidewater/Hampton Roads, 270+ teams)
  - Scrape all 3, process via fastProcessStaging
  - Expected: **+1,000-3,000 VA matches**

- [ ] **WI — Add 5 regional leagues + 4 tournaments to PlayMetrics adapter**
  - Leagues (3 new org IDs):
    - `1027-1519-e326860f` — MAYSA League Fall 2025 (Madison, competitive)
    - `1027-1262-9af9ea75` — MAYSA League Spring 2025
    - `1028-1508-d9de4618` — East Central Classic League Fall 2025
    - `1028-1245-87cf8b2e` — East Central Spring 2025
    - `1033-1414-5115f522` — Central Wisconsin Soccer League
  - Tournaments:
    - `1014-1549-d93b8fa6` — WYSA State Championships Fall 2025
    - `1014-1287-253aeff2` — WYSA State Championships Spring 2025
    - `1014-1548-5e86d088` — WYSA Presidents Cup Fall 2025
    - `1014-1286-98381605` — WYSA Presidents Cup Spring 2025
  - Scrape all, process via fastProcessStaging
  - Expected: **+500-1,500 WI matches**

- [ ] **Run ELO recalculation + refresh views**

**Phase 1 Expected Results:** +3,500-9,500 matches across IL/VA/WI — zero new adapters needed (all use existing GotSport + PlayMetrics)

---

**Phase 2: Squadi Adapter (AR)**

- [ ] Research Squadi React SPA structure
- [ ] Build Squadi adapter (Puppeteer-based)
- [ ] Scrape Arkansas Competitive Soccer League
- [ ] Process and deploy to production
- [ ] Verify AR → PRODUCTION

**Phase 2 Expected Results:** 1 state → PRODUCTION, +500-1,000 matches, 10th adapter

---

**Session 104 Total Expected:** +4,000-10,500 matches, 10th adapter, IL/VA/WI significantly boosted

---

#### Session 105: RI + HI Adapters
- [ ] **RI Super Liga** (0.5 session)
  - Build Cheerio-based adapter for PHP endpoints
  - Scrape RI Super Liga (3 divisions per age/gender)
  - Expected: +200-400 matches

- [ ] **HI Oahu League** (0.5 session)
  - Build Puppeteer-based adapter for AngularJS SPA
  - Scrape Oahu League (A/B/C flights)
  - Expected: +150-300 matches

**Expected Results:** 2 states → PRODUCTION, +350-700 matches, 11th-12th adapters

---

### 🟡 Priority 2: HIGH — National Programs Complete (Sessions 106-107)

#### Session 106: National Programs — Get ALL Available Data
**CRITICAL:** "Between seasons" is NOT an excuse — get ALL data available NOW + ensure future schedules captured

- [ ] **Girls Academy — COMPLETE COVERAGE**
  - **NOT "between seasons"** — scrape ALL Fall 2025 data available
  - Events to scrape: 42137, 42138, 44874, 45530
  - Verify schedule scraping for Spring 2026 works
  - Run discovery for ALL Girls Academy events
  - Expected: 136 → 600-800 matches (Fall 2025 portion)

- [ ] **USYS National League — 13 Conferences**
  - **NOT "between seasons"** — discover ALL conference event IDs NOW
  - Scrape all available data (Fall 2025 portion)
  - Ensure schedule capture works for Spring 2026
  - Known: Sunshine P1 (43114), Sunshine P2 (43943), GL+MW (between seasons)
  - Missing: 10+ remaining conferences
  - Action: WebSearch + GotSport discovery for all 13 conference IDs
  - Expected: 30 → 1,000-2,000 matches

- [ ] **NPL Regional — 2 Remaining Leagues**
  - 16/18 already on GotSport
  - Discover final 2 regional NPL leagues
  - Expected: 1,104 → 1,300-1,500 matches

**Expected Results:** +1,500-3,000 matches, 3 national programs complete

---

#### Session 107: PA-W GLC — MUST SOLVE (Principle 42)
**CRITICAL:** NOT acceptable to defer. Try minimum 5 MORE approaches.

- [ ] **Approach 11:** SportsAffinity API endpoints (inspect network tab on working states)
- [ ] **Approach 12:** Historical Wayback Machine archives
- [ ] **Approach 13:** Alternative data sources (clubs posting schedules)
- [ ] **Approach 14:** Direct widget embed URLs
- [ ] **Approach 15:** Mobile app endpoints
- [ ] **Approach 16:** Contact league admin (last resort)

**GUIDs saved in:** `.claude/hooks/session_checkpoint.md`

**Expected Results:** +500-1,000 matches (top-tier PA-W)

---

### 🟠 Priority 3: MEDIUM — Standings Scrapers (Sessions 108-109)
**Upgrade 41 states from PARTIAL → PRODUCTION**

#### Session 108: Standings Part 1
- [ ] **GotSport Adapter** — Add standings scraping
  - States affected: 35 states
  - Test on CA, TX, NY
  - Expected: +5,000-10,000 standings entries

- [ ] **SportsAffinity Adapter** — Add standings scraping
  - States affected: GA, MN, UT, OR, NE, PA-W, IA (7 states)
  - Expected: +3,000-5,000 standings entries

**Expected Results:** +8,000-15,000 standings entries, 10+ states → PRODUCTION

---

#### Session 109: Standings Part 2
- [ ] **PlayMetrics Adapter** — Add standings scraping (CO, SDL)
- [ ] **HTGSports Adapter** — Add standings scraping (26+ states)
- [ ] **MLS Next Adapter** — Add standings scraping (national)
- [ ] **TotalGlobalSports Adapter** — Add standings scraping (ECNL)

**Expected Results:** +4,500-7,000 standings entries, 5+ states → PRODUCTION

---

### 🟢 Priority 4: POLISH — Technical Debt & Optimization (Session 110+)

#### Session 110a: Fix Double-Prefix Failures
- [ ] Investigate 74 matches that failed team resolution in Wave 2d
- [ ] Example: "Delmarva Rush Delmarva Rush Rush 2017B"
- [ ] Fix edge cases in `cleanTeamName.cjs`
- [ ] Re-process failed matches

**Expected Results:** +74 matches resolved

---

#### Session 110b: View Refresh Optimization
- [ ] Diagnose app_league_standings 50+ sec refresh time
- [ ] Add indexes to hybrid view
- [ ] Optimize SQL queries
- [ ] Test refresh performance

**Expected Results:** <10 sec refresh time

---

#### Session 110c: Source Entity Map Backfill
- [ ] Analyze existing matches for missing SEM entries
- [ ] Backfill from historical data
- [ ] Expected: ~72K → 90K+ entries

---

#### Ongoing: Daily Pipeline Monitoring
- [ ] Monitor 8 sync jobs for failures
- [ ] Add alerting for failures
- [ ] Weekly pipeline health reports

---

## Completion Targets (Updated Session 103)

| Milestone | Current (S102) | Target (S110) | Target (S120) | Gap to S110 |
|-----------|----------------|---------------|---------------|-------------|
| **States at PRODUCTION** | 4 | **15** | **55** | 11 states |
| **States at PARTIAL+** | 47 | 55 | 55 | 8 states |
| **Active matches** | 495,178 | **600,000** | **1,000,000** | +104,822 |
| **Leagues in DB** | 414 | **500** | **700** | +86 |
| **National programs** | 3 PROD | **7 PROD** | **7 PROD** | 4 programs |
| **Adapters built** | 9 | **12** | **12** | 3 adapters |
| **Pipeline sync jobs** | 9 | **12** | **12** | 3 jobs |
| **Standings coverage** | 2 adapters | **8 adapters** | **8 adapters** | 6 adapters |

### Milestone Breakdown

**By Session 110 (Est. 2 weeks):**
- All 12 adapters built ✅
- 15 states at PRODUCTION (KS, MO-KC, NC, GA, VA, DC, IL, WI, AR, RI, HI + 4 more via standings)
- 600K+ matches (from national programs + standings scrapers)
- All national programs complete (Girls Academy, USYS NL, NPL, SDL)
- All high-priority technical debt cleared

**By Session 120 (Est. 4-6 weeks):**
- All 55 entries at PRODUCTION
- 1M+ matches
- Full standings coverage across all adapters
- Daily pipeline running smoothly with zero gaps

---

## Coverage Summary

| Status | Count | Description |
|--------|-------|-------------|
| **PRODUCTION** | 4 | Full data pipeline (matches + standings + schedules) |
| **PARTIAL** | 43 | Some league data active, need standings/more events |
| **GS RANKS** | 5 | GotSport ranking badges only — no local league data yet |
| **NO LEAGUE** | 3 | No statewide premier league exists (MS, SD, WY) |
| **Total** | 55 | All 50 states + DC (CA split 3, PA split 2) |

### National Programs (Updated Session 103)

| Program | Adapter | Status | Matches | Age Groups | Action Required |
|---------|---------|--------|---------|------------|-----------------|
| **MLS Next** | mlsnext.js (Modular11/Puppeteer) | **PRODUCTION** | 9,795 | U13-U19 Boys | Add standings scraper (S109) |
| **ECNL/ECRL/Pre-ECNL** | totalglobalsports.js (TGS/Puppeteer) | **PRODUCTION** | **33,567** (76 events) | U13-U19 Boys+Girls | Add standings scraper (S109) |
| **GotSport Rankings** | restoreGotSportRanks.cjs | **PRODUCTION** | N/A (ranks only) | All | Daily refresh working ✅ |
| **SDL** | playmetrics.js (PlayMetrics/Puppeteer) | PARTIAL → **PRODUCTION (S109)** | 349 | U11-U12 Boys+Girls | Add standings scraper |
| **Girls Academy** | gotsport.js (GotSport) | PARTIAL → **SESSION 106** | 136 → **600-800 target** | U13-U19 Girls | **NOT "between seasons"** — scrape ALL Fall 2025 data (42137, 42138, 44874, 45530) + verify Spring schedule capture |
| **USYS National League** | gotsport.js (GotSport) | MISSING → **SESSION 106** | 30 → **1,000-2,000 target** | Regional conferences | **NOT "between seasons"** — discover all 13 conference IDs NOW + scrape Fall 2025 data |
| **NPL (18 regional)** | gotsport.js (GotSport) | PARTIAL → **SESSION 106** | 1,104 → **1,300-1,500 target** | Regional NPL | Discover 2 remaining leagues (16/18 on GotSport) |

### Adapter Status (12 needed for 100% coverage)

| # | Adapter | Status | States Covered | Division Data |
|---|---------|--------|----------------|:---:|
| 1 | **GotSport** | PRODUCTION | 35 states (304+ leagues, 1,777 tournaments) | Via event discovery |
| 2 | **Heartland CGI** | PRODUCTION | KS, MO-KC | Yes (14 divisions) |
| 3 | **HTGSports** | PRODUCTION | 26+ (tournaments) | Basic |
| 4 | **SINC Sports** | PRODUCTION | NC, TN (between seasons) | Yes (15 divisions) |
| 5 | **MLS Next (Modular11)** | PRODUCTION | National (all states) | Yes (conferences) |
| 6 | **SportsAffinity** | PRODUCTION | GA, MN, UT, OR, NE, PA-W, IA (66 events) | No |
| 7 | **TotalGlobalSports** | **PRODUCTION** | ECNL national (76 events, 33,567 matches) | Yes (conferences/regions) |
| 8 | **PlayMetrics** | **PRODUCTION** | CO, SDL + growing | Yes — public `/g/` URLs |
| 9 | **Demosphere** | **PRODUCTION** | VA/DC (NCSL) | Yes — JSON/XML endpoints |
| 10 | **Squadi** | **NOT BUILT** | AR (+ NJ partial) | Yes — public standings URLs |
| 11 | **RI Super Liga** | **NOT BUILT** | RI | Yes — PHP endpoints |
| 12 | **HI Oahu League** | **NOT BUILT** | HI | Yes — AngularJS SPA |

**9 built (all PRODUCTION) + 3 to build = 12 adapters for 100% national coverage.**

---

## Complete State Checklist (Session 98b — ALL PLATFORMS VERIFIED)

### Legend

- **PRODUCTION** — Full pipeline: matches + standings + schedules
- **PARTIAL** — Some data flows active, others need work
- **GS RANKS** — GotSport ranking badges only (no local match/standings/schedule data)
- **NO LEAGUE** — No statewide premier league exists; teams compete in multi-state events

### Alabama — Wyoming (Alphabetical)

| # | State | Primary Premier League | Divisions | Platform | GotSport Event IDs | SV Status | Action |
|---|-------|----------------------|-----------|----------|-------------------|-----------|--------|
| 1 | **AL** | Alabama State League (ASL) | Div 1, 2 | GotSport | 45401, 51021 | **PARTIAL** | Scrape Spring 2026 |
| 2 | **AK** | United Anchorage YSL (UAYSL) | A/B/C flights | GotSport | **5082** | GS RANKS | Event 5082 scraped — 0 matches (between seasons). Retry next season. |
| 3 | **AZ** | AZ Advanced Leagues (APL/ASL1/ASL2) | APL, ASL1, ASL2 | GotSport | 32958, 44446, 34558, 39642, 39518, 40487 | **PARTIAL** | 6 leagues, 418 matches. Already discovered. |
| 4 | **AR** | Arkansas Competitive Soccer League (ACSL) | U11-U19 B+G | **Squadi** | N/A (was GotSport pre-2024) | GS RANKS → **SESSION 104** | **BUILD SQUADI ADAPTER** — React SPA, Puppeteer-based, public standings URLs confirmed. Expected: +500-1,000 matches. |
| 5 | **CA-N** | Cal North CSL (CCSL) + BPYSL + CASA | Gold, Silver, Bronze, Copper | GotSport | 44635, 38645, 41352, 45152 | **PARTIAL** | Merged with CA. 17 CA leagues, 7,416 matches total. |
| 6 | **CA-NC** | NorCal Youth Premier League | Premier, Gold, Silver, Bronze, Copper | GotSport | 33458, 40753, 43408, 39481, 41823, 44145, 44142 | **PARTIAL** | Already discovered. NorCal: ~3,500 matches. |
| 7 | **CA-S** | SOCAL Soccer League + CCSAI + SCL | NPL + tiers | GotSport | 43086, 45205, 39754, 49470, 35287, 45285 | **PARTIAL** | SOCAL alone: 3,079 matches. Already discovered. |
| 8 | **CO** | Colorado Advanced League (CAL) | 9 tiers: P1/P2/P3, Elite, Platinum, Gold, Silver, Bronze, Secondary | **PlayMetrics** + GotSport | PM: CAL Fall 2025 (4,764) + GS (320) | **PARTIAL** | **5,084 CO matches.** PlayMetrics adapter built. CAL Fall 2025 scraped (108 divisions). Need Spring 2026 when available. |
| 9 | **CT** | CT Championship League + ACSL | Premier I/II, First Division | GotSport | 44333, 39670, 44480, 40341, 40662 | **PARTIAL** | 5 leagues, 162 matches. Already discovered. |
| 10 | **DE** | EDP League + ESPL + CLS | EDP tiers | GotSport | 45707 (ESPL), 43731 (CLS) + EDP 44329 (multi-state) | **PARTIAL** | 2 DE-specific leagues (66 matches) + EDP coverage via MD event 44329. |
| 11 | **FL** | FSPL + EDP FL + FCL NPL | Multi-tier + 3 regional | GotSport | 80693, 76361, 79779 | **PARTIAL** | Discover FSPL main event IDs |
| 12 | **GA** | GPL + Classic/Athena | GPL; Classic 1-5, Athena A-D | SportsAffinity + GotSport | Multiple SA events (Boys) | **PARTIAL** | Boys scraped (Fall 2024/2025 + Spring 2025). Girls NOT on SA (Athena ended 2021). Girls data comes via GotSport tournaments (1,276 teams, 1,451 matches). |
| 13 | **HI** | Oahu League | A/B/C flights | **Custom AngularJS** | N/A | GS RANKS → **SESSION 105** | **BUILD HI ADAPTER** — Puppeteer-based, AngularJS SPA. Expected: +150-300 matches. |
| 14 | **ID** | Idaho Premier League (IPL) | Gold, Silver | GotSport | **45021** | **PARTIAL** | 45021 scraped: 20 matches. +364 from prior events. Total: 384 ID matches. |
| 15 | **IL** | IL State Premiership + NISL + SLYSA IL + MWC | Premiership I + NPL + Club/Conference + tiers | GotSport | 45492, 40174, 44640, 39659, 45100, 40255, 34346 + **NEW: 44630, 40124, 44632, 41112** | **PARTIAL** | **S103 finding:** IL uses GotSport, NOT Demosphere. 7 leagues, 12,123 matches. **S103 gap:** NISL (17K players, 1,300 teams) not yet scraped — 4 event IDs discovered (NPL Fall/Spring + Club/Conference Fall/Spring). **SESSION 104 Phase 1.** |
| 16 | **IN** | IYSA D3L | Premier, 1st, 2nd White | GotSport | 45057, 40237 | **PARTIAL** | 2 leagues, 87 matches. Need more ISL event discovery. |
| 17 | **IA** | Iowa Soccer League (ISL) + IDL + EIYSL | Age group-based | SportsAffinity + GotSport + HTGSports | SA: ISL Fall/Spring (580), GS: 47441 (32), HTG: 13486, 13113 (0, between seasons) | **PARTIAL** | 3 platforms. 612 matches total. SA GUIDs: Fall `7762C9F4`, Spring `627614EC`. EIYSL retry next season. |
| 18 | **KS** | **Heartland Soccer** | **Division 1-14** | **Heartland CGI** | N/A | **PRODUCTION** | **DONE** |
| 19 | **KY** | Kentucky Premier League (KPL) | Premier, First | GotSport | **48452** | **PARTIAL** | 48452 scraped: 0 matches (between seasons). KY Select (42 matches) already exists. Retry Spring 2026. |
| 20 | **LA** | LA Competitive Soccer League (LCSL) | Age-group divisions | GotSport | **40246, 35322, 35539** | **PARTIAL** | All 3 events scraped: 130 LA matches total across 3 LCSL events. |
| 21 | **ME** | Maine State Premier League (MSPL) | Age-group based | GotSport | **957, 40404** | **PARTIAL** | 957: 0 (between seasons), 40404: 50 matches. +27 Pine Tree League. Total: 77 ME matches. |
| 22 | **MD** | EDP League + CPSL NPL + ICSL + USYS NL SAC | Multi-tier | GotSport | 44329 (EDP: 496), 43268 (CPSL: 17), 43667 (ICSL: 365), 44340 (USYS 15-19U: 50), 50581 (USYS 13-14U: 20) | **PARTIAL** | 5 leagues, 948 matches. EDP 44329 also covers DE teams. |
| 23 | **MA** | GBYSL Select | NPL + lower | GotSport | 45209, 41506 | **PARTIAL** | 2 leagues, 48 matches. Need NEP event discovery for more. |
| 24 | **MI** | MSPSP + MYSL | GL Premier, Premier 1/2, Classic 1/2 | GotSport | 45649, 46034, 50611 | **PARTIAL** | Scrape Spring events |
| 25 | **MN** | MYSA State Competitive | Premier, Classic 1/2/3, Maroon, Gold (6 tiers) | SportsAffinity + GotSport | 6 GS leagues + 3 SA events | **PARTIAL** | **940 current-season matches** (190 GS + 531 SA Fall+Spring). SA adapter: 3 events (Fall Competitive, Metro Alliance, Summer 2025). |
| 26 | **MS** | No statewide league (State Cup only) | N/A | GotSport (cup: 48449) | 48449 (cup only) | **NO LEAGUE** | Capture via USYS Mid South Conference |
| 27 | **MO** | **SLYSA + Heartland (KC)** | Bracket-based | GotSport + Heartland | TBD (SLYSA) | **PARTIAL** | Discover SLYSA event IDs |
| 28 | **MT** | Montana State Spring League (MSSL) | Premier, Select, Classic | GotSport | **40682** | **PARTIAL** | 40682: 0 (between seasons). Prior events: 45 MT matches. Retry Spring 2026. |
| 29 | **NE** | NE Youth Soccer League | Divisions 1-4 | SportsAffinity + GotSport | 4 SA events (Fall+Spring) | **PARTIAL** | **2,143 current-season matches** (476 GS + 1,667 SA). SA events: Premier Conf, Dev Conf, CYSL, Cornhusker. |
| 30 | **NV** | NV South Youth Soccer League (NVSYSL) | Age-group based | GotSport | **40180** | **PARTIAL** | 40180 scraped: 316 staged (some team resolution issues). Total: 294 NV matches across 6 events. |
| 31 | **NH** | NH Soccer League (NHSL) | Age-group based | GotSport | **46884** | **PARTIAL** | 46884 scraped: 404 matches. Total: 428 NH matches. Largest Wave 2a result. |
| 32 | **NJ** | CJSL + NISL/NPL + SJSL + Inter-County + Mid NJ | Premier, Championship | GotSport | 45173, 40984, 44630, 41112, 40124, 44632, 43667, 39205, 45867, 41029, 45343, 40724, 44872, 40588 + more | **PARTIAL** | 21 leagues, 1,481 matches. Comprehensive NJ coverage. |
| 33 | **NM** | Duke City Soccer League (DCSL) | U9-U14 B+G | **Custom (PDF/WordPress)** | N/A | GS RANKS | PDF parsing adapter (Wave 7, lowest priority) |
| 34 | **NY** | LIJSL + Hudson Valley + WYSL + CAYSA | Premier, Championship | GotSport | 45260, 39930, 45972, 42453, 45845, 40436, 46869, 41459, 47326, 38890 + more | **PARTIAL** | 13 leagues, 1,583 matches. LIJSL alone: 1,090 matches. |
| 35 | **NC** | **NCYSA Classic League** | **Premier, 1st, 2nd, 3rd (15 divs)** | **SINC Sports** | N/A | **PRODUCTION** | **DONE** (8,692 matches, 805 standings) |
| 36 | **ND** | No state-specific league | N/A | N/A | N/A | GS RANKS | No ND-specific premier league exists. Teams play in USYS Midwest Conference (captured via multi-state events). |
| 37 | **OH** | OSPL/COPL/OCL + OPC + GCFYSL + WDDOA + FCL NPL | Premier I/II + divisions | GotSport | 45535, 40173, 46714, 40799, 45013, 40074, 43857, 43909, 43910, 33887, 45220, 36071 + more | **PARTIAL** | 19 leagues, 1,106 matches. Comprehensive OH coverage. |
| 38 | **OK** | OK Premier League (OPL) + OPC | D1, D2 + Gold/Silver/Bronze | GotSport | **45220, 50796** | **PARTIAL** | 45220: 0 (between seasons), 50796: 38 matches. Total: 67 OK matches. |
| 39 | **OR** | OYSA Competitive League | Premier Gold/Silver, Div 1/2 | SportsAffinity + GotSport | 6 SA events (Fall+Spring) | **PARTIAL** | **10,046 current-season matches** (1,607 GS + 8,439 SA). SA events: Fall League, Dev League, Founders Cup, Valley Academy, Soccer 5, PYSA + Spring/Winter leagues. |
| 40 | **PA-E** | APL/Acela + EPPL + PSSLU + MaxinMotion | Premier, Championship | GotSport | 43531, 40626, 46768, 41370, 44986, 34294, 40350, 48194, 41091, 44034, 39130 | **PARTIAL** | 14 leagues (PA combined), 907 matches. |
| 41 | **PA-W** | PA West State Leagues | Divisions verified | SportsAffinity + GotSport | 10 SA events (Fall) | PARTIAL → **SESSION 107** | **10,857 PA matches safe.** GLC/NAL/E64 restricted access — **MUST SOLVE (Session 107)** per Principle 42. Try 5+ more approaches. NOT acceptable to defer. GUIDs in session_checkpoint.md. Expected: +500-1,000 top-tier matches. |
| 42 | **RI** | Super Liga | 3 divisions per age/gender | **Custom PHP** (thesuperliga.com) | N/A | GS RANKS → **SESSION 105** | **BUILD RI ADAPTER** — Cheerio-based, PHP endpoints public. Expected: +200-400 matches. |
| 43 | **SC** | SCCL (SC Challenge League) | Challenge, Classic | GotSport | 45507, 40890 | **PARTIAL** | 2 leagues, 409 matches. Already discovered. |
| 44 | **SD** | No statewide league | N/A | N/A | N/A | **NO LEAGUE** | Capture via USYS regional data |
| 45 | **TN** | **TN State League (TSL)** | **Div 1, 2a, 2b, 3** | **SINC Sports** | N/A | GS RANKS | SINC adapter exists. March 2026 season start. |
| 46 | **TX-N** | NTSSA competitive + EDPL + CCSAI | Multiple tiers | GotSport | 79367, 77871 | **PARTIAL** | Discover more TX-N event IDs |
| 47 | **TX-S** | State Classic League + GCL | SCL Div I (East/West) | GotSport | 78565, 75263 | **PARTIAL** | Discover more TX-S event IDs |
| 48 | **UT** | UYSA Premier League | Premier + tiers (320+ teams) | SportsAffinity + GotSport | 6 SA events (Fall+Spring) | **PARTIAL** | **5,759 current-season matches** (1,408 GS + 4,351 SA). SA events: Premier PL/SCL/IRL/XL (3,523!), SUIRL, UVCL, YDL, Platform, Challenger. |
| 49 | **VT** | Vermont Soccer League (VSL) | D1, D2, D3 | GotSport | **39252** | **PARTIAL** | 39252 scraped: 148 matches. Total: 145 VT matches across 2 events. |
| 50 | **VA** | NCSL + VCSL + VPSL + TASL | Promo/relegation; Premier/Classic; NPL; Tidewater | **Demosphere** + GotSport | 80738 (NCSL) + 4 GS leagues + **NEW: 44587, 42891, 41359** | **PARTIAL** | **Demosphere adapter BUILT (S103).** NCSL 10,882 matches. VA total: 11,000 league matches. **S103 gap:** VCSL (20+ clubs), VPSL NPL, TASL (270+ teams) not yet scraped — 3 GotSport IDs discovered. **SESSION 104 Phase 1.** |
| 51 | **WA** | WPL + WSSL + EWSL | NPL + competitive tiers | GotSport | 44846, 44844, 45512, 44848, 40035, 39584, 40039, 38594, 39585, 48496, 40931, 46254 | **PARTIAL** | 12 leagues, 633 matches. Comprehensive WA coverage. |
| 52 | **WV** | WV State League | TBD | GotSport | Event ID behind registration hash | GS RANKS | Small market (~30-50 teams). Season starts March 2026. Retry then. |
| 53 | **WI** | WYSA State League + MAYSA + East Central + CWSL | Premier, First Division + regional competitive | **PlayMetrics** + GotSport | PM: WYSA (org 1014) + **NEW: MAYSA (1027), East Central (1028), CWSL (1033)** + 2 GS leagues | **PARTIAL** | **PlayMetrics expansion (S103).** WI league matches: 4,516. **S103 gap:** MAYSA (Madison), East Central Classic, CWSL, State Cups/Presidents Cup not yet scraped — 9 PlayMetrics IDs discovered across 4 org IDs. **SESSION 104 Phase 1.** |
| 54 | **WY** | No statewide league | N/A | GotSport (registration only) | N/A | **NO LEAGUE** | Capture via Snake River League if applicable |
| 55 | **DC** | NCSL (shared VA/MD) | Promo/relegation | **Demosphere** | 80738 (shared with VA) | **PARTIAL** | **Demosphere adapter BUILT (S103).** DC teams captured via NCSL. Shared VA/MD data. |

**SDL (Sporting Development League):**
- Platform: **PlayMetrics** (public URLs confirmed)
- URL: `playmetricssports.com/g/leagues/1133-1550-26d1bb55/` (U11/U12 Boys), `/1133-1563-d15ba886/` (Girls)
- 13 clubs, 6 Midwest states, U11-U12 only
- Action: Build PlayMetrics adapter (Wave 4)

---

## Platform Summary (10 Platforms Powering US Youth Soccer)

| # | Platform | States | Adapter Status | Public Data |
|---|----------|--------|---------------|-------------|
| 1 | **GotSport** | 35 states | **BUILT** | Excellent |
| 2 | **SportsAffinity** | GA, MN, UT, OR, NE, PA-W | **BUILT** | Good |
| 3 | **SINC Sports** | NC, TN | **BUILT** | Good |
| 4 | **Heartland CGI** | KS, MO-KC | **BUILT** | Good |
| 5 | **Modular11 (MLS Next)** | National | **BUILT** | Good |
| 6 | **TotalGlobalSports (ECNL)** | National (76 events) | **BUILT** | Good (Puppeteer+stealth) |
| 7 | **HTGSports** | National (tournaments) | **BUILT** | Good |
| 8 | **PlayMetrics** | CO, SDL, WI + growing | **BUILT** | Good (public `/g/` URLs) |
| 9 | **Demosphere** | VA/DC (NCSL) | **BUILT** | Good (JSON/XML endpoints) |
| 10 | **Squadi** | AR (+ NJ admin) | **NOT BUILT** | Good (public URLs) |
| 11 | **Custom PHP** | RI | **NOT BUILT** | Good (PHP endpoints) |
| 12 | **Custom AngularJS** | HI | **NOT BUILT** | Good (dynamic pages) |

---

## Expansion Wave Plan

### Wave 1: Foundation Adapters (COMPLETE)
- [x] KS/MO — Heartland CGI (PRODUCTION, 14 divisions)
- [x] NC — NCYSA Classic League via SINC Sports (PRODUCTION, 8,692 matches)
- [x] MLS Next — Modular11 adapter (PRODUCTION, 9,795 matches)
- [x] GA — SportsAffinity adapter (PRODUCTION, Boys 2,409 matches)
- [x] GotSport Rankings — National ranking badges (PRODUCTION, 64% match rate)

### Wave 2: GotSport Event Discovery (35 states — HIGHEST ROI)

**Sub-wave 2a: Confirmed Event IDs — COMPLETE (Session 98b-2):**
- [x] AK — UAYSL (5082) — 0 matches (between seasons)
- [x] ID — Idaho Premier (45021) — 20 matches scraped
- [x] KY — Kentucky Premier (48452) — 0 matches (between seasons), KY Select has 42
- [x] LA — LCSL (40246, 35322, 35539) — 170 staged, 130 total LA matches
- [x] ME — Maine State Premier (957, 40404) — 50 matches from 40404
- [x] MT — Montana State Spring (40682) — 0 matches (between seasons), 45 from prior events
- [x] NH — NH Soccer League (46884) — 404 matches staged, 428 total
- [x] NV — NV South YSL (40180) — 316 staged, 294 total (some team resolution issues)
- [x] OK — OPL (45220) + OPC (50796) — 76 staged from OPC, 45220 between seasons
- [x] VT — Vermont Soccer League (39252) — 148 matches, 145 total

**Sub-wave 2b: Large markets — ALREADY DISCOVERED (Session 98b-2 audit):**
Most Wave 2b states already had league data from prior GotSport discovery scrapes. Database audit found 120 leagues across these states.
- [x] CA-S — SOCAL (43086: 3,079 matches) + CCSAI + SCL — **7,416 total CA matches**
- [x] CA-NC — NorCal Premier (33458, 40753, 44142: 3,500+ matches)
- [x] CA-N — BPYSL + CASA + Inter-Regional
- [x] OH — OSPL/COPL/OCL + OPC + GCFYSL + WDDOA + FCL — **1,106 matches, 19 leagues**
- [x] NY — LIJSL + Hudson Valley + WYSL + CAYSA — **1,583 matches, 13 leagues**
- [x] NJ — CJSL + NISL/NPL + SJSL + Inter-County + Mid NJ — **1,481 matches, 21 leagues**
- [x] PA-E — APL/Acela + EPPL + PSSLU + MaxinMotion — **907 matches, 14 leagues**
- [x] IL — Premiership + SLYSA IL + MWC — **211 matches, 7 leagues**
- [x] IN — IYSA D3L — **87 matches, 2 leagues** (need more)
- [ ] MD — EDP + MDSL — No MD-state leagues yet (teams play in multi-state events)
- [x] MA — GBYSL Select — **48 matches, 2 leagues** (need NEP)
- [x] AZ — ASA Advanced Leagues — **418 matches, 6 leagues**
- [x] WA — WPL + WSSL + EWSL — **633 matches, 12 leagues**
- [x] SC — SCCL — **409 matches, 2 leagues**
- [x] CT — Championship League + ACSL — **162 matches, 5 leagues**

**Sub-wave 2c: National programs — PARTIALLY COMPLETE (Session 98b-3):**
Already had 26 NPL leagues (1,104 matches) + USYS NL events in DB from prior scrapes.
- [x] Girls Academy — 42137 (0, between seasons), 42138 (116 staged), 44874 (12), 45530 (8)
- [x] USYS National League — Sunshine P1 (43114: 24), Sunshine P2 (43943: 6), GL+MW (between seasons)
- [x] NPL — 26 NPL leagues already in DB with 1,104 matches (WA, CA, OH, FL, NJ, MN, VA, Central States, SAPL, Red River, JPL MW)
- [ ] USYS NL remaining conferences — scrape when season starts (most between seasons Feb 2026)

**Sub-wave 2d: Small/remaining markets + MD/DE/IA (Session 101):**
- [x] MD — EDP League (44329: 496), CPSL NPL (43268: 17), ICSL (43667: 365), USYS NL SAC 15-19U (44340: 50), USYS NL SAC 13-14U (50581: 20) — **948 matches, 5 leagues**
- [x] DE — Eastern Shore PL (45707: 10), Central League Soccer (43731: 56) — **66 matches, 2 leagues**
- [x] IA — SportsAffinity ISL Fall (349) + Spring (231), GotSport IDL (47441: 32), HTGSports EIYSL (0, between seasons) — **612 matches, 3 platforms**
- [x] ND — **RESOLVED:** No state-specific premier league. Teams play USYS Midwest Conference.
- [ ] WV — Season starts March 2026. Event ID behind registration hash. Deferred.
- [ ] WY — Snake River League (if applicable)

**Completion:** All 35+ GotSport states have event IDs and at least one season scraped. MD/DE/IA upgraded from GS RANKS to PARTIAL.

### Wave 3: SportsAffinity Expansion (Session 99 — MOSTLY COMPLETE)
- [x] GA Girls — **RESOLVED (Session 100):** GA Girls is NOT on SportsAffinity. Athena league ended on SA in 2021. GA Girls data (1,276 teams, 1,451 matches) already exists via GotSport tournaments. No action needed.
- [x] MN — MYSA State Competitive: **940 matches** (3 SA events: Fall Competitive, Metro Alliance, Summer 2025)
- [x] UT — UYSA Premier League: **5,759 matches** (6 SA events: Premier PL/SCL/IRL/XL, SUIRL, UVCL, YDL, Platform, Challenger)
- [x] OR — OYSA Competitive: **10,046 matches** (6 SA events: Fall League, Dev League, Founders Cup, Valley, Soccer 5, PYSA + Spring/Winter)
- [x] NE — NE Youth Soccer: **2,143 matches** (4 SA events: Premier Conf, Dev Conf, CYSL, Cornhusker)
- [x] PA-W — PA West State Leagues: **10,857 PA matches** (10 SA events: Classic, Frontier, Div 4, Districts 1-5,7). GLC/NAL/E64 pending (HTML parser issue).

**Status: COMPLETE.** All 6 SA states scraped (Fall 2025 + Spring current). GA Girls resolved (not on SA, comes via GotSport). PA-W GLC top-tier event has restricted access (deferred March 2026 — see Risks section).

### Wave 4: PlayMetrics Adapter (CO + SDL) — COMPLETE (Session 102)
- [x] Build PlayMetrics adapter (Puppeteer, DOM-aware scraping)
- [x] CO — Colorado Advanced League Fall 2025 (4,764 matches, 108 divisions, 9 tiers)
- [x] SDL — Sporting Development League (Boys: 320, Girls: 29)
- [x] Added to daily-data-sync.yml pipeline (8th sync job)

**Completion:** PlayMetrics adapter built and PRODUCTION. CO upgraded. SDL scraped. +5,113 matches.

### Wave 5: Demosphere Adapter (VA/DC) + WI PlayMetrics — COMPLETE (Session 103)
- [x] Build Demosphere adapter v2.0 (Cheerio, JSON/XML endpoints)
- [x] VA/DC — NCSL: 608 divisions, 10,842 unique matches staged, 10,882 inserted
- [x] IL — Confirmed on GotSport (not Demosphere), 7 leagues, 12,123 matches already in DB
- [x] WI — Migrated to PlayMetrics (org 1014), WYSA Fall 2,164 + Spring 2,230 matches
- [x] 4 events reclassified as leagues, sync-demosphere added to pipeline

**Completion:** Demosphere adapter built and PRODUCTION. VA+DC upgraded. WI upgraded via PlayMetrics. IL already covered. +15,268 matches.

### Wave 6: Squadi Adapter (AR)
- [ ] Build Squadi adapter (React SPA, Puppeteer)
- [ ] AR — Arkansas Competitive Soccer League

**Completion:** Squadi adapter built. AR at PRODUCTION.

### Wave 7: Custom Platforms (RI, HI, NM)
- [ ] RI — Super Liga (Cheerio, PHP endpoints)
- [ ] HI — Oahu League (Puppeteer, AngularJS)
- [ ] NM — Duke City Soccer League (PDF parsing)

**Completion:** All custom adapters built. RI, HI, NM at PRODUCTION.

### Wave 8: ECNL Full Scrape + TN
- [x] **ECNL COMPLETE (Session 100):** ALL 76 ECNL/ECRL/Pre-ECNL events scraped (IDs 3880-3960). 33,567 matches. 79 tournaments reclassified as leagues. TGS adapter expanded 13→76 staticEvents.
- [ ] TN — TN State League via SINC Sports (March 2026 season start)

**Status:** ECNL DONE. TN waiting on season start (SINC adapter already built and proven with NC).

### Wave 9: Ongoing Maintenance
- [ ] Daily pipeline via GitHub Actions
- [ ] Season event ID refresh (August + January)
- [ ] Platform migration monitoring
- [ ] All 55 entries verified at PRODUCTION

---

## Known Risks & Gaps (Updated Session 103)

> **CRITICAL:** All risks categorized by severity. 🔴 CRITICAL items MUST be resolved — no exceptions.

| # | Risk/Gap | Severity | Status | Impact | Action Plan |
|---|----------|----------|--------|--------|-------------|
| 1 | **3 adapters not built** | 🔴 **CRITICAL** | ACTIVE | Blocks 3 states from PRODUCTION (AR, RI, HI) | **Sessions 104-105:** Build 3 adapters (Squadi, RI, HI) |
| 2 | **PA-W GLC restricted access** | 🔴 **CRITICAL** | **MUST SOLVE** | Top-tier PA-W event inaccessible. **NOT ACCEPTABLE TO DEFER.** Principle 42 applies. | **Session 107:** Try 5+ more approaches: API endpoints, Wayback, mobile endpoints, widget embeds, club schedules |
| 3 | **Girls Academy incomplete** | 🟡 HIGH | ACTIVE | Only 136 matches, should have 600-800 from Fall 2025. **NOT "between seasons"** — data exists. | **Session 106:** Scrape ALL Fall 2025 data (events 42137, 42138, 44874, 45530) + verify Spring schedule capture works |
| 4 | **USYS NL 13 conferences missing** | 🟡 HIGH | ACTIVE | Only 30 matches, missing 10+ conference event IDs. **NOT "between seasons"** — discover NOW. | **Session 106:** Discover all 13 conference IDs, scrape all available Fall 2025 data, verify Spring schedule capture |
| 5 | **NPL 2 leagues missing** | 🟡 MEDIUM | ACTIVE | 16/18 on GotSport, 2 remaining undiscovered | **Session 106:** Discover final 2 regional NPL leagues |
| 6 | **PRODUCTION gap (4 vs 55)** | 🟡 MEDIUM | ACTIVE | Only 4/55 states (7.3%) at full PRODUCTION. 41 states lack standings/schedule data. | **Sessions 108-109:** Build standings scrapers for 6 major platforms |
| 7 | **Match count gap (480K vs 1M)** | 🟡 MEDIUM | ACTIVE | Still 520K matches short of 1M target | **All sessions:** Event discovery + Spring 2026 data + standings |
| 8 | **Double-prefix failures** | 🟢 LOW | ACTIVE | 74 matches failed team resolution in Wave 2d (e.g., "Delmarva Rush Delmarva Rush Rush 2017B") | **Session 110a:** Fix cleanTeamName.cjs edge cases |
| 9 | **View refresh performance** | 🟢 LOW | ACTIVE | app_league_standings takes 50+ sec to refresh | **Session 110b:** Add indexes, optimize SQL |
| 10 | **Source_entity_map coverage** | 🟢 LOW | ACTIVE | ~72K entries, could backfill +10K-20K from existing data | **Session 110c:** Backfill from historical matches |
| 11 | **TN between seasons** | 🟢 LOW | WAITING | SINC adapter ready, season starts March 2026 | **March 2026:** Scrape TN State League |
| 12 | **318 Pre-ECNL null dates** | 🟢 LOW | ACCEPTED | 81.5% success rate, failures from incomplete TGS events | No action (not recoverable) |

### Resolved Risks (Archive)

| # | Risk/Gap | Resolution | Session |
|---|----------|----------|---------|
| R1 | GA Girls not on SportsAffinity | Athena league ended on SA in 2021. GA Girls data (1,276 teams, 1,451 matches) already in DB via GotSport tournaments. | S100 |
| R2 | ECNL future-proofing | Added LEAGUE_KEYWORDS + 74 TGS source_entity_map backfill → auto-classify new seasons | S101 |
| R3 | MD/DE/IA event IDs missing | All 3 states upgraded from GS RANKS → PARTIAL (17 events discovered) | S101 |
| R4 | Wave 2d small markets | ND resolved (no state league), MD/DE/IA scraped, WV deferred to March 2026 | S101 |

---

## Session 104-110 Roadmap (Critical Path to National Coverage)

> **PURPOSE:** 7-session sprint to complete adapter buildout, national programs, and standings scrapers.
>
> **NOTE:** Session 103 detailed action items are in the "Active Work Queue" section at the top of this file.

### ✅ Session 103: Demosphere Adapter — COMPLETE
**Focus:** Built Demosphere adapter → VA/DC + WI upgraded. IL confirmed on GotSport.

**Delivered:**
- ✅ Demosphere.js adapter v2.0 built (Cheerio, JSON/XML endpoints)
- ✅ NCSL (VA/DC) scraped: 608 divisions, 10,842 unique matches, 10,882 inserted
- ✅ WI WYSA via PlayMetrics: 4,394 matches (Fall 2,164 + Spring 2,230)
- ✅ IL confirmed already covered: 7 leagues, 12,123 matches via GotSport
- ✅ **+15,268 matches, +5,042 teams, +4 leagues, 9th adapter, 9th pipeline job**

---

### Session 104: IL/VA/WI Gap Fill + Squadi Adapter
**Focus:** (1) Scrape discovered IL/VA/WI premier leagues using existing adapters, (2) Build Squadi adapter → AR to PRODUCTION

**Deliverables:**
- IL: +2,000-5,000 matches from NISL (17K players) + SLYSA IL Central (5 GotSport events)
- VA: +1,000-3,000 matches from VCSL + VPSL NPL + TASL (3 GotSport events)
- WI: +500-1,500 matches from MAYSA + East Central + CWSL + State Cups (9 PlayMetrics events)
- AR: Squadi.js adapter built, ACSL scraped, +500-1,000 matches, 10th adapter
- Total: **+4,000-10,500 matches**, 10th adapter, 3 states significantly boosted

---

### Session 105: RI + HI Adapters
**Focus:** Build final 2 custom adapters → RI + HI to PRODUCTION

**Deliverables:**
- RI Super Liga adapter (Cheerio, PHP endpoints)
- HI Oahu League adapter (Puppeteer, AngularJS)
- 2 states upgraded to PRODUCTION
- +350-700 matches, 11th-12th adapters

**Milestone:** ALL 12 ADAPTERS BUILT ✅

---

### Session 106: National Programs — Complete Coverage
**Focus:** Girls Academy + USYS NL + NPL — get ALL available data

**CRITICAL:** "Between seasons" is NOT an excuse. Get all Fall 2025 data + ensure Spring schedules work.

**Deliverables:**
- Girls Academy: 136 → 600-800 matches (ALL Fall 2025 data)
- USYS NL: Discover all 13 conference IDs, scrape all available data
- NPL: Discover 2 remaining regional leagues
- +1,500-3,000 matches

**Milestone:** ALL NATIONAL PROGRAMS COMPLETE ✅

---

### Session 107: PA-W GLC — MUST SOLVE
**Focus:** Restricted access problem — try 5+ MORE approaches (Principle 42)

**NOT ACCEPTABLE TO DEFER.** This is a MUST SOLVE per Principle 42.

**Approaches to try:**
1. SportsAffinity API endpoints (inspect network on working states)
2. Wayback Machine archives
3. Alternative data sources (club schedules)
4. Direct widget embed URLs
5. Mobile app endpoints
6. Contact league admin (last resort)

**Deliverables:**
- PA-W GLC/NAL/E64 data access solved
- +500-1,000 top-tier PA-W matches

---

### Session 108: Standings Scrapers Part 1
**Focus:** Add standings to GotSport + SportsAffinity adapters

**Deliverables:**
- GotSport standings scraper (35 states affected)
- SportsAffinity standings scraper (7 states affected)
- +8,000-15,000 standings entries
- 10+ states upgraded to PRODUCTION

---

### Session 109: Standings Scrapers Part 2
**Focus:** Add standings to PlayMetrics + HTGSports + MLS Next + TGS adapters

**Deliverables:**
- PlayMetrics, HTGSports, MLS Next, TGS standings scrapers
- +4,500-7,000 standings entries
- 5+ states upgraded to PRODUCTION

**Milestone:** ALL ADAPTERS HAVE STANDINGS ✅

---

### Session 110: Polish & Optimization
**Focus:** Clear all technical debt

**Deliverables:**
- Fix double-prefix failures (74 matches)
- Optimize view refresh performance (<10 sec)
- Backfill source_entity_map (+10K-20K entries)
- Daily pipeline monitoring established

**Milestone:** SYSTEM HEALTH 95%+ ✅

---

### After Session 110
- 12 adapters built ✅
- 15+ states at PRODUCTION
- 600K+ matches
- All national programs complete
- All high-priority technical debt cleared
- Clear path to 55/55 states at PRODUCTION by Session 120

---

### Deferred to March 2026

| Task | Platform | State | Reason | Retry Date |
|------|----------|-------|--------|------------|
| TN State League | SINC Sports | TN | Season starts March 2026 | March 1, 2026 |
| WV State League | GotSport | WV | Season starts March 2026, event ID behind registration | March 1, 2026 |
| IA Spring 2026 | SportsAffinity | IA | Schedule releases March 13 | March 13, 2026 |

---

## Accountability Framework

### Session Start Protocol (MANDATORY)
Every session MUST start by reading this file and reporting:
1. States at PRODUCTION: X of 55
2. States at PARTIAL: Y of 55
3. Total matches in system
4. What was accomplished last session (from Progress Log)
5. What's next per Wave priority

### Session End Protocol (MANDATORY)
Every session MUST end by:
1. Updating this file (status changes, checkboxes, progress log)
2. Committing changes
3. Reporting delta: "+X matches, +Y teams, Z states moved up"

### Wave Discipline
Follow Wave order (2→3→4→5→6→7→8→9) unless user explicitly redirects. No jumping ahead.

### "Am I Drifting?" Check
Before ANY task: "Is this the highest-ROI activity per Wave priority?" If no → redirect.

---

## Verification Checklist (Per State Onboarding)

When bringing a new state to PRODUCTION, verify ALL THREE data flows:

```markdown
## State: _______ | League: _______ | Date: _______

### Flow 1: Match Results → SV Power Rating
- [ ] Adapter scrapes match results correctly
- [ ] Matches flow through staging → DQE/fastProcess → matches_v2
- [ ] Teams resolve correctly (source_entity_map populated)
- [ ] ELO calculation includes new matches
- [ ] Teams appear in state rankings with correct state

### Flow 2: League Standings → AS-IS Display
- [ ] Adapter scrapes standings correctly
- [ ] Standings flow through staging_standings → processStandings → league_standings
- [ ] Divisions display correctly in app
- [ ] W-L-D and points match official league data (NOT recalculated)
- [ ] All teams in each division visible (no NULL metadata filtering)

### Flow 3: Scheduled Games → Upcoming Section
- [ ] Adapter returns future matches with NULL scores
- [ ] Matches have league_id linkage (required for app_upcoming_schedule)
- [ ] Upcoming games appear on team detail pages
- [ ] NULL scores preserved through pipeline (not converted to 0-0)

### Regression
- [ ] Zero impact on existing state data
- [ ] Total teams_v2 count only INCREASES
- [ ] Total matches_v2 active count only INCREASES
- [ ] GotSport rankings unaffected
```

---

## Notes

- **NO LEAGUE states (MS, SD, WY):** No statewide premier league structure. Teams compete in multi-state USYS conferences. Captured through conference events on GotSport.
- **EDP states (NJ, PA-E, NY, MD, DE, CT):** Use GotSport under the hood via EDP Soccer.
- **California:** Split into 3 sub-regions (Cal North, NorCal Premier, Cal South) — independent league admin.
- **Pennsylvania:** Split into 2 (Eastern PA via EDP/GotSport, PA West via SportsAffinity).
- **Sports Connect:** Being sunset 2027, migrating to PlayMetrics. States tracked under PlayMetrics going forward.
- **Squadi:** Australian platform recently entering US market (AR, NJ).

---

*This document is the single source of truth for national expansion tracking.*
*Update every session. Follow the Wave plan. No drifting.*
*See [3-DATA_EXPANSION_ROADMAP.md](3-DATA_EXPANSION_ROADMAP.md) for strategic framework.*
*See [3-DATA_SCRAPING_PLAYBOOK.md](3-DATA_SCRAPING_PLAYBOOK.md) for adapter development procedures.*
