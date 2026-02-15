# SoccerView State Coverage Checklist

> **Version 3.0** | Updated: February 15, 2026 | Session 98b
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

## Completion Targets

| Milestone | Target | Current | Gap |
|-----------|--------|---------|-----|
| States at PRODUCTION | 55 | 4 (KS, MO-KC, NC, GA-Boys) | 51 |
| States at PARTIAL+ | 55 | 7 (+AL, MI, FL, TX) | 48 |
| Active matches | 1M+ | 426,513 | ~574K |
| Adapters built | 12 | 7 | 5 (PlayMetrics, Demosphere, Squadi, RI, HI) |
| Leagues in app | 300+ | 98 (with standings) | ~200 |

---

## Coverage Summary

| Status | Count | Description |
|--------|-------|-------------|
| **PRODUCTION** | 4 | Full data pipeline (matches + standings + schedules) |
| **PARTIAL** | 6 | Some data flows active, gaps remain |
| **GS RANKS** | 42 | GotSport ranking badges only — no local league data |
| **NO LEAGUE** | 3 | No statewide premier league exists (MS, SD, WY) |
| **Total** | 55 | All 50 states + DC (CA split 3, PA split 2) |

### National Programs

| Program | Adapter | Status | Matches | Age Groups |
|---------|---------|--------|---------|------------|
| **MLS Next** | mlsnext.js (Modular11/Puppeteer) | **PRODUCTION** | 9,795 | U13-U19 Boys |
| **ECNL/ECRL** | totalglobalsports.js (TGS/Puppeteer) | **IN PROGRESS** | 816 (1 of 13 events) | U13-U19 Boys+Girls |
| **Girls Academy** | gotsport.js (GotSport) | **MISSING** | 0 | Discover event IDs |
| **USYS National League** | gotsport.js (GotSport) | **MISSING** | 0 | 13 conferences to discover |
| **NPL (18 regional)** | gotsport.js (16/18 on GotSport) | **MISSING** | 0 | Discover event IDs |
| **GotSport Rankings** | restoreGotSportRanks.cjs | **PRODUCTION** | N/A (ranks only) | All |
| **SDL** | PlayMetrics (NEW) | **MISSING** | 0 | U11-U12 Boys+Girls |

### Adapter Status (12 needed for 100% coverage)

| # | Adapter | Status | States Covered | Division Data |
|---|---------|--------|----------------|:---:|
| 1 | **GotSport** | PRODUCTION | 35 states (304 leagues, 1,754 tournaments) | Via event discovery |
| 2 | **Heartland CGI** | PRODUCTION | KS, MO-KC | Yes (14 divisions) |
| 3 | **HTGSports** | PRODUCTION | 26+ (tournaments) | Basic |
| 4 | **SINC Sports** | PRODUCTION | NC, TN (between seasons) | Yes (15 divisions) |
| 5 | **MLS Next (Modular11)** | PRODUCTION | National (all states) | Yes (conferences) |
| 6 | **SportsAffinity** | PRODUCTION | GA (Boys only) | No |
| 7 | **TotalGlobalSports** | IN PROGRESS | ECNL national | Pending |
| 8 | **PlayMetrics** | **NOT BUILT** | CO, SDL + growing | Yes — public `/g/` URLs |
| 9 | **Demosphere** | **NOT BUILT** | VA/DC, IL, WI | Yes — widget-based |
| 10 | **Squadi** | **NOT BUILT** | AR (+ NJ partial) | Yes — public standings URLs |
| 11 | **RI Super Liga** | **NOT BUILT** | RI | Yes — PHP endpoints |
| 12 | **HI Oahu League** | **NOT BUILT** | HI | Yes — AngularJS SPA |

**7 built + 5 to build = 12 adapters for 100% national coverage.**

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
| 2 | **AK** | United Anchorage YSL (UAYSL) | A/B/C flights | GotSport | **5082** | GS RANKS | Scrape event 5082 |
| 3 | **AZ** | AZ Advanced Leagues (APL/ASL1/ASL2) | APL, ASL1, ASL2 | GotSport | TBD | GS RANKS | Discover event IDs |
| 4 | **AR** | Arkansas Competitive Soccer League (ACSL) | U11-U19 B+G | **Squadi** | N/A (was GotSport pre-2024) | GS RANKS | Build Squadi adapter (Wave 6) |
| 5 | **CA-N** | Cal North CSL (CCSL) | Gold, Silver, Bronze, Copper | GotSport | TBD | GS RANKS | Discover CCSL event IDs |
| 6 | **CA-NC** | NorCal Youth Premier League | Premier, Gold, Silver, Bronze, Copper | GotSport | TBD | GS RANKS | Discover event IDs (3,000+ teams) |
| 7 | **CA-S** | SOCAL Soccer League | NPL + tiers | GotSport | TBD | GS RANKS | Discover event IDs (3,500+ teams) |
| 8 | **CO** | Colorado Advanced League (CAL) | 9 tiers: P1/P2/P3, Elite, Platinum, Gold, Silver, Bronze, Secondary | **PlayMetrics** | N/A | GS RANKS | Build PlayMetrics adapter (Wave 4) |
| 9 | **CT** | EDP CT + CJSA | Premier I/II, First Division | GotSport (EDP) | TBD | GS RANKS | Discover EDP CT event IDs |
| 10 | **DE** | EDP League (multi-state) | EDP tiers | GotSport (EDP) | 57177e158c | GS RANKS | Scrape EDP event |
| 11 | **FL** | FSPL + EDP FL + FCL NPL | Multi-tier + 3 regional | GotSport | 80693, 76361, 79779 | **PARTIAL** | Discover FSPL main event IDs |
| 12 | **GA** | GPL + Classic/Athena | GPL; Classic 1-5, Athena A-D | SportsAffinity | N/A | **PARTIAL** | Expand Girls + more events |
| 13 | **HI** | Oahu League | A/B/C flights | **Custom AngularJS** | N/A | GS RANKS | Build Oahu adapter (Wave 7) |
| 14 | **ID** | Idaho Premier League (IPL) | Gold, Silver | GotSport | **45021** | GS RANKS | Scrape event 45021 |
| 15 | **IL** | IL State Premiership | Premiership I + tiers | **Demosphere** | N/A | GS RANKS | Build Demosphere adapter (Wave 5) |
| 16 | **IN** | Indiana Soccer League (ISL) | Premier, 1st, 2nd White | GotSport | TBD | GS RANKS | Discover ISL event IDs |
| 17 | **IA** | Iowa Soccer League | Age group-based | GotSport/PlayMetrics (migrating) | TBD | GS RANKS | Verify current platform, discover IDs |
| 18 | **KS** | **Heartland Soccer** | **Division 1-14** | **Heartland CGI** | N/A | **PRODUCTION** | **DONE** |
| 19 | **KY** | Kentucky Premier League (KPL) | Premier, First | GotSport | **48452** | GS RANKS | Scrape event 48452 |
| 20 | **LA** | LA Competitive Soccer League (LCSL) | Age-group divisions | GotSport | **40246, 35322, 35539** | GS RANKS | Scrape 3 confirmed events |
| 21 | **ME** | Maine State Premier League (MSPL) | Age-group based | GotSport | **957, 40404** | GS RANKS | Scrape confirmed events |
| 22 | **MD** | EDP League + MDSL | EDP tiers | GotSport (EDP) | TBD | GS RANKS | Discover EDP/MDSL event IDs |
| 23 | **MA** | New England Premiership (NEP) | NPL + lower | GotSport | TBD | GS RANKS | Discover NEP event IDs |
| 24 | **MI** | MSPSP + MYSL | GL Premier, Premier 1/2, Classic 1/2 | GotSport | 45649, 46034, 50611 | **PARTIAL** | Scrape Spring events |
| 25 | **MN** | MYSA State Competitive | Premier, Classic 1/2/3, Maroon, Gold (6 tiers) | SportsAffinity | N/A | GS RANKS | SportsAffinity event discovery (Wave 3) |
| 26 | **MS** | No statewide league (State Cup only) | N/A | GotSport (cup: 48449) | 48449 (cup only) | **NO LEAGUE** | Capture via USYS Mid South Conference |
| 27 | **MO** | **SLYSA + Heartland (KC)** | Bracket-based | GotSport + Heartland | TBD (SLYSA) | **PARTIAL** | Discover SLYSA event IDs |
| 28 | **MT** | Montana State Spring League (MSSL) | Premier, Select, Classic | GotSport | **40682** | GS RANKS | Scrape event 40682 |
| 29 | **NE** | NE Youth Soccer League | Divisions 1-4 | SportsAffinity | N/A | GS RANKS | SportsAffinity event discovery (Wave 3) |
| 30 | **NV** | NV South Youth Soccer League (NVSYSL) | Age-group based | GotSport | **40180** | GS RANKS | Scrape event 40180 |
| 31 | **NH** | NH Soccer League (NHSL) | Age-group based | GotSport | **46884** | GS RANKS | Scrape event 46884 |
| 32 | **NJ** | EDP NJ + Squadi admin | Premier, Championship | GotSport (EDP) + Squadi | 57177e158c (EDP) | GS RANKS | Scrape EDP event |
| 33 | **NM** | Duke City Soccer League (DCSL) | U9-U14 B+G | **Custom (PDF/WordPress)** | N/A | GS RANKS | PDF parsing adapter (Wave 7, lowest priority) |
| 34 | **NY** | EDP NY + CJSL | Premier, Championship | GotSport (EDP) | ed51079ad4 (EDP NA) | GS RANKS | Scrape EDP NA event |
| 35 | **NC** | **NCYSA Classic League** | **Premier, 1st, 2nd, 3rd (15 divs)** | **SINC Sports** | N/A | **PRODUCTION** | **DONE** (8,692 matches, 805 standings) |
| 36 | **ND** | Dakota Premier League (DPL) | TBD | GotSport (likely) | TBD | GS RANKS | Discover event ID (small) |
| 37 | **OH** | OSSL + Buckeye Premier | Premier I/II + divisions | GotSport | TBD | GS RANKS | Discover event IDs |
| 38 | **OK** | OK Premier League (OPL) + OPC | D1, D2 + Gold/Silver/Bronze | GotSport | **45220, 50796** | GS RANKS | Scrape 2 confirmed events |
| 39 | **OR** | OYSA Competitive League | Premier Gold/Silver, Div 1/2 | SportsAffinity | N/A | GS RANKS | SportsAffinity event discovery (Wave 3) |
| 40 | **PA-E** | EDP PA | Premier, Championship | GotSport (EDP) | 57177e158c (EDP) | GS RANKS | Scrape EDP event |
| 41 | **PA-W** | PA West State Leagues | Divisions verified | SportsAffinity | N/A | GS RANKS | SportsAffinity event discovery (Wave 3) |
| 42 | **RI** | Super Liga | 3 divisions per age/gender | **Custom PHP** (thesuperliga.com) | N/A | GS RANKS | Build RI adapter (Wave 7) |
| 43 | **SC** | SC Challenge + PMSL | Challenge, Classic | GotSport | TBD | GS RANKS | Discover event IDs |
| 44 | **SD** | No statewide league | N/A | N/A | N/A | **NO LEAGUE** | Capture via USYS regional data |
| 45 | **TN** | **TN State League (TSL)** | **Div 1, 2a, 2b, 3** | **SINC Sports** | N/A | GS RANKS | SINC adapter exists. March 2026 season start. |
| 46 | **TX-N** | NTSSA competitive + EDPL + CCSAI | Multiple tiers | GotSport | 79367, 77871 | **PARTIAL** | Discover more TX-N event IDs |
| 47 | **TX-S** | State Classic League + GCL | SCL Div I (East/West) | GotSport | 78565, 75263 | **PARTIAL** | Discover more TX-S event IDs |
| 48 | **UT** | UYSA Premier League | Premier + tiers (320+ teams) | SportsAffinity | N/A | GS RANKS | SportsAffinity event discovery (Wave 3) |
| 49 | **VT** | Vermont Soccer League (VSL) | D1, D2, D3 | GotSport | **39252** | GS RANKS | Scrape event 39252 |
| 50 | **VA** | NCSL + VCSL | Promo/relegation; Premier/Classic | **Demosphere** (NCSL) + GotSport | TBD | GS RANKS | Build Demosphere adapter (Wave 5) |
| 51 | **WA** | WA Premier League (WPL) | NPL + competitive tiers | GotSport | TBD | GS RANKS | Discover WPL event IDs |
| 52 | **WV** | WV State League | TBD | GotSport (likely) | ~4716 (unconfirmed) | GS RANKS | Confirm event ID (small) |
| 53 | **WI** | WYSA State League | Premier, First Division | **Demosphere** | N/A | GS RANKS | Build Demosphere adapter (Wave 5) |
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
| 6 | **TotalGlobalSports (ECNL)** | National | **BUILT** | Good |
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

**Sub-wave 2a: Confirmed Event IDs — scrape immediately:**
- [ ] AK — UAYSL (5082)
- [ ] ID — Idaho Premier (45021)
- [ ] KY — Kentucky Premier (48452)
- [ ] LA — LCSL (40246, 35322, 35539)
- [ ] ME — Maine State Premier (957, 40404)
- [ ] MT — Montana State Spring (40682)
- [ ] NH — NH Soccer League (46884)
- [ ] NV — NV South YSL (40180)
- [ ] OK — OPL (45220) + OPC (50796)
- [ ] VT — Vermont Soccer League (39252)

**Sub-wave 2b: Large markets — discover event IDs:**
- [ ] CA-S — SOCAL Soccer League (3,500+ teams)
- [ ] CA-NC — NorCal Premier (3,000+ teams)
- [ ] CA-N — CCSL
- [ ] OH — OSSL + Buckeye Premier
- [ ] NY — EDP NY + CJSL
- [ ] NJ — EDP NJ
- [ ] PA-E — EDP PA
- [ ] IL — NISL (if on GotSport; Premiership is Demosphere)
- [ ] IN — Indiana Soccer League
- [ ] MD — EDP + MDSL
- [ ] MA — New England Premiership
- [ ] AZ — APL/ASL
- [ ] WA — WA Premier League
- [ ] SC — SC Challenge + PMSL
- [ ] CT — EDP CT + CJSA

**Sub-wave 2c: National programs on GotSport:**
- [ ] Girls Academy — discover all conference event IDs
- [ ] USYS National League — 13 conferences
- [ ] NPL Finals + regional events (16 GotSport leagues)

**Sub-wave 2d: Small/remaining markets:**
- [ ] ND — Dakota Premier League
- [ ] WV — WV State League
- [ ] WY — Snake River League (if applicable)

**Completion:** All 35 GotSport states have event IDs and at least one season scraped.

### Wave 3: SportsAffinity Expansion (adapter BUILT)
- [ ] GA Girls — expand existing
- [ ] MN — MYSA State Competitive (6 tiers)
- [ ] UT — UYSA Premier League (320+ teams)
- [ ] OR — OYSA Competitive
- [ ] NE — NE Youth Soccer
- [ ] PA-W — PA West State Leagues

**Completion:** All 6 SportsAffinity states at PRODUCTION.

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
- [ ] Run remaining 12 TGS/ECNL events
- [ ] TN — TN State League via SINC Sports (March 2026)

**Completion:** All ECNL events scraped. TN at PRODUCTION.

### Wave 9: Ongoing Maintenance
- [ ] Daily pipeline via GitHub Actions
- [ ] Season event ID refresh (August + January)
- [ ] Platform migration monitoring
- [ ] All 55 entries verified at PRODUCTION

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
