# Session 41 - Comprehensive Action Plan

> **Status:** Linking in progress (4 parallel batches running)
> **Updated:** January 25, 2026 1:07 PM

---

## PHASE 1: TODAY - After Linking Completes (~6:00 PM)

### Automated (This Tab - No User Action Required)
- [ ] **Wait for linking completion** (~4-5 hours)
- [ ] **Run recalculate_elo_v2.js** (~10 min) - Update ELO with all linked matches
- [ ] **Run syncMatchCounts.js** (~1 min) - Update teams.matches_played field
- [ ] **Verify database state** - Check counts, link rates, errors
- [ ] **Provide completion summary** - Stats, improvements, next steps

### Manual Verification (After Automated Tasks)
- [ ] **Check database stats**
  - Total matches linked
  - Link rate improvement
  - Teams with match history count
  - ELO distribution (min, max, avg)
- [ ] **Review error logs** (if any)
- [ ] **Spot-check Heartland data** - Verify HTGSports + Heartland League matches visible

---

## PHASE 2: TONIGHT - Before Bed (~10:00 PM)

### Critical Overnight Task
- [ ] **Start reconciliation** - `node scripts/reconcileRankedTeams.js`
  - Estimated time: 10-12 hours
  - Single-threaded (no timeout issues)
  - 23,926 ranked teams to process
  - Leave running overnight
  - **DO NOT CLOSE TERMINAL**

---

## PHASE 3: TOMORROW MORNING - After Reconciliation (~8:00 AM)

### Data Pipeline Completion
- [ ] **Verify reconciliation completed** - Check terminal output
- [ ] **Run recalculate_elo_v2.js** - Update ELO with newly reconciled teams
- [ ] **Run syncMatchCounts.js** - Update match counts again
- [ ] **Check reconciliation stats**
  - Teams reconciled
  - Match rate improvement
  - Ranked teams now with matches

### Database Health Check
- [ ] **Run checkStatus.js** - Get final database metrics
- [ ] **Check for data anomalies**
  - Duplicate team names
  - Orphaned matches
  - Missing ELO ratings
- [ ] **Verify reconciliation quality** - Sample 10-20 reconciled teams manually

---

## PHASE 4: APP TESTING & VERIFICATION

### Core Functionality Tests
- [ ] **Test Home Tab**
  - Stats display correctly
  - Latest Matches carousel shows Heartland matches
  - Top Teams list accurate
- [ ] **Test Rankings Tab**
  - Official Rankings mode shows all ranked teams
  - SoccerView Power Rating filters correctly
  - Switch toggle works smoothly
- [ ] **Test Teams Tab**
  - Search works (try Heartland teams: "Sporting", "KC")
  - Filters work (state, age group, gender)
  - Match history count accurate
- [ ] **Test Matches Tab**
  - Recent matches include Heartland data
  - Filters work correctly
  - Match cards display properly
- [ ] **Test Team Detail Screens**
  - ELO ratings display
  - Match history shows all matches
  - Recent matches section accurate

### Heartland Data Verification
- [ ] **Search for Heartland teams** - "Sporting KC", "KC Fusion", etc.
- [ ] **Verify HTGSports matches** (5,624 matches)
  - Source: events.htgsports.net
  - Event names display
  - Scores present
- [ ] **Verify Heartland League matches** (2,801 matches)
  - Source: calendar.heartlandsoccer.net
  - Team names correct
  - Dates accurate

### Performance Testing
- [ ] **Test load times**
  - Home tab initial load
  - Rankings tab load (108K+ teams)
  - Teams tab search
  - Match history pagination
- [ ] **Test scroll performance**
  - Long lists (Rankings, Teams)
  - Match history
  - Latest Matches carousel
- [ ] **Test filter performance**
  - State filters
  - Age group filters
  - Multiple filters combined

---

## PHASE 5: DOCUMENTATION UPDATES

### CLAUDE.md Updates
- [ ] **Update Session 41 section** - Final accomplishments
- [ ] **Update database metrics**
  - Total teams: [FINAL COUNT]
  - Total matches: [FINAL COUNT]
  - Link rate: [FINAL %]
  - Teams with matches: [FINAL COUNT]
- [ ] **Update Heartland integration section**
  - Matches scraped breakdown
  - Data sources documented
  - Scripts created list
- [ ] **Document reconciliation results**
  - Teams reconciled count
  - Ranked teams coverage improvement
  - Match rate before/after
- [ ] **Update Next Steps section**
  - V1.1 roadmap priorities
  - Regional data gaps
  - Performance optimizations

### Technical Documentation
- [ ] **Document parallel processing lessons**
  - What worked (linking)
  - What failed (reconciliation)
  - Database timeout issues
  - Future optimization strategies
- [ ] **Document Heartland integration**
  - HTGSports scraper architecture
  - Heartland League scraper architecture
  - Event ID discovery process
  - Data mapping decisions
- [ ] **Update script documentation**
  - reconcileRankedTeamsParallel.js notes
  - fastLinkV3Parallel.js notes
  - Timeout configuration lessons

---

## PHASE 6: FUTURE PLANNING

### V1.1 Feature Priorities
- [ ] **League Standings feature** - Competitor's #1 requested feature
  - Design database schema
  - Plan UI/UX
  - Identify data sources
- [ ] **Match prediction improvements**
  - Enhance What-If scenarios
  - Add confidence intervals
  - Improve prediction accuracy
- [ ] **Gamification enhancements**
  - Expand prediction scoring
  - Add leaderboards
  - Reward badges/achievements

### Regional Data Expansion
- [ ] **Priority State: North Carolina (NC)**
  - Platform: SINC Sports
  - Teams: 3,172 (20.4% coverage)
  - Build scraper for sincsports.com
- [ ] **Priority State: Georgia (GA)**
  - Platform: GotSport (expand coverage)
  - Teams: 3,030 (26.0% coverage)
  - Discover more GA events
- [ ] **Priority Region: Southeast**
  - SC, NC, GA, AL, TN, MS, LA
  - 11,527 teams with ~25% avg coverage
  - Build Piedmont Conference scraper

### Performance Optimizations
- [ ] **Database indexing review**
  - Analyze slow queries
  - Add indexes for fuzzy matching
  - Optimize team_name_aliases table
- [ ] **Reconciliation optimization**
  - Pre-filter candidates by state/gender
  - Batch fuzzy queries differently
  - Consider materialized views
- [ ] **App performance**
  - Optimize Rankings tab rendering
  - Implement virtual scrolling
  - Add pagination where needed

---

## SAFE TO DO NOW (Other Tab - No Disruption)

### ✅ Documentation Work
- [x] Create this action plan
- [x] Draft League Standings feature spec (FEATURE_SPEC_LEAGUE_STANDINGS.md)
- [x] Create Database Optimization Plan (DATABASE_OPTIMIZATION_PLAN.md)
- [x] Update CLAUDE.md with links to new docs
- [x] Update CLAUDE.md with Phase 1 completion status
- [x] Update SESSION_41_ACTION_PLAN.md with Phase 1 results
- [ ] Document Heartland integration architecture
- [ ] Plan NC/GA data source integration

### ✅ Database Optimization (Phase 1 Complete - Jan 25, 2026)
- [x] Create executePhase1Optimization.js script
- [x] Drop duplicate trigram index (idx_teams_team_name_trgm)
- [x] Create reconciliation priority index (idx_teams_reconciliation_priority)
- [x] Create reconciliation candidates index (idx_teams_reconciliation_candidates)
- [x] Run ANALYZE on teams table
- [x] Verify all indexes created successfully
- [x] Confirm storage savings (355 MB → 324 MB = -31 MB)
- **Results:** 6.87s execution time, zero errors, ready for reconciliation

### ✅ Planning & Research
- [ ] Research SINC Sports platform (NC)
- [ ] Research Piedmont Conference data access
- [ ] Research league standings data sources
- [ ] Plan gamification enhancements
- [ ] Review competitor features

### ✅ Code Cleanup (Non-Data Scripts)
- [ ] Clean up old/unused scripts in scripts/ folder
- [ ] Organize archive folder
- [ ] Remove stale checkpoint files
- [ ] Add JSDoc comments to key functions

### ✅ UI/UX Improvements (Visual Only)
- [ ] Review dark theme consistency
- [ ] Plan UI animations/transitions
- [ ] Design loading state improvements
- [ ] Sketch league standings UI mockups

### ✅ Testing Preparation
- [ ] Write test plan checklist
- [ ] Prepare test data samples
- [ ] Document test scenarios
- [ ] Plan regression test suite

---

## ⚠️ DO NOT DO NOW (Wait Until Data Secure)

### ❌ Anything Touching Database
- ❌ Running any scripts that query/update database
- ❌ Testing app features (requires latest data)
- ❌ Scraping new data sources
- ❌ Database schema changes

### ❌ Anything Requiring Final Numbers
- ❌ Updating CLAUDE.md with final stats
- ❌ Writing Session 41 summary
- ❌ Creating performance reports

### ❌ Anything That Could Interfere
- ❌ Installing new npm packages (might restart processes)
- ❌ Modifying running scripts
- ❌ Database connection changes
- ❌ Environment variable changes

---

## MONITORING SCHEDULE (This Tab)

| Time | Check | Status |
|------|-------|--------|
| 1:34 PM | Check #1 | Automated |
| 2:04 PM | Check #2 | Automated |
| 2:34 PM | Check #3 | Automated |
| 3:04 PM | Check #4 | Automated |
| 3:34 PM | Check #5 | Automated |
| 4:04 PM | Check #6 | Automated |
| 4:34 PM | Check #7 | Automated |
| 5:04 PM | Check #8 | Automated |
| 5:34 PM | Check #9 | Automated |
| ~6:00 PM | **COMPLETION** | Will notify |

---

## PRIORITY MATRIX

### HIGH PRIORITY (Do ASAP After Data Secure)
1. Verify data integrity
2. Test Heartland data in app
3. Update CLAUDE.md with final stats
4. Start overnight reconciliation

### MEDIUM PRIORITY (This Week)
1. Plan League Standings feature
2. Research NC/GA data sources
3. Performance optimization planning
4. Code cleanup and documentation

### LOW PRIORITY (Next Sprint)
1. Gamification enhancements
2. UI/UX improvements
3. Regional data expansion (beyond NC/GA)
4. Advanced analytics features

---

## BLOCKERS & DEPENDENCIES

| Task | Blocked By | Estimated Unblock Time |
|------|------------|----------------------|
| ELO recalc | Linking completion | ~6:00 PM today |
| App testing | ELO recalc + sync | ~6:15 PM today |
| Final stats | App testing verification | ~7:00 PM today |
| Reconciliation | User to start overnight | ~10:00 PM tonight |
| Final reconciliation stats | Reconciliation completion | ~8:00 AM tomorrow |

---

## SUCCESS METRICS

### Session 41 Goals
- [x] Heartland data integration (8,425 matches) ✅
- [x] Database optimization Phase 1 (reconciliation indexes) ✅
- [ ] Team linking improvement (target: 90%+ link rate)
- [ ] ELO recalculation with new matches
- [ ] Reconciliation of ranked teams (target: 70%+ with matches)

### Database Optimization Metrics (Phase 1 Complete)
- [x] Duplicate index removed (idx_teams_team_name_trgm)
- [x] Reconciliation priority index created (296 kB)
- [x] Reconciliation candidates index created (1,552 kB)
- [x] Storage savings achieved (-31 MB, teams: 355 MB → 324 MB)
- [x] Execution time: <10 seconds (actual: 6.87s)
- [x] Zero errors during optimization
- [x] All indexes verified and functional
- [ ] Reconciliation speedup validated (run tonight)

### Quality Checks
- [ ] No data loss during processing
- [ ] No duplicate matches created
- [ ] ELO ratings within expected range (1200-1800)
- [ ] Match counts accurate across all teams
- [ ] Heartland matches properly attributed

---

**Last Updated:** January 25, 2026 3:23 PM
**Status:** Linking in progress, Phase 1 optimization complete
**Next Milestone:** Linking completion (~6:00 PM), then reconciliation overnight
**Completed Today:**
- ✅ Heartland data integration (8,425 matches)
- ✅ Database Phase 1 optimization (-31 MB, 2 new indexes)
- ✅ League Standings feature spec (47KB)
- ✅ Database Optimization Plan (68KB)
