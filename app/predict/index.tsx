import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, Stack, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  FlatList,
  Keyboard,
  Modal,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  getConfidenceColor,
  getShortTeamName,
  getVeryShortTeamName,
  PredictionResult,
  predictMatch,
  TeamStats,
} from "../../lib/predictions";
import { supabase } from "../../lib/supabase";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

// Age groups for filter - U8 through U19
const AGE_GROUPS = [
  "All",
  "U8",
  "U9",
  "U10",
  "U11",
  "U12",
  "U13",
  "U14",
  "U15",
  "U16",
  "U17",
  "U18",
  "U19",
];
const GENDERS = ["All", "Boys", "Girls"];

// State filter options - alphabetical order
const STATES = [
  "All",
  "AZ",
  "CA",
  "CO",
  "FL",
  "GA",
  "IL",
  "KS",
  "KY",
  "MA",
  "MD",
  "MO",
  "NC",
  "NJ",
  "NV",
  "NY",
  "OH",
  "PA",
  "TN",
  "TX",
  "VA",
  "WA",
];

// ============================================================
// TEAM SELECTOR MODAL - v1.3: WITH STATE FILTER + KEYBOARD FIX
// ============================================================

type TeamSelectorProps = {
  visible: boolean;
  onClose: () => void;
  onSelect: (team: TeamStats) => void;
  excludeTeamId?: string;
  title: string;
  // Pre-filter based on selected team (match age/gender)
  suggestedAgeGroup?: string;
  suggestedGender?: string;
  suggestedState?: string;
};

function TeamSelectorModal({
  visible,
  onClose,
  onSelect,
  excludeTeamId,
  title,
  suggestedAgeGroup,
  suggestedGender,
  suggestedState,
}: TeamSelectorProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [teams, setTeams] = useState<TeamStats[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // FILTERS - initialize with suggestions if provided
  const [selectedAge, setSelectedAge] = useState<string>(
    suggestedAgeGroup || "All",
  );
  const [selectedGender, setSelectedGender] = useState<string>(
    suggestedGender || "All",
  );
  const [selectedState, setSelectedState] = useState<string>(
    suggestedState || "All",
  );

  // Reset filters when modal opens with new suggestions
  useEffect(() => {
    if (visible) {
      if (suggestedAgeGroup && suggestedAgeGroup !== "All") {
        setSelectedAge(suggestedAgeGroup);
      }
      if (suggestedGender && suggestedGender !== "All") {
        setSelectedGender(suggestedGender);
      }
      if (suggestedState && suggestedState !== "All") {
        setSelectedState(suggestedState);
      }
    }
  }, [visible, suggestedAgeGroup, suggestedGender, suggestedState]);

  const searchTeams = useCallback(
    async (query: string, age: string, gender: string, state: string) => {
      if (query.length < 2) {
        setTeams([]);
        setHasSearched(false);
        return;
      }

      setLoading(true);
      setHasSearched(true);

      try {
        let queryBuilder = supabase
          .from("team_elo")
          .select("*")
          .ilike("team_name", `%${query}%`);

        // Apply age filter
        if (age !== "All") {
          queryBuilder = queryBuilder.eq("age_group", age);
        }

        // Apply gender filter
        if (gender !== "All") {
          queryBuilder = queryBuilder.eq("gender", gender);
        }

        // Apply state filter
        if (state !== "All") {
          queryBuilder = queryBuilder.eq("state", state);
        }

        const { data, error } = await queryBuilder
          .order("national_rank", { ascending: true, nullsFirst: false })
          .limit(50);

        if (!error && data) {
          const filtered = excludeTeamId
            ? data.filter((t) => t.id !== excludeTeamId)
            : data;
          setTeams(filtered as TeamStats[]);
        }
      } catch (err) {
        console.error("Search error:", err);
      } finally {
        setLoading(false);
      }
    },
    [excludeTeamId],
  );

  // Debounced search - triggers on query, age, gender, or state change
  useEffect(() => {
    const timer = setTimeout(() => {
      searchTeams(searchQuery, selectedAge, selectedGender, selectedState);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, selectedAge, selectedGender, selectedState, searchTeams]);

  const handleSelect = (team: TeamStats) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onSelect(team);
    onClose();
    setSearchQuery("");
    setTeams([]);
    setHasSearched(false);
  };

  const handleClose = () => {
    onClose();
    setSearchQuery("");
    setTeams([]);
    setHasSearched(false);
    setSelectedAge("All");
    setSelectedGender("All");
    setSelectedState("All");
  };

  const hasActiveFilters =
    selectedAge !== "All" ||
    selectedGender !== "All" ||
    selectedState !== "All";

  const renderTeamItem = ({ item }: { item: TeamStats }) => (
    <TouchableOpacity
      style={styles.teamSelectItem}
      onPress={() => handleSelect(item)}
      activeOpacity={0.7}
    >
      <View style={styles.teamSelectInfo}>
        {/* v1.3: Show FULL team name - no truncation */}
        <Text style={styles.teamSelectName} numberOfLines={2}>
          {item.team_name || "Unknown Team"}
        </Text>
        <View style={styles.teamSelectMetaRow}>
          {item.age_group && (
            <View style={styles.metaBadge}>
              <Text style={styles.metaBadgeText}>{item.age_group}</Text>
            </View>
          )}
          {item.gender && (
            <View
              style={[
                styles.metaBadge,
                item.gender === "Girls"
                  ? styles.metaBadgeGirls
                  : styles.metaBadgeBoys,
              ]}
            >
              <Text style={styles.metaBadgeText}>{item.gender}</Text>
            </View>
          )}
          {item.state && (
            <Text style={styles.teamSelectState}>{item.state}</Text>
          )}
          {item.national_rank && (
            <Text style={styles.teamSelectRank}>#{item.national_rank}</Text>
          )}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={20} color="#6b7280" />
    </TouchableOpacity>
  );

  // Filter chip component
  const FilterChip = ({
    label,
    selected,
    onPress,
  }: {
    label: string;
    selected: boolean;
    onPress: () => void;
  }) => (
    <TouchableOpacity
      style={[styles.filterChip, selected && styles.filterChipSelected]}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      activeOpacity={0.7}
    >
      <Text
        style={[
          styles.filterChipText,
          selected && styles.filterChipTextSelected,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <SafeAreaView style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <TouchableOpacity
            onPress={handleClose}
            style={styles.modalCloseButton}
          >
            <Ionicons name="close" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>{title}</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Search Input */}
        <View style={styles.searchContainer}>
          <Ionicons
            name="search"
            size={20}
            color="#6b7280"
            style={styles.searchIcon}
          />
          <TextInput
            style={styles.searchInput}
            placeholder="Search team name..."
            placeholderTextColor="#6b7280"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              onPress={() => setSearchQuery("")}
              style={styles.clearButton}
            >
              <Ionicons name="close-circle" size={20} color="#6b7280" />
            </TouchableOpacity>
          )}
        </View>

        {/* FILTER SECTION - v1.3: Fixed layout + State filter */}
        <View style={styles.filtersContainer}>
          {/* Gender Filter - FIXED: Inline label */}
          <View style={styles.filterRow}>
            <Text style={styles.filterLabel}>Gender</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.filterScroll}
              keyboardShouldPersistTaps="handled"
            >
              {GENDERS.map((gender) => (
                <FilterChip
                  key={gender}
                  label={gender}
                  selected={selectedGender === gender}
                  onPress={() => setSelectedGender(gender)}
                />
              ))}
            </ScrollView>
          </View>

          {/* Age Group Filter */}
          <View style={styles.filterRow}>
            <Text style={styles.filterLabel}>Age</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.filterScroll}
              keyboardShouldPersistTaps="handled"
            >
              {AGE_GROUPS.map((age) => (
                <FilterChip
                  key={age}
                  label={age}
                  selected={selectedAge === age}
                  onPress={() => setSelectedAge(age)}
                />
              ))}
            </ScrollView>
          </View>

          {/* State Filter - NEW in v1.3 */}
          <View style={styles.filterRow}>
            <Text style={styles.filterLabel}>State</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.filterScroll}
              keyboardShouldPersistTaps="handled"
            >
              {STATES.map((state) => (
                <FilterChip
                  key={state}
                  label={state}
                  selected={selectedState === state}
                  onPress={() => setSelectedState(state)}
                />
              ))}
            </ScrollView>
          </View>

          {/* Active filters indicator */}
          {hasActiveFilters && (
            <TouchableOpacity
              style={styles.clearFiltersButton}
              onPress={() => {
                setSelectedAge("All");
                setSelectedGender("All");
                setSelectedState("All");
              }}
            >
              <Ionicons name="close-circle" size={16} color="#f59e0b" />
              <Text style={styles.clearFiltersText}>Clear filters</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Results - v1.3: keyboard dismisses on scroll */}
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#10b981" />
          </View>
        ) : teams.length > 0 ? (
          <FlatList
            data={teams}
            renderItem={renderTeamItem}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.teamList}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            onScrollBeginDrag={() => Keyboard.dismiss()}
          />
        ) : hasSearched ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="search-outline" size={48} color="#374151" />
            <Text style={styles.emptyText}>No teams found</Text>
            <Text style={styles.emptySubtext}>
              Try different search terms or adjust filters
            </Text>
          </View>
        ) : (
          <View style={styles.emptyContainer}>
            <Ionicons name="football-outline" size={48} color="#374151" />
            <Text style={styles.emptyText}>Search for a team</Text>
            <Text style={styles.emptySubtext}>
              Use filters to narrow results
            </Text>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

// ============================================================
// PROBABILITY BAR
// ============================================================

type ProbBarProps = {
  homePercent: number;
  drawPercent: number;
  awayPercent: number;
  homeLabel: string;
  awayLabel: string;
};

function ProbabilityBar({
  homePercent,
  drawPercent,
  awayPercent,
  homeLabel,
  awayLabel,
}: ProbBarProps) {
  const shortHome = getVeryShortTeamName(homeLabel);
  const shortAway = getVeryShortTeamName(awayLabel);

  return (
    <View style={styles.probBarContainer}>
      <View style={styles.probBarLabels}>
        <Text
          style={[styles.probBarLabel, { color: "#10b981" }]}
          numberOfLines={1}
        >
          {shortHome}
        </Text>
        <Text style={[styles.probBarLabel, { color: "#f59e0b" }]}>Draw</Text>
        <Text
          style={[styles.probBarLabel, { color: "#3B82F6" }]}
          numberOfLines={1}
        >
          {shortAway}
        </Text>
      </View>
      <View style={styles.probBar}>
        <View
          style={[
            styles.probBarSegment,
            {
              flex: homePercent,
              backgroundColor: "#10b981",
              borderTopLeftRadius: 8,
              borderBottomLeftRadius: 8,
            },
          ]}
        />
        <View
          style={[
            styles.probBarSegment,
            {
              flex: drawPercent,
              backgroundColor: "#f59e0b",
            },
          ]}
        />
        <View
          style={[
            styles.probBarSegment,
            {
              flex: awayPercent,
              backgroundColor: "#3B82F6",
              borderTopRightRadius: 8,
              borderBottomRightRadius: 8,
            },
          ]}
        />
      </View>
      <View style={styles.probBarPercents}>
        <Text style={[styles.probBarPercent, { color: "#10b981" }]}>
          {homePercent}%
        </Text>
        <Text style={[styles.probBarPercent, { color: "#f59e0b" }]}>
          {drawPercent}%
        </Text>
        <Text style={[styles.probBarPercent, { color: "#3B82F6" }]}>
          {awayPercent}%
        </Text>
      </View>
    </View>
  );
}

// ============================================================
// FACTOR BAR
// ============================================================

type FactorBarProps = {
  name: string;
  homeValue: string | number;
  awayValue: string | number;
  homeAdvantage: number;
};

function FactorBar({
  name,
  homeValue,
  awayValue,
  homeAdvantage,
}: FactorBarProps) {
  const barWidth = Math.abs(homeAdvantage);
  const isHomeAdvantage = homeAdvantage > 0;

  return (
    <View style={styles.factorRow}>
      <View style={styles.factorValueLeft}>
        <Text
          style={[
            styles.factorValue,
            isHomeAdvantage && styles.factorValueWinner,
          ]}
          numberOfLines={1}
        >
          {homeValue}
        </Text>
      </View>
      <View style={styles.factorBarCenter}>
        <Text style={styles.factorName}>{name}</Text>
        <View style={styles.factorBarTrack}>
          <View style={styles.factorBarHalf}>
            {isHomeAdvantage && (
              <View
                style={[
                  styles.factorBarFill,
                  styles.factorBarFillHome,
                  { width: `${barWidth}%` },
                ]}
              />
            )}
          </View>
          <View style={styles.factorBarCenterLine} />
          <View style={styles.factorBarHalf}>
            {!isHomeAdvantage && homeAdvantage !== 0 && (
              <View
                style={[
                  styles.factorBarFill,
                  styles.factorBarFillAway,
                  { width: `${barWidth}%` },
                ]}
              />
            )}
          </View>
        </View>
      </View>
      <View style={styles.factorValueRight}>
        <Text
          style={[
            styles.factorValue,
            !isHomeAdvantage && homeAdvantage !== 0 && styles.factorValueWinner,
          ]}
          numberOfLines={1}
        >
          {awayValue}
        </Text>
      </View>
    </View>
  );
}

// ============================================================
// TALE OF THE TAPE
// ============================================================

type TaleOfTapeProps = {
  comparison: PredictionResult["comparison"];
};

function TaleOfTape({ comparison }: TaleOfTapeProps) {
  return (
    <View style={styles.tapeContainer}>
      {comparison.map((item, index) => (
        <View key={index} style={styles.tapeRow}>
          <Text
            style={[
              styles.tapeValue,
              styles.tapeValueLeft,
              item.winner === "home" && styles.tapeValueWinner,
            ]}
            numberOfLines={1}
          >
            {item.homeValue}
          </Text>
          <Text style={styles.tapeCategory}>{item.category}</Text>
          <Text
            style={[
              styles.tapeValue,
              styles.tapeValueRight,
              item.winner === "away" && styles.tapeValueWinner,
            ]}
            numberOfLines={1}
          >
            {item.awayValue}
          </Text>
        </View>
      ))}
    </View>
  );
}

// ============================================================
// MAIN SCREEN - v1.3: Fixed share message, state filter support
// ============================================================

export default function PredictScreen() {
  // Check for pre-populated team from navigation params
  const params = useLocalSearchParams<{ teamId?: string }>();

  const [homeTeam, setHomeTeam] = useState<TeamStats | null>(null);
  const [awayTeam, setAwayTeam] = useState<TeamStats | null>(null);
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const [showHomeSelector, setShowHomeSelector] = useState(false);
  const [showAwaySelector, setShowAwaySelector] = useState(false);
  const [showFactors, setShowFactors] = useState(false);
  const [loadingPrePopulate, setLoadingPrePopulate] = useState(false);

  const scoreAnim = useState(new Animated.Value(0))[0];

  // Pre-populate Team A if teamId is passed
  useEffect(() => {
    if (params.teamId && !homeTeam) {
      loadTeamById(params.teamId);
    }
  }, [params.teamId]);

  const loadTeamById = async (teamId: string) => {
    setLoadingPrePopulate(true);
    try {
      const { data, error } = await supabase
        .from("team_elo")
        .select("*")
        .eq("id", teamId)
        .single();

      if (!error && data) {
        setHomeTeam(data as TeamStats);
      }
    } catch (err) {
      console.error("Error loading team:", err);
    } finally {
      setLoadingPrePopulate(false);
    }
  };

  // Run prediction when both teams selected
  useEffect(() => {
    if (homeTeam && awayTeam) {
      const result = predictMatch(homeTeam, awayTeam);
      setPrediction(result);

      scoreAnim.setValue(0);
      Animated.spring(scoreAnim, {
        toValue: 1,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }).start();

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      setPrediction(null);
    }
  }, [homeTeam, awayTeam]);

  // v1.3: REVERTED TO FUN SHARE FORMAT - No #YouthSoccer, No phone icon, FULL team names
  const handleShare = async () => {
    if (!prediction || !homeTeam || !awayTeam) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Use FULL team names - no truncation
    const homeName = homeTeam.team_name || "Team A";
    const awayName = awayTeam.team_name || "Team B";

    // Fun format with emojis - but NO hashtag and NO phone icon
    const message = `⚽ Match Prediction ⚽

${homeName}
  vs
${awayName}

🎯 Score: ${prediction.predictedHomeScore} - ${prediction.predictedAwayScore}

📊 Odds:
• ${homeName}: ${prediction.homeWinProbability}%
• Draw: ${prediction.drawProbability}%
• ${awayName}: ${prediction.awayWinProbability}%

Confidence: ${prediction.confidenceLevel}

Predicted by SoccerView`;

    try {
      await Share.share({ message });
    } catch (error) {
      console.error("Share error:", error);
    }
  };

  const handleReset = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setHomeTeam(null);
    setAwayTeam(null);
    setPrediction(null);
  };

  const handleSwapTeams = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const temp = homeTeam;
    setHomeTeam(awayTeam);
    setAwayTeam(temp);
  };

  if (loadingPrePopulate) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingFullScreen}>
          <ActivityIndicator size="large" color="#10b981" />
          <Text style={styles.loadingText}>Loading team...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>⚔️ Match Prediction</Text>
        {prediction && (
          <TouchableOpacity style={styles.shareButton} onPress={handleShare}>
            <Ionicons name="share-outline" size={24} color="#10b981" />
          </TouchableOpacity>
        )}
        {!prediction && <View style={{ width: 40 }} />}
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Team Selection */}
        <View style={styles.teamsContainer}>
          {/* Home Team */}
          <TouchableOpacity
            style={[styles.teamCard, homeTeam && styles.teamCardSelected]}
            onPress={() => setShowHomeSelector(true)}
            activeOpacity={0.7}
          >
            {homeTeam ? (
              <>
                <View style={styles.teamLogoPlaceholder}>
                  <Ionicons name="shield" size={28} color="#10b981" />
                </View>
                <Text style={styles.teamName} numberOfLines={2}>
                  {getShortTeamName(homeTeam.team_name || "", 16)}
                </Text>
                <Text style={styles.teamAgeGender}>
                  {homeTeam.age_group} {homeTeam.gender}
                </Text>
                {homeTeam.national_rank && (
                  <Text style={styles.teamRank}>#{homeTeam.national_rank}</Text>
                )}
              </>
            ) : (
              <>
                <View style={styles.teamLogoPlaceholder}>
                  <Ionicons
                    name="add-circle-outline"
                    size={36}
                    color="#6b7280"
                  />
                </View>
                <Text style={styles.selectTeamText}>Select{"\n"}Team A</Text>
              </>
            )}
          </TouchableOpacity>

          {/* VS Badge */}
          <View style={styles.vsBadge}>
            <Text style={styles.vsText}>VS</Text>
            {homeTeam && awayTeam && (
              <TouchableOpacity
                style={styles.swapButton}
                onPress={handleSwapTeams}
              >
                <Ionicons name="swap-horizontal" size={18} color="#6b7280" />
              </TouchableOpacity>
            )}
          </View>

          {/* Away Team */}
          <TouchableOpacity
            style={[styles.teamCard, awayTeam && styles.teamCardSelected]}
            onPress={() => setShowAwaySelector(true)}
            activeOpacity={0.7}
          >
            {awayTeam ? (
              <>
                <View style={styles.teamLogoPlaceholder}>
                  <Ionicons name="shield" size={28} color="#3B82F6" />
                </View>
                <Text style={styles.teamName} numberOfLines={2}>
                  {getShortTeamName(awayTeam.team_name || "", 16)}
                </Text>
                <Text style={styles.teamAgeGender}>
                  {awayTeam.age_group} {awayTeam.gender}
                </Text>
                {awayTeam.national_rank && (
                  <Text style={styles.teamRank}>#{awayTeam.national_rank}</Text>
                )}
              </>
            ) : (
              <>
                <View style={styles.teamLogoPlaceholder}>
                  <Ionicons
                    name="add-circle-outline"
                    size={36}
                    color="#6b7280"
                  />
                </View>
                <Text style={styles.selectTeamText}>Select{"\n"}Opponent</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Prediction Results */}
        {prediction && (
          <Animated.View
            style={[
              styles.predictionContainer,
              {
                opacity: scoreAnim,
                transform: [
                  {
                    scale: scoreAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.9, 1],
                    }),
                  },
                ],
              },
            ]}
          >
            {/* Predicted Score */}
            <View style={styles.scoreCard}>
              <Text style={styles.predictedLabel}>🎯 PREDICTED SCORE</Text>
              <View style={styles.scoreDisplay}>
                <Text style={styles.scoreNumber}>
                  {prediction.predictedHomeScore}
                </Text>
                <Text style={styles.scoreDash}>-</Text>
                <Text style={styles.scoreNumber}>
                  {prediction.predictedAwayScore}
                </Text>
              </View>
            </View>

            {/* Probability Bar */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Win Probability</Text>
              <ProbabilityBar
                homePercent={prediction.homeWinProbability}
                drawPercent={prediction.drawProbability}
                awayPercent={prediction.awayWinProbability}
                homeLabel={homeTeam?.team_name || "Home"}
                awayLabel={awayTeam?.team_name || "Away"}
              />
            </View>

            {/* Confidence */}
            <View style={styles.confidenceCard}>
              <Text style={styles.confidenceLabel}>Prediction Confidence</Text>
              <View style={styles.confidenceBar}>
                <View
                  style={[
                    styles.confidenceFill,
                    {
                      width: `${prediction.confidencePercent}%`,
                      backgroundColor: getConfidenceColor(
                        prediction.confidenceLevel,
                      ),
                    },
                  ]}
                />
              </View>
              <Text
                style={[
                  styles.confidenceText,
                  { color: getConfidenceColor(prediction.confidenceLevel) },
                ]}
              >
                {prediction.confidenceLevel} ({prediction.confidencePercent}%)
              </Text>
            </View>

            {/* Factor Analysis Toggle */}
            <TouchableOpacity
              style={styles.factorsToggle}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setShowFactors(!showFactors);
              }}
            >
              <Text style={styles.factorsToggleText}>
                {showFactors ? "Hide Analysis" : "Show Factor Analysis"}
              </Text>
              <Ionicons
                name={showFactors ? "chevron-up" : "chevron-down"}
                size={20}
                color="#10b981"
              />
            </TouchableOpacity>

            {/* Factor Breakdown */}
            {showFactors && (
              <View style={styles.factorsCard}>
                <Text style={styles.sectionTitle}>Factor Breakdown</Text>
                {prediction.factors.map((factor, index) => (
                  <FactorBar
                    key={index}
                    name={factor.name}
                    homeValue={factor.homeValue}
                    awayValue={factor.awayValue}
                    homeAdvantage={factor.homeAdvantage}
                  />
                ))}
              </View>
            )}

            {/* Tale of the Tape */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>📊 Tale of the Tape</Text>
              <TaleOfTape comparison={prediction.comparison} />
            </View>

            {/* Action Buttons */}
            <View style={styles.actionButtons}>
              <TouchableOpacity
                style={styles.shareButtonLarge}
                onPress={handleShare}
              >
                <Ionicons name="share-social" size={20} color="#fff" />
                <Text style={styles.shareButtonText}>Share Prediction</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.resetButton}
                onPress={handleReset}
              >
                <Ionicons name="refresh" size={20} color="#6b7280" />
                <Text style={styles.resetButtonText}>New Prediction</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        )}

        {/* Empty State */}
        {!prediction && (
          <View style={styles.emptyState}>
            <Ionicons name="analytics-outline" size={64} color="#374151" />
            <Text style={styles.emptyStateTitle}>
              {homeTeam
                ? "Now select an opponent"
                : "Select two teams to predict"}
            </Text>
            <Text style={styles.emptyStateSubtitle}>
              Our AI analyzes ELO, win rate, goals, and more
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Team Selector Modals - with smart filter suggestions including state */}
      <TeamSelectorModal
        visible={showHomeSelector}
        onClose={() => setShowHomeSelector(false)}
        onSelect={setHomeTeam}
        excludeTeamId={awayTeam?.id}
        title="Select Team A"
        suggestedAgeGroup={awayTeam?.age_group || undefined}
        suggestedGender={awayTeam?.gender || undefined}
        suggestedState={awayTeam?.state || undefined}
      />
      <TeamSelectorModal
        visible={showAwaySelector}
        onClose={() => setShowAwaySelector(false)}
        onSelect={setAwayTeam}
        excludeTeamId={homeTeam?.id}
        title="Select Opponent"
        suggestedAgeGroup={homeTeam?.age_group || undefined}
        suggestedGender={homeTeam?.gender || undefined}
        suggestedState={homeTeam?.state || undefined}
      />
    </SafeAreaView>
  );
}

// ============================================================
// STYLES
// ============================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  loadingFullScreen: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  loadingText: {
    color: "#9ca3af",
    fontSize: 14,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.05)",
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#1F2937",
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
  },
  shareButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    justifyContent: "center",
    alignItems: "center",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },

  // Teams Selection
  teamsContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  teamCard: {
    flex: 1,
    backgroundColor: "#111",
    borderRadius: 16,
    padding: 12,
    alignItems: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.1)",
    borderStyle: "dashed",
    minHeight: 140,
    justifyContent: "center",
  },
  teamCardSelected: {
    borderColor: "#10b981",
    borderStyle: "solid",
  },
  teamLogoPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#1F2937",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 8,
  },
  teamName: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 2,
    lineHeight: 16,
  },
  teamAgeGender: {
    color: "#9ca3af",
    fontSize: 11,
    marginBottom: 4,
  },
  teamRank: {
    color: "#10b981",
    fontSize: 14,
    fontWeight: "bold",
  },
  selectTeamText: {
    color: "#6b7280",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
  },
  vsBadge: {
    width: 50,
    alignItems: "center",
    paddingHorizontal: 4,
  },
  vsText: {
    color: "#f59e0b",
    fontSize: 18,
    fontWeight: "bold",
  },
  swapButton: {
    marginTop: 6,
    padding: 6,
    borderRadius: 16,
    backgroundColor: "#1F2937",
  },

  // Prediction Results
  predictionContainer: {
    gap: 16,
  },
  scoreCard: {
    backgroundColor: "rgba(16, 185, 129, 0.1)",
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.3)",
  },
  predictedLabel: {
    color: "#10b981",
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 12,
    letterSpacing: 1,
  },
  scoreDisplay: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  scoreNumber: {
    color: "#fff",
    fontSize: 56,
    fontWeight: "bold",
  },
  scoreDash: {
    color: "#6b7280",
    fontSize: 40,
    fontWeight: "300",
  },

  // Section Cards
  sectionCard: {
    backgroundColor: "#111",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  sectionTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 16,
  },

  // Probability Bar
  probBarContainer: {
    gap: 8,
  },
  probBarLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 4,
  },
  probBarLabel: {
    fontSize: 11,
    fontWeight: "600",
    maxWidth: "30%",
  },
  probBar: {
    flexDirection: "row",
    height: 28,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#1F2937",
  },
  probBarSegment: {
    height: "100%",
  },
  probBarPercents: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 4,
  },
  probBarPercent: {
    fontSize: 15,
    fontWeight: "700",
  },

  // Confidence
  confidenceCard: {
    backgroundColor: "#111",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  confidenceLabel: {
    color: "#9ca3af",
    fontSize: 12,
    marginBottom: 8,
  },
  confidenceBar: {
    height: 8,
    backgroundColor: "#1F2937",
    borderRadius: 4,
    overflow: "hidden",
    marginBottom: 8,
  },
  confidenceFill: {
    height: "100%",
    borderRadius: 4,
  },
  confidenceText: {
    fontSize: 14,
    fontWeight: "600",
  },

  // Factors Toggle
  factorsToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 12,
    backgroundColor: "rgba(16, 185, 129, 0.1)",
    borderRadius: 12,
  },
  factorsToggleText: {
    color: "#10b981",
    fontSize: 14,
    fontWeight: "600",
  },

  // Factor Bars
  factorsCard: {
    backgroundColor: "#111",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  factorRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  factorValueLeft: {
    width: 55,
    alignItems: "flex-end",
    paddingRight: 8,
  },
  factorValueRight: {
    width: 55,
    alignItems: "flex-start",
    paddingLeft: 8,
  },
  factorValue: {
    color: "#9ca3af",
    fontSize: 12,
    fontWeight: "600",
  },
  factorValueWinner: {
    color: "#10b981",
  },
  factorBarCenter: {
    flex: 1,
  },
  factorName: {
    color: "#6b7280",
    fontSize: 10,
    textAlign: "center",
    marginBottom: 4,
  },
  factorBarTrack: {
    flexDirection: "row",
    height: 8,
    backgroundColor: "#1F2937",
    borderRadius: 4,
    overflow: "hidden",
  },
  factorBarHalf: {
    flex: 1,
    flexDirection: "row",
  },
  factorBarFill: {
    height: "100%",
  },
  factorBarFillHome: {
    backgroundColor: "#10b981",
    alignSelf: "flex-end",
  },
  factorBarFillAway: {
    backgroundColor: "#3B82F6",
    alignSelf: "flex-start",
  },
  factorBarCenterLine: {
    width: 2,
    backgroundColor: "#374151",
  },

  // Tale of the Tape
  tapeContainer: {
    gap: 12,
  },
  tapeRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  tapeValue: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: "#9ca3af",
  },
  tapeValueLeft: {
    textAlign: "left",
  },
  tapeValueRight: {
    textAlign: "right",
  },
  tapeValueWinner: {
    color: "#10b981",
  },
  tapeCategory: {
    color: "#6b7280",
    fontSize: 11,
    textAlign: "center",
    width: 80,
  },

  // Action Buttons
  actionButtons: {
    gap: 12,
  },
  shareButtonLarge: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#10b981",
    paddingVertical: 16,
    borderRadius: 12,
  },
  shareButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  resetButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#1F2937",
    paddingVertical: 14,
    borderRadius: 12,
  },
  resetButtonText: {
    color: "#9ca3af",
    fontSize: 14,
    fontWeight: "600",
  },

  // Empty State
  emptyState: {
    alignItems: "center",
    paddingVertical: 48,
    gap: 12,
  },
  emptyStateTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
  },
  emptyStateSubtitle: {
    color: "#6b7280",
    fontSize: 14,
    textAlign: "center",
    paddingHorizontal: 32,
  },

  // Modal
  modalContainer: {
    flex: 1,
    backgroundColor: "#000",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  modalCloseButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#1F2937",
    justifyContent: "center",
    alignItems: "center",
  },
  modalTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#111",
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: "#fff",
    fontSize: 16,
    paddingVertical: 14,
  },
  clearButton: {
    padding: 4,
  },

  // FILTERS - v1.3: Fixed layout
  filtersContainer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.05)",
  },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  filterLabel: {
    color: "#6b7280",
    fontSize: 12,
    width: 50,
    fontWeight: "600",
  },
  filterScroll: {
    flexGrow: 0,
    marginLeft: 4,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "#1F2937",
    marginRight: 8,
    borderWidth: 1,
    borderColor: "transparent",
  },
  filterChipSelected: {
    backgroundColor: "rgba(16, 185, 129, 0.2)",
    borderColor: "#10b981",
  },
  filterChipText: {
    color: "#9ca3af",
    fontSize: 12,
    fontWeight: "600",
  },
  filterChipTextSelected: {
    color: "#10b981",
  },
  clearFiltersButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingVertical: 4,
  },
  clearFiltersText: {
    color: "#f59e0b",
    fontSize: 12,
    fontWeight: "500",
  },

  // Team List
  teamList: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  teamSelectItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#111",
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  teamSelectInfo: {
    flex: 1,
  },
  teamSelectName: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 6,
  },
  teamSelectMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  metaBadge: {
    backgroundColor: "#10b981",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  metaBadgeBoys: {
    backgroundColor: "#3B82F6",
  },
  metaBadgeGirls: {
    backgroundColor: "#ec4899",
  },
  metaBadgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "600",
  },
  teamSelectState: {
    color: "#9ca3af",
    fontSize: 12,
  },
  teamSelectRank: {
    color: "#f59e0b",
    fontSize: 12,
    fontWeight: "600",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
    paddingTop: 60,
  },
  emptyText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  emptySubtext: {
    color: "#6b7280",
    fontSize: 14,
    textAlign: "center",
  },
});
