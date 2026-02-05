# SoccerView UI Patterns & Standards

> **Version 1.9** | Last Updated: February 5, 2026 | Session 90 (Match Tap Navigation Fix)
>
> Universal UI patterns that must be applied consistently across ALL screens.

---

## Design System

### Colors

| Element | Color | Hex | Usage |
|---------|-------|-----|-------|
| Background | Black | `#000000` | Main app background |
| Card Background | Dark Gray | `#111111` | Cards and containers |
| Primary Blue | Blue | `#3B82F6` | SoccerView Power Rating, links, interactive |
| Amber/Gold | Amber | `#F59E0B` | Official Rankings, awards, achievements |
| Success Green | Green | `#10B981` | Success states, wins |
| Error Red | Red | `#EF4444` | Errors, losses |
| Muted Text | Gray | `#9CA3AF` | Secondary text |
| Border | Dark Gray | `#374151` | Subtle borders |

### Typography

| Element | Size | Weight | Color |
|---------|------|--------|-------|
| Page Title | 28 | Bold | White |
| Section Header | 20 | Semi-bold | White |
| Card Title | 18 | Semi-bold | White |
| Body Text | 16 | Regular | White |
| Secondary Text | 14 | Regular | Muted |
| Small/Caption | 12 | Regular | Muted |

---

## Mandatory Patterns

### 1. Team Names - NEVER Truncate

**CRITICAL:** Team names must always be fully visible.

```typescript
// ❌ WRONG - Truncates team name
<Text style={styles.teamName} numberOfLines={2}>{team.name}</Text>

// ✅ CORRECT - Full team name visible
<Text style={styles.teamName}>{team.name}</Text>
```

**Why:**
- Youth soccer team names are long (e.g., "Sporting Blue Valley SPORTING BV Pre-NAL 15 (U11 Boys)")
- Parents need full name to identify their team
- Cards should expand vertically to accommodate

**Applies to:**
- League Standings page
- Rankings tab
- Teams tab
- Team detail page
- Match cards
- Any component displaying team names

**Exceptions:**
- Event/tournament names (not team-specific)
- Location/venue text
- Very narrow elements (use tooltip instead)

---

### 2. Keyboard-Aware Search Bars

When a screen has a search bar with filters:

```typescript
// 1. Import required modules
import { KeyboardAvoidingView, Platform } from "react-native";
import { useAnimatedKeyboard, interpolate, useAnimatedStyle } from "react-native-reanimated";

// 2. Add keyboard animation hook
const keyboard = useAnimatedKeyboard();

const keyboardAwareStyle = useAnimatedStyle(() => {
  if (Platform.OS !== 'ios') return {};
  return {
    paddingBottom: interpolate(
      keyboard.height.value,
      [0, 300],
      [0, 100],
    ),
  };
});

// 3. Structure
<SafeAreaView style={styles.container} edges={["top"]}>
  <KeyboardAvoidingView
    style={styles.keyboardAvoidingContainer}
    behavior={Platform.OS === "ios" ? "padding" : undefined}
  >
    {/* Fixed header */}
    <View style={styles.header}>...</View>

    {/* Sticky search - apply keyboardAwareStyle */}
    <Animated.View style={[styles.stickyHeaderContainer, keyboardAwareStyle]}>
      {/* Search bar and filters */}
    </Animated.View>

    {/* List with keyboard handling */}
    <FlatList
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      ...
    />
  </KeyboardAvoidingView>
</SafeAreaView>
```

**Behaviors:**
- Search bar stays visible when keyboard opens
- Smooth spring animation
- Tap outside dismisses keyboard
- Dragging list dismisses keyboard

---

### 3. Selective Keyboard Collapse

For screens with multiple inputs, only collapse filters when SEARCH BAR is focused:

```typescript
// Track which input triggered keyboard
const searchBarFocusedRef = useRef(false);

// Keyboard listeners
const showSubscription = Keyboard.addListener(showEvent, () => {
  if (searchBarFocusedRef.current) {
    filterHeight.value = withSpring(0, SPRING_CONFIG);
    setFiltersVisible(false);
  }
});

// Search bar
<TextInput
  onFocus={() => {
    searchBarFocusedRef.current = true;
    filterHeight.value = withSpring(0, SPRING_CONFIG);
    setFiltersVisible(false);
  }}
  onBlur={() => {
    searchBarFocusedRef.current = false;
  }}
  ...
/>

// State picker (separate input - doesn't collapse filters)
<TextInput
  // No need to set searchBarFocusedRef
  ...
/>
```

---

### 4. Dynamic Filter Height

Measure filter content height dynamically:

```typescript
// JS thread ref + UI thread shared value
const measuredHeightRef = useRef(260);
const maxHeightShared = useSharedValue(260);

// Measure on layout
<View onLayout={(e) => {
  const newHeight = e.nativeEvent.layout.height;
  if (newHeight > 0 && newHeight !== measuredHeightRef.current) {
    measuredHeightRef.current = newHeight;
    maxHeightShared.value = newHeight;
  }
}}>
  {/* Filter content */}
</View>

// Use in animation
const toggleFilters = () => {
  if (filtersVisible) {
    filterHeight.value = withSpring(0, SPRING_CONFIG);
  } else {
    filterHeight.value = withSpring(maxHeightShared.value, SPRING_CONFIG);
  }
  setFiltersVisible(!filtersVisible);
};
```

---

### 5. Type-Ahead State Picker

For state selection, use type-ahead with wrapping chips:

```typescript
// State
const [stateInput, setStateInput] = useState("");
const [selectedStates, setSelectedStates] = useState<string[]>([]);

// Filter suggestions
const stateSuggestions = US_STATES.filter(s =>
  s.toLowerCase().includes(stateInput.toLowerCase()) &&
  !selectedStates.includes(s)
).slice(0, 5);

// Render selected as chips
<View style={styles.selectedChipsContainer}>
  {selectedStates.map(state => (
    <TouchableOpacity
      key={state}
      style={styles.selectedChip}
      onPress={() => removeState(state)}
    >
      <Text style={styles.chipText}>{state}</Text>
      <Ionicons name="close-circle" size={14} color="#fff" />
    </TouchableOpacity>
  ))}
</View>

// Horizontal suggestions
<ScrollView horizontal showsHorizontalScrollIndicator={false}>
  {stateSuggestions.map(state => (
    <TouchableOpacity
      key={state}
      style={styles.suggestion}
      onPress={() => addState(state)}
    >
      <Text>{state}</Text>
    </TouchableOpacity>
  ))}
</ScrollView>
```

---

### 6. Collapsible Filters (Twitter/X Style)

Use spring animation for filter expand/collapse:

```typescript
const SPRING_CONFIG = {
  damping: 20,
  stiffness: 200,
  mass: 0.5,
};

const filterHeight = useSharedValue(0);

const animatedFilterStyle = useAnimatedStyle(() => ({
  height: filterHeight.value,
  overflow: 'hidden',
}));

// Toggle
const toggleFilters = () => {
  filterHeight.value = withSpring(
    filtersVisible ? 0 : DEFAULT_FILTER_HEIGHT,
    SPRING_CONFIG
  );
  setFiltersVisible(!filtersVisible);
};
```

---

### 7. Shared MatchCard Component

Use the single source of truth component for all match displays:

```typescript
import { MatchCard, MatchCardData } from '@/components/MatchCard';

// Data shape
interface MatchCardData {
  id: string;
  match_date: string;
  home_team: { name: string; elo?: number };
  away_team: { name: string; elo?: number };
  home_score?: number;
  away_score?: number;
  event?: { name: string };
  division?: string;
}

// Usage
<MatchCard
  match={matchData}
  onPress={() => router.push(`/match/${match.id}`)}
/>
```

---

### 8. Pull-to-Refresh

All list screens must have pull-to-refresh:

```typescript
const [refreshing, setRefreshing] = useState(false);

const handleRefresh = async () => {
  setRefreshing(true);
  await fetchData();
  setRefreshing(false);
};

<FlatList
  refreshControl={
    <RefreshControl
      refreshing={refreshing}
      onRefresh={handleRefresh}
      tintColor="#3B82F6"
    />
  }
  ...
/>
```

---

### 9. Haptic Feedback

All tappable elements should provide haptic feedback:

```typescript
import * as Haptics from 'expo-haptics';

// Light feedback for buttons
<TouchableOpacity
  onPress={() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    handlePress();
  }}
>

// Medium for selections
Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

// Heavy for important actions
Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

// Notification for success/error
Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
```

---

### 10. Custom SVG Rank Chart

For ranking charts where lower = better (inverted Y-axis):

```typescript
// Don't use react-native-gifted-charts for inverted Y-axis!
// Use custom SVG instead:

const rankToY = (rank: number) => {
  const normalized = (rank - minRank) / (maxRank - minRank);
  return paddingTop + normalized * chartHeight;
};

// Build smooth curve path
let pathD = `M ${points[0].x} ${points[0].y}`;
for (let i = 1; i < points.length; i++) {
  const prev = points[i - 1];
  const curr = points[i];
  const cpX = (prev.x + curr.x) / 2;
  pathD += ` Q ${cpX} ${prev.y}, ${cpX} ${(prev.y + curr.y) / 2}`;
  pathD += ` Q ${cpX} ${curr.y}, ${curr.x} ${curr.y}`;
}
```

See [app/team/[id].tsx](../app/team/[id].tsx) for full implementation.

---

### 8. Stats Grid Layout (Session 67)

For 4 equal stat boxes on one row:

```typescript
statsGrid: {
  flexDirection: "row",
  justifyContent: "space-between",
  marginBottom: 24,
},
statBox: {
  width: "23%",  // Explicit percentage, NOT flex: 1
  backgroundColor: "#111",
  borderRadius: 12,
  paddingVertical: 14,
  alignItems: "center",
},
```

**Why explicit width:**
- `flex: 1` can cause wrapping issues on some devices
- `width: "23%"` guarantees 4 boxes fit with spacing

---

### 9. Custom Icons with Glow (Session 67)

For custom outlined icons with hue/glow effect:

```typescript
barChartIcon: {
  flexDirection: "row",
  alignItems: "flex-end",
  gap: 2,
  width: 22,
  height: 22,
  justifyContent: "center",
  shadowColor: "#f59e0b",
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0.6,
  shadowRadius: 4,
},
barChartBar: {
  width: 6,
  backgroundColor: "transparent",
  borderWidth: 1.5,
  borderColor: "#f59e0b",
  borderRadius: 2,
},
```

**Pattern:** Use `borderWidth` + `transparent` fill for outlined look. Add `shadowColor` matching the border for glow.

---

### 10. Icon Alignment in Headers (Session 67)

When aligning emoji icons with custom View-based icons:

```typescript
iconContainer: {
  width: 28,      // Slightly larger than icon
  height: 24,
  alignItems: "center",
  justifyContent: "center",
  marginRight: 2,  // Padding to prevent cutoff
},
```

**Why:** Emoji icons can vary in actual render width. Wrapping in fixed-width container ensures consistent alignment.

---

### 11. Consistent Help Icon Sizes

All help/info icons on a page must use the same size:

```typescript
// ✅ CORRECT - All 18px
<Ionicons name="help-circle-outline" size={18} color="#6b7280" />

// ❌ WRONG - Mixed sizes
<Ionicons name="help-circle-outline" size={20} color="#6b7280" />  // Header 1
<Ionicons name="help-circle-outline" size={18} color="#6b7280" />  // Header 2
```

---

### 12. Two-Level Chart Filters (Session 68)

For charts with multiple data sources and scopes, use segmented controls:

```typescript
// State
const [journeySource, setJourneySource] = useState<"sv" | "gs" | "both">("both");
const [journeyScope, setJourneyScope] = useState<"national" | "state">("national");

// Source segmented control
<View style={styles.sourceSegment}>
  <TouchableOpacity
    style={[styles.sourceSegmentBtn, journeySource === "sv" && styles.sourceSegmentBtnActiveSV]}
    onPress={() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setJourneySource("sv");
    }}
  >
    <Image source={require("../../assets/images/icon.png")} style={styles.sourceSegmentIcon} />
    <Text style={[styles.sourceSegmentText, journeySource === "sv" && styles.sourceSegmentTextActive]}>
      SV
    </Text>
  </TouchableOpacity>
  {/* Similar for GotSport and Both */}
</View>

// Scope toggle
<View style={styles.scopeToggle}>
  <TouchableOpacity
    style={[styles.scopeBtn, journeyScope === "national" && styles.scopeBtnActive]}
    onPress={() => setJourneyScope("national")}
  >
    <Text style={styles.scopeText}>National</Text>
  </TouchableOpacity>
  <TouchableOpacity
    style={[styles.scopeBtn, journeyScope === "state" && styles.scopeBtnActive]}
    onPress={() => setJourneyScope("state")}
  >
    <Text style={styles.scopeText}>State</Text>
  </TouchableOpacity>
</View>
```

**Styles:**
```typescript
sourceSegment: {
  flexDirection: "row",
  backgroundColor: "rgba(255,255,255,0.05)",
  borderRadius: 12,
  padding: 4,
},
sourceSegmentBtn: {
  flex: 1,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  paddingVertical: 10,
  borderRadius: 10,
  gap: 6,
},
sourceSegmentBtnActiveSV: { backgroundColor: "#3B82F6" },
sourceSegmentBtnActiveGS: { backgroundColor: "#f59e0b" },
sourceSegmentBtnActiveBoth: { backgroundColor: "#10b981" },
```

---

### 13. Chart Gradient Fills (Session 68)

Add subtle gradient fills under chart lines using `react-native-chart-kit`:

```typescript
<LineChart
  chartConfig={{
    // ... other config
    fillShadowGradient: "#f59e0b",      // Color matching line
    fillShadowGradientOpacity: 0.15,    // Subtle 15% opacity
  }}
  bezier
/>
```

**Recommended opacities:**
- Single source charts: 15% (`0.15`)
- Compare/overlay charts: 10% (`0.1`)

---

### 14. Scope-Aware Data Logic (Session 68)

When data has multiple scopes (national/state), use a helper function:

```typescript
const getGSRank = (h: RankHistoryPoint) =>
  journeyScope === "national" ? h.national_rank : h.state_rank;

// Filter valid points
const gsPoints = rankHistory.filter((p) => getGSRank(p) !== null);

// Build stats
const gsRanks = gsPoints.map((p) => getGSRank(p) as number);
const gsCurrent = gsRanks.length > 0 ? gsRanks[gsRanks.length - 1] : null;
const gsBest = gsRanks.length > 0 ? Math.min(...gsRanks) : null;
```

**Dynamic labels:**
```typescript
<Text style={styles.rankingStatLabel}>
  {journeyScope === "national" ? "National" : "State"}
</Text>
```

---

### 15. Chart Y-Axis with Rank Values (Session 68 QC)

For rank charts where "lower = better", invert values so up = better, and format Y-axis to show actual ranks:

```typescript
// 1. Get raw rank values
const rawRanks = sampled.map((p) => getSVRank(p) || 1);
const maxRank = Math.max(...rawRanks);
const minRank = Math.min(...rawRanks);

// 2. Invert: lower rank (better) becomes higher chart value
const data = rawRanks.map((r) => maxRank + minRank - r);

// 3. Format Y-axis to show actual rank values
<LineChart
  chartConfig={{
    // ... other config
    formatYLabel: (val) => `#${formatNumber(maxRank + minRank - Number(val))}`,
  }}
  withHorizontalLabels  // Shows Y-axis scale
/>
```

**Why this works:**
- `maxRank + minRank - r` inverts the value so #1 appears at top
- `formatYLabel` converts back to actual rank with `#` prefix
- Chart shows "Up = better rank" which matches user expectations

**Example:**
- Raw ranks: [3689, 3500, 3200]
- Inverted: [3200, 3389, 3689] (so 3200 plots higher)
- Y-axis labels: #3,200, #3,389, #3,689 (original values)

---

### 16. Chart Y-Axis Padding (Session 70)

For rank charts with large ranges, use **proportional padding** based on actual values, not range:

```typescript
// ❌ WRONG: Percentage of RANGE
// For range 304-3551, 10% = 325 → displayMin = max(1, 304-325) = 1
// This shows #1 on Y-axis even though best rank was #304!
const padding = Math.ceil(range * 0.1);
const displayMin = Math.max(1, minRank - padding);

// ✅ CORRECT: Percentage of actual VALUES
// For minRank 304, 10% = 30 → displayMin = 274
// Y-axis shows close to actual best rank
const topPadding = Math.max(Math.ceil(minRank * 0.1), 1);
const bottomPadding = Math.max(Math.ceil(maxRank * 0.1), 5);
const displayMin = Math.max(1, minRank - topPadding);
const displayMax = maxRank + bottomPadding;
```

**Why this matters:**
- Large ranges (3000+) with range-based padding show misleading #1 at top
- Value-based padding keeps Y-axis tight around actual data
- Users see meaningful scale reflecting team's actual rank range

---

## Preferred Libraries

| Category | Library | Why |
|----------|---------|-----|
| **Charts (Single Line)** | `react-native-gifted-charts` | Beautiful, handles edge cases |
| **Charts (Multi-Line Compare)** | `react-native-chart-kit` | Reliable multi-dataset rendering (Session 71) |
| **Charts (Inverted)** | Custom SVG | Required for rank charts |
| **Animations** | `react-native-reanimated` | 60fps native animations |
| **Gestures** | `react-native-gesture-handler` | Native gesture system |
| **Navigation** | `expo-router` | File-based routing |
| **Icons** | `@expo/vector-icons` | Comprehensive sets |
| **Haptics** | `expo-haptics` | Native feedback |

### Chart Library Selection (Session 71)

**When to use which chart library:**

| Use Case | Library | Example |
|----------|---------|---------|
| Single data series | `react-native-gifted-charts` | SoccerView rank chart, GotSport rank chart |
| Multiple overlaid series | `react-native-chart-kit` | Compare chart (SV vs GS overlay) |
| Inverted Y-axis (lower=better) | Custom SVG | Rank charts where #1 is at top |

**Why not gifted-charts for multi-line?**
- GitHub issue #975 documented rendering issues with different-length datasets
- Even with fixes in v1.4.56+, problems persist with datasets that start at different times
- chart-kit handles multi-dataset reliably with `datasets: [{data: [...], color: () => "..."}]`

```javascript
// ✅ CORRECT - Use chart-kit for multi-line compare
<ChartKitLineChart
  data={{
    labels: dateLabels,
    datasets: [
      { data: source1Data, color: () => "#3B82F6", strokeWidth: 2.5 },
      { data: source2Data, color: () => "#f59e0b", strokeWidth: 3 },
    ],
  }}
  bezier
  withDots={true}
  withShadow={false}
/>

// ❌ WRONG - Don't use gifted-charts dataSet for multi-line overlay
<LineChart
  dataSet={[{data: source1}, {data: source2}]}  // Rendering issues!
/>
```

---

### 17. Gender Display Conversion (Session 73)

The database stores gender as "M"/"F" but UI displays "Boys"/"Girls". Use centralized mappings:

```typescript
import { GENDER_DISPLAY, GENDER_FROM_DISPLAY, GenderType } from "../../lib/supabase.types";

// Display in UI: DB format → human format
<Text>{GENDER_DISPLAY[team.gender as GenderType] ?? team.gender}</Text>
// "M" → "Boys", "F" → "Girls"

// Query filter: UI format → DB format
const dbGender = GENDER_FROM_DISPLAY[selectedGender];
if (dbGender) dbQuery = dbQuery.eq("gender", dbGender);
// "Boys" → "M", "Girls" → "F"

// Transform query results
const transformed = (data || []).map((row: any) => ({
  ...row,
  gender: GENDER_DISPLAY[row.gender as GenderType] ?? row.gender,
}));
```

**Mappings (from lib/supabase.types.ts):**
```typescript
export const GENDER_DISPLAY: Record<GenderType, string> = {
  'M': 'Boys',
  'F': 'Girls',
};

export const GENDER_FROM_DISPLAY: Record<string, GenderType> = {
  'Boys': 'M',
  'Girls': 'F',
};
```

**Apply to:**
- Team cards and detail pages
- Filter dropdowns/chips
- Search modal results
- Any place showing gender

---

### 18. Analytical Factors Legend (Session 73)

When showing comparison bars (green/red), add a legend so users know which team each color represents.

**IMPORTANT: Team names NEVER truncate (Principle 4).** The legend wraps vertically if needed.

```typescript
{/* Legend row at top of factors section - wraps if needed */}
<View style={styles.factorsLegend}>
  <View style={styles.factorsLegendItem}>
    <View style={[styles.factorsLegendDot, { backgroundColor: "#22c55e" }]} />
    <Text style={styles.factorsLegendText}>
      {homeTeam?.team_name || "Team A"}
    </Text>
  </View>
  <View style={styles.factorsLegendDivider} />
  <View style={styles.factorsLegendItem}>
    <View style={[styles.factorsLegendDot, { backgroundColor: "#ef4444" }]} />
    <Text style={styles.factorsLegendText}>
      {awayTeam?.team_name || "Team B"}
    </Text>
  </View>
</View>
```

**Styles (wrapping-friendly):**
```typescript
factorsLegend: {
  flexDirection: "row",
  alignItems: "flex-start",  // Top-align for wrapped text
  justifyContent: "center",
  marginBottom: 16,
  paddingVertical: 10,
  paddingHorizontal: 12,
  backgroundColor: "rgba(255,255,255,0.03)",
  borderRadius: 8,
  flexWrap: "wrap",  // Allow wrapping
},
factorsLegendItem: {
  flexDirection: "row",
  alignItems: "flex-start",  // Dot aligns with first line
  flex: 1,
  minWidth: 100,
},
factorsLegendDot: {
  width: 10,
  height: 10,
  borderRadius: 5,
  marginRight: 6,
  marginTop: 3,  // Align with text baseline
},
factorsLegendText: {
  color: "#d1d5db",
  fontSize: 12,
  fontWeight: "500",
  flex: 1,  // Text wraps within item
},
factorsLegendDivider: {
  width: 1,
  alignSelf: "stretch",
  minHeight: 16,
  backgroundColor: "rgba(255,255,255,0.15)",
  marginHorizontal: 12,
},
```

**Result (compact teams):**
```
┌─────────────────────────────────────────┐
│  🟢 Home Team   │   🔴 Away Team        │
└─────────────────────────────────────────┘
```

**Result (long team names wrap):**
```
┌─────────────────────────────────────────┐
│  🟢 Sporting BV    │   🔴 KC Strikers   │
│     Pre-NAL 15     │      Elite B15     │
└─────────────────────────────────────────┘
```

**Why:**
- Users can immediately understand bar meanings at a glance
- No need to read help text
- Shows actual team names, not generic labels
- Compact and unobtrusive design

---

### 19. Expandable Event Cards (Session 73)

For Match History sections, event cards toggle expansion to show matches inline instead of navigating to a new page:

```typescript
// State to track expanded events
const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());

// Toggle handler
const handlePress = () => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  setExpandedEvents((prev) => {
    const next = new Set(prev);
    if (next.has(eventId)) {
      next.delete(eventId);
    } else {
      next.add(eventId);
    }
    return next;
  });
};

// Chevron rotates based on state
<Ionicons
  name={isExpanded ? "chevron-down" : "chevron-forward"}
  size={18}
  color="#4b5563"
/>
```

**Expanded Matches List (MUST be tappable - Session 90 fix):**
```typescript
// Sort matches newest to oldest
const sortedMatches = [...group.matches].sort((a, b) => {
  const dateA = a.match_date ? new Date(a.match_date).getTime() : 0;
  const dateB = b.match_date ? new Date(b.match_date).getTime() : 0;
  return dateB - dateA;
});

// Render each match row - MUST use TouchableOpacity for navigation
<TouchableOpacity
  style={styles.expandedMatchRow}
  activeOpacity={0.7}
  onPress={() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/match/${match.id}`);
  }}
>
  <Text style={[styles.expandedMatchResult, { color: resultColor }]}>
    {resultIcon}  {/* ✓ green, ✗ red, − amber, ⏳ gray */}
  </Text>
  <Text style={styles.expandedMatchDate}>{matchDate}</Text>
  <Text style={styles.expandedMatchVs}>vs</Text>
  <Text style={styles.expandedMatchOpponent}>{opponentName}</Text>
  <Text style={styles.expandedMatchScore}>{score}</Text>
</TouchableOpacity>
```

**CRITICAL:** All match rows everywhere in the app MUST navigate to `/match/[id]` on tap. Never use plain `<View>` for match rows.

**Styles:**
```typescript
eventCardExpanded: {
  marginBottom: 0,
  borderBottomLeftRadius: 0,
  borderBottomRightRadius: 0,
},
expandedMatchesContainer: {
  backgroundColor: "#0a0a0a",
  borderWidth: 1,
  borderTopWidth: 0,
  borderColor: "rgba(255,255,255,0.08)",
  borderBottomLeftRadius: 12,
  borderBottomRightRadius: 12,
  paddingVertical: 8,
  paddingHorizontal: 12,
  marginBottom: 10,
},
expandedMatchRow: {
  flexDirection: "row",
  alignItems: "center",
  paddingVertical: 8,
  borderBottomWidth: 1,
  borderBottomColor: "rgba(255,255,255,0.05)",
},
```

**Result Indicators:**
| Result | Icon | Color |
|--------|------|-------|
| Win | ✓ | `#10B981` (green) |
| Loss | ✗ | `#EF4444` (red) |
| Draw | − | `#f59e0b` (amber) |
| Scheduled | ⏳ | `#6b7280` (gray) |

**Visual Layout:**
```
┌─────────────────────────────────────────────────┐
│ ⌄ ⚽  Heartland Premier League 2026             │
│      3W-1L-0D  Aug-Dec · 8 matches              │
├─────────────────────────────────────────────────┤
│  ✓  Dec 15  vs  Union KC Elite          3-1    │
│  ✗  Nov 22  vs  KC Strikers             1-2    │
│  ✓  Oct 18  vs  Sporting Blue           2-0    │
│  ⏳  Mar 05  vs  KC Thunder              —      │
└─────────────────────────────────────────────────┘
```

**Why:**
- Reduces navigation depth (no page switch to see matches)
- Shows complete match history at a glance
- Compact 2-line event card header keeps list scannable
- Universal pattern works for both leagues and tournaments

---

### 20. Prediction Help Modal (Session 73)

For complex features like the VS Battle prediction, add a help modal explaining the algorithm:

```typescript
// State
const [showPredictionHelp, setShowPredictionHelp] = useState(false);

// Help button next to label
<View style={styles.scoreLabelRow}>
  <Text style={styles.scoreLabel}>Predicted Score</Text>
  <TouchableOpacity onPress={() => setShowPredictionHelp(true)}>
    <Ionicons name="help-circle-outline" size={20} color="#6b7280" />
  </TouchableOpacity>
</View>

// Modal content
<Modal visible={showPredictionHelp} transparent animationType="fade">
  <View style={styles.helpModalOverlay}>
    <View style={styles.helpModalContent}>
      <View style={styles.helpModalHeader}>
        <Text style={styles.helpModalTitle}>🎯 How Predictions Work</Text>
        <TouchableOpacity onPress={() => setShowPredictionHelp(false)}>
          <Ionicons name="close" size={24} color="#fff" />
        </TouchableOpacity>
      </View>
      <ScrollView>
        {/* Factor explanations */}
        <View style={styles.helpFactorItem}>
          <Text style={styles.helpFactorName}>📊 Win Probability</Text>
          <Text style={styles.helpFactorDesc}>
            The percentage chance each team has to win...
          </Text>
        </View>
      </ScrollView>
    </View>
  </View>
</Modal>
```

**Key points to explain:**
- How win probability is calculated
- How predicted score relates to probability
- Factor weights (ELO 40%, Goal Diff 20%, etc.)
- Home advantage boost
- Confidence level meaning

---

### 21. Real-Time Data Queries (Session 75)

**CRITICAL:** Never trust pre-computed values from materialized views for user-facing data.

**Problem:** Pre-computed stats can become stale if:
- Batch jobs (ELO calculation) haven't run
- Materialized view refresh is delayed
- Data pipeline has issues

**Universal Pattern:**

```typescript
// ❌ WRONG - Uses pre-computed values (can be stale)
const { data: team } = await supabase
  .from("app_team_profile")  // Materialized view
  .select("matches_played, wins, losses, draws, elo_rating")
  .eq("id", teamId);

// Displays potentially stale data
<Text>{team.matches_played} Matches</Text>
<Text>{team.elo_rating} ELO</Text>

// ✅ CORRECT - Query source tables directly
// Season Stats - from matches_v2
const { data: homeStats } = await supabase
  .from("matches_v2")
  .select("home_score, away_score")
  .eq("home_team_id", teamId)
  .not("home_score", "is", null)
  .gte("match_date", seasonStart);

// Calculate W-L-D from real data
let wins = 0, losses = 0, draws = 0;
homeStats.forEach(m => {
  if (m.home_score > m.away_score) wins++;
  else if (m.home_score < m.away_score) losses++;
  else draws++;
});

// Power Rating - from teams_v2 (bypass view)
const { data: eloData } = await supabase
  .from("teams_v2")
  .select("elo_rating, elo_national_rank, elo_state_rank")
  .eq("id", teamId)
  .single();
```

**When to Apply:**
- Season Stats display
- Power Rating display
- Any user-facing aggregate data

**When NOT to Apply:**
- List views (Rankings, Teams tabs) - pre-computed is acceptable for performance
- Data that changes rarely (team name, state, gender)
- Historical snapshots (rank_history_v2)

**Performance Notes:**
- Use lightweight queries (no joins) for real-time data
- Only fetch the fields you need
- Source tables have indexes for fast lookups

**Applies to:**
- Team detail page (`app/team/[id].tsx`)
- Any page showing team aggregate stats

---

## File References

| Pattern | Implementation File |
|---------|---------------------|
| Keyboard-aware search | `app/(tabs)/rankings.tsx`, `app/(tabs)/teams.tsx` |
| Type-ahead state picker | `app/(tabs)/rankings.tsx` |
| Shared MatchCard | `components/MatchCard.tsx` |
| Custom rank chart | `app/team/[id].tsx` |
| League standings | `app/league/[eventId].tsx` |
| Stats grid layout | `app/team/[id].tsx` |
| Custom icons with glow | `app/team/[id].tsx` |
| Icon alignment in headers | `app/team/[id].tsx` |
| Two-level chart filters | `app/team/[id].tsx` |
| Chart gradient fills | `app/team/[id].tsx` |
| Scope-aware data logic | `app/team/[id].tsx` |
| Multi-line compare chart | `app/team/[id].tsx` (ChartKitLineChart) |
| Gender display conversion | `app/predict/index.tsx`, `lib/supabase.types.ts` |
| Analytical factors legend | `app/predict/index.tsx` |
| Expandable event cards | `app/team/[id].tsx` |
| Prediction help modal | `app/predict/index.tsx` |
| Real-time data queries | `app/team/[id].tsx` |

---

*This document defines mandatory UI patterns for SoccerView.*
*All new features must follow these patterns for consistency.*
