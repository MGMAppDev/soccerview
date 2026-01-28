# Feature Specification: League Standings - Points Table

> **Version:** 1.0
> **Created:** January 25, 2026
> **Target Release:** V1.1
> **Priority:** HIGH (Competitor's #1 Requested Feature)

---

## Executive Summary

### The Problem
Users cannot see traditional points-based league standings. The current League screen (`app/league/[eventId].tsx`) shows teams ranked by **SoccerView Power Rating (ELO)**, which is useful but NOT what parents/coaches expect when viewing league standings.

**Competitor User Feedback:**
- ❌ "I just want to see where my team stands in the league table"
- ❌ "Your ELO ranking is cool but not what coaches use"
- ❌ "Need traditional standings with points and goal difference"
- ❌ "Can't find the real league table anywhere"

### The Solution
Add a **Points Table** tab alongside the existing **Power Ratings** tab on the League screen. This gives users BOTH:
1. ✅ Traditional points-based standings (what they expect)
2. ✅ SoccerView Power Rating (our competitive advantage)

### Competitive Advantage
- **GotSport has standings:** But with TERRIBLE UX (slow, hard to navigate, ugly interface)
- **SoccerView will have:** Beautiful, modern, fast standings with superior mobile UX

---

## User Stories

### Primary User Stories

**US-1: View Traditional League Standings**
- **As a** soccer parent
- **I want to** see my team's position in the league table with points, wins, losses, and goal difference
- **So that** I can understand how my team is performing relative to others in traditional soccer terms

**US-2: Toggle Between Points and Power Ratings**
- **As a** coach
- **I want to** switch between traditional points table and ELO-based power ratings
- **So that** I can see both traditional standings and advanced analytics

**US-3: View Recent Form**
- **As a** fan
- **I want to** see each team's recent match results (W-D-L)
- **So that** I can understand which teams are trending up or down

**US-4: Filter Standings by Division**
- **As a** parent with kids in different age groups
- **I want to** filter standings by age group and gender
- **So that** I can quickly find relevant divisions

**US-5: Navigate to Team Details**
- **As a** user
- **I want to** tap a team row in the standings
- **So that** I can view full team details, roster, and match history

### Secondary User Stories

**US-6: Understand Tiebreaker Rules**
- **As a** competitive coach
- **I want to** see why teams with the same points are ranked differently
- **So that** I understand playoff qualification or seeding

**US-7: View Head-to-Head Record**
- **As a** parent
- **I want to** see how my team performed against a specific opponent
- **So that** I can gauge relative strength

---

## Database Design

### Option 1: Calculated On-the-Fly (RECOMMENDED)

**Advantages:**
- ✅ No schema changes required
- ✅ Always up-to-date (no stale data)
- ✅ No storage overhead
- ✅ Easier to maintain

**Disadvantages:**
- ⚠️ Slightly slower for large leagues (acceptable with proper indexing)

**Implementation:**
```sql
-- Example query to calculate standings
WITH event_matches AS (
  SELECT
    mr.id,
    mr.home_team_id,
    mr.away_team_id,
    mr.home_score,
    mr.away_score,
    mr.match_date
  FROM match_results mr
  WHERE mr.event_id = $1  -- Filter by event
    AND mr.home_team_id IS NOT NULL
    AND mr.away_team_id IS NOT NULL
    AND mr.home_score IS NOT NULL
    AND mr.away_score IS NOT NULL
),
team_stats AS (
  -- Home team stats
  SELECT
    home_team_id AS team_id,
    COUNT(*) AS gp,
    SUM(CASE WHEN home_score > away_score THEN 1 ELSE 0 END) AS wins,
    SUM(CASE WHEN home_score = away_score THEN 1 ELSE 0 END) AS draws,
    SUM(CASE WHEN home_score < away_score THEN 1 ELSE 0 END) AS losses,
    SUM(home_score) AS gf,
    SUM(away_score) AS ga,
    SUM(CASE
      WHEN home_score > away_score THEN 3
      WHEN home_score = away_score THEN 1
      ELSE 0
    END) AS points
  FROM event_matches
  GROUP BY home_team_id

  UNION ALL

  -- Away team stats
  SELECT
    away_team_id AS team_id,
    COUNT(*) AS gp,
    SUM(CASE WHEN away_score > home_score THEN 1 ELSE 0 END) AS wins,
    SUM(CASE WHEN away_score = home_score THEN 1 ELSE 0 END) AS draws,
    SUM(CASE WHEN away_score < home_score THEN 1 ELSE 0 END) AS losses,
    SUM(away_score) AS gf,
    SUM(home_score) AS ga,
    SUM(CASE
      WHEN away_score > home_score THEN 3
      WHEN away_score = home_score THEN 1
      ELSE 0
    END) AS points
  FROM event_matches
  GROUP BY away_team_id
)
SELECT
  t.id,
  t.name,
  t.club_name,
  t.age_group,
  t.gender,
  SUM(ts.gp) AS games_played,
  SUM(ts.wins) AS wins,
  SUM(ts.draws) AS draws,
  SUM(ts.losses) AS losses,
  SUM(ts.gf) AS goals_for,
  SUM(ts.ga) AS goals_against,
  SUM(ts.gf) - SUM(ts.ga) AS goal_difference,
  SUM(ts.points) AS points,
  ROW_NUMBER() OVER (
    ORDER BY
      SUM(ts.points) DESC,           -- 1st tiebreaker: Points
      SUM(ts.gf) - SUM(ts.ga) DESC,  -- 2nd tiebreaker: Goal Difference
      SUM(ts.gf) DESC                -- 3rd tiebreaker: Goals For
  ) AS position
FROM team_stats ts
JOIN teams t ON t.id = ts.team_id
WHERE t.age_group = $2  -- Optional filter by age group
  AND t.gender = $3     -- Optional filter by gender
GROUP BY t.id, t.name, t.club_name, t.age_group, t.gender
ORDER BY position;
```

### Option 2: Materialized View (Future Optimization)

**When to Use:**
- Only if performance becomes an issue (>500ms query time)
- For leagues with 100+ teams
- High traffic scenarios

**Schema:**
```sql
CREATE MATERIALIZED VIEW league_standings AS
  -- Same query as above
WITH REFRESH ON DEMAND;

-- Refresh after match imports
REFRESH MATERIALIZED VIEW league_standings;
```

---

## API Design

### New Functions in `lib/leagues.ts`

```typescript
/**
 * Get points-based league standings for an event
 * @param eventId - Event ID to get standings for
 * @param filters - Optional filters (age group, gender)
 * @returns Array of teams with points table stats
 */
export async function getLeaguePointsTable(
  eventId: string,
  filters?: { ageGroup?: string; gender?: string }
): Promise<LeaguePointsTableTeam[]>;

/**
 * Get recent form (last 5 matches) for teams in an event
 * @param eventId - Event ID
 * @param teamIds - Array of team IDs
 * @returns Map of team ID to form array (e.g., ['W', 'D', 'L', 'W', 'W'])
 */
export async function getTeamsForm(
  eventId: string,
  teamIds: string[]
): Promise<Map<string, FormResult[]>>;

/**
 * Get head-to-head record between two teams in an event
 * @param eventId - Event ID
 * @param teamId1 - First team ID
 * @param teamId2 - Second team ID
 * @returns Head-to-head stats
 */
export async function getHeadToHead(
  eventId: string,
  teamId1: string,
  teamId2: string
): Promise<HeadToHeadStats>;
```

### TypeScript Interfaces

```typescript
export interface LeaguePointsTableTeam {
  id: string;
  name: string;
  club_name: string | null;
  age_group: string | null;
  gender: string | null;
  position: number;              // Rank in table
  games_played: number;          // GP
  wins: number;                  // W
  draws: number;                 // D
  losses: number;                // L
  goals_for: number;             // GF
  goals_against: number;         // GA
  goal_difference: number;       // GD
  points: number;                // Pts
  form: FormResult[];            // Last 5 matches: ['W', 'D', 'L', 'W', 'W']

  // Optional advanced stats
  elo_rating?: number;           // Link to Power Rating
  elo_national_rank?: number;
}

export type FormResult = 'W' | 'D' | 'L';

export interface HeadToHeadStats {
  team1_wins: number;
  team2_wins: number;
  draws: number;
  team1_goals: number;
  team2_goals: number;
  matches: {
    id: string;
    date: string;
    team1_score: number;
    team2_score: number;
    result: 'W' | 'D' | 'L';  // From team1 perspective
  }[];
}
```

---

## UI/UX Design

### Screen Layout (app/league/[eventId].tsx)

```
┌─────────────────────────────────────┐
│  ← Standings                        │  ← Header (unchanged)
├─────────────────────────────────────┤
│  🏆 League                          │
│  Spring 2025 KC Youth League        │  ← Event info (unchanged)
│  42 Teams · 210 Matches             │
├─────────────────────────────────────┤
│  ┌───────────┐ ┌───────────┐       │
│  │ Points    │ │ Power     │       │  ← NEW: Toggle tabs
│  │ Table     │ │ Ratings   │       │
│  └───────────┘ └───────────┘       │
├─────────────────────────────────────┤
│  All  Boys  Girls  │ U15 U16 U17   │  ← Filters (unchanged)
├─────────────────────────────────────┤
│                                     │
│  ╔═══╦═════════════╦════╦═══╦═════╗│
│  ║ # ║ Team        ║ GP ║...║ Pts ║│  ← NEW: Points Table
│  ╠═══╬═════════════╬════╬═══╬═════╣│
│  ║ 1 ║ Team A      ║ 10 ║...║ 28  ║│
│  ║   ║ WWDWW       ║    ║   ║     ║│  ← Form indicator
│  ╠═══╬═════════════╬════╬═══╬═════╣│
│  ║ 2 ║ Team B      ║ 10 ║...║ 25  ║│
│  ║   ║ WLWWW       ║    ║   ║     ║│
│  ╚═══╩═════════════╩════╩═══╩═════╝│
│                                     │
└─────────────────────────────────────┘
```

### Team Row Design (Mobile-Optimized)

**Option A: Compact Row (Default)**
```
┌─────────────────────────────────────┐
│  🏆1  Sporting KC 09 Boys        28 │ ← Position, Team, Points
│       10 GP · 9W-1D-0L · +24 GD     │ ← Stats row
│       ✅✅⚪✅✅                      │ ← Form (last 5)
└─────────────────────────────────────┘
```

**Option B: Detailed Table (Swipe Left to Reveal)**
```
┌────────────────────────────────────────────────┐
│  #  Team Name         GP  W  D  L  GF GA  Pts │
│  1  Sporting KC 09B   10  9  1  0  32  8   28 │
│     ✅✅⚪✅✅                                   │
└────────────────────────────────────────────────┘
```

**Recommended: Option A (Better Mobile UX)**
- Easier to scan on small screens
- Aligns with SoccerView's modern design
- Details available on team page

### Form Indicator Design

```typescript
// Color coding for form badges
const FORM_COLORS = {
  W: '#22C55E',  // Green (win)
  D: '#8E8E93',  // Gray (draw)
  L: '#EF4444',  // Red (loss)
};

// Visual representation
✅ W (Win)   - Green checkmark badge
⚪ D (Draw)  - Gray circle badge
❌ L (Loss)  - Red X badge
```

### Tiebreaker Indicator

When teams have identical points:
```
┌─────────────────────────────────────┐
│  4  Team X              18 pts      │
│  5  Team Y              18 pts ⓘ    │ ← Info icon for tiebreaker
│  6  Team Z              18 pts      │
└─────────────────────────────────────┘

Tap ⓘ → Shows tiebreaker explanation:
"Team Y ranked higher due to:
 • Better goal difference (+8 vs +6)
 • Head-to-head: Won 2-1 vs Team Z"
```

---

## Points Calculation Logic

### Standard Soccer Points System

| Result | Points | Notes |
|--------|--------|-------|
| Win | 3 | Team scored more goals than opponent |
| Draw | 1 | Both teams scored equal goals |
| Loss | 0 | Team scored fewer goals than opponent |

### Edge Cases

**Forfeits:**
- Awarded as 3-0 win (3 points, +3 GD)
- Opponent gets 0 points, -3 GD
- **Data indicator:** `match_results.forfeit = true` (future column)

**Abandoned Matches:**
- Not counted in standings
- **Data indicator:** `match_results.status = 'abandoned'` (future column)

**Bonus Points (Some Leagues):**
- Some leagues award bonus points for:
  - Scoring 3+ goals (+1 bonus)
  - Winning by 3+ goals (+1 bonus)
- **Implementation:** Store league rules in `event_registry.rules` JSON column
- **V1.0:** Use standard 3-1-0 system only
- **V1.1:** Add league-specific bonus rules

### Tiebreaker Rules (Standard FIFA/USSF)

Order of precedence when teams have equal points:

1. **Points** - Total points earned
2. **Goal Difference (GD)** - Goals For minus Goals Against
3. **Goals For (GF)** - Total goals scored
4. **Head-to-Head Points** - Points earned in matches between tied teams
5. **Head-to-Head Goal Difference** - GD in matches between tied teams
6. **Head-to-Head Goals For** - GF in matches between tied teams
7. **Fair Play** - Yellow/red card count (future enhancement)
8. **Drawing of Lots** - Random tiebreaker (manual only)

**V1.0 Implementation:**
- Use tiebreakers 1-3 (Points, GD, GF)
- Display "Tied on points" indicator for teams with same points

**V1.1 Enhancement:**
- Calculate head-to-head records (tiebreakers 4-6)
- Display tiebreaker explanation on tap

---

## Form Calculation Logic

### Recent Form (Last 5 Matches)

**Definition:** Results of the last 5 matches played **within this event**, ordered chronologically (oldest → newest).

**Query:**
```sql
WITH team_matches AS (
  SELECT
    CASE
      WHEN home_team_id = $1 THEN away_team_id
      ELSE home_team_id
    END AS opponent_id,
    CASE
      WHEN home_team_id = $1 AND home_score > away_score THEN 'W'
      WHEN home_team_id = $1 AND home_score < away_score THEN 'L'
      WHEN away_team_id = $1 AND away_score > home_score THEN 'W'
      WHEN away_team_id = $1 AND away_score < home_score THEN 'L'
      ELSE 'D'
    END AS result,
    match_date
  FROM match_results
  WHERE event_id = $2
    AND (home_team_id = $1 OR away_team_id = $1)
    AND home_score IS NOT NULL
    AND away_score IS NOT NULL
  ORDER BY match_date DESC
  LIMIT 5
)
SELECT array_agg(result ORDER BY match_date ASC) AS form
FROM team_matches;
```

**Display:**
```
✅✅⚪✅✅  → W-W-D-W-W (5 matches, great form!)
❌⚪⚪✅✅  → L-D-D-W-W (4 wins last 2, improving)
✅         → W (Only 1 match played)
-          → No matches yet
```

---

## Implementation Plan

### Phase 1: Database Layer (2-3 hours)

**Tasks:**
1. ✅ Add `getLeaguePointsTable()` function to `lib/leagues.ts`
   - Write SQL query for points calculation
   - Add filtering (age group, gender)
   - Return `LeaguePointsTableTeam[]` array
2. ✅ Add `getTeamsForm()` function to `lib/leagues.ts`
   - Batch query for form data
   - Return map of team ID → form array
3. ✅ Create TypeScript interfaces
   - `LeaguePointsTableTeam`
   - `FormResult`
   - `HeadToHeadStats` (future)
4. ✅ Add database indexes (if needed)
   ```sql
   -- If not already indexed
   CREATE INDEX IF NOT EXISTS idx_match_results_event_teams
   ON match_results(event_id, home_team_id, away_team_id);
   ```

**Testing:**
```bash
# Test query performance
node scripts/testLeagueStandingsQuery.js

# Expected output:
# ✅ Query executed in 45ms
# ✅ 42 teams returned
# ✅ Points totals correct
# ✅ Tiebreakers applied correctly
```

### Phase 2: UI/UX Layer (3-4 hours)

**Tasks:**
1. ✅ Update `app/league/[eventId].tsx`
   - Add state for active view: `'points' | 'power'`
   - Add toggle buttons (Points Table | Power Ratings)
   - Keep existing filters
2. ✅ Create `renderPointsTableRow()` function
   - Display: Position, Team, GP, W-D-L, GF-GA, GD, Pts
   - Add form indicator below stats
   - Add trophy icon for top 3
   - Highlight user's team (future: requires user auth)
3. ✅ Add form badge component
   - Green checkmark for W
   - Gray circle for D
   - Red X for L
   - Display last 5 horizontally
4. ✅ Add haptic feedback
   - Tab switch
   - Team row tap
5. ✅ Add loading/empty states
   - "Calculating standings..."
   - "No matches played yet"

**Visual Polish:**
- Match SoccerView design system colors
- Use existing card styles
- Smooth tab transitions
- Pull-to-refresh support

### Phase 3: Testing & QA (1-2 hours)

**Test Cases:**

| Test | Input | Expected Output |
|------|-------|-----------------|
| Points calculation | 3 wins, 1 draw, 1 loss | 10 points |
| Goal difference | 15 GF, 8 GA | +7 GD |
| Tiebreaker (GD) | Team A: 12 pts (+5 GD), Team B: 12 pts (+3 GD) | Team A ranked higher |
| Tiebreaker (GF) | Team A: 12 pts (+5 GD, 18 GF), Team B: 12 pts (+5 GD, 16 GF) | Team A ranked higher |
| Form calculation | Last 5 matches: W-L-W-W-D | ✅❌✅✅⚪ |
| Empty league | Event with 0 matches | "No matches played yet" |
| Filter by age group | Select "U15" | Only U15 teams shown |
| Filter by gender | Select "Boys" | Only boys teams shown |

**Edge Case Testing:**
- League with 1 team (solo team shows #1)
- League with 100+ teams (scroll performance)
- Team with 0 matches played (0 pts, 0 GF, 0 GA)
- All teams tied on points (tiebreakers applied)

**Performance Testing:**
- Query time < 500ms for leagues with 50+ teams
- Scroll smoothness at 60fps
- Tab switch < 100ms

### Phase 4: Documentation (30 min)

**Update Files:**
1. ✅ `CLAUDE.md` - Document new feature
2. ✅ `lib/leagues.ts` - JSDoc comments
3. ✅ `app/league/[eventId].tsx` - Code comments
4. ✅ Create this spec document

---

## Success Metrics

### User Engagement Metrics

| Metric | Baseline | Target (3 months) |
|--------|----------|-------------------|
| League page views | [TBD] | +50% |
| Avg. time on League page | [TBD] | +30% |
| Tab switch rate (Points ↔ Power) | N/A | 60%+ users try both |
| Team detail taps from standings | [TBD] | +40% |

### User Satisfaction Metrics

| Metric | Target |
|--------|--------|
| App Store reviews mentioning "standings" | 10+ positive mentions |
| Feature request for standings | 0 (feature now exists!) |
| User complaints about standings UX | <5% of feedback |

### Technical Performance Metrics

| Metric | Target |
|--------|--------|
| Query execution time | <500ms (p95) |
| League page load time | <1.5s (p95) |
| Points calculation accuracy | 100% |
| Zero downtime during rollout | ✅ |

---

## Future Enhancements (V1.2+)

### V1.2: Advanced Tiebreakers
- **Head-to-Head Records** - Calculate points/GD/GF in matches between tied teams
- **Tiebreaker Explanation Modal** - Tap info icon to see why teams are ranked
- **Fair Play Points** - Yellow/red card tracking (requires match event data)

### V1.3: Bonus Points
- **League-Specific Rules** - Store in `event_registry.rules` JSON
- **Configurable Bonuses** - 3+ goals, clean sheets, etc.
- **Custom Point Systems** - Support 2-1-0 or other systems

### V1.4: Historical Standings
- **Standings Over Time** - See how teams moved up/down during season
- **Standings Animation** - Animated transitions between match days
- **Form Chart** - Graph of points accumulation over time

### V1.5: Playoff Scenarios
- **Playoff Calculator** - "What if we win our next 3 matches?"
- **Qualification Tracker** - "Need 6 points to qualify for playoffs"
- **Seeding Preview** - "Currently seeded #3 for tournament"

---

## Appendix: Research & References

### Competitor Analysis

**GotSport Standings:**
- ✅ Shows traditional points table
- ✅ Includes GF, GA, GD, Pts
- ❌ Ugly, outdated UI
- ❌ Slow page loads
- ❌ Poor mobile experience
- ❌ No form indicator
- ❌ Hard to filter/navigate

**LeagueApps Standings:**
- ✅ Clean, modern UI
- ✅ Good mobile experience
- ❌ Limited to specific leagues
- ❌ No power ratings
- ❌ No advanced analytics

**SoccerView Opportunity:**
- ✅ Best mobile UX
- ✅ Fastest performance
- ✅ BOTH traditional + advanced (ELO)
- ✅ National coverage (all leagues)
- ✅ Modern design

### User Research

**Top 10 User Requests (from competitor reviews):**
1. **League Standings** ← THIS FEATURE
2. Tournament brackets
3. Player stats
4. Team rosters
5. Schedule/calendar view
6. Push notifications
7. Live scores
8. Video highlights
9. Referee assignments
10. Field maps

**Quotes from Users:**
> "Just give me a simple league table like every other soccer app!"
> — Parent, GotSport review (1 star)

> "Can't believe there's no standings. That's literally the first thing I look for."
> — Coach, GotSport review (2 stars)

> "Love the rankings but where's the actual league table?"
> — Parent, SoccerView beta tester

---

## Sign-Off

**Stakeholders:**
- [ ] Product Owner - Approved
- [ ] Engineering Lead - Approved
- [ ] Design Lead - Approved
- [ ] QA Lead - Approved

**Ready for Implementation:** ⬜ YES / ⬜ NO

---

**Document Version:** 1.0
**Last Updated:** January 25, 2026
**Author:** Claude AI (SoccerView SME)
**Status:** DRAFT - Awaiting Review
