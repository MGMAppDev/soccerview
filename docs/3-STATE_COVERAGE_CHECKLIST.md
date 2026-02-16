# SoccerView State Coverage Checklist

> **Version 4.0** | Updated: February 16, 2026 | Session 100
>
> **THE MASTER TRACKER** for national expansion. Every US state, every premier league, every platform, every action needed.
> **Updated every session.** This is the single source of truth for coverage status.
>
> **GUARANTEED END STATE:** All 55 entries at PRODUCTION — division structure, standings, matches, schedules for every premier league in every state.

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

## Completion Targets

| Milestone | Target | Current | Gap |
|-----------|--------|---------|-----|
| States at PRODUCTION | 55 | 4 (KS, MO-KC, NC, GA-Boys) | 51 |
| States at PARTIAL+ | 55 | 43 (39 with league data + 4 PRODUCTION) | 12 remaining |
| Active matches | 1M+ | **473,756** | ~526K |
| Leagues in DB | 398+ | **398** | More via daily discovery |
| National programs | 7 | 3 PRODUCTION (MLS Next, ECNL, GS Ranks) | 4 remaining (GA, USYS NL, NPL, SDL) |
| Adapters built | 12 | 7 | 5 (PlayMetrics, Demosphere, Squadi, RI, HI) |
| Pipeline sync jobs | 7 | **7** (GS, HTG, HRT, SINC, TGS, MLS Next, SA) | All built |
| States needing new adapters | 0 | 9 | AR, CO, DC, DE, HI, IA, MD, NM, RI + partial IL/VA/WI |

---

## Coverage Summary

| Status | Count | Description |
|--------|-------|-------------|
| **PRODUCTION** | 4 | Full data pipeline (matches + standings + schedules) |
| **PARTIAL** | 39 | Some league data active, need standings/more events |
| **GS RANKS** | 9 | GotSport ranking badges only — no local league data yet |
| **NO LEAGUE** | 3 | No statewide premier league exists (MS, SD, WY) |
| **Total** | 55 | All 50 states + DC (CA split 3, PA split 2) |

### National Programs

| Program | Adapter | Status | Matches | Age Groups |
|---------|---------|--------|---------|------------|
| **MLS Next** | mlsnext.js (Modular11/Puppeteer) | **PRODUCTION** | 9,795 | U13-U19 Boys |
| **ECNL/ECRL/Pre-ECNL** | totalglobalsports.js (TGS/Puppeteer) | **PRODUCTION** | **33,567** (76 events: 21 ECNL + 46 ECRL + 11 Pre-ECNL) | U13-U19 Boys+Girls |
| **Girls Academy** | gotsport.js (GotSport) | **PARTIAL** | ~136 (3 GS events: 42137, 42138, 44874, 45530) | Between seasons — retry Spring 2026 |
| **USYS National League** | gotsport.js (GotSport) | **MISSING** | 0 | 13 conferences to discover |
| **NPL (18 regional)** | gotsport.js (16/18 on GotSport) | **MISSING** | 0 | Discover event IDs |
| **GotSport Rankings** | restoreGotSportRanks.cjs | **PRODUCTION** | N/A (ranks only) | All |
| **SDL** | PlayMetrics (NEW) | **MISSING** | 0 | U11-U12 Boys+Girls |

### Adapter Status (12 needed for 100% coverage)

| # | Adapter | Status | States Covered | Division Data |
|---|---------|--------|----------------|:---:|
| 1 | **GotSport** | PRODUCTION | 35 states (304+ leagues, 1,777 tournaments) | Via event discovery |
| 2 | **Heartland CGI** | PRODUCTION | KS, MO-KC | Yes (14 divisions) |
| 3 | **HTGSports** | PRODUCTION | 26+ (tournaments) | Basic |
| 4 | **SINC Sports** | PRODUCTION | NC, TN (between seasons) | Yes (15 divisions) |
| 5 | **MLS Next (Modular11)** | PRODUCTION | National (all states) | Yes (conferences) |
| 6 | **SportsAffinity** | PRODUCTION | GA, MN, UT, OR, NE, PA-W (64 events) | No |
| 7 | **TotalGlobalSports** | **PRODUCTION** | ECNL national (76 events, 33,567 matches) | Yes (conferences/regions) |
| 8 | **PlayMetrics** | **NOT BUILT** | CO, SDL + growing | Yes — public `/g/` URLs |
| 9 | **Demosphere** | **NOT BUILT** | VA/DC, IL, WI | Yes — widget-based |
| 10 | **Squadi** | **NOT BUILT** | AR (+ NJ partial) | Yes — public standings URLs |
| 11 | **RI Super Liga** | **NOT BUILT** | RI | Yes — PHP endpoints |
| 12 | **HI Oahu League** | **NOT BUILT** | HI | Yes — AngularJS SPA |

**7 built (all PRODUCTION) + 5 to build = 12 adapters for 100% national coverage.**

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
| 4 | **AR** | Arkansas Competitive Soccer League (ACSL) | U11-U19 B+G | **Squadi** | N/A (was GotSport pre-2024) | GS RANKS | Build Squadi adapter (Wave 6) |
| 5 | **CA-N** | Cal North CSL (CCSL) + BPYSL + CASA | Gold, Silver, Bronze, Copper | GotSport | 44635, 38645, 41352, 45152 | **PARTIAL** | Merged with CA. 17 CA leagues, 7,416 matches total. |
| 6 | **CA-NC** | NorCal Youth Premier League | Premier, Gold, Silver, Bronze, Copper | GotSport | 33458, 40753, 43408, 39481, 41823, 44145, 44142 | **PARTIAL** | Already discovered. NorCal: ~3,500 matches. |
| 7 | **CA-S** | SOCAL Soccer League + CCSAI + SCL | NPL + tiers | GotSport | 43086, 45205, 39754, 49470, 35287, 45285 | **PARTIAL** | SOCAL alone: 3,079 matches. Already discovered. |
| 8 | **CO** | Colorado Advanced League (CAL) | 9 tiers: P1/P2/P3, Elite, Platinum, Gold, Silver, Bronze, Secondary | **PlayMetrics** + GotSport | 4 GS leagues (320 matches) | **PARTIAL** | GotSport has 320 CO matches. PlayMetrics needed for full CAL coverage. |
| 9 | **CT** | CT Championship League + ACSL | Premier I/II, First Division | GotSport | 44333, 39670, 44480, 40341, 40662 | **PARTIAL** | 5 leagues, 162 matches. Already discovered. |
| 10 | **DE** | EDP League (multi-state) | EDP tiers | GotSport (EDP) | 57177e158c | GS RANKS | Scrape EDP event |
| 11 | **FL** | FSPL + EDP FL + FCL NPL | Multi-tier + 3 regional | GotSport | 80693, 76361, 79779 | **PARTIAL** | Discover FSPL main event IDs |
| 12 | **GA** | GPL + Classic/Athena | GPL; Classic 1-5, Athena A-D | SportsAffinity + GotSport | Multiple SA events (Boys) | **PARTIAL** | Boys scraped (Fall 2024/2025 + Spring 2025). Girls NOT on SA (Athena ended 2021). Girls data comes via GotSport tournaments (1,276 teams, 1,451 matches). |
| 13 | **HI** | Oahu League | A/B/C flights | **Custom AngularJS** | N/A | GS RANKS | Build Oahu adapter (Wave 7) |
| 14 | **ID** | Idaho Premier League (IPL) | Gold, Silver | GotSport | **45021** | **PARTIAL** | 45021 scraped: 20 matches. +364 from prior events. Total: 384 ID matches. |
| 15 | **IL** | IL State Premiership + SLYSA IL + MWC | Premiership I + tiers | GotSport + Demosphere | 45492, 40174, 44640, 39659, 45100, 40255, 34346 | **PARTIAL** | 7 leagues, 211 matches via GotSport. Demosphere for full IL Premiership. |
| 16 | **IN** | IYSA D3L | Premier, 1st, 2nd White | GotSport | 45057, 40237 | **PARTIAL** | 2 leagues, 87 matches. Need more ISL event discovery. |
| 17 | **IA** | Iowa Soccer League | Age group-based | GotSport/PlayMetrics (migrating) | TBD | GS RANKS | Verify current platform, discover IDs |
| 18 | **KS** | **Heartland Soccer** | **Division 1-14** | **Heartland CGI** | N/A | **PRODUCTION** | **DONE** |
| 19 | **KY** | Kentucky Premier League (KPL) | Premier, First | GotSport | **48452** | **PARTIAL** | 48452 scraped: 0 matches (between seasons). KY Select (42 matches) already exists. Retry Spring 2026. |
| 20 | **LA** | LA Competitive Soccer League (LCSL) | Age-group divisions | GotSport | **40246, 35322, 35539** | **PARTIAL** | All 3 events scraped: 130 LA matches total across 3 LCSL events. |
| 21 | **ME** | Maine State Premier League (MSPL) | Age-group based | GotSport | **957, 40404** | **PARTIAL** | 957: 0 (between seasons), 40404: 50 matches. +27 Pine Tree League. Total: 77 ME matches. |
| 22 | **MD** | EDP League + MDSL | EDP tiers | GotSport (EDP) | TBD | GS RANKS | Discover EDP/MDSL event IDs |
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
| 36 | **ND** | Dakota Premier League (DPL) | TBD | GotSport (likely) | TBD | GS RANKS | Discover event ID (small) |
| 37 | **OH** | OSPL/COPL/OCL + OPC + GCFYSL + WDDOA + FCL NPL | Premier I/II + divisions | GotSport | 45535, 40173, 46714, 40799, 45013, 40074, 43857, 43909, 43910, 33887, 45220, 36071 + more | **PARTIAL** | 19 leagues, 1,106 matches. Comprehensive OH coverage. |
| 38 | **OK** | OK Premier League (OPL) + OPC | D1, D2 + Gold/Silver/Bronze | GotSport | **45220, 50796** | **PARTIAL** | 45220: 0 (between seasons), 50796: 38 matches. Total: 67 OK matches. |
| 39 | **OR** | OYSA Competitive League | Premier Gold/Silver, Div 1/2 | SportsAffinity + GotSport | 6 SA events (Fall+Spring) | **PARTIAL** | **10,046 current-season matches** (1,607 GS + 8,439 SA). SA events: Fall League, Dev League, Founders Cup, Valley Academy, Soccer 5, PYSA + Spring/Winter leagues. |
| 40 | **PA-E** | APL/Acela + EPPL + PSSLU + MaxinMotion | Premier, Championship | GotSport | 43531, 40626, 46768, 41370, 44986, 34294, 40350, 48194, 41091, 44034, 39130 | **PARTIAL** | 14 leagues (PA combined), 907 matches. |
| 41 | **PA-W** | PA West State Leagues | Divisions verified | SportsAffinity + GotSport | 10 SA events (Fall) | **PARTIAL** | **10,857 PA current-season matches** (+2,436 SA). SA events: Classic, Frontier, Div 4, Districts 1-5,7. GLC/NAL/E64 returned 0 (HTML parser issue — needs investigation). |
| 42 | **RI** | Super Liga | 3 divisions per age/gender | **Custom PHP** (thesuperliga.com) | N/A | GS RANKS | Build RI adapter (Wave 7) |
| 43 | **SC** | SCCL (SC Challenge League) | Challenge, Classic | GotSport | 45507, 40890 | **PARTIAL** | 2 leagues, 409 matches. Already discovered. |
| 44 | **SD** | No statewide league | N/A | N/A | N/A | **NO LEAGUE** | Capture via USYS regional data |
| 45 | **TN** | **TN State League (TSL)** | **Div 1, 2a, 2b, 3** | **SINC Sports** | N/A | GS RANKS | SINC adapter exists. March 2026 season start. |
| 46 | **TX-N** | NTSSA competitive + EDPL + CCSAI | Multiple tiers | GotSport | 79367, 77871 | **PARTIAL** | Discover more TX-N event IDs |
| 47 | **TX-S** | State Classic League + GCL | SCL Div I (East/West) | GotSport | 78565, 75263 | **PARTIAL** | Discover more TX-S event IDs |
| 48 | **UT** | UYSA Premier League | Premier + tiers (320+ teams) | SportsAffinity + GotSport | 6 SA events (Fall+Spring) | **PARTIAL** | **5,759 current-season matches** (1,408 GS + 4,351 SA). SA events: Premier PL/SCL/IRL/XL (3,523!), SUIRL, UVCL, YDL, Platform, Challenger. |
| 49 | **VT** | Vermont Soccer League (VSL) | D1, D2, D3 | GotSport | **39252** | **PARTIAL** | 39252 scraped: 148 matches. Total: 145 VT matches across 2 events. |
| 50 | **VA** | NCSL + VCSL | Promo/relegation; Premier/Classic | Demosphere + GotSport | 4 GS leagues (125 matches) | **PARTIAL** | GotSport has 125 VA matches. Demosphere for full NCSL. |
| 51 | **WA** | WPL + WSSL + EWSL | NPL + competitive tiers | GotSport | 44846, 44844, 45512, 44848, 40035, 39584, 40039, 38594, 39585, 48496, 40931, 46254 | **PARTIAL** | 12 leagues, 633 matches. Comprehensive WA coverage. |
| 52 | **WV** | WV State League | TBD | GotSport (likely) | ~4716 (unconfirmed) | GS RANKS | Confirm event ID (small) |
| 53 | **WI** | WYSA State League | Premier, First Division | Demosphere + GotSport | 2 GS leagues (123 matches) | **PARTIAL** | GotSport has 123 WI matches. Demosphere for full WYSA. |
| 54 | **WY** | No statewide league | N/A | GotSport (registration only) | N/A | **NO LEAGUE** | Capture via Snake River League if applicable |
| 55 | **DC** | NCSL (shared VA/MD) | Promo/relegation | **Demosphere** | N/A | GS RANKS | Build Demosphere adapter (Wave 5) |

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
| 8 | **PlayMetrics** | CO, SDL + growing | **NOT BUILT** | Good (public `/g/` URLs) |
| 9 | **Demosphere** | VA/DC, IL, WI | **NOT BUILT** | Moderate (widgets) |
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

**Sub-wave 2d: Small/remaining markets:**
- [ ] ND — Dakota Premier League
- [ ] WV — WV State League
- [ ] WY — Snake River League (if applicable)

**Completion:** All 35 GotSport states have event IDs and at least one season scraped.

### Wave 3: SportsAffinity Expansion (Session 99 — MOSTLY COMPLETE)
- [x] GA Girls — **RESOLVED (Session 100):** GA Girls is NOT on SportsAffinity. Athena league ended on SA in 2021. GA Girls data (1,276 teams, 1,451 matches) already exists via GotSport tournaments. No action needed.
- [x] MN — MYSA State Competitive: **940 matches** (3 SA events: Fall Competitive, Metro Alliance, Summer 2025)
- [x] UT — UYSA Premier League: **5,759 matches** (6 SA events: Premier PL/SCL/IRL/XL, SUIRL, UVCL, YDL, Platform, Challenger)
- [x] OR — OYSA Competitive: **10,046 matches** (6 SA events: Fall League, Dev League, Founders Cup, Valley, Soccer 5, PYSA + Spring/Winter)
- [x] NE — NE Youth Soccer: **2,143 matches** (4 SA events: Premier Conf, Dev Conf, CYSL, Cornhusker)
- [x] PA-W — PA West State Leagues: **10,857 PA matches** (10 SA events: Classic, Frontier, Div 4, Districts 1-5,7). GLC/NAL/E64 pending (HTML parser issue).

**Status: COMPLETE.** All 6 SA states scraped (Fall 2025 + Spring current). GA Girls resolved (not on SA, comes via GotSport). PA-W GLC top-tier event has restricted access (deferred March 2026 — see Risks section).

### Wave 4: PlayMetrics Adapter (CO + SDL)
- [ ] Build PlayMetrics adapter (Puppeteer, XHR intercept)
- [ ] CO — Colorado Advanced League (9 tiers)
- [ ] SDL — Sporting Development League (U11/U12)

**Completion:** PlayMetrics adapter built. CO + SDL at PRODUCTION.

### Wave 5: Demosphere Adapter (VA/DC, IL, WI)
- [ ] Build Demosphere adapter
- [ ] VA/DC — NCSL (promo/relegation)
- [ ] IL — IL State Premiership
- [ ] WI — WYSA State League

**Completion:** Demosphere adapter built. All 4 entries at PRODUCTION.

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

## Known Risks & Gaps (Updated Session 100)

| # | Risk/Gap | Severity | Status | Action |
|---|----------|----------|--------|--------|
| 1 | **GA Girls not on SportsAffinity** | Low | **RESOLVED** | Athena league ended on SA in 2021. GA Girls data (1,276 teams, 1,451 matches) already in DB via GotSport tournaments. No action needed. |
| 2 | **PA-W GLC/NAL/E64 restricted access** | Medium | **DEFERRED** | Entire PA-W SportsAffinity site has restricted access (all events redirect to UnPublishedPage.asp). 10 approaches tested per Principle 42. PA-W lower tiers (10,857 matches) are safe. Retry March 2026. GUIDs saved in session_checkpoint.md. |
| 3 | **318 Pre-ECNL null match_date failures** | Low | **ACCEPTED** | 1,396 of 1,718 Pre-ECNL records succeeded (81.5%). Failures are from partially-published TGS events with no match dates. Not recoverable. |
| 4 | **ECNL future-proofing for new seasons** | Medium | **MITIGATED** | All 76 current ECNL events registered in source_entity_map → Tier 0 lookup handles them. NEW season events (2026-27, IDs 3961+) will need: (a) discovery via quick_tgs_probe.cjs, (b) addition to staticEvents in totalglobalsports.js, (c) manual classification as leagues (names don't contain LEAGUE_KEYWORDS). Consider adding "ECNL/ECRL" to LEAGUE_KEYWORDS in fastProcessStaging.cjs. |
| 5 | **TN SINC Sports between seasons** | Low | **WAITING** | SINC adapter exists and is proven (NC: 8,692 matches). TN State League season starts March 2026. Calendar reminder to scrape. |
| 6 | **5 adapters not built (Waves 4-7)** | High | **PENDING** | PlayMetrics (CO 9-tier + SDL), Demosphere (VA/DC + IL + WI), Squadi (AR), RI Super Liga (PHP), HI Oahu (AngularJS). These block 9 state entries from reaching PRODUCTION. |
| 7 | **Wave 2d small markets (ND, WV)** | Low | **PENDING** | ND Dakota Premier League and WV State League need GotSport event ID discovery. Small team counts. WY has no statewide league. |
| 8 | **MD/DE/IA event IDs missing** | Medium | **PENDING** | MD (EDP/MDSL), DE (EDP), IA (migrating to PlayMetrics) — no state-specific league event IDs discovered yet. MD/DE teams play in multi-state EDP events. |

---

## Session 101 Action Items (Next Session)

### Priority 1: Complete Wave 2d (Low effort, completeness)
- [ ] Discover ND Dakota Premier League event ID on GotSport
- [ ] Discover WV State League event ID on GotSport
- [ ] Discover MD EDP/MDSL event IDs
- [ ] Discover DE EDP event ID
- [ ] Verify IA current platform status (GotSport vs PlayMetrics migration)

### Priority 2: Wave 4 — Build PlayMetrics Adapter (Highest ROI new adapter)
- [ ] Research PlayMetrics public `/g/` URL structure
- [ ] Build PlayMetrics adapter (Puppeteer, XHR intercept)
- [ ] Scrape CO — Colorado Advanced League (9 tiers: P1/P2/P3, Elite, Platinum, Gold, Silver, Bronze, Secondary)
- [ ] Scrape SDL — Sporting Development League (U11/U12 national)
- [ ] Process through pipeline, run ELO, refresh views

### Priority 3: Wave 5 — Build Demosphere Adapter
- [ ] Research Demosphere widget-based data access
- [ ] Build Demosphere adapter
- [ ] Scrape VA/DC — NCSL (promo/relegation system)
- [ ] Scrape IL — IL State Premiership (full coverage beyond current 211 GS matches)
- [ ] Scrape WI — WYSA State League (full coverage beyond current 123 GS matches)

### Priority 4: Wave 6 — Build Squadi Adapter
- [ ] Research Squadi React SPA structure
- [ ] Build Squadi adapter (Puppeteer)
- [ ] Scrape AR — Arkansas Competitive Soccer League

### Priority 5: ECNL Future-Proofing
- [ ] Add "ecnl", "ecrl", "pre-ecnl" to LEAGUE_KEYWORDS in fastProcessStaging.cjs
- [ ] Verify all 76 ECNL source_entity_map entries point to leagues (not tournaments)

### Priority 6: TN Retry (March 2026)
- [ ] When March arrives: scrape TN State League via SINC Sports adapter

### Priority 7: Wave 7 — Custom Platform Adapters (Lowest ROI)
- [ ] RI — Super Liga (Cheerio, PHP endpoints)
- [ ] HI — Oahu League (Puppeteer, AngularJS SPA)
- [ ] NM — Duke City Soccer League (PDF parsing, lowest priority)

### Priority 8: PA-W GLC Retry (March 2026)
- [ ] Re-test PA-W SportsAffinity access with saved GUIDs (in session_checkpoint.md)
- [ ] If still blocked, try alternative approaches (mobile endpoints, different User-Agent)

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
