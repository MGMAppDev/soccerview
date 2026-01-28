# Cross-Tab Coordination Plan
**Created:** January 25, 2026 3:55 PM
**Purpose:** Consolidate workstreams and avoid duplicate work

---

## Current State Analysis

### Database Status (Just Verified)
- **Total Matches:** 467,001
- **Linked Matches:** 414,290 (88.7%) ✅
- **Teams with Matches:** 19,500
- **League Events:** 272
- **Sample ELO Ratings:** 1500 (default - suggests fresh calculation needed)

### Tab 1 (This Tab) - Work Completed
✅ **League Standings Feature - COMPLETE**
- TypeScript interfaces added to lib/leagues.ts
- getLeaguePointsTable() function implemented
- getTeamsForm() function implemented
- UI components added to app/league/[eventId].tsx
- Points Table toggle UI ready
- Form badges implemented

✅ **Database Linking - COMPLETE**
- +20,802 matches linked (84.3% → 88.7%)
- Heartland data successfully integrated

⏸️ **Ready to Test:**
- Points Table feature (database queries safe now)
- Need to find sample league event ID for testing

### Tab 2 (Other Tab) - Status Unknown
⚠️ **User Reports:** "ELO is running in the other tab"

**Possible Activities:**
1. Running `recalculate_elo_v2.js` (ELO recalculation)
2. Running `syncMatchCounts.js` (updating matches_played field)
3. Running reconciliation scripts
4. Idle/stuck session

---

## Risk Analysis: Duplicate Work

### ⚠️ HIGH RISK - If Both Tabs Are Active:

**Potential Conflicts:**
1. **ELO Recalculation** - If running in Tab 2:
   - Writes to: `teams.elo_rating`, `teams.elo_national_rank`, `teams.elo_state_rank`
   - Duration: ~30-45 minutes for 44K teams
   - This tab's actions: None conflicting (read-only queries)

2. **Match Count Sync** - If running in Tab 2:
   - Writes to: `teams.matches_played`
   - Duration: ~5-10 minutes
   - This tab's actions: None conflicting

3. **Reconciliation** - If running in Tab 2:
   - Writes to: `teams` (ranking data transfers)
   - Duration: Hours (may be stuck/crashed)
   - This tab's actions: None conflicting

### ✅ LOW RISK - Current Situation:

**This Tab's Pending Work:**
- Testing Points Table feature (READ-ONLY queries)
- Eventually: Running ELO recalc (if not already done)
- Eventually: Running syncMatchCounts (if not already done)

**Conclusion:** If Tab 2 is running ELO, this tab can safely test Points Table (read-only). No write conflicts.

---

## Recommended Consolidation Plan

### Option 1: Let Tab 2 Finish, Then Close It ⭐ RECOMMENDED

**Steps:**
1. **Check Tab 2 Status:**
   - Is ELO recalculation actually running?
   - Check for output file or progress indicators
   - Estimate time remaining

2. **If ELO Running in Tab 2:**
   - ✅ Let it finish (30-45 min total, probably 15-20 min left)
   - ✅ Meanwhile in THIS tab: Test Points Table feature (read-only, safe)
   - ⏰ When Tab 2 completes: Close Tab 2, continue in THIS tab
   - ✅ Run syncMatchCounts in THIS tab after

3. **If Tab 2 Idle/Stuck:**
   - ❌ Close Tab 2 immediately
   - ✅ Run ELO recalc in THIS tab
   - ✅ Run syncMatchCounts in THIS tab

### Option 2: Consolidate Now (Aggressive)

**Steps:**
1. Check Tab 2 for any running processes
2. Kill any running scripts (Ctrl+C or process kill)
3. Close Tab 2
4. Run all remaining work in THIS tab:
   - Test Points Table
   - Run ELO recalculation
   - Run syncMatchCounts
   - Update CLAUDE.md

**Risk:** May lose 15-20 minutes of ELO calculation progress if it's mid-run.

---

## Immediate Action Items

### For User to Do Now:

1. **Switch to Tab 2** and report:
   - [ ] Is there a script running? (check terminal output)
   - [ ] What's the last line of output?
   - [ ] Any .txt/.log files being actively written?
   - [ ] Estimated completion time shown?

2. **Based on Tab 2 Status:**

   **If ELO Running:**
   ```
   → Return to THIS tab
   → Test Points Table feature while waiting
   → Close Tab 2 when it completes
   → Continue all future work in THIS tab
   ```

   **If Tab 2 Idle:**
   ```
   → Close Tab 2 immediately
   → Stay in THIS tab for all remaining work
   ```

---

## Division of Labor (After Consolidation)

### This Tab Will Handle:

**Immediate (Next 30 min):**
1. ✅ Test Points Table feature
2. ✅ Verify form badges display
3. ✅ Test on sample league event
4. ⏸️ Wait for Tab 2 ELO completion (if running)

**After Tab 2 Closed:**
5. Run ELO recalculation (if not done)
6. Run syncMatchCounts.js
7. Update CLAUDE.md with Session 41 accomplishments
8. Final testing and verification

**Documentation:**
9. Update all relevant .md files
10. Create final session summary

---

## Key Metrics to Track

After consolidation, verify:

| Metric | Current | Target | Status |
|--------|---------|--------|--------|
| Matches Linked | 414,290 (88.7%) | Same | ✅ |
| Teams with Matches | 19,500 | ~120K | ❓ (check after syncMatchCounts) |
| ELO Calculated | Unknown | ~44K teams | ❓ (check after recalc) |
| Points Table Works | Untested | Functional | ⏸️ (test now) |

---

## Success Criteria for Single Tab

After consolidation, THIS tab will be the single source of truth for:
- ✅ All code changes
- ✅ All database operations
- ✅ All testing
- ✅ All documentation updates
- ✅ Session 41 completion

**Expected Timeline:**
- Now - 4:30 PM: Test Points Table + monitor Tab 2
- 4:30 PM - 5:00 PM: Close Tab 2, run remaining scripts
- 5:00 PM - 5:30 PM: Documentation and wrap-up

---

**Next Step:** User checks Tab 2 status and reports back.
