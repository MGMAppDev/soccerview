# SoccerView State Coverage Checklist

> **Version 2.0** | Updated: February 15, 2026 | Session 98
>
> Master reference for national expansion. Every US state, every premier league, every platform, every action needed.
> **Updated as leagues are onboarded.** This is the single source of truth for coverage status.

---

## Coverage Summary

| Status | Count | Description |
|--------|-------|-------------|
| **PRODUCTION** | 4 | Full data pipeline (matches + standings + schedules) |
| **PARTIAL** | 3 | Some data flows active, gaps remain |
| **GS RANKS** | 48 | GotSport ranking badges only — no local league data |
| **Total** | 55 | All 50 states + DC (CA and PA split into sub-regions) |

### National Programs

| Program | Adapter | Status | Matches | Age Groups |
|---------|---------|--------|---------|------------|
| **MLS Next** | mlsnext.js (Modular11/Puppeteer) | **PRODUCTION** | 9,795 | U13-U19 Boys |
| **ECNL/ECRL** | totalglobalsports.js (TGS/Puppeteer) | **IN PROGRESS** | 0 (adapter needs fix) | U13-U19 Boys+Girls |
| **GotSport Rankings** | restoreGotSportRanks.cjs | **PRODUCTION** | N/A (ranks only) | All |

### Adapter Status

| Adapter | Status | States Covered | Division Data |
|---------|--------|----------------|:---:|
| **GotSport scheduling** | PRODUCTION | 30+ (274 leagues, 1,706 tournaments) | Via event discovery |
| **Heartland CGI** | PRODUCTION | KS, MO | Yes (14 divisions) |
| **HTGSports** | PRODUCTION | 26+ (tournaments) | Basic |
| **SINC Sports** | PRODUCTION (Session 95) | NC, TN (between seasons) | Yes (15 divisions) |
| **MLS Next (Modular11)** | PRODUCTION (Session 97) | National (all states) | Yes (conferences) |
| **SportsAffinity** | PRODUCTION (Session 97) | GA (Boys only) | No |
| **TotalGlobalSports** | IN PROGRESS (Session 98) | ECNL national | Pending |
| **Demosphere** | NOT BUILT | IL, KY, VA/DC, WI | Yes |
| **Sports Connect** | NOT BUILT | CO, CT, IA, MA, SD | Yes |
| **PlayMetrics** | NOT BUILT | WI, SDL (KC) | Yes |

**3 remaining adapters + GotSport event discovery = complete national coverage.**

---

## Complete State Checklist

### Legend

| Column | Description |
|--------|-------------|
| **State** | US state or sub-region |
| **Association** | State youth soccer association |
| **Primary Premier League** | Main competitive league (premier level) |
| **Divisions** | Known division/tier structure |
| **Platform** | Technology platform hosting league data |
| **SV Status** | Current SoccerView integration status |
| **Action** | Next step to achieve full coverage |

### Status Key

- **PRODUCTION** — Full pipeline: matches + standings + schedules
- **PARTIAL** — Some data flows active, others need work
- **GS RANKS** — GotSport ranking badges only (no local match/standings/schedule data)
- **TEST LEAGUE** — Selected for Phase C validation testing

---

### Alabama — Wyoming (Alphabetical)

| # | State | Association | Primary Premier League | Divisions | Platform | SV Status | Action |
|---|-------|-------------|----------------------|-----------|----------|-----------|--------|
| 1 | **AL** | Alabama Soccer Assoc | Alabama State League (ASL) | Div 1, Div 2 | GotSport | **PARTIAL** | Fall 2025 active (45401), Spring 2026 scraping (51021) |
| 2 | **AK** | Alaska YSA | United Anchorage YSL | A/B/C flights | GotSport | GS RANKS | Discover event IDs (small market) |
| 3 | **AZ** | Arizona Soccer Assoc | AZ Advanced Leagues (APL/ASL1/ASL2) | APL, ASL1, ASL2 (promo/relegation) | GotSport | GS RANKS | Discover event IDs |
| 4 | **AR** | Arkansas Soccer Assoc | AR Competitive Soccer League | NEEDS VERIFICATION | GotSport | GS RANKS | Discover event IDs |
| 5 | **CA-N** | Cal North Soccer | Cal North CSL (CCSL) | Gold, Silver, Bronze, Copper | GotSport | GS RANKS | Discover CCSL event IDs |
| 6 | **CA-NC** | NorCal Premier | NorCal Youth Premier League | Premier, Gold, Silver, Bronze, Copper | GotSport | GS RANKS | Discover event IDs (3,000+ teams) |
| 7 | **CA-S** | Cal South Soccer | SOCAL Soccer League | NPL + tiers | GotSport | GS RANKS | Discover event IDs |
| 8 | **CO** | Colorado Soccer Assoc | CO Advanced League | 9 tiers: Premier 1/2/3, Elite, Platinum, Gold, Silver, Bronze, Secondary | Sports Connect | GS RANKS | New adapter or verify GotSport |
| 9 | **CT** | CT Junior Soccer Assoc | CJSA + EDP CT | Premier I/II, First Division | Sports Connect + GotSport (EDP) | GS RANKS | Discover EDP CT event IDs |
| 10 | **DE** | Delaware YSA | EDP League (multi-state) | EDP tiers | GotSport (via EDP) | GS RANKS | Discover EDP event IDs |
| 11 | **FL** | Florida YSA | FL State Premier League (FSPL) | Single-tier + 3 regional | GotSport | GS RANKS | Discover FSPL event IDs |
| 12 | **GA** | Georgia Soccer | GPL + Classic/Athena | GPL; Classic 1-5, Athena A-D | **SportsAffinity** + GotSport | **PARTIAL** | SportsAffinity adapter PRODUCTION (Boys, 2,409 matches). Girls TBD. |
| 13 | **HI** | Hawaii YSA | Island-based leagues | A/B/C flights | SportsAffinity | GS RANKS | Low priority (small market) |
| 14 | **ID** | Idaho YSA | Idaho Premier League | NEEDS VERIFICATION | GotSport | GS RANKS | Discover IPL event IDs |
| 15 | **IL** | Illinois YSA | IL State Premiership | Premiership I + tiers | Demosphere | GS RANKS | Need Demosphere adapter |
| 16 | **IN** | Indiana Soccer | Indiana Soccer League (ISL) | Premier, 1st, 2nd White | GotSport | GS RANKS | Discover ISL event IDs |
| 17 | **IA** | Iowa Soccer | Iowa Soccer League | Age group-based | Sports Connect | GS RANKS | Need Sports Connect adapter |
| 18 | **KS** | Kansas YSA | **Heartland Soccer** | **Division 1-14** | **Heartland CGI** | **PRODUCTION** | **DONE** |
| 19 | **KY** | Kentucky YSA | Kentucky Premier League | NEEDS VERIFICATION | Demosphere + GotSport | GS RANKS | Need Demosphere adapter |
| 20 | **LA** | Louisiana Soccer Assoc | LCSL + PSL | Classic, Premier | GotSport | GS RANKS | Discover event IDs |
| 21 | **ME** | Soccer Maine | Maine State Premier League | Age group-based | GotSport | GS RANKS | Discover event IDs (small market) |
| 22 | **MD** | Maryland State YS | EDP League + MDSL | EDP tiers | GotSport | GS RANKS | Discover EDP/MDSL event IDs |
| 23 | **MA** | Massachusetts YS | New England Premiership | NPL + lower | Sports Connect + GotSport | GS RANKS | Discover NEP event IDs |
| 24 | **MI** | Michigan State YS | MSPSP + MYSL | GL Premier, Premier 1/2, Classic 1/2 (5 tiers) | GotSport | **PARTIAL** | MSPSP Fall (45649) active. Adding MYSL (46034) + MSPSP Spring (50611). |
| 25 | **MN** | Minnesota YS | MYSA State Competitive | Premier, Classic 1/2/3, Maroon, Gold (6 tiers) | SportsAffinity | GS RANKS | Need SportsAffinity adapter |
| 26 | **MS** | Mississippi Soccer Assoc | MS Competitive Soccer League | NEEDS VERIFICATION | GotSport | GS RANKS | Discover event IDs |
| 27 | **MO** | Missouri YS | **SLYSA + Heartland (KC)** | Bracket-based divisions | GotSport + Heartland | **PARTIAL** | Discover SLYSA event IDs |
| 28 | **MT** | Montana YSA | MYSA State League | Premier, Select, Classic, Academy | GotSport | GS RANKS | Discover event IDs (small market) |
| 29 | **NE** | Nebraska State Soccer | NE Youth Soccer League | Divisions 1-4 | SportsAffinity | GS RANKS | Need SportsAffinity adapter |
| 30 | **NV** | Nevada YSA | NV State League | NEEDS VERIFICATION | GotSport | GS RANKS | Discover event IDs |
| 31 | **NH** | New Hampshire SA | NH Soccer League | NEEDS VERIFICATION | GotSport | GS RANKS | Discover event IDs (small market) |
| 32 | **NJ** | NJ Youth Soccer | EDP League + NCSA | Premier, Championship | GotSport (via EDP) | GS RANKS | Discover EDP NJ event IDs |
| 33 | **NM** | New Mexico YSA | Duke City Soccer League | NEEDS VERIFICATION | GotSport + SportsEngine | GS RANKS | Verify platform |
| 34 | **NY** | Eastern NY YSA + NY West | EDP Premier + CJSL | Premier, Championship | GotSport (via EDP) | GS RANKS | Discover EDP NY event IDs |
| 35 | **NC** | NC Youth Soccer Assoc | **NCYSA Classic League** | **Premier, 1st, 2nd, 3rd (15 divs)** | **SINC Sports** | **PRODUCTION** | 8,692 matches, 805 standings, 318 teams. Session 95-96. |
| 36 | **ND** | North Dakota Soccer | Dakota Premier League | NEEDS VERIFICATION | GotSport | GS RANKS | Discover event IDs (small market) |
| 37 | **OH** | Ohio Soccer Assoc | OSSL + Buckeye Premier | Premier I/II; BPYSL divisions | GotSport | GS RANKS | Discover event IDs |
| 38 | **OK** | Oklahoma Soccer Assoc | Oklahoma Premier League | Super Premier, OPL 1/2/3 | GotSport + TeamStats | GS RANKS | Discover event IDs |
| 39 | **OR** | Oregon YSA | OYSA Competitive League | Premier Gold/Silver, Div 1/2 | SportsAffinity | GS RANKS | Need SportsAffinity adapter |
| 40 | **PA-E** | Eastern PA YS | EDP League | Premier, Championship | GotSport (via EDP) | GS RANKS | Discover EDP PA event IDs |
| 41 | **PA-W** | PA West Soccer | PA West State Leagues | Divisions verified | SportsAffinity | GS RANKS | Need SportsAffinity adapter |
| 42 | **RI** | Soccer Rhode Island | Super Liga | 3 divisions per age/gender | Custom | GS RANKS | Custom scraper (small market) |
| 43 | **SC** | SC Youth Soccer Assoc | SC Challenge + PMSL | Challenge, Classic | GotSport | GS RANKS | Discover event IDs |
| 44 | **SD** | South Dakota YSA | SD Champions League | NEEDS VERIFICATION | Sports Connect | GS RANKS | Need Sports Connect adapter (small market) |
| 45 | **TN** | Tennessee State Soccer | **TN State League (TSL)** | **Div 1, 2a, 2b, 3** | **SINC Sports** | **GS RANKS** | SINC adapter exists but TN between seasons. Deferred to March 2026. |
| 46 | **TX-N** | North Texas Soccer | NTSSA competitive leagues | Multiple tiers | GotSport | GS RANKS | Discover event IDs |
| 47 | **TX-S** | South Texas YS | State Classic League | SCL Div I (East/West), SRPL | GotSport | GS RANKS | Discover event IDs |
| 48 | **UT** | Utah YSA | UYSA Premier League | Premier + tiers (320+ teams) | SportsAffinity | GS RANKS | Need SportsAffinity adapter |
| 49 | **VT** | Vermont Soccer Assoc | Vermont Soccer League | Div 1, 2, 3 | GotSport | GS RANKS | Discover event IDs (small market) |
| 50 | **VA** | Virginia YSA | NCSL + VCSL | NCSL promo/relegation; VCSL Premier/Classic | Demosphere (NCSL) + GotSport | GS RANKS | Need Demosphere adapter |
| 51 | **WA** | Washington YS | WA Premier League (WPL) | NPL + competitive tiers | GotSport + SportsAffinity | GS RANKS | Discover WPL event IDs |
| 52 | **WV** | WV Soccer Assoc | WV State League | NEEDS VERIFICATION | NEEDS VERIFICATION | GS RANKS | Verify platform (small market) |
| 53 | **WI** | Wisconsin YSA | WYSA State League | Premier, First Division | Demosphere | GS RANKS | Need Demosphere adapter |
| 54 | **WY** | Wyoming Soccer Assoc | WSA Competitive League | NEEDS VERIFICATION | GotSport | GS RANKS | Discover event IDs (small market) |
| 55 | **DC** | VYSA / MDCVSA | NCSL (shared VA/MD) | Promo/relegation divisions | Demosphere | GS RANKS | Need Demosphere adapter |

---

## Platform-to-State Mapping

Which adapter unlocks which states:

### GotSport Event Discovery (30+ states, adapter EXISTS)

States where local leagues use GotSport for scheduling. Adapter is built — just need to discover league event IDs.

AL, AK, AZ, AR, CA-N, CA-NC, CA-S, CT (EDP), DE (EDP), FL, GA, ID, IN, LA, ME, MD (EDP), MA, MI, MS, MT, NV, NH, NJ (EDP), NM, NY (EDP), ND, OH, OK, PA-E (EDP), SC, TX-N, TX-S, VT, WA, WY

**Action:** Run GotSport event discovery for each state's league. ~30 min per state.

### SINC Sports (NC PRODUCTION, TN deferred — adapter BUILT)

| State | League | Divisions | Status |
|-------|--------|-----------|--------|
| **NC** | NCYSA Classic League | Premier, 1st, 2nd, 3rd (15 divs) | **PRODUCTION** (8,692 matches, 805 standings) |
| TN | TN State League (TSL) | Div 1, 2a, 2b, 3 | Deferred to March 2026 (between seasons) |

**Action:** Adapter EXISTS (Session 95). TN expansion when new season starts.

### Demosphere (IL, KY, VA, DC, WI — adapter NOT BUILT)

| State | League | Divisions |
|-------|--------|-----------|
| IL | IL State Premiership | Premiership I + tiers |
| KY | Kentucky Premier League | NEEDS VERIFICATION |
| VA | NCSL + VCSL | Promo/relegation; Premier/Classic |
| DC | NCSL (shared VA/MD) | Promo/relegation |
| WI | WYSA State League | Premier, First Division |

**Action:** Build Demosphere adapter after SINC Sports validation.

### SportsAffinity (MN, NE, OR, UT, HI, PA-W — adapter BUILT, expand to more states)

| State | League | Divisions | Status |
|-------|--------|-----------|--------|
| **GA** | GPL + Classic/Athena | GPL; Classic 1-5, Athena A-D | **PRODUCTION** (Boys, 2,409 matches) |
| MN | MYSA State Competitive | Premier, Classic 1/2/3, Maroon, Gold (6 tiers) | Discover event IDs |
| NE | NE Youth Soccer League | Divisions 1-4 | Discover event IDs |
| OR | OYSA Competitive League | Premier Gold/Silver, Div 1/2 | Discover event IDs |
| UT | UYSA Premier League | Premier + tiers (320+ teams) | Discover event IDs |
| HI | Island-based leagues | A/B/C flights | Low priority |
| PA-W | PA West State Leagues | Divisions verified | Discover event IDs |

**Action:** Adapter EXISTS (Session 97). Expand to MN, UT, OR, NE, PA-W via event discovery.

### Sports Connect (CO, CT, IA, MA, SD — adapter NOT BUILT)

| State | League | Divisions |
|-------|--------|-----------|
| CO | CO Advanced League | 9 tiers: Premier 1/2/3 through Secondary |
| CT | CJSA (non-EDP) | Premier I/II, First Division |
| IA | Iowa Soccer League | Age group-based |
| MA | New England Premiership (non-EDP) | NPL + lower |
| SD | SD Champions League | NEEDS VERIFICATION |

**Action:** Build Sports Connect adapter after SportsAffinity.

### Custom/Other

| State | Platform | Notes |
|-------|----------|-------|
| RI | Custom | Small market, Super Liga, custom scraper needed |
| NM | SportsEngine | Verify if GotSport covers league data |
| WV | NEEDS VERIFICATION | Identify platform first |
| GA | Sports Connect (partial) | Some leagues on Sports Connect, others on GotSport |

---

## Expansion Priority Order

Based on coverage gaps, team counts, and adapter efficiency:

### Wave 1: Foundation Adapters (COMPLETE)
- [x] KS/MO — Heartland CGI (PRODUCTION, 14 divisions)
- [x] NC — NCYSA Classic League via SINC Sports (PRODUCTION, 8,692 matches)
- [x] MLS Next — Modular11 adapter (PRODUCTION, 9,795 matches, U13-U19 national)
- [x] GA — SportsAffinity adapter (PRODUCTION, Boys 2,409 matches)
- [x] GotSport Rankings — National ranking badges (PRODUCTION, 64% match rate)

### Wave 2: GotSport Event Discovery (IN PROGRESS — Highest ROI)
Adapter already built. Just need to discover event IDs. Covers 30+ states.
- [x] AL — ASL Fall 2025 (45401) + Spring 2026 (51021)
- [x] MI — MYSL Fall (46034) + MSPSP Spring (50611)
- [ ] FL — FSPL (large market, highest priority)
- [ ] TX-N — NTSSA (large market)
- [ ] TX-S — SCL (large market)
- [ ] CA-NC — NorCal Premier (3,000+ teams)
- [ ] CA-S — SOCAL Soccer League
- [ ] CA-N — CCSL
- [ ] OH — OSSL + Buckeye Premier
- [ ] NJ — EDP NJ
- [ ] NY — EDP NY
- [ ] PA-E — EDP PA
- [ ] MD — EDP/MDSL
- [ ] IN — ISL
- [ ] SC — SC Challenge + PMSL
- [ ] AZ — APL/ASL1/ASL2
- [ ] LA — LCSL + PSL
- [ ] (remaining 15+ GotSport states...)

### Wave 3: SportsAffinity Expansion (adapter BUILT)
- [x] GA — GPL Boys (PRODUCTION)
- [ ] GA — Girls (expand existing)
- [ ] MN — MYSA State Competitive (6 tiers, large market)
- [ ] UT — UYSA Premier League (320+ teams)
- [ ] OR — OYSA Competitive
- [ ] NE — NE Youth Soccer
- [ ] PA-W — PA West State Leagues
- [ ] HI — Island leagues (low priority)

### Wave 4: Demosphere Adapter (NOT BUILT)
- [ ] VA + DC — NCSL (large, promo/relegation)
- [ ] IL — State Premiership
- [ ] WI — WYSA
- [ ] KY — Premier League

### Wave 5: Sports Connect Adapter (NOT BUILT)
- [ ] CO — CO Advanced (9 tiers!)
- [ ] IA — Iowa Soccer
- [ ] CT — CJSA
- [ ] MA — NEP
- [ ] SD — Champions League

### Wave 6: ECNL + SINC Sports Expansion
- [ ] ECNL/ECRL — TotalGlobalSports adapter (IN PROGRESS, needs fix)
- [ ] TN — TN State League via SINC Sports (deferred to March 2026, between seasons)

---

## Verification Checklist (Per State Onboarding)

When bringing a new state to PRODUCTION status, verify ALL THREE data flows:

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

- **"NEEDS VERIFICATION"** = league structure exists but division names/counts not confirmed. Research needed before adapter work.
- **"small market"** = fewer than ~500 premier teams. Lower priority but still tracked for completeness.
- **EDP** states (NJ, PA-E, NY, MD, DE, CT) use GotSport under the hood via EDP Soccer. May be discoverable through existing GotSport adapter.
- California split into 3 sub-regions (Cal North, NorCal Premier, Cal South) because each has independent league administration.
- Pennsylvania split into 2 (Eastern PA via EDP/GotSport, PA West via SportsAffinity).

---

*This document is the single source of truth for national expansion tracking.*
*Update SV Status column as each state is onboarded.*
*See [3-DATA_EXPANSION_ROADMAP.md](3-DATA_EXPANSION_ROADMAP.md) for strategic framework.*
