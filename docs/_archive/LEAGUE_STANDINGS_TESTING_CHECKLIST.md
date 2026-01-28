# League Standings Feature - Testing Checklist

> **Created:** January 25, 2026 3:45 PM
> **Test After:** 4:15 PM (when fastLinkV3Parallel.js completes)
> **Feature:** Points Table Implementation

---

## Pre-Testing Verification

- [ ] Verify linking process completed successfully
- [ ] Check database for updated `home_team_id` and `away_team_id` in match_results
- [ ] Confirm no errors in linking output

---

## Database Layer Tests

### Test 1: getLeaguePointsTable() Query
```bash
# Run in Node.js or Supabase SQL editor
SELECT event_id, event_name FROM event_registry WHERE source_type = 'league' LIMIT 1;
# Use event_id in app to test
```

**Expected Results:**
- [ ] Query executes in < 500ms for leagues with 50+ teams
- [ ] Returns array of LeaguePointsTableTeam objects
- [ ] Points calculation is correct: Win=3, Draw=1, Loss=0
- [ ] Tiebreakers applied correctly: Points → GD → GF
- [ ] Position field numbered correctly (1, 2, 3, ...)

### Test 2: getTeamsForm() Query

**Expected Results:**
- [ ] Returns Map<string, FormResult[]>
- [ ] Form arrays have max 5 elements
- [ ] Form results ordered chronologically (oldest → newest)
- [ ] W/D/L values correct based on match scores

---

## UI Layer Tests

### Test 3: Points Table Display

**Test Data:** Use a known league (e.g., Heartland league event)

**Expected Results:**
- [ ] Toggle buttons render correctly
- [ ] "Points Table" button active by default
- [ ] Tap "Power Ratings" switches view smoothly
- [ ] Tap "Points Table" switches back smoothly
- [ ] Haptic feedback on toggle tap

### Test 4: Points Table Row Rendering

**Expected Results:**
- [ ] Position (rank) displays correctly
- [ ] Trophy icons for top 3 positions
- [ ] Team name and club name display
- [ ] Stats row shows: "GP · W-D-L · GD"
- [ ] GD shown as +/- with color coding (green for positive, red for negative)
- [ ] Points value displays prominently on right
- [ ] Chevron icon present for navigation

### Test 5: Form Indicator Badges

**Expected Results:**
- [ ] Form badges render below stats row
- [ ] W = Green checkmark (✅)
- [ ] D = Gray circle (⚪)
- [ ] L = Red X (❌)
- [ ] Max 5 badges displayed
- [ ] Badges ordered left-to-right (oldest → newest)
- [ ] Teams with < 5 matches show fewer badges

### Test 6: Filters

**Expected Results:**
- [ ] Gender filter works (All, Boys, Girls)
- [ ] Age group filter works (All, U15, U16, etc.)
- [ ] Filters apply to both Points Table and Power Ratings
- [ ] Filtered results re-calculate positions correctly

### Test 7: Empty States

**Expected Results:**
- [ ] "No standings available" message when no completed matches
- [ ] "No teams found" when filters eliminate all teams
- [ ] Appropriate icons display in empty states

### Test 8: Navigation

**Expected Results:**
- [ ] Tap team row navigates to Team Detail screen
- [ ] Haptic feedback on team tap
- [ ] Back button returns to league screen
- [ ] Scroll position preserved on back navigation

---

## Edge Case Tests

### Test 9: Tiebreaker Scenarios

**Setup:** Find league where multiple teams have same points

**Expected Results:**
- [ ] Teams with equal points sorted by GD
- [ ] Teams with equal points and GD sorted by GF
- [ ] Teams with equal points, GD, and GF sorted alphabetically

### Test 10: Large Leagues

**Setup:** Test with league containing 50+ teams

**Expected Results:**
- [ ] Query executes in < 500ms
- [ ] Scroll performance smooth at 60fps
- [ ] No lag when toggling between views

### Test 11: No Matches Played

**Setup:** Find event with 0 completed matches

**Expected Results:**
- [ ] Points Table shows empty state
- [ ] Power Ratings shows empty state or teams with 0 matches
- [ ] No errors in console

### Test 12: Single Team League

**Expected Results:**
- [ ] Team shows as #1 position
- [ ] All stats display correctly
- [ ] No rendering errors

---

## Performance Tests

### Test 13: Query Performance

**Target:** < 500ms for p95 queries

**Test Events:**
- Small league (< 20 teams)
- Medium league (20-50 teams)
- Large league (50+ teams)

**Measure:**
- [ ] getLeaguePointsTable() execution time
- [ ] getTeamsForm() execution time
- [ ] Total page load time

### Test 14: UI Performance

**Target:** 60fps scroll, < 100ms toggle

**Measure:**
- [ ] Scroll frame rate in large league
- [ ] Toggle switch animation smoothness
- [ ] Filter application speed

---

## Integration Tests

### Test 15: Multi-Tab Experience

**Expected Results:**
- [ ] Switch between Standings and Matches tabs
- [ ] Data persists when returning to Standings tab
- [ ] Selected view (Points/Power) remembered during session
- [ ] Filters persist across tab switches

### Test 16: Pull-to-Refresh

**Expected Results:**
- [ ] Pull-to-refresh reloads both Points Table and Power Ratings
- [ ] Haptic feedback on refresh start
- [ ] Loading indicator displays
- [ ] Data updates correctly

---

## Data Accuracy Tests

### Test 17: Points Calculation

**Manual Verification:**
1. Pick a team from Points Table
2. Navigate to Team Detail
3. Count wins/draws/losses in league matches
4. Calculate: (Wins × 3) + (Draws × 1) = Points
5. Verify matches Points Table value

**Expected Results:**
- [ ] Points calculation 100% accurate

### Test 18: Goal Difference

**Manual Verification:**
1. Pick a team from Points Table
2. Sum goals scored (GF) and goals conceded (GA) from matches
3. Calculate: GF - GA = GD
4. Verify matches Points Table GD value

**Expected Results:**
- [ ] GD calculation 100% accurate

### Test 19: Form Accuracy

**Manual Verification:**
1. Pick a team with 5+ matches
2. Check last 5 match results on Team Detail
3. Map to W/D/L
4. Verify matches form badges in Points Table

**Expected Results:**
- [ ] Form badges 100% accurate
- [ ] Ordered correctly (chronological)

---

## Cross-Platform Tests

### Test 20: iOS Display

**Expected Results:**
- [ ] All text readable and properly sized
- [ ] Badges render correctly
- [ ] Colors match design system
- [ ] Safe area insets respected

### Test 21: Android Display

**Expected Results:**
- [ ] All text readable and properly sized
- [ ] Badges render correctly
- [ ] Colors match design system
- [ ] Navigation bar handled correctly

---

## Accessibility Tests

### Test 22: Text Contrast

**Expected Results:**
- [ ] All text meets WCAG AA contrast ratio (4.5:1)
- [ ] Color-coded elements have non-color indicators (icons)

### Test 23: Touch Targets

**Expected Results:**
- [ ] All tap targets minimum 44x44 pts
- [ ] Toggle buttons easily tappable
- [ ] Team rows easily tappable

---

## Regression Tests

### Test 24: Power Ratings View

**Expected Results:**
- [ ] Power Ratings view still works correctly
- [ ] ELO ratings display
- [ ] W-L-D records display
- [ ] National ranks display

### Test 25: Matches Tab

**Expected Results:**
- [ ] Matches tab unaffected by changes
- [ ] Match cards render correctly
- [ ] Filters still work

---

## Sign-Off Checklist

After all tests pass:

- [ ] Update CLAUDE.md with feature completion
- [ ] Update SESSION_41_ACTION_PLAN.md
- [ ] Mark feature as COMPLETE in FEATURE_SPEC_LEAGUE_STANDINGS.md
- [ ] Commit changes with descriptive message
- [ ] Test on physical device (not just simulator)

---

## Known Issues to Monitor

Document any issues found during testing:

1.
2.
3.

---

## Performance Benchmarks

Record actual performance metrics:

| Metric | Target | Actual | Pass/Fail |
|--------|--------|--------|-----------|
| Query time (small league) | < 100ms | ___ ms | ___ |
| Query time (medium league) | < 300ms | ___ ms | ___ |
| Query time (large league) | < 500ms | ___ ms | ___ |
| Toggle switch speed | < 100ms | ___ ms | ___ |
| Scroll FPS | 60fps | ___ fps | ___ |

---

**Tester:** _______________
**Date:** _______________
**Time:** _______________
**Platform:** iOS / Android
**Device:** _______________
**Build:** _______________
