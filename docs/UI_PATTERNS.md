# SoccerView UI Patterns & Standards

> **Version 1.0** | Last Updated: January 28, 2026
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

## Preferred Libraries

| Category | Library | Why |
|----------|---------|-----|
| **Charts (Standard)** | `react-native-gifted-charts` | Beautiful, handles edge cases |
| **Charts (Inverted)** | Custom SVG | Required for rank charts |
| **Animations** | `react-native-reanimated` | 60fps native animations |
| **Gestures** | `react-native-gesture-handler` | Native gesture system |
| **Navigation** | `expo-router` | File-based routing |
| **Icons** | `@expo/vector-icons` | Comprehensive sets |
| **Haptics** | `expo-haptics` | Native feedback |

---

## File References

| Pattern | Implementation File |
|---------|---------------------|
| Keyboard-aware search | `app/(tabs)/rankings.tsx`, `app/(tabs)/teams.tsx` |
| Type-ahead state picker | `app/(tabs)/rankings.tsx` |
| Shared MatchCard | `components/MatchCard.tsx` |
| Custom rank chart | `app/team/[id].tsx` |
| League standings | `app/league/[eventId].tsx` |

---

*This document defines mandatory UI patterns for SoccerView.*
*All new features must follow these patterns for consistency.*
