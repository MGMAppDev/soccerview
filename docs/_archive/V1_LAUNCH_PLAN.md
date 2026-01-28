# SoccerView V1 Launch Plan

> **Created:** January 25, 2026
> **Last Updated:** January 26, 2026 (Session 44)
> **Target Launch:** Week of February 3, 2026
> **Status:** 🟢 DATA READY - Proceeding to QC & App Store Prep

---

## Launch Readiness Summary

| Criteria | Target | Current | Status |
|----------|--------|---------|--------|
| Total Teams | 100K+ | 149,000 | ✅ PASS |
| Matches (3 seasons) | 300K+ | 470,135 | ✅ PASS |
| Match Link Rate | 85%+ | 95%+ | ✅ PASS |
| Teams w/ Rankings | 100K+ | 136,353 | ✅ PASS |
| Teams w/ ELO | 40K+ | 47,094 | ✅ PASS |
| Database Security | RLS 100% | 100% | ✅ PASS |
| Heartland Score Coverage | 80%+ | 93.6% | ✅ PASS |

**All 7 criteria met. Ready for QC and App Store preparation.**

---

## IMMEDIATE PRIORITIES (Session 44)

### Priority 1: Fix Daily Data Sync Pipeline ✅ COMPLETE (Session 44)

**Issues Found & Fixed:**
- [x] Two conflicting workflows running (ingest.yml + daily-data-sync.yml)
- [x] Legacy ingest.yml deleted (was running broken scripts)
- [x] Local workflow changes pushed to GitHub
- [x] Added `scrapeHeartlandResults.js` (scores!)
- [x] Added `integrateHeartlandTeams.js` (team creation + linking)
- [x] Added `syncMatchCounts.js` (match visibility)
- [x] Added npm caching for faster builds
- [x] Added detailed summary report

**New Workflow Structure:**
```
daily-data-sync.yml (6 AM UTC / 1 AM EST)
├── Phase 1 (Parallel):
│   ├── sync-gotsport           → syncActiveEvents.js
│   ├── sync-heartland-puppeteer → scrapeHTGSports.js + scrapeHeartlandLeague.js
│   └── sync-heartland-results  → scrapeHeartlandResults.js ✅ NEW
├── Phase 2: integrate-heartland-teams → integrateHeartlandTeams.js ✅ NEW
├── Phase 3: link-teams         → linkTeams.js
├── Phase 4: recalculate-elo    → recalculate_elo_v2.js
├── Phase 5: sync-match-counts  → syncMatchCounts.js ✅ NEW
├── Phase 6: score-predictions  → scorePredictions.js
└── summary                     → Generate report
```

### Priority 2: Comprehensive App QC 🟠 HIGH

**User has specific issues to report.** Full testing checklist:

**Core Functionality:**
- [ ] Home tab - stats, latest matches, top teams
- [ ] Rankings tab - Official mode, SoccerView mode, toggle works
- [ ] Teams tab - search, filters, team cards
- [ ] Matches tab - recent matches display correctly
- [ ] Team Details - stats consistency (Session 43 fix), match history
- [ ] League Standings - points table, form indicators

**Match Card Consistency:**
- [ ] All match cards show scores (when available)
- [ ] Date badges display correctly
- [ ] Team names don't overflow
- [ ] Consistent styling across all screens

**Edge Cases:**
- [ ] Teams with no matches
- [ ] Teams with no rankings
- [ ] Empty search results
- [ ] Network error handling
- [ ] Pull-to-refresh on all lists

**User-Reported Issues:**
- [ ] (To be documented during QC session)

### Priority 3: App Store Preparation 🟠 HIGH

**Assets Needed:**
- [ ] App icon (1024x1024 for iOS, 512x512 for Android)
- [ ] Screenshots (6.7", 6.5", 5.5" iPhone + iPad)
- [ ] Feature graphic (Android, 1024x500)
- [ ] Privacy Policy URL
- [ ] Terms of Service URL

**Metadata:**
- [ ] App name finalized
- [ ] Short description (80 chars)
- [ ] Full description (4000 chars)
- [ ] Keywords (iOS, 100 chars)
- [ ] Category: Sports
- [ ] Age rating: 4+ / Everyone

**Go-To-Market Strategy:**
- [ ] Soft launch vs hard launch decision
- [ ] Beta testing plan (TestFlight/Internal Testing)
- [ ] Launch day promotion
- [ ] Social media presence
- [ ] Initial user acquisition strategy

### Priority 4: Production Build & Submit

- [ ] Review `app.json` configuration
- [ ] Review `eas.json` build profiles
- [ ] Create iOS production build
- [ ] Create Android production build
- [ ] Submit to TestFlight
- [ ] Submit to Google Play Internal Testing
- [ ] Beta feedback cycle
- [ ] Final submission

---

## Completed Tasks (Sessions 41-43)

### Data Pipeline ✅
- [x] HTGSports scraper fixed - 5,624 matches
- [x] Heartland League calendar scraper fixed - 2,801 matches
- [x] Heartland Results CGI scraper created - 4,634 matches with scores
- [x] Team integration pipeline - 129 new teams, 100% link rate
- [x] ELO recalculation - 184,396 matches processed
- [x] Match count sync - 74,827 teams visible

### Database Optimization ✅
- [x] Upgraded to Supabase Pro tier
- [x] Removed duplicate trigram index (-31 MB)
- [x] Added reconciliation composite indexes
- [x] Verified RLS on all tables

### UI Fixes ✅
- [x] Team stats consistency fix (Session 43)
- [x] Shared MatchCard component created
- [x] Match card styling standardized

---

## Daily Sync Workflow Reference

**Current Schedule:** 6 AM UTC (1 AM EST / midnight CST)

**To Run Manually:**
```bash
# Via GitHub CLI
gh workflow run daily-data-sync.yml --ref main

# With specific sync type
gh workflow run daily-data-sync.yml --ref main -f sync_type=full
```

**Sync Type Options:**
- `full` - All sources + processing
- `gotsport_only` - Just GotSport events
- `heartland_only` - Just Heartland sources
- `linking_only` - Just team linking
- `elo_only` - Just ELO recalculation
- `scoring_only` - Just prediction scoring

---

## Quick Commands Reference

```bash
# Check workflow status
gh run list --workflow=daily-data-sync.yml

# View specific run logs
gh run view <run-id> --log

# Manual data sync
node scripts/syncActiveEvents.js           # GotSport
node scripts/scrapeHTGSports.js --active-only      # Heartland tournaments
node scripts/scrapeHeartlandLeague.js --active-only # Heartland calendar
node scripts/scrapeHeartlandResults.js     # Heartland results with scores
node scripts/integrateHeartlandTeams.js    # Link Heartland matches
node scripts/recalculate_elo_v2.js         # ELO ratings
node scripts/syncMatchCounts.js            # Match counts

# Production builds
eas build --platform ios --profile production
eas build --platform android --profile production
```

---

## Timeline Estimate

| Phase | Duration | Target |
|-------|----------|--------|
| Fix Daily Sync | 1-2 hours | Jan 26 |
| App QC | 2-4 hours | Jan 26-27 |
| App Store Prep | 2-3 days | Jan 27-29 |
| Beta Testing | 3-5 days | Jan 30 - Feb 3 |
| Final Submission | 1 day | Feb 3-4 |
| App Store Review | 1-3 days | Feb 4-7 |
| **V1 Launch** | - | **Week of Feb 3** |

---

*Last Updated: January 26, 2026 - Session 43*
