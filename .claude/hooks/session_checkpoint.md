# Session Checkpoint — Auto-Updated
Last Updated: 2026-02-18T03:00:00Z
Session: 112 — IN PROGRESS

## 🚨 CRITICAL RULE — PLASTERED HERE PERMANENTLY
**"BETWEEN SEASONS" IS BANNED. WE ARE IN THE 2025-26 SEASON (Aug 2025-Jul 2026).**
**0 matches from a scrape = WRONG EVENT ID or SCRAPER BUG. Find the correct one.**
**Spring 2026 leagues are ACTIVE RIGHT NOW (Feb-Jun 2026). Scrape them.**
**NEVER mark a state "done" with 0 matches from any source.**

---

## Session 112 Goals

1. Scrape 8 discovered GotSport event IDs ✅ (mostly done — most had data from prior scrapes)
2. NO LEAGUE states (MS, SD, WY) — research USYS regional events
3. GS RANKS states (ND verified, NM needs adapter)
4. Clear technical debt

---

## Completed This Session (Session 112)

### 1. "Between Seasons" Language Eliminated Everywhere ✅
- **User directive:** Stop using "between seasons" as excuse. We ARE in season (Aug 2025-Jul 2026).
- Updated: `docs/1.1-GUARDRAILS_v2.md` Section 19 — zero tolerance policy
- Updated: `.claude/hooks/CRITICAL_RULES.md` — banned phrase plastered at top
- Updated: `CLAUDE.md` Principle 43 — "WE ARE ALWAYS IN-SEASON"
- Updated: `docs/3-STATE_COVERAGE_CHECKLIST.md` — removed all "between seasons" justifications
- Updated: `docs/3-DATA_EXPANSION_ROADMAP.md` — TN SINC entry

### 2. 8 GotSport Events Added to staticEvents + Scraping ✅
Added to `scripts/adapters/gotsport.js` staticEvents (18 total, up from 4):
- FL: 43009 (FSPL: 62 matches), 45008 (WFPL: 429), 45046 (CFPL: 16 NEW), 45052 (SEFPL: 0 — Spring not started)
- IN: 49628 (ISL Spring — reclassified tournament→league, 93 matches)
- MO: 44132 (SLYSA: 324 matches)
- TX: 44745 (GCL: 158), 45379 (EDPL: 217)
- Spring 2026 with groups configured (no games yet, in staticEvents for nightly):
  - 48452 KY Premier (44 groups), 40682 MT Spring (38 groups), 45220 OK Premier (35 groups)
  - 957 ME State Premier (13 groups), 5082 AK UAYSL (12 groups), 42137 GA Tier 1 (78 groups)

### 3. ISL 49628 Reclassified Tournament→League ✅
- Created league "Indiana Soccer League Spring 2026" (UUID: 127b2afa-8bac-490c-9472-a1323d94cc02)
- Re-pointed 93 matches from tournament to league
- Registered in source_entity_map

### 4. CFPL 45046 — 16 NEW Matches Scraped + Processed ✅
- 16 CFPL Spring 2026 matches staged and processed via fastProcessStaging
- 17 new FL teams created

### 5. "Between Seasons" Gap States Re-Investigated ✅
These events were falsely marked "done between seasons" — they ARE Spring 2026 events:
- KY 48452: 44 groups set up — Spring games start ~March
- MT 40682: 38 groups set up — Spring games start ~March
- OK 45220: 35 groups set up — Spring games start ~March
- ME 957: 13 groups set up — Spring games start ~March
- AK 5082: 12 groups set up — Spring games start ~March
- GA Tier 1 42137: 78 groups set up — Spring games start ~March
**All 6 events now in staticEvents. Nightly pipeline will capture games when posted.**
**These states already have solid coverage: KY 6,883 matches, OK 5,274, MT 3,282, ME 2,273, AK 755.**

### SEM Gap Analysis (Completed)
- 75,588 teams have matches but no SEM entry
- Most gaps from platforms that don't emit source team IDs (legacy, gotsport match pipeline, SA, PlayMetrics)
- Only TGS/Demosphere/SINC/Squadi have source IDs in staging — those ARE mapped
- **Conclusion: SEM backfill not feasible for bulk gap. Not a data quality problem.**

## In Progress

- Research agent for MS/SD/WY/ND/NM — need to investigate manually

## Key Metrics (Session 112 start)

| Metric | Session 111 end | Current |
|--------|----------------|---------|
| matches_v2 (active) | 525,682 | **~525,700+** |
| teams_v2 | 187,604 | **~187,620** |
| league_standings | 17,732 | 17,732 |
| leagues | 464 | **465** (+1 ISL) |
| GotSport staticEvents | 12 | **18** (+6 Spring 2026 gaps) |

## Files Modified This Session

- `scripts/adapters/gotsport.js` — +6 Spring 2026 events to staticEvents (now 18 total)
- `scripts/_debug/reclassify_isl_49628.cjs` — Created (ISL reclassification)
- `scripts/_debug/check_zero_match_events.cjs` — Created (gap audit tool)
- `docs/1.1-GUARDRAILS_v2.md` — Section 19 "between seasons" banned
- `.claude/hooks/CRITICAL_RULES.md` — Season rule updated to BANNED
- `CLAUDE.md` — Principle 43 updated (Session 99/112)
- `docs/3-STATE_COVERAGE_CHECKLIST.md` — All "between seasons" entries corrected
- `docs/3-DATA_EXPANSION_ROADMAP.md` — TN entry updated

## Next Steps This Session

1. Research MS/SD/WY (NO LEAGUE states) — find USYS multi-state conference events
2. Research ND/NM — verify coverage approaches
3. Check IA EIYSL HTG events (13486, 13113) — re-scrape, might have Spring data now
4. Commit all changes
5. Update CLAUDE.md to v24.2

## Resume Prompt for Session 113

"Resume SoccerView Session 113. Session 112 IN PROGRESS — eliminated 'between seasons' excuse everywhere (CRITICAL RULE: banned). Added 6 Spring 2026 gap events to GotSport staticEvents (KY/MT/OK/ME/AK/GA Tier 1 — groups configured, games start March). Scraped CFPL (16 new matches). Reclassified ISL→league (+93 matches). Need: (1) Research MS/SD/WY NO LEAGUE states via USYS conferences, (2) ND/NM GS RANKS verification, (3) IA EIYSL re-scrape, (4) Commit + CLAUDE.md v24.2. Read CLAUDE.md (v24.1) and session_checkpoint.md first."
