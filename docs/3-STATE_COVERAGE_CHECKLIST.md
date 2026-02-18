# SoccerView State Coverage Checklist

> **Version 6.2** | Updated: February 18, 2026 | Session 111 Complete
>
> **THE MASTER TRACKER** for national expansion. Every US state, every premier league, every platform, every action needed.
> **Updated every session.** This is the single source of truth for coverage status.
>
> **GUARANTEED END STATE:** All 55 entries at PRODUCTION — all 5 data elements flowing per SV Data Architecture.
>
> **THE 5 DATA ELEMENTS (per DATA_EXPANSION_ROADMAP.md):**
> 1. **Matches** — Flow 1: match results in matches_v2
> 2. **SV Power Rating / ELO** — Computed from matches by recalculate_elo_v2.js
> 3. **GotSport Rankings** — Tier 3 overlay (covers all 50 states via restoreGotSportRanks.cjs)
> 4. **League Standings** — Flow 2: AS-IS scraped from source (NOT computed) via scrapeStandings.js
> 5. **Schedules** — Flow 3: NULL-score future matches with league linkage via same pipeline
>
> **PRODUCTION = All 5 elements flowing. No exceptions. No shortcuts.**
>
> **COMPLETION PLAN: Sessions 110-116 (7 sessions to 100%)**

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
| 104 | Feb 17 | **IL/VA/WI gap fill + Squadi AR adapter.** Scraped all 17 discovered gaps from Session 103 research: 5 IL GotSport (488), 3 VA GotSport (238), 9 WI PlayMetrics (7,095 incl MAYSA 175 divisions). Built 10th adapter (Squadi REST API, 68s scrape). AR: 6 events, 1,639 matches. Event classification fix in fastProcessStaging (check staging_events.event_type). | **+9,352 matches, +4,630 teams, +18 leagues, +1 adapter, +1 pipeline job** | RI + HI adapters |
| 105 | Feb 17 | **HI Oahu League via SportsAffinity** (NOT custom — same platform as GA/MN/UT/OR/NE/PA-W/IA). Added 4 events to SA adapter. Scraped 4 seasons (Fall+Spring 2024/25 + 2025/26). 3,589 matches, 497 new teams, 4 new HI leagues. **RI Super Liga:** Data PURGED between seasons — Fall 2025 permanently lost. Tried 5+ approaches per Principle 42 (Wayback found structure but not POST data). Built adapter skeleton for March 28 retry. Updated GUARDRAILS S19 with data retention warning. Full adapter audit: all 10 adapters have Fall 2025 ✅. | **+3,589 matches, +497 teams, +4 leagues** | Girls Academy + USYS NL + NPL |
| 106 | Feb 17 | **National Programs Complete.** GA (4 events reclassified tournament→league, 528 total GA matches). **USYS NL:** Discovered 21 new conference event IDs (Team Premier + Club P1/P2 + Winter). Scraped 1,151 USYS NL matches + 485 Winter showcase = 1,636 total. All NL team/club events reclassified as leagues. **TCSL NPL TX:** TGS event 3989 added, 947 matches staged (1,199 TGS total). **STXCL NPL:** AthleteOne platform — new adapter deferred. | **+2,163 matches, +2,011 teams, +26 leagues, +11 tournaments** | PA-W GLC (Session 107) |
| 107 | Feb 17 | **Team Key Normalization Fix.** Systemic bug: fastProcessStaging built team lookup keys from raw names but teamMap used cleaned names. 2-line fix wrapping removeDuplicatePrefix(). Recovered 11,061 stuck staging records. | **+9,094 matches, +106 teams** | Session 108 pipeline fix |
| 108 | Feb 17 | **Pipeline Freshness & Reliability (Systemic Fix).** PA-W GLC SOLVED (national GotSport programs). NAL reclassified tournament→league (84 matches). Fixed year filter bug (undefined >= 2025 = false). Smart discovery: leagues 30d, tournaments 14d. Removed custom discoverEvents from 4 adapters → unified path. DQE→fastProcessStaging in nightly (240x faster). Cascade protection on 6 downstream jobs. 3 new principles (45-47). | **+84 NAL matches, +128 teams, 3 systemic fixes** | Standings scrapers |
| 109 | Feb 17 | **GotSport Standings Scraper.** Built standings section for gotsport.js adapter. Scraped 40/40 GotSport leagues = 7,580 standings. Fixed points column bug (10-col vs 11-col layouts). SportsAffinity confirmed NOT NEEDED (no native standings page). Fast bulk processor: 10,753 rows in 15.1s. Added to daily pipeline. | **+9,715 standings (2,012→11,727), +3,979 teams, +4,003 SEM entries** | Standings Part 2 |
| 110 | Feb 17 | **Standings Mega-Sprint.** Built standings scrapers for 3 more adapters: Demosphere (NCSL: 1,106 standings via XML), Squadi (AR: 537 standings via REST API), PlayMetrics (staged for CI). TGS deferred to S111 (needs stealth Puppeteer). HTGSports skipped (tournaments only). Pipeline updated: 3 adapters added, timeout 50→90m. | **+1,643 standings (11,727→13,370), standings adapters 3→6** | TGS standings + Spring blitz |
| 111 | Feb 18 | **TGS Standings + CO CAL Spring + Spring Blitz.** Added stealth Puppeteer to scrapeStandings.js. Built TGS standings section: 75/75 ECNL events scraped (4,362 standings). CO CAL Spring 2026: 4,564 matches via PlayMetrics. Spring blitz: most events already in pipeline (Principle 45 working). Fast bulk TGS processor: 4,362 rows in 340s. Event discovery: FL (6 new IDs), IN (49628), MO (44132 SLYSA), TX (44745 GCL, 45379 EDPL). AK deferred June 2026. | **+5,222 matches (520K→525K), +4,362 standings (13K→17.7K), +4,862 teams, +6,019 SEM, standings adapters 6→7** | Session 112 |

---

## Completed Work (Sessions 95-109) — ARCHIVE

> All completed session details moved here for reference. See Session Progress Log above for summary.

<details>
<summary>Click to expand completed session details (Sessions 103-111)</summary>

#### Session 103: Demosphere Adapter (VA/DC, IL, WI) — COMPLETE ✅
**Actual Results:** VA+DC+WI upgraded, **+15,268 matches, +5,042 teams, +4 leagues, 9th adapter, 9th pipeline job**

#### Session 104: IL/VA/WI Gap Fill + Squadi Adapter (AR) — COMPLETE ✅
**Actual Results: +9,352 matches, +4,630 teams, +18 leagues, 10th adapter, 10th pipeline job**

#### Session 105: HI Oahu League + RI Super Liga — COMPLETE ✅
**Actual Results: +3,589 matches, +497 teams, +4 leagues. HI upgraded. RI adapter skeleton built (March 28 retry).**

#### Session 106: National Programs — COMPLETE ✅
**Actual Results: +2,163 matches, +2,011 teams, +26 leagues. GA + USYS NL + NPL (17/18) complete.**

#### Session 107: Team Key Normalization Fix — COMPLETE ✅
**Actual Results: +9,094 matches recovered from stuck staging.**

#### Session 108: Pipeline Freshness & Reliability — COMPLETE ✅
**Actual Results: PA-W GLC solved. NAL reclassified. 3 systemic pipeline fixes.**

#### Session 109: GotSport Standings Scraper — COMPLETE ✅
**Actual Results: +9,715 standings (2,012→11,727). 40/40 GotSport leagues. SA confirmed NOT NEEDED.**

#### Session 110: Standings Mega-Sprint — COMPLETE ✅
**Actual Results: +1,643 standings (11,727→13,370). Demosphere (1,106) + Squadi (537) + PlayMetrics (staged). Standings adapters 3→6.**

#### Session 111: TGS Standings + CO CAL Spring + Spring Blitz — COMPLETE ✅
**Actual Results: +5,222 matches, +4,362 standings (13,370→17,732). TGS/ECNL 75/75 events. CO CAL Spring 4,564 matches. Stealth Puppeteer in scrapeStandings.js. Standings adapters 6→7. Event discovery: FL/IN/MO/TX new IDs found.**

</details>

---

## Active Work Queue — 7-Session Completion Plan (Sessions 110-116)

> **DIRECTIVE:** Complete ALL remaining items. No deferrals. No "between seasons" excuses. No shortcuts. Every state at PRODUCTION with all 5 data elements. 100% completion.
>
> **Architecture:** All work uses the existing V2 system. Zero architecture changes. Zero new patterns.
> - Standings scrapers: Add `standings` config to existing adapter files via scrapeStandings.js engine
> - Event discovery: Find GotSport IDs, scrape through existing coreScraper.js pipeline
> - New adapters: Follow existing `_template.js` pattern

---

### ✅ Session 110: STANDINGS MEGA-SPRINT — COMPLETE

**Result:** Built standings scrapers for Demosphere (+1,106), Squadi (+537), PlayMetrics (staged for CI). HTGSports skipped (tournaments only). TGS deferred to S111. Standings: 11,727→13,370. Adapters: 3→6.

---

### ✅ Session 111: TGS STANDINGS + SPRING 2026 BLITZ + CO CAL — COMPLETE

**Results:**
- [x] Stealth Puppeteer in scrapeStandings.js (puppeteerStealth flag)
- [x] TGS standings section built: 75/75 ECNL events, 4,362 standings processed (340s bulk)
- [x] CO CAL Spring 2026: PlayMetrics league 1017-1829-bf8e0969, 4,564 matches
- [x] Spring blitz: Most events already captured by nightly pipeline (Principle 45)
- [x] Pipeline: TGS added to scrape-standings, timeout 90→120 min

**Event Discovery Results (from background agents):**

| State | Event IDs Found | Status |
|-------|----------------|--------|
| **FL** | 43009 (FSPL), 45008 (WFPL), 45046 (CFPL), 45052 (SEFPL) | **4 NEW IDs — ready to scrape** |
| **IN** | 49628 (ISL Spring 2026) | **1 NEW ID — ready to scrape** |
| **MO** | 44132 (SLYSA Fall 2025) | **1 NEW ID — ready to scrape** |
| **TX** | 44745 (GCL 2025-26), 45379 (EDPL Fall South TX) | **2 NEW IDs — ready to scrape** |
| **MA** | NEP not publicly on GotSport | BLOCKED — needs manual investigation |
| **AK** | No public event ID; retry June 2026 | DEFERRED |

**Spring 2026 Status:**
- CO — ✅ SCRAPED (4,564 matches via PlayMetrics)
- AL/MI/KY/MT/OK — Pipeline auto-discovers when active (Principle 45)
- AK — Deferred June 2026 (structurally limited market, premier teams in USYS NL)
- IA EIYSL — Between seasons, retry next season

**Metrics:** matches 520K→525K, teams 182K→187K, standings 13K→17.7K, leagues 463→464, SEM 82K→88K

---

### 🟠 Session 112: NO-LEAGUE STATES + NM + ND + ALL TECHNICAL DEBT

**Goal:** Solve the 3 NO LEAGUE states (MS, SD, WY) + 2 GS RANKS states (ND, NM). Clear ALL technical debt.

**NO LEAGUE States (find data or document with evidence):**
- [ ] MS — Research USYS Mid South Conference events. Find MS premier team activity. GotSport standings may cover MS teams from S109.
- [ ] SD — Research USYS regional events. Find any SD premier team activity. If none, document with evidence.
- [ ] WY — Research Snake River League, USYS regional. Find events or document.

**GS RANKS States (must get local data):**
- [ ] ND — Verify USYS Midwest Conference captures ND teams with matches. If teams exist with matches, ND has data.
- [ ] NM — Build Duke City Soccer League adapter (PDF/WordPress scraping). Per Principle 42 — find the data.

**Technical Debt (ALL items — clear in this session):**
- [ ] Fix 74 double-prefix match failures (cleanTeamName.cjs edge cases, "Delmarva Rush Delmarva Rush Rush 2017B")
- [ ] View refresh optimization (app_league_standings 50+ sec → target <10 sec, add indexes)
- [ ] SEM backfill (+10-20K source_entity_map entries from existing data)
- [ ] Pipeline monitoring/alerting (add failure alerts to GitHub Actions)
- [ ] Update DATA_EXPANSION_ROADMAP.md (source table + wave status outdated)
- [ ] Update DATA_SCRAPING_PLAYBOOK.md (adapter list + standings pipeline outdated)

**Expected:** MS/SD/WY/ND resolved. NM adapter built. All tech debt cleared.

---

### 🟢 Session 113: AthleteOne ADAPTER + FULL 50-STATE PRODUCTION AUDIT

**Goal:** Build 12th adapter (AthleteOne for STXCL NPL TX = 18th/18 NPL). Run comprehensive state-by-state audit — verify every state has all 5 data elements.

- [ ] **AthleteOne adapter:** Research STXCL NPL platform, build adapter, scrape data. Complete 18/18 NPL leagues.
- [ ] **50-State PRODUCTION Audit:** For each of 55 entries, verify via SQL:
  - Has matches in matches_v2? (count per state)
  - Has ELO ratings on teams? (check per state)
  - Has GotSport rankings? (check per state)
  - Has AS-IS standings in league_standings? (count per state)
  - Has future scheduled matches with league linkage? (count per state)
- [ ] **Fix ALL gaps found in audit** — any state missing any element, fix it
- [ ] **Update every state row** in this checklist with verified status

**Expected:** 12th adapter built. Comprehensive audit identifies + fixes remaining gaps. Most states at PRODUCTION.

---

### 🔵 Session 114: MARCH SEASONAL STATES (March 1-13, 2026)

> **Calendar-gated:** Cannot start before March 1, 2026.

- [ ] **TN State League** (March 1) — Scrape via SINC Sports adapter (proven with NC). Matches + standings + schedules. All 4 divisions (Div 1, 2a, 2b, 3).
- [ ] **WV State League** (March 1) — Find event ID (behind registration hash per Principle 42 — 5+ approaches), scrape via GotSport.
- [ ] **IA EIYSL** — Retry HTGSports events 13486, 13113.
- [ ] **IA Spring 2026** (March 13) — SportsAffinity ISL Spring.
- [ ] **Any remaining Spring 2026 events** across all states now available.
- [ ] Process all through pipeline. ELO recalculation (one run).

**Expected:** TN → PRODUCTION (matches + SINC standings + schedules). WV upgraded. IA complete. +2,000-5,000 matches.

---

### 🟣 Session 115: RI SUPER LIGA + FINAL GAPS (March 28, 2026)

> **Calendar-gated:** Cannot start before March 28, 2026. DATA-PURGING PLATFORM — must scrape same day.

- [ ] **RI Super Liga** (March 28) — Activate adapter skeleton (`risuperliga.js`). Scrape ALL matches + standings + schedules IMMEDIATELY. Data-purging platform — complete same day.
- [ ] **AK UAYSL** — If Spring 2026 is now active, scrape. If not, document permanent status with evidence.
- [ ] **Re-scrape any states** that were partial in Session 113 audit.
- [ ] **Final gap closure** — any remaining incomplete items from prior sessions.

**Expected:** RI upgraded. All gaps closed.

---

### ⬛ Session 116: FINAL VERIFICATION + 100% SIGN-OFF

**Goal:** Verify 100% completion. Full ELO recalculation. App QC testing. Pipeline health check. Close the checklist.

- [ ] **Full ELO recalculation** (one final run covering ALL matches)
- [ ] **All 5 materialized views refreshed**
- [ ] **App QC Testing** (per Post-Expansion QC Protocol, Principle 41):
  - Home page match count correct
  - Every state appears in Rankings state filter with teams visible
  - Team names display correctly (no double-prefix, no encoding issues)
  - League standings show for every state with leagues
  - Team detail shows matches, correct state, ELO populated
- [ ] **Pipeline dry-run:** Run full daily-data-sync.yml manually, verify all sync + standings + ELO jobs succeed
- [ ] **Final metrics report:** States at PRODUCTION, total matches, teams, leagues, standings, schedules
- [ ] **Update ALL documentation:** CLAUDE.md, STATE_COVERAGE_CHECKLIST.md (mark FINAL), DATA_EXPANSION_ROADMAP.md, DATA_SCRAPING_PLAYBOOK.md
- [ ] **STATE_COVERAGE_CHECKLIST.md:** Mark version FINAL — all 55 states verified

**Expected:** 100% completion. Checklist CLOSED.

---

## Completion Targets (Updated Session 111)

| Milestone | Current (S111) | Target (S113) | Target (S116) | Gap |
|-----------|----------------|---------------|---------------|-----|
| **States at PRODUCTION** | 4 | **35+** | **55** | 51 states |
| **States at PARTIAL+** | 48 | 55 | 55 | 7 states |
| **Active matches** | **525,682** | **575K+** | **650K+** | +125K |
| **Leagues in DB** | **464** | **500+** | **550+** | +86 |
| **League standings** | **17,732** | **20K+** | **25K+** | +7K+ |
| **National programs** | 5 PROD, NPL 17/18 | **7 PROD** (all) | **7 PROD** | +2 (RI, AthleteOne) |
| **Adapters built** | 10 + 1 skeleton | **12** | **13** (+ NM) | +3 |
| **Standings adapters** | **7** (GS/TGS/SINC/Heartland/Demosphere/Squadi/PlayMetrics) | **7** | **7** | Done ✅ |
| **Pipeline sync jobs** | 10 | **12** | **13** | +3 |
| **Tech debt items** | 4 open | **0** | **0** | Clear all |

### Session-by-Session Milestones

| Session | Date | Focus | Key Metric | Cumulative PRODUCTION |
|---------|------|-------|------------|----------------------|
| **110** | ✅ DONE | 3 standings scrapers (Demosphere/Squadi/PlayMetrics) | +1,643 standings, adapters 3→6 | 30+ states |
| **111** | ✅ DONE | TGS standings + CO CAL Spring + event discovery | +5,222 matches, +4,362 standings, adapters 6→7 | 35+ states |
| **112** | Immediate | NO LEAGUE + NM + tech debt | All debt cleared | 40+ states |
| **113** | Immediate | AthleteOne + 50-state audit | 12th adapter, full audit | 45+ states |
| **114** | March 1-13 | TN, WV, IA seasonal | +2K-5K matches | 48+ states |
| **115** | March 28 | RI + final gaps | RI PRODUCTION | 52+ states |
| **116** | After 115 | Final verification + sign-off | 100% verified | **55/55** |

---

## Coverage Summary (Post-Session 111)

| Status | Count | Description | Target (S116) |
|--------|-------|-------------|---------------|
| **PRODUCTION** | 4 | All 5 data elements flowing (matches + ELO + GS ranks + standings + schedules) | **55** |
| **PARTIAL** | 44 | Some data flows active, missing AS-IS standings and/or events | **0** |
| **GS RANKS** | 4 | GotSport ranking badges only — no local match/standings data (AK, NM, TN, WV + RI deferred) | **0** |
| **NO LEAGUE** | 3 | No statewide premier league (MS, SD, WY) — resolve via USYS regional | **0** (documented) |
| **Total** | 55 | All 50 states + DC (CA split 3, PA split 2) | **55/55** |

### National Programs (Updated Session 103)

| Program | Adapter | Status | Matches | Age Groups | Action Required |
|---------|---------|--------|---------|------------|-----------------|
| **MLS Next** | mlsnext.js (Modular11/Puppeteer) | **PRODUCTION** | 9,795 | U13-U19 Boys | Add standings scraper (S109) |
| **ECNL/ECRL/Pre-ECNL** | totalglobalsports.js (TGS/Puppeteer) | **PRODUCTION** | **33,567** (76 events) | U13-U19 Boys+Girls | Add standings scraper (S109) |
| **GotSport Rankings** | restoreGotSportRanks.cjs | **PRODUCTION** | N/A (ranks only) | All | Daily refresh working ✅ |
| **SDL** | playmetrics.js (PlayMetrics/Puppeteer) | PARTIAL → **PRODUCTION (S109)** | 349 | U11-U12 Boys+Girls | Add standings scraper |
| **Girls Academy** | gotsport.js (GotSport) | **PRODUCTION** | **528** (83+379+50+16) | U13-U19 Girls | **Session 106 DONE.** 4 events scraped + reclassified as leagues. GA Tier 1 + Aspire + JGAL + FL. |
| **USYS National League** | gotsport.js (GotSport) | **PRODUCTION** | **~1,151 league + 485 winter** | Regional conferences | **Session 106 DONE.** 21 new events discovered + scraped (8 Team Premier + 7 Club P1 + 4 Club P2 + 2 Winter). All reclassified as leagues. Winter Events kept as tournaments. |
| **NPL (18 regional)** | gotsport.js (GotSport) + TGS | PARTIAL → **SESSION 106 PARTIAL** | 2,767 + **947 TCSL** | Regional NPL | **Session 106:** TCSL NPL TX (TGS event 3989, 947 matches) added. 17/18 done. STXCL NPL needs AthleteOne adapter (Session 110+). |

### Adapter Status (12 needed for 100% coverage)

| # | Adapter | Status | States Covered | Division Data |
|---|---------|--------|----------------|:---:|
| 1 | **GotSport** | PRODUCTION | 35 states (304+ leagues, 1,777 tournaments) | Via event discovery |
| 2 | **Heartland CGI** | PRODUCTION | KS, MO-KC | Yes (14 divisions) |
| 3 | **HTGSports** | PRODUCTION | 26+ (tournaments) | Basic |
| 4 | **SINC Sports** | PRODUCTION | NC, TN (between seasons) | Yes (15 divisions) |
| 5 | **MLS Next (Modular11)** | PRODUCTION | National (all states) | Yes (conferences) |
| 6 | **SportsAffinity** | PRODUCTION | GA, MN, UT, OR, NE, PA-W, IA, **HI** (72 events) | No |
| 7 | **TotalGlobalSports** | **PRODUCTION** | ECNL national (76 events, 33,567 matches) | Yes (conferences/regions) |
| 8 | **PlayMetrics** | **PRODUCTION** | CO, SDL, WI (WYSA/MAYSA/EC/CWSL) | Yes — public `/g/` URLs |
| 9 | **Demosphere** | **PRODUCTION** | VA/DC (NCSL) | Yes — JSON/XML endpoints |
| 10 | **Squadi** | **PRODUCTION** | AR (ACSL/NWAL/CAL/State Champs) | Yes — REST API (no browser!) |
| 11 | **RI Super Liga** | **SKELETON** (retry March 28) | RI | Yes — PHP endpoints (data-purging!) |

**10 built (all PRODUCTION) + 1 skeleton (RI, retry March 28) = 11 adapters for 100% national coverage.**
**HI uses SportsAffinity (adapter #6) — no custom adapter needed.**

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
| 2 | **AK** | United Anchorage YSL (UAYSL) | A/B/C flights | GotSport | **5082** | **PARTIAL** | Event 5082: 12 groups set up, 0 games scheduled yet (Spring starts ~Mar 2026). In staticEvents — nightly captures when games post. 755 AK matches from other events. |
| 3 | **AZ** | AZ Advanced Leagues (APL/ASL1/ASL2) | APL, ASL1, ASL2 | GotSport | 32958, 44446, 34558, 39642, 39518, 40487 | **PARTIAL** | 6 leagues, 418 matches. Already discovered. |
| 4 | **AR** | ACSL + NWAL + CAL + State Champs | U11-U19 B+G | **Squadi** | 6 competitions (REST API) | **PRODUCTION** ✅ | **Session 104:** Squadi adapter built (REST API, no browser). 6 events, 1,637 matches, 693 new teams. sync-squadi in pipeline. |
| 5 | **CA-N** | Cal North CSL (CCSL) + BPYSL + CASA | Gold, Silver, Bronze, Copper | GotSport | 44635, 38645, 41352, 45152 | **PARTIAL** | Merged with CA. 17 CA leagues, 7,416 matches total. |
| 6 | **CA-NC** | NorCal Youth Premier League | Premier, Gold, Silver, Bronze, Copper | GotSport | 33458, 40753, 43408, 39481, 41823, 44145, 44142 | **PARTIAL** | Already discovered. NorCal: ~3,500 matches. |
| 7 | **CA-S** | SOCAL Soccer League + CCSAI + SCL | NPL + tiers | GotSport | 43086, 45205, 39754, 49470, 35287, 45285 | **PARTIAL** | SOCAL alone: 3,079 matches. Already discovered. |
| 8 | **CO** | Colorado Advanced League (CAL) | 9 tiers: P1/P2/P3, Elite, Platinum, Gold, Silver, Bronze, Secondary | **PlayMetrics** + GotSport | PM: CAL Fall 2025 (4,764) + **CAL Spring 2026 (4,564)** + GS (320) | **PARTIAL** | **9,648 CO matches.** Session 111: Spring 2026 scraped (league 1017-1829-bf8e0969). Fall+Spring both active. |
| 9 | **CT** | CT Championship League + ACSL | Premier I/II, First Division | GotSport | 44333, 39670, 44480, 40341, 40662 | **PARTIAL** | 5 leagues, 162 matches. Already discovered. |
| 10 | **DE** | EDP League + ESPL + CLS | EDP tiers | GotSport | 45707 (ESPL), 43731 (CLS) + EDP 44329 (multi-state) | **PARTIAL** | 2 DE-specific leagues (66 matches) + EDP coverage via MD event 44329. |
| 11 | **FL** | FSPL + EDP FL + FCL NPL | Multi-tier + 3 regional | GotSport | 80693, 76361, 79779 | **PARTIAL** | Discover FSPL main event IDs |
| 12 | **GA** | GPL + Classic/Athena | GPL; Classic 1-5, Athena A-D | SportsAffinity + GotSport | Multiple SA events (Boys) | **PARTIAL** | Boys scraped (Fall 2024/2025 + Spring 2025). Girls NOT on SA (Athena ended 2021). Girls data comes via GotSport tournaments (1,276 teams, 1,451 matches). |
| 13 | **HI** | Oahu League | A/B/C flights (Boys only) | **SportsAffinity** | SA: 4 events (ol-fall-25-26, ol-spring-25-26, ol-fallcomp24-25, ol-springcomp24-25) | **PARTIAL** | **Session 105:** NOT custom AngularJS — uses SportsAffinity! Added 4 events to SA adapter. 3,589 matches, 761 teams, 4 leagues. Boys only (B07-B19). Need standings scraper for PRODUCTION. |
| 14 | **ID** | Idaho Premier League (IPL) | Gold, Silver | GotSport | **45021** | **PARTIAL** | 45021 scraped: 20 matches. +364 from prior events. Total: 384 ID matches. |
| 15 | **IL** | IL State Premiership + NISL + SLYSA IL + MWC | Premiership I + NPL + Club/Conference + tiers | GotSport | 45492, 40174, 44640, 39659, 45100, 40255, 34346 + **NEW: 44630, 40124, 44632, 41112** | **PARTIAL** | **S103 finding:** IL uses GotSport, NOT Demosphere. 7 leagues, 12,123 matches. **S103 gap:** NISL (17K players, 1,300 teams) not yet scraped — 4 event IDs discovered (NPL Fall/Spring + Club/Conference Fall/Spring). **SESSION 104 Phase 1.** |
| 16 | **IN** | IYSA D3L | Premier, 1st, 2nd White | GotSport | 45057, 40237 | **PARTIAL** | 2 leagues, 87 matches. Need more ISL event discovery. |
| 17 | **IA** | Iowa Soccer League (ISL) + IDL + EIYSL | Age group-based | SportsAffinity + GotSport + HTGSports | SA: ISL Fall/Spring (580), GS: 47441 (32), HTG: 13486, 13113 | **PARTIAL** | 3 platforms. 612 matches total. SA GUIDs: Fall `7762C9F4`, Spring `627614EC`. EIYSL HTG events have 0 matches — need to verify if Spring 2026 events are active. Re-investigate. |
| 18 | **KS** | **Heartland Soccer** | **Division 1-14** | **Heartland CGI** | N/A | **PRODUCTION** | **DONE** |
| 19 | **KY** | Kentucky Premier League (KPL) | Premier, First | GotSport | **48452** | **PARTIAL** | 48452: 44 groups set up, 0 games yet (Spring starts ~Mar 2026). In staticEvents — nightly captures when games post. 6,883 KY matches from other events. |
| 20 | **LA** | LA Competitive Soccer League (LCSL) | Age-group divisions | GotSport | **40246, 35322, 35539** | **PARTIAL** | All 3 events scraped: 130 LA matches total across 3 LCSL events. |
| 21 | **ME** | Maine State Premier League (MSPL) | Age-group based | GotSport | **957, 40404** | **PARTIAL** | 957: 13 groups set up, 0 games yet (Spring starts ~Mar 2026). In staticEvents — nightly captures. 40404: 50 matches. Total: 2,273 ME matches. |
| 22 | **MD** | EDP League + CPSL NPL + ICSL + USYS NL SAC | Multi-tier | GotSport | 44329 (EDP: 496), 43268 (CPSL: 17), 43667 (ICSL: 365), 44340 (USYS 15-19U: 50), 50581 (USYS 13-14U: 20) | **PARTIAL** | 5 leagues, 948 matches. EDP 44329 also covers DE teams. |
| 23 | **MA** | GBYSL Select | NPL + lower | GotSport | 45209, 41506 | **PARTIAL** | 2 leagues, 48 matches. Need NEP event discovery for more. |
| 24 | **MI** | MSPSP + MYSL | GL Premier, Premier 1/2, Classic 1/2 | GotSport | 45649, 46034, 50611 | **PARTIAL** | Scrape Spring events |
| 25 | **MN** | MYSA State Competitive | Premier, Classic 1/2/3, Maroon, Gold (6 tiers) | SportsAffinity + GotSport | 6 GS leagues + 3 SA events | **PARTIAL** | **940 current-season matches** (190 GS + 531 SA Fall+Spring). SA adapter: 3 events (Fall Competitive, Metro Alliance, Summer 2025). |
| 26 | **MS** | No intrastate league — teams play USYS Mid South Conference (AL/AR/LA/MS/TN) | Multi-state U13-U19 | GotSport | **40362** (Mid South 2024-25), 48449 (State Cup) | **PARTIAL** | **Session 112:** Added 40362 to staticEvents + scraped. 1,647 MS matches from multi-state events. Mid South venues: Vicksburg, Jackson, Gulfport, Tupelo. |
| 27 | **MO** | **SLYSA + Heartland (KC)** | Bracket-based | GotSport + Heartland | TBD (SLYSA) | **PARTIAL** | Discover SLYSA event IDs |
| 28 | **MT** | Montana State Spring League (MSSL) | Premier, Select, Classic | GotSport | **40682** | **PARTIAL** | 40682: 38 groups set up, 0 games yet (Spring starts ~Mar 2026). In staticEvents — nightly captures. 3,282 MT matches from other events. |
| 29 | **NE** | NE Youth Soccer League | Divisions 1-4 | SportsAffinity + GotSport | 4 SA events (Fall+Spring) | **PARTIAL** | **2,143 current-season matches** (476 GS + 1,667 SA). SA events: Premier Conf, Dev Conf, CYSL, Cornhusker. |
| 30 | **NV** | NV South Youth Soccer League (NVSYSL) | Age-group based | GotSport | **40180** | **PARTIAL** | 40180 scraped: 316 staged (some team resolution issues). Total: 294 NV matches across 6 events. |
| 31 | **NH** | NH Soccer League (NHSL) | Age-group based | GotSport | **46884** | **PARTIAL** | 46884 scraped: 404 matches. Total: 428 NH matches. Largest Wave 2a result. |
| 32 | **NJ** | CJSL + NISL/NPL + SJSL + Inter-County + Mid NJ | Premier, Championship | GotSport | 45173, 40984, 44630, 41112, 40124, 44632, 43667, 39205, 45867, 41029, 45343, 40724, 44872, 40588 + more | **PARTIAL** | 21 leagues, 1,481 matches. Comprehensive NJ coverage. |
| 33 | **NM** | DCSL (WordPress/WPForms) + USYS Desert Conf + NWRGSL (Wix) | U9-U19 B+G | GotSport + Custom WordPress | **34558** (Desert Conf 2024-25), 24591 (older) | **PARTIAL** | **Session 112:** Added Desert Conf 34558 to staticEvents + scraped. 2,544 NM matches from multi-state. DCSL AJAX endpoint (dukecity.org) viable for custom adapter — Spring 2026 starts Feb 28. |
| 34 | **NY** | LIJSL + Hudson Valley + WYSL + CAYSA | Premier, Championship | GotSport | 45260, 39930, 45972, 42453, 45845, 40436, 46869, 41459, 47326, 38890 + more | **PARTIAL** | 13 leagues, 1,583 matches. LIJSL alone: 1,090 matches. |
| 35 | **NC** | **NCYSA Classic League** | **Premier, 1st, 2nd, 3rd (15 divs)** | **SINC Sports** | N/A | **PRODUCTION** | **DONE** (8,692 matches, 805 standings) |
| 36 | **ND** | NDSL exists but U9-U12 Rec Plus only (not premier) | N/A | SportsConnect → PlayMetrics | N/A | GS RANKS | NDSL is recreational-tier, excluded per Principle 28. Teams play USYS Midwest Conference (already scraped). 566 ND matches from multi-state events. |
| 37 | **OH** | OSPL/COPL/OCL + OPC + GCFYSL + WDDOA + FCL NPL | Premier I/II + divisions | GotSport | 45535, 40173, 46714, 40799, 45013, 40074, 43857, 43909, 43910, 33887, 45220, 36071 + more | **PARTIAL** | 19 leagues, 1,106 matches. Comprehensive OH coverage. |
| 38 | **OK** | OK Premier League (OPL) + OPC | D1, D2 + Gold/Silver/Bronze | GotSport | **45220, 50796** | **PARTIAL** | 45220: 35 groups set up, 0 games yet (Spring starts ~Mar 2026). In staticEvents — nightly captures. 50796: 38 matches. 5,274 OK matches from other events. |
| 39 | **OR** | OYSA Competitive League | Premier Gold/Silver, Div 1/2 | SportsAffinity + GotSport | 6 SA events (Fall+Spring) | **PARTIAL** | **10,046 current-season matches** (1,607 GS + 8,439 SA). SA events: Fall League, Dev League, Founders Cup, Valley Academy, Soccer 5, PYSA + Spring/Winter leagues. |
| 40 | **PA-E** | APL/Acela + EPPL + PSSLU + MaxinMotion | Premier, Championship | GotSport | 43531, 40626, 46768, 41370, 44986, 34294, 40350, 48194, 41091, 44034, 39130 | **PARTIAL** | 14 leagues (PA combined), 907 matches. |
| 41 | **PA-W** | PA West State Leagues | Divisions verified | SportsAffinity + GotSport | 10 SA events (Fall) | **PARTIAL** | **10,857 PA matches safe.** GLC/NAL/E64 RESOLVED (Session 108): national GotSport programs, not SportsAffinity. NAL reclassified as league (+84 matches). |
| 42 | **RI** | Super Liga | Anchor, Classic Gold/Blue, Rhody + U7-U19 | **Custom PHP** (thesuperliga.com) | N/A | GS RANKS → **DEFERRED (March 28)** | **Session 105:** Site PURGES data between seasons — Fall 2025 permanently lost. Tried 5+ approaches per Principle 42. Adapter skeleton built (`risuperliga.js`). **RETRY: March 28, 2026** (Spring season start). ⚠️ DATA-PURGING PLATFORM — must scrape during active season. |
| 43 | **SC** | SCCL (SC Challenge League) | Challenge, Classic | GotSport | 45507, 40890 | **PARTIAL** | 2 leagues, 409 matches. Already discovered. |
| 44 | **SD** | No statewide intrastate league | N/A | HTGSports (State Cup) + GotSport (USYS MW Conf) | JPL Mountain West 44839 (includes SD) | **PARTIAL** | No statewide premier league. SD teams play USYS Midwest Conference (already scraped). State Cup uses HTGSports. 1,843 SD matches from multi-state events. |
| 45 | **TN** | **TN State League (TSL)** | **Div 1, 2a, 2b, 3** | **SINC Sports** | N/A | GS RANKS | SINC adapter exists. March 2026 season start. |
| 46 | **TX-N** | NTSSA competitive + EDPL + CCSAI | Multiple tiers | GotSport | 79367, 77871 | **PARTIAL** | Discover more TX-N event IDs |
| 47 | **TX-S** | State Classic League + GCL | SCL Div I (East/West) | GotSport | 78565, 75263 | **PARTIAL** | Discover more TX-S event IDs |
| 48 | **UT** | UYSA Premier League | Premier + tiers (320+ teams) | SportsAffinity + GotSport | 6 SA events (Fall+Spring) | **PARTIAL** | **5,759 current-season matches** (1,408 GS + 4,351 SA). SA events: Premier PL/SCL/IRL/XL (3,523!), SUIRL, UVCL, YDL, Platform, Challenger. |
| 49 | **VT** | Vermont Soccer League (VSL) | D1, D2, D3 | GotSport | **39252** | **PARTIAL** | 39252 scraped: 148 matches. Total: 145 VT matches across 2 events. |
| 50 | **VA** | NCSL + VCSL + VPSL + TASL | Promo/relegation; Premier/Classic; NPL; Tidewater | **Demosphere** + GotSport | 80738 (NCSL) + 4 GS leagues + **NEW: 44587, 42891, 41359** | **PARTIAL** | **Demosphere adapter BUILT (S103).** NCSL 10,882 matches. VA total: 11,000 league matches. **S103 gap:** VCSL (20+ clubs), VPSL NPL, TASL (270+ teams) not yet scraped — 3 GotSport IDs discovered. **SESSION 104 Phase 1.** |
| 51 | **WA** | WPL + WSSL + EWSL | NPL + competitive tiers | GotSport | 44846, 44844, 45512, 44848, 40035, 39584, 40039, 38594, 39585, 48496, 40931, 46254 | **PARTIAL** | 12 leagues, 633 matches. Comprehensive WA coverage. |
| 52 | **WV** | WV State League | TBD | GotSport | Event ID behind registration hash | GS RANKS | Small market (~30-50 teams). Season starts March 2026. Retry then. |
| 53 | **WI** | WYSA State League + MAYSA + East Central + CWSL | Premier, First Division + regional competitive | **PlayMetrics** + GotSport | PM: WYSA (org 1014) + **NEW: MAYSA (1027), East Central (1028), CWSL (1033)** + 2 GS leagues | **PARTIAL** | **PlayMetrics expansion (S103).** WI league matches: 4,516. **S103 gap:** MAYSA (Madison), East Central Classic, CWSL, State Cups/Presidents Cup not yet scraped — 9 PlayMetrics IDs discovered across 4 org IDs. **SESSION 104 Phase 1.** |
| 54 | **WY** | No intrastate league — Yellowstone Premier League (multi-state: WY/CO/UT/NV/ID/MT) | Multi-state, event-based weekends | GotSport | **32734** (YPL 2024-25), 13170 (Snake River, HTG?), 44839 (JPL MW: 127 matches) | **PARTIAL** | **Session 112:** Added YPL 32734 to staticEvents + scraped. 2025-26 YPL event ID not posted yet. 1,809 WY matches from multi-state events (ECNL, JPL, etc). |
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
| 2 | **SportsAffinity** | GA, MN, UT, OR, NE, PA-W, IA, **HI** | **BUILT** | Good |
| 3 | **SINC Sports** | NC, TN | **BUILT** | Good |
| 4 | **Heartland CGI** | KS, MO-KC | **BUILT** | Good |
| 5 | **Modular11 (MLS Next)** | National | **BUILT** | Good |
| 6 | **TotalGlobalSports (ECNL)** | National (76 events) | **BUILT** | Good (Puppeteer+stealth) |
| 7 | **HTGSports** | National (tournaments) | **BUILT** | Good |
| 8 | **PlayMetrics** | CO, SDL, WI + growing | **BUILT** | Good (public `/g/` URLs) |
| 9 | **Demosphere** | VA/DC (NCSL) | **BUILT** | Good (JSON/XML endpoints) |
| 10 | **Squadi** | AR | **BUILT** | Good (REST API, no browser) |
| 11 | **Custom PHP** | RI | **SKELETON** (retry March 28) | ⚠️ Data-purging platform! |

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
- [x] AK — UAYSL (5082) — 12 groups configured, Spring starts ~Mar 2026, in staticEvents (nightly monitors). 755 AK matches from other sources.
- [x] ID — Idaho Premier (45021) — 20 matches scraped
- [x] KY — Kentucky Premier (48452) — 44 groups configured, Spring starts ~Mar 2026, in staticEvents. 6,883 KY matches from other sources.
- [x] LA — LCSL (40246, 35322, 35539) — 170 staged, 130 total LA matches
- [x] ME — Maine State Premier (957, 40404) — 957: 13 groups Spring 2026 (in staticEvents), 40404: 50 matches. 2,273 ME total.
- [x] MT — Montana State Spring (40682) — 38 groups configured, Spring starts ~Mar 2026, in staticEvents. 3,282 MT matches from other sources.
- [x] NH — NH Soccer League (46884) — 404 matches staged, 428 total
- [x] NV — NV South YSL (40180) — 316 staged, 294 total (some team resolution issues)
- [x] OK — OPL (45220) + OPC (50796) — 45220: 35 groups Spring 2026 (in staticEvents), 50796: 38 matches. 5,274 OK total.
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
- [x] Girls Academy — 42137: 78 groups set up (Spring starts Mar 2026, in staticEvents for nightly), 42138 (379 matches), 44874 (50 matches), 45530 (16 matches)
- [x] USYS National League — Sunshine P1 (43114: 24), Sunshine P2 (43943: 6), GL+MW conferences in staticEvents (scraped Session 106 — ~1,151 matches)
- [x] NPL — 26 NPL leagues already in DB with 1,104 matches (WA, CA, OH, FL, NJ, MN, VA, Central States, SAPL, Red River, JPL MW)
- [x] USYS NL remaining conferences — Scraped Session 106 (21 new conferences, ~1,151 total NL matches)

**Sub-wave 2d: Small/remaining markets + MD/DE/IA (Session 101):**
- [x] MD — EDP League (44329: 496), CPSL NPL (43268: 17), ICSL (43667: 365), USYS NL SAC 15-19U (44340: 50), USYS NL SAC 13-14U (50581: 20) — **948 matches, 5 leagues**
- [x] DE — Eastern Shore PL (45707: 10), Central League Soccer (43731: 56) — **66 matches, 2 leagues**
- [x] IA — SportsAffinity ISL Fall (349) + Spring (231), GotSport IDL (47441: 32), HTGSports EIYSL (13486, 13113 — need re-investigation, Spring 2026 events) — **612 matches, 3 platforms**
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

### Wave 6: Squadi Adapter (AR) — COMPLETE ✅ (Session 104)
- [x] Built Squadi adapter (REST API, no browser needed — 68s scrape!)
- [x] AR — ACSL, NWAL, CAL, State Championships — 1,637 matches, 693 teams
- [x] sync-squadi added to pipeline (10th sync source)

**Completion:** Squadi adapter built. AR at PRODUCTION. +1,637 matches.

### Wave 7: Custom Platforms (RI, HI, NM) — PARTIALLY COMPLETE (Session 105)
- [x] HI — **RESOLVED (Session 105):** Uses SportsAffinity, NOT custom AngularJS! Added 4 events to SA adapter. 3,589 matches across 4 seasons. No new adapter needed.
- [ ] RI — Super Liga adapter skeleton built (`risuperliga.js`). **Site purges data between seasons.** Retry March 28, 2026 (Spring 2026).
- [ ] NM — Duke City Soccer League (PDF parsing) — lowest priority

**Status:** HI DONE via SA adapter. RI waiting on season (March 28). NM deferred (PDF parsing, low ROI).

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

## Known Risks & Gaps (Updated Session 111)

> **DIRECTIVE:** ALL items MUST be resolved. No deferrals. Assigned to specific sessions.

| # | Risk/Gap | Severity | Session | Action |
|---|----------|----------|---------|--------|
| 1 | **RI data-purging platform** | 🔴 CRITICAL | **S115** (March 28) | Scrape SAME DAY Spring goes live. Adapter skeleton ready. |
| 2 | ~~41 states lack AS-IS standings~~ | ~~🔴~~ ✅ RESOLVED | **S110-111** | 7 standings adapters active (GS/TGS/SINC/Heartland/Demosphere/Squadi/PlayMetrics). 17,732 total standings. |
| 3 | **5 states need event scraping** (FL, IN, MO, TX — IDs found; MA blocked) | 🟡 HIGH | **S112** | IDs discovered S111: FL (43009, 45008, 45046, 45052), IN (49628), MO (44132), TX (44745, 45379). MA NEP blocked. |
| 4 | **Spring 2026 partially scraped** (CO done; AL/MI/KY/MT/OK via pipeline) | 🟢 LOW | **S112** | CO CAL Spring done (4,564). Others auto-discovered by nightly pipeline (Principle 45). AK deferred June 2026. |
| 5 | **NO LEAGUE states** (MS, SD, WY) | 🟡 HIGH | **S112** | Research USYS regional data, find evidence |
| 6 | **NM has no adapter** (PDF/WordPress) | 🟡 HIGH | **S112** | Build adapter per Principle 42 |
| 7 | **STXCL NPL** (18th/18 NPL, AthleteOne) | 🟡 MEDIUM | **S113** | Build AthleteOne adapter |
| 8 | **TN between seasons** (SINC ready) | 🟡 MEDIUM | **S114** (March 1) | Scrape via SINC adapter |
| 9 | **WV event ID behind hash** | 🟡 MEDIUM | **S114** (March 1) | Per Principle 42, find it |
| 10 | **Double-prefix failures** (74 matches) | 🟢 LOW | **S112** | Fix cleanTeamName.cjs edge cases |
| 11 | **View refresh 50+ sec** | 🟢 LOW | **S112** | Add indexes, optimize SQL |
| 12 | **SEM backfill** (~72K → 90K+) | 🟢 LOW | **S112** | Bulk SQL from historical data |
| 13 | **Pipeline monitoring/alerting** | 🟢 LOW | **S112** | Add failure alerts to GitHub Actions |
| 14 | **Girls Academy gap** (528 vs 800) | 🟢 LOW | **S112** | Re-scrape all 4 events |
| 15 | **318 Pre-ECNL null dates** | ⚪ ACCEPTED | N/A | Not recoverable (81.5% success rate) |
| 16 | **Outdated docs** (Roadmap, Playbook) | 🟢 LOW | **S112** | Update source tables, adapter lists |

### Resolved Risks (Archive)

| # | Risk/Gap | Resolution | Session |
|---|----------|----------|---------|
| R1 | GA Girls not on SportsAffinity | Athena ended on SA in 2021. Girls via GotSport tournaments. | S100 |
| R2 | ECNL future-proofing | LEAGUE_KEYWORDS + 74 TGS SEM backfill | S101 |
| R3 | MD/DE/IA event IDs missing | All 3 upgraded GS RANKS → PARTIAL | S101 |
| R4 | Wave 2d small markets | ND resolved, MD/DE/IA scraped | S101 |
| R5 | PA-W GLC restricted access | National GotSport programs, not SA. NAL reclassified. | S108 |
| R6 | GA incomplete (136 matches) | Scraped 4 events → 528 total. USYS NL 21 events. | S106 |
| R7 | USYS NL 13 conferences | 21 events discovered + scraped. | S106 |
| R8 | NPL 2 leagues missing | TCSL found (TGS). STXCL → AthleteOne S113. 17/18 done. | S106 |
| R9 | SA has no standings page | Confirmed — all 10 URLs 404. Hybrid view computes. | S109 |
| R10 | 41 states lack AS-IS standings | 7 standings adapters built (S109-S111). 17,732 total. | S110-111 |
| R11 | Event discovery FL/IN/MA/MO/TX | 8 new event IDs found. MA NEP blocked. | S111 |
| R12 | CO Spring 2026 not scraped | CAL Spring 2026 scraped: 4,564 matches. | S111 |
| R13 | AK UAYSL data | Structurally limited market. No public event ID. Retry June 2026. | S111 |

---

## Session Roadmap — REPLACED

> **The old Sessions 104-110 roadmap has been replaced by the 7-Session Completion Plan (Sessions 110-116) in the Active Work Queue above.**
>
> All completed session results are in the Session Progress Log and Completed Work archive at the top of this file.

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
