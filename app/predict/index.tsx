import { Ionicons } from "@expo/vector-icons";
import Slider from "@react-native-community/slider";
import * as Haptics from "expo-haptics";
import { router, Stack, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import PredictionModal from "../../components/PredictionModal";
import {
  generatePrediction,
  PredictionResult,
  TeamData,
} from "../../lib/predictions";
import { supabase } from "../../lib/supabase";

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
const STATES = [
  "All",
  "CA",
  "TX",
  "FL",
  "NY",
  "PA",
  "IL",
  "OH",
  "GA",
  "NC",
  "MI",
  "NJ",
  "VA",
  "WA",
  "AZ",
  "MA",
  "TN",
  "IN",
  "MO",
  "MD",
  "WI",
  "CO",
  "MN",
  "KS",
];

// ============================================================
// FACTOR HELP TEXT - Explains what each analytical factor means
// ============================================================
const FACTOR_HELP: Record<string, string> = {
  "ELO Rating":
    "Team's overall strength rating. Higher = stronger team historically.",
  "Goal Diff":
    "Average goal differential per match. Positive means team scores more than they concede.",
  "Win Rate":
    "Percentage of matches won. Higher win rate = more consistent winner.",
  "Head-to-Head":
    "Historical performance when these two teams have played each other.",
  Strength: "Combined measure of offensive and defensive capabilities.",
  Form: "Recent performance trend over last 5-10 matches.",
  "Home Advantage":
    "Boost for playing at home venue (typically 3-5% advantage).",
};

type TeamSelectorModalProps = {
  visible: boolean;
  onClose: () => void;
  onSelect: (team: TeamData) => void;
  excludeTeamId?: string;
  title: string;
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
}: TeamSelectorModalProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<TeamData[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedAgeGroup, setSelectedAgeGroup] = useState(
    suggestedAgeGroup || "All",
  );
  const [selectedGender, setSelectedGender] = useState(
    suggestedGender || "All",
  );
  const [selectedState, setSelectedState] = useState(suggestedState || "All");

  useEffect(() => {
    if (visible) {
      setSelectedAgeGroup(suggestedAgeGroup || "All");
      setSelectedGender(suggestedGender || "All");
      setSelectedState(suggestedState || "All");
      setSearchQuery("");
      setResults([]);
    }
  }, [visible, suggestedAgeGroup, suggestedGender, suggestedState]);

  const searchTeams = async (query: string) => {
    if (query.length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      let dbQuery = supabase
        .from("team_elo")
        .select("*")
        .ilike("team_name", `%${query}%`)
        .order("elo_rating", { ascending: false })
        .limit(50);
      if (selectedAgeGroup !== "All")
        dbQuery = dbQuery.eq("age_group", selectedAgeGroup);
      if (selectedGender !== "All")
        dbQuery = dbQuery.eq("gender", selectedGender);
      if (selectedState !== "All") dbQuery = dbQuery.eq("state", selectedState);
      if (excludeTeamId) dbQuery = dbQuery.neq("id", excludeTeamId);
      const { data, error } = await dbQuery;
      if (error) throw error;
      setResults((data as TeamData[]) || []);
    } catch (err) {
      console.error("Search error:", err);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => searchTeams(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery, selectedAgeGroup, selectedGender, selectedState]);

  const clearFilters = () => {
    setSelectedAgeGroup("All");
    setSelectedGender("All");
    setSelectedState("All");
  };

  const renderTeamItem = ({ item }: { item: TeamData }) => (
    <TouchableOpacity
      style={styles.teamResultItem}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onSelect(item);
        onClose();
      }}
    >
      <View style={styles.teamResultInfo}>
        <Text style={styles.teamResultName} numberOfLines={2}>
          {item.team_name}
        </Text>
        <View style={styles.teamBadgeRow}>
          {item.age_group && (
            <View style={styles.ageBadge}>
              <Text style={styles.ageBadgeText}>{item.age_group}</Text>
            </View>
          )}
          {item.gender && (
            <View style={styles.genderBadge}>
              <Text style={styles.genderBadgeText}>{item.gender}</Text>
            </View>
          )}
          {item.state && (
            <View style={styles.stateBadge}>
              <Text style={styles.stateBadgeText}>{item.state}</Text>
            </View>
          )}
        </View>
      </View>
      <View style={styles.teamResultRight}>
        <Text style={styles.teamResultElo}>
          {Math.round(item.elo_rating || 1500)}
        </Text>
        {item.national_rank && (
          <Text style={styles.teamResultRank}>#{item.national_rank}</Text>
        )}
      </View>
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.modalOverlay}
      >
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{title}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Ionicons name="close" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
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
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus={true}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery("")}>
                <Ionicons name="close-circle" size={20} color="#6b7280" />
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.filtersContainer}>
            <View style={styles.filterRow}>
              <Text style={styles.filterLabel}>Age</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.filterScroll}
                keyboardShouldPersistTaps="handled"
              >
                {AGE_GROUPS.map((age) => (
                  <TouchableOpacity
                    key={age}
                    style={[
                      styles.filterChip,
                      selectedAgeGroup === age && styles.filterChipActive,
                    ]}
                    onPress={() => setSelectedAgeGroup(age)}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        selectedAgeGroup === age && styles.filterChipTextActive,
                      ]}
                    >
                      {age}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
            <View style={styles.filterRow}>
              <Text style={styles.filterLabel}>Gender</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.filterScroll}
                keyboardShouldPersistTaps="handled"
              >
                {GENDERS.map((g) => (
                  <TouchableOpacity
                    key={g}
                    style={[
                      styles.filterChip,
                      selectedGender === g && styles.filterChipActive,
                    ]}
                    onPress={() => setSelectedGender(g)}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        selectedGender === g && styles.filterChipTextActive,
                      ]}
                    >
                      {g}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
            <View style={styles.filterRow}>
              <Text style={styles.filterLabel}>State</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.filterScroll}
                keyboardShouldPersistTaps="handled"
              >
                {STATES.map((s) => (
                  <TouchableOpacity
                    key={s}
                    style={[
                      styles.filterChip,
                      selectedState === s && styles.filterChipActive,
                    ]}
                    onPress={() => setSelectedState(s)}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        selectedState === s && styles.filterChipTextActive,
                      ]}
                    >
                      {s}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
            <TouchableOpacity
              style={styles.clearFiltersButton}
              onPress={clearFilters}
            >
              <Text style={styles.clearFiltersText}>Clear Filters</Text>
            </TouchableOpacity>
          </View>
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#3B82F6" />
            </View>
          ) : results.length > 0 ? (
            <FlatList
              data={results}
              renderItem={renderTeamItem}
              keyExtractor={(item) => item.id}
              style={styles.resultsList}
              keyboardShouldPersistTaps="handled"
            />
          ) : searchQuery.length >= 2 ? (
            <View style={styles.emptyResults}>
              <Ionicons name="search-outline" size={48} color="#374151" />
              <Text style={styles.emptyResultsText}>
                No teams found matching "{searchQuery}"
              </Text>
            </View>
          ) : (
            <View style={styles.emptyResults}>
              <Ionicons name="search-outline" size={48} color="#374151" />
              <Text style={styles.emptyResultsText}>
                Type at least 2 characters
              </Text>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ============================================================
// MAIN PREDICT SCREEN
// ============================================================

export default function PredictScreen() {
  const params = useLocalSearchParams();
  const scoreAnim = useRef(new Animated.Value(0)).current;

  const [homeTeam, setHomeTeam] = useState<TeamData | null>(null);
  const [awayTeam, setAwayTeam] = useState<TeamData | null>(null);
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [showHomeSelector, setShowHomeSelector] = useState(false);
  const [showAwaySelector, setShowAwaySelector] = useState(false);
  const [showFactors, setShowFactors] = useState(false);
  const [showWhatIf, setShowWhatIf] = useState(false);
  const [whatIfHomeBoost, setWhatIfHomeBoost] = useState(0);
  const [whatIfAwayBoost, setWhatIfAwayBoost] = useState(0);
  const [showUserPrediction, setShowUserPrediction] = useState(false);
  const [userPredictionSubmitted, setUserPredictionSubmitted] = useState(false);

  // Help modals
  const [showFactorsHelp, setShowFactorsHelp] = useState(false);
  const [showWhatIfHelp, setShowWhatIfHelp] = useState(false);

  // Load team from params if provided
  useEffect(() => {
    const loadTeamFromParams = async () => {
      if (params.teamId && typeof params.teamId === "string") {
        try {
          const { data, error } = await supabase
            .from("team_elo")
            .select("*")
            .eq("id", params.teamId)
            .single();
          if (!error && data) {
            setHomeTeam(data as TeamData);
          }
        } catch (err) {
          console.error("Error loading team:", err);
        }
      }
    };
    loadTeamFromParams();
  }, [params.teamId]);

  useEffect(() => {
    if (homeTeam && awayTeam) runPrediction();
    else setPrediction(null);
  }, [homeTeam, awayTeam]);

  const runPrediction = async () => {
    if (!homeTeam || !awayTeam) return;
    setLoading(true);
    scoreAnim.setValue(0);
    setUserPredictionSubmitted(false);
    try {
      const result = await generatePrediction(homeTeam, awayTeam);
      setPrediction(result);
      Animated.spring(scoreAnim, {
        toValue: 1,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }).start();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.error("Prediction error:", err);
    } finally {
      setLoading(false);
    }
  };

  const runWhatIfPrediction = async () => {
    if (!homeTeam || !awayTeam) return;
    setLoading(true);
    try {
      const result = await generatePrediction(
        homeTeam,
        awayTeam,
        whatIfHomeBoost,
        whatIfAwayBoost,
      );
      setPrediction(result);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (err) {
      console.error("What-if error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (showWhatIf && homeTeam && awayTeam) {
      const timer = setTimeout(() => runWhatIfPrediction(), 300);
      return () => clearTimeout(timer);
    }
  }, [whatIfHomeBoost, whatIfAwayBoost]);

  const resetPrediction = () => {
    setHomeTeam(null);
    setAwayTeam(null);
    setPrediction(null);
    setShowFactors(false);
    setShowWhatIf(false);
    setWhatIfHomeBoost(0);
    setWhatIfAwayBoost(0);
    setUserPredictionSubmitted(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const sharePrediction = async () => {
    if (!prediction || !homeTeam || !awayTeam) return;
    const message = `⚽ Match Prediction\n\n${homeTeam.team_name}\nvs\n${awayTeam.team_name}\n\n🎯 Predicted Score: ${prediction.predictedHomeScore} - ${prediction.predictedAwayScore}\n\n${prediction.homeWinProbability > prediction.awayWinProbability ? homeTeam.team_name : awayTeam.team_name} favored (${Math.round(Math.max(prediction.homeWinProbability, prediction.awayWinProbability) * 100)}%)\nDraw: ${Math.round(prediction.drawProbability * 100)}%\n\nConfidence: ${prediction.confidence}\n\n— SoccerView App`;
    try {
      await Share.share({ message });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.error("Share error:", err);
    }
  };

  const handleOpenUserPrediction = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setShowUserPrediction(true);
  };

  const handleUserPredictionSubmitted = () => {
    setUserPredictionSubmitted(true);
  };

  // Longer team name for display (20 chars)
  const getDisplayTeamName = (name: string, maxLen = 20) =>
    name.length <= maxLen ? name : name.substring(0, maxLen - 1) + "…";

  const getConfidenceColor = (c: string) => {
    switch (c) {
      case "Very High":
        return "#22c55e";
      case "High":
        return "#4ade80";
      case "Medium":
        return "#f59e0b";
      case "Low":
        return "#ef4444";
      default:
        return "#6b7280";
    }
  };

  // Filter out "Awards" factor if impact is 0 (not useful)
  const getDisplayFactors = () => {
    if (!prediction) return [];
    return prediction.factors.filter((f) => {
      // Remove Awards if it's 0 or very small
      if (f.name === "Awards" && Math.abs(f.impact) < 0.01) return false;
      return true;
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.back();
          }}
        >
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>⚔️ VS Battle</Text>
        <TouchableOpacity
          style={styles.shareButton}
          onPress={sharePrediction}
          disabled={!prediction}
        >
          <Ionicons
            name="share-outline"
            size={24}
            color={prediction ? "#10b981" : "#374151"}
          />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Team Selection Cards */}
        <View style={styles.teamsContainer}>
          <TouchableOpacity
            style={[styles.teamCard, homeTeam && styles.teamCardSelected]}
            onPress={() => setShowHomeSelector(true)}
          >
            {homeTeam ? (
              <>
                <Text style={styles.teamCardName} numberOfLines={2}>
                  {homeTeam.team_name}
                </Text>
                <Text style={styles.teamCardMeta}>
                  {homeTeam.age_group} {homeTeam.gender}
                </Text>
                <Text style={styles.teamCardElo}>
                  {Math.round(homeTeam.elo_rating || 1500)} ELO
                </Text>
              </>
            ) : (
              <>
                <Ionicons name="add-circle-outline" size={40} color="#3B82F6" />
                <Text style={styles.teamCardPlaceholder}>Select Team A</Text>
              </>
            )}
          </TouchableOpacity>
          <View style={styles.vsContainer}>
            <Text style={styles.vsText}>VS</Text>
          </View>
          <TouchableOpacity
            style={[styles.teamCard, awayTeam && styles.teamCardSelected]}
            onPress={() => setShowAwaySelector(true)}
          >
            {awayTeam ? (
              <>
                <Text style={styles.teamCardName} numberOfLines={2}>
                  {awayTeam.team_name}
                </Text>
                <Text style={styles.teamCardMeta}>
                  {awayTeam.age_group} {awayTeam.gender}
                </Text>
                <Text style={styles.teamCardElo}>
                  {Math.round(awayTeam.elo_rating || 1500)} ELO
                </Text>
              </>
            ) : (
              <>
                <Ionicons name="add-circle-outline" size={40} color="#3B82F6" />
                <Text style={styles.teamCardPlaceholder}>Select Team B</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Loading State */}
        {loading && (
          <View style={styles.loadingPrediction}>
            <ActivityIndicator size="large" color="#3B82F6" />
            <Text style={styles.loadingText}>Calculating prediction...</Text>
          </View>
        )}

        {/* Prediction Results */}
        {prediction && !loading && (
          <Animated.View
            style={[
              styles.predictionContainer,
              {
                opacity: scoreAnim,
                transform: [
                  {
                    scale: scoreAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.8, 1],
                    }),
                  },
                ],
              },
            ]}
          >
            {/* Predicted Score */}
            <View style={styles.scoreContainer}>
              <Text style={styles.scoreLabel}>Predicted Score</Text>
              <View style={styles.scoreRow}>
                <Text style={styles.scoreTeam} numberOfLines={1}>
                  {getDisplayTeamName(homeTeam?.team_name || "", 12)}
                </Text>
                <Text style={styles.scoreValue}>
                  {prediction.predictedHomeScore} -{" "}
                  {prediction.predictedAwayScore}
                </Text>
                <Text style={styles.scoreTeam} numberOfLines={1}>
                  {getDisplayTeamName(awayTeam?.team_name || "", 12)}
                </Text>
              </View>
            </View>

            {/* Win Probability - DYNAMIC ALIGNMENT */}
            <View style={styles.probabilityContainer}>
              <Text style={styles.probabilityLabel}>Win Probability</Text>
              <View style={styles.probabilityBar}>
                <View
                  style={[
                    styles.probabilitySegment,
                    {
                      flex: prediction.homeWinProbability,
                      backgroundColor: "#22c55e",
                    },
                  ]}
                />
                <View
                  style={[
                    styles.probabilitySegment,
                    {
                      flex: prediction.drawProbability,
                      backgroundColor: "#f59e0b",
                    },
                  ]}
                />
                <View
                  style={[
                    styles.probabilitySegment,
                    {
                      flex: prediction.awayWinProbability,
                      backgroundColor: "#3B82F6",
                    },
                  ]}
                />
              </View>

              {/* FIXED: Percentage labels with proper spacing */}
              <View style={styles.probabilityLabelsRow}>
                <View style={styles.probLabelWrapper}>
                  <Text style={[styles.probPercent, { color: "#22c55e" }]}>
                    {Math.round(prediction.homeWinProbability * 100)}%
                  </Text>
                  <Text style={styles.probTeamLabel}>Win</Text>
                </View>
                <View style={styles.probLabelWrapper}>
                  <Text style={[styles.probPercent, { color: "#f59e0b" }]}>
                    {Math.round(prediction.drawProbability * 100)}%
                  </Text>
                  <Text style={styles.probTeamLabel}>Draw</Text>
                </View>
                <View style={styles.probLabelWrapper}>
                  <Text style={[styles.probPercent, { color: "#3B82F6" }]}>
                    {Math.round(prediction.awayWinProbability * 100)}%
                  </Text>
                  <Text style={styles.probTeamLabel}>Win</Text>
                </View>
              </View>
            </View>

            {/* Confidence */}
            <View style={styles.confidenceContainer}>
              <Text style={styles.confidenceLabel}>Confidence</Text>
              <Text
                style={[
                  styles.confidenceValue,
                  { color: getConfidenceColor(prediction.confidence) },
                ]}
              >
                {prediction.confidence}
              </Text>
            </View>

            {/* Analytical Factors Toggle */}
            <View style={styles.toggleRow}>
              <TouchableOpacity
                style={styles.toggleButton}
                onPress={() => setShowFactors(!showFactors)}
              >
                <Text style={styles.toggleButtonText}>
                  {showFactors ? "Hide" : "Show"} Analytical Factors
                </Text>
                <Ionicons
                  name={showFactors ? "chevron-up" : "chevron-down"}
                  size={20}
                  color="#3B82F6"
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.helpButton}
                onPress={() => setShowFactorsHelp(true)}
              >
                <Ionicons
                  name="help-circle-outline"
                  size={22}
                  color="#6b7280"
                />
              </TouchableOpacity>
            </View>

            {/* FIXED: Analytical Factors with wider percentage column */}
            {showFactors && (
              <View style={styles.factorsContainer}>
                {getDisplayFactors().map((f, i) => (
                  <View key={i} style={styles.factorRow}>
                    <Text style={styles.factorName}>{f.name}</Text>
                    <View style={styles.factorBarContainer}>
                      <View
                        style={[
                          styles.factorBar,
                          {
                            width: `${Math.min(Math.abs(f.impact) * 100, 100)}%`,
                            backgroundColor:
                              f.impact > 0 ? "#22c55e" : "#ef4444",
                          },
                        ]}
                      />
                    </View>
                    <Text style={styles.factorValue} numberOfLines={1}>
                      {f.impact > 0 ? "+" : ""}
                      {(f.impact * 100).toFixed(0)}%
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {/* What If Scenarios Toggle */}
            <View style={styles.toggleRow}>
              <TouchableOpacity
                style={styles.toggleButton}
                onPress={() => setShowWhatIf(!showWhatIf)}
              >
                <Text style={[styles.toggleButtonText, { color: "#f59e0b" }]}>
                  🎲 What If Scenarios
                </Text>
                <Ionicons
                  name={showWhatIf ? "chevron-up" : "chevron-down"}
                  size={20}
                  color="#f59e0b"
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.helpButton}
                onPress={() => setShowWhatIfHelp(true)}
              >
                <Ionicons
                  name="help-circle-outline"
                  size={22}
                  color="#6b7280"
                />
              </TouchableOpacity>
            </View>

            {/* FIXED: What If Sliders with inline percentage */}
            {showWhatIf && (
              <View style={styles.whatIfContainer}>
                <Text style={styles.whatIfDescription}>
                  Adjust team performance to see how the prediction changes
                </Text>

                {/* Home Team Slider */}
                <View style={styles.sliderContainer}>
                  <View style={styles.sliderLabelRow}>
                    <View
                      style={[
                        styles.sliderTeamDot,
                        { backgroundColor: "#22c55e" },
                      ]}
                    />
                    <Text style={styles.sliderTeamName} numberOfLines={1}>
                      {homeTeam?.team_name || "Team A"}
                    </Text>
                  </View>
                  {/* FIXED: Clean slider with just percentage at end */}
                  <View style={styles.sliderRow}>
                    <Slider
                      style={styles.slider}
                      minimumValue={-20}
                      maximumValue={20}
                      value={whatIfHomeBoost}
                      onValueChange={setWhatIfHomeBoost}
                      minimumTrackTintColor="#22c55e"
                      maximumTrackTintColor="#374151"
                      thumbTintColor="#22c55e"
                    />
                    <Text
                      style={[
                        styles.sliderValueInline,
                        whatIfHomeBoost !== 0 && {
                          color: whatIfHomeBoost > 0 ? "#22c55e" : "#ef4444",
                        },
                      ]}
                      numberOfLines={1}
                    >
                      {whatIfHomeBoost > 0 ? "+" : ""}
                      {Math.round(whatIfHomeBoost)}%
                    </Text>
                  </View>
                </View>

                {/* Away Team Slider */}
                <View style={styles.sliderContainer}>
                  <View style={styles.sliderLabelRow}>
                    <View
                      style={[
                        styles.sliderTeamDot,
                        { backgroundColor: "#3B82F6" },
                      ]}
                    />
                    <Text style={styles.sliderTeamName} numberOfLines={1}>
                      {awayTeam?.team_name || "Team B"}
                    </Text>
                  </View>
                  {/* FIXED: Clean slider with just percentage at end */}
                  <View style={styles.sliderRow}>
                    <Slider
                      style={styles.slider}
                      minimumValue={-20}
                      maximumValue={20}
                      value={whatIfAwayBoost}
                      onValueChange={setWhatIfAwayBoost}
                      minimumTrackTintColor="#3B82F6"
                      maximumTrackTintColor="#374151"
                      thumbTintColor="#3B82F6"
                    />
                    <Text
                      style={[
                        styles.sliderValueInline,
                        whatIfAwayBoost !== 0 && {
                          color: whatIfAwayBoost > 0 ? "#22c55e" : "#ef4444",
                        },
                      ]}
                      numberOfLines={1}
                    >
                      {whatIfAwayBoost > 0 ? "+" : ""}
                      {Math.round(whatIfAwayBoost)}%
                    </Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={styles.resetWhatIfButton}
                  onPress={() => {
                    setWhatIfHomeBoost(0);
                    setWhatIfAwayBoost(0);
                  }}
                >
                  <Text style={styles.resetWhatIfText}>Reset to Original</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* User Prediction Section */}
            <View style={styles.userPredictionSection}>
              <View style={styles.userPredictionDivider} />
              {userPredictionSubmitted ? (
                <View style={styles.predictionSubmittedCard}>
                  <Ionicons name="checkmark-circle" size={24} color="#10b981" />
                  <View style={styles.predictionSubmittedText}>
                    <Text style={styles.predictionSubmittedTitle}>
                      Your Prediction Locked In!
                    </Text>
                    <Text style={styles.predictionSubmittedSubtitle}>
                      Earn points when results come in
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => router.push("/leaderboard")}
                    style={styles.viewLeaderboardLink}
                  >
                    <Text style={styles.viewLeaderboardText}>Leaderboard</Text>
                    <Ionicons
                      name="chevron-forward"
                      size={16}
                      color="#3B82F6"
                    />
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.makeMyPredictionButton}
                  onPress={handleOpenUserPrediction}
                >
                  <View style={styles.makeMyPredictionContent}>
                    <Text style={styles.makeMyPredictionEmoji}>🎯</Text>
                    <View style={styles.makeMyPredictionTextContainer}>
                      <Text style={styles.makeMyPredictionTitle}>
                        Make YOUR Prediction
                      </Text>
                      <Text style={styles.makeMyPredictionSubtitle}>
                        Guess the score & earn points on the leaderboard
                      </Text>
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={24} color="#f59e0b" />
                </TouchableOpacity>
              )}
            </View>

            <TouchableOpacity
              style={styles.newPredictionButton}
              onPress={resetPrediction}
            >
              <Ionicons name="refresh" size={20} color="#fff" />
              <Text style={styles.newPredictionText}>New Prediction</Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* Empty State */}
        {!prediction && !loading && (
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

      {/* Team Selector Modals */}
      <TeamSelectorModal
        visible={showHomeSelector}
        onClose={() => setShowHomeSelector(false)}
        onSelect={setHomeTeam}
        excludeTeamId={awayTeam?.id}
        title="Select Team A"
        suggestedAgeGroup={awayTeam?.age_group ?? undefined}
        suggestedGender={awayTeam?.gender ?? undefined}
        suggestedState={awayTeam?.state ?? undefined}
      />
      <TeamSelectorModal
        visible={showAwaySelector}
        onClose={() => setShowAwaySelector(false)}
        onSelect={setAwayTeam}
        excludeTeamId={homeTeam?.id}
        title="Select Opponent"
        suggestedAgeGroup={homeTeam?.age_group ?? undefined}
        suggestedGender={homeTeam?.gender ?? undefined}
        suggestedState={homeTeam?.state ?? undefined}
      />

      {/* User Prediction Modal */}
      {homeTeam && awayTeam && (
        <PredictionModal
          visible={showUserPrediction}
          onClose={() => setShowUserPrediction(false)}
          teamA={{
            name: homeTeam.team_name || "",
            state: homeTeam.state ?? undefined,
            ageGroup: homeTeam.age_group ?? undefined,
            gender: homeTeam.gender ?? undefined,
          }}
          teamB={{
            name: awayTeam.team_name || "",
            state: awayTeam.state ?? undefined,
            ageGroup: awayTeam.age_group ?? undefined,
            gender: awayTeam.gender ?? undefined,
          }}
          onPredictionSubmitted={handleUserPredictionSubmitted}
        />
      )}

      {/* FIXED: Analytical Factors Help Modal - Restructured for proper scrolling */}
      <Modal
        visible={showFactorsHelp}
        transparent
        animationType="fade"
        onRequestClose={() => setShowFactorsHelp(false)}
      >
        <View style={styles.helpModalOverlay}>
          {/* Tap outside to close - positioned behind content */}
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setShowFactorsHelp(false)}
          />
          {/* Modal content - sits on top, doesn't block scroll */}
          <View
            style={[
              styles.helpModalContent,
              { height: Dimensions.get("window").height * 0.7 },
            ]}
          >
            <View style={styles.helpModalHeader}>
              <Text style={styles.helpModalTitle}>📊 Analytical Factors</Text>
              <TouchableOpacity onPress={() => setShowFactorsHelp(false)}>
                <Ionicons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{
                paddingHorizontal: 16,
                paddingTop: 16,
                paddingBottom: 32,
              }}
              showsVerticalScrollIndicator={true}
              bounces={true}
            >
              <Text style={styles.helpModalDescription}>
                These factors show how each metric influences the prediction.
                Green bars favor Team A, red bars favor Team B.
              </Text>
              {Object.entries(FACTOR_HELP).map(([name, desc]) => (
                <View key={name} style={styles.helpFactorItem}>
                  <Text style={styles.helpFactorName}>{name}</Text>
                  <Text style={styles.helpFactorDesc}>{desc}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* FIXED: What If Help Modal - Restructured for proper scrolling */}
      <Modal
        visible={showWhatIfHelp}
        transparent
        animationType="fade"
        onRequestClose={() => setShowWhatIfHelp(false)}
      >
        <View style={styles.helpModalOverlay}>
          {/* Tap outside to close - positioned behind content */}
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setShowWhatIfHelp(false)}
          />
          {/* Modal content - sits on top, doesn't block scroll */}
          <View
            style={[
              styles.helpModalContent,
              { height: Dimensions.get("window").height * 0.7 },
            ]}
          >
            <View style={styles.helpModalHeader}>
              <Text style={styles.helpModalTitle}>🎲 What If Scenarios</Text>
              <TouchableOpacity onPress={() => setShowWhatIfHelp(false)}>
                <Ionicons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{
                paddingHorizontal: 16,
                paddingTop: 16,
                paddingBottom: 32,
              }}
              showsVerticalScrollIndicator={true}
              bounces={true}
            >
              <Text style={styles.helpModalDescription}>
                Explore hypothetical scenarios by boosting or reducing each
                team's performance:
              </Text>
              <View style={styles.helpBulletItem}>
                <Text style={styles.helpBullet}>•</Text>
                <Text style={styles.helpBulletText}>
                  <Text style={{ color: "#22c55e", fontWeight: "600" }}>
                    +20%
                  </Text>{" "}
                  = Team playing at peak performance (hot streak, key players
                  healthy)
                </Text>
              </View>
              <View style={styles.helpBulletItem}>
                <Text style={styles.helpBullet}>•</Text>
                <Text style={styles.helpBulletText}>
                  <Text style={{ color: "#ef4444", fontWeight: "600" }}>
                    -20%
                  </Text>{" "}
                  = Team underperforming (injuries, fatigue, off day)
                </Text>
              </View>
              <View style={styles.helpBulletItem}>
                <Text style={styles.helpBullet}>•</Text>
                <Text style={styles.helpBulletText}>
                  <Text style={{ fontWeight: "600" }}>0%</Text> = Team plays at
                  their expected level
                </Text>
              </View>
              <Text style={[styles.helpModalDescription, { marginTop: 16 }]}>
                The prediction updates in real-time as you adjust the sliders!
              </Text>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ============================================================
// STYLES
// ============================================================

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
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
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "600" },
  shareButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#1F2937",
    justifyContent: "center",
    alignItems: "center",
  },
  scrollView: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  teamsContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 24,
  },
  teamCard: {
    flex: 1,
    backgroundColor: "#1F2937",
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 120,
    borderWidth: 2,
    borderColor: "transparent",
  },
  teamCardSelected: { borderColor: "#3B82F6" },
  teamCardName: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 4,
  },
  teamCardMeta: { color: "#9ca3af", fontSize: 12, marginBottom: 4 },
  teamCardElo: { color: "#3B82F6", fontSize: 16, fontWeight: "bold" },
  teamCardPlaceholder: { color: "#6b7280", fontSize: 14, marginTop: 8 },
  vsContainer: { paddingHorizontal: 12 },
  vsText: { color: "#6b7280", fontSize: 16, fontWeight: "600" },
  loadingPrediction: { alignItems: "center", paddingVertical: 40 },
  loadingText: { color: "#9ca3af", fontSize: 14, marginTop: 12 },
  predictionContainer: {
    backgroundColor: "#111",
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  scoreContainer: { alignItems: "center", marginBottom: 24 },
  scoreLabel: { color: "#9ca3af", fontSize: 14, marginBottom: 8 },
  scoreRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
  },
  scoreTeam: { color: "#9ca3af", fontSize: 12, flex: 1, textAlign: "center" },
  scoreValue: { color: "#fff", fontSize: 36, fontWeight: "bold" },
  probabilityContainer: { marginBottom: 20 },
  probabilityLabel: {
    color: "#9ca3af",
    fontSize: 14,
    marginBottom: 8,
    textAlign: "center",
  },
  probabilityBar: {
    flexDirection: "row",
    height: 24,
    borderRadius: 12,
    overflow: "hidden",
    marginBottom: 8,
  },
  probabilitySegment: { height: "100%" },

  // FIXED PROBABILITY LABELS - proper spacing
  probabilityLabelsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 4,
  },
  probLabelWrapper: {
    alignItems: "center",
    minWidth: 60,
  },
  probPercent: {
    fontSize: 15,
    fontWeight: "700",
  },
  probTeamLabel: {
    color: "#6b7280",
    fontSize: 11,
    marginTop: 2,
  },

  confidenceContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
    marginBottom: 16,
  },
  confidenceLabel: { color: "#9ca3af", fontSize: 14 },
  confidenceValue: { fontSize: 16, fontWeight: "600" },

  // Toggle with help button
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  toggleButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    gap: 8,
    flex: 1,
  },
  toggleButtonText: { color: "#3B82F6", fontSize: 14, fontWeight: "600" },
  helpButton: {
    padding: 8,
  },

  factorsContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
  },
  factorRow: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  factorName: { color: "#9ca3af", fontSize: 12, width: 90 },
  factorBarContainer: {
    flex: 1,
    height: 8,
    backgroundColor: "#1F2937",
    borderRadius: 4,
    marginHorizontal: 8,
  },
  factorBar: { height: "100%", borderRadius: 4 },
  // FIXED: Wider width for percentage to prevent wrapping
  factorValue: { color: "#fff", fontSize: 12, width: 50, textAlign: "right" },

  whatIfContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
  },
  whatIfDescription: {
    color: "#9ca3af",
    fontSize: 12,
    textAlign: "center",
    marginBottom: 16,
  },
  sliderContainer: { marginBottom: 20 },
  sliderLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    gap: 8,
  },
  sliderTeamDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  sliderTeamName: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    flex: 1,
  },
  sliderRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  slider: { flex: 1, height: 40 },
  // FIXED: Inline percentage - wider width, no wrap
  sliderValueInline: {
    color: "#9ca3af",
    fontSize: 14,
    fontWeight: "600",
    minWidth: 50,
    textAlign: "right",
    marginLeft: 8,
  },
  resetWhatIfButton: { alignItems: "center", paddingVertical: 8 },
  resetWhatIfText: { color: "#6b7280", fontSize: 13 },

  // User Prediction Section
  userPredictionSection: {
    marginTop: 16,
  },
  userPredictionDivider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.1)",
    marginBottom: 16,
  },
  makeMyPredictionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(245, 158, 11, 0.1)",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.3)",
  },
  makeMyPredictionContent: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  makeMyPredictionEmoji: {
    fontSize: 28,
    marginRight: 12,
  },
  makeMyPredictionTextContainer: {
    flex: 1,
  },
  makeMyPredictionTitle: {
    color: "#f59e0b",
    fontSize: 16,
    fontWeight: "bold",
  },
  makeMyPredictionSubtitle: {
    color: "#9ca3af",
    fontSize: 12,
    marginTop: 2,
  },
  predictionSubmittedCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(16, 185, 129, 0.1)",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.3)",
  },
  predictionSubmittedText: {
    flex: 1,
    marginLeft: 12,
  },
  predictionSubmittedTitle: {
    color: "#10b981",
    fontSize: 14,
    fontWeight: "600",
  },
  predictionSubmittedSubtitle: {
    color: "#6b7280",
    fontSize: 12,
    marginTop: 2,
  },
  viewLeaderboardLink: {
    flexDirection: "row",
    alignItems: "center",
  },
  viewLeaderboardText: {
    color: "#3B82F6",
    fontSize: 13,
    fontWeight: "600",
  },

  newPredictionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#3B82F6",
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 20,
    gap: 8,
  },
  newPredictionText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  emptyState: { alignItems: "center", paddingVertical: 60 },
  emptyStateTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
    marginTop: 16,
    marginBottom: 8,
  },
  emptyStateSubtitle: { color: "#6b7280", fontSize: 14, textAlign: "center" },

  // FIXED: Help Modal Styles - proper scrolling structure
  helpModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.85)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  helpModalContent: {
    backgroundColor: "#1F2937",
    borderRadius: 20,
    width: "100%",
    overflow: "hidden",
  },
  helpModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  helpModalTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
  },
  helpModalDescription: {
    color: "#9ca3af",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  helpFactorItem: {
    marginBottom: 16,
  },
  helpFactorName: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 4,
  },
  helpFactorDesc: {
    color: "#9ca3af",
    fontSize: 13,
    lineHeight: 18,
  },
  helpBulletItem: {
    flexDirection: "row",
    marginBottom: 12,
  },
  helpBullet: {
    color: "#f59e0b",
    fontSize: 16,
    marginRight: 8,
    lineHeight: 20,
  },
  helpBulletText: {
    color: "#d1d5db",
    fontSize: 14,
    lineHeight: 20,
    flex: 1,
  },

  // Modal Styles (Team Selector)
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.9)" },
  modalContent: {
    flex: 1,
    backgroundColor: "#111",
    marginTop: 60,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  modalTitle: { color: "#fff", fontSize: 18, fontWeight: "600" },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#1F2937",
    justifyContent: "center",
    alignItems: "center",
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1F2937",
    borderRadius: 12,
    margin: 16,
    paddingHorizontal: 12,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, color: "#fff", fontSize: 16, paddingVertical: 12 },
  filtersContainer: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  filterRow: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  filterLabel: { color: "#9ca3af", fontSize: 12, width: 50 },
  filterScroll: { flex: 1, marginLeft: 8 },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "#1F2937",
    marginRight: 8,
  },
  filterChipActive: { backgroundColor: "#3B82F6" },
  filterChipText: { color: "#9ca3af", fontSize: 12 },
  filterChipTextActive: { color: "#fff" },
  clearFiltersButton: { alignSelf: "flex-end", paddingVertical: 4 },
  clearFiltersText: { color: "#ef4444", fontSize: 12 },
  loadingContainer: { padding: 40, alignItems: "center" },
  resultsList: { flex: 1, paddingHorizontal: 16 },
  teamResultItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1F2937",
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  teamResultInfo: { flex: 1 },
  teamResultName: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 4,
  },
  teamBadgeRow: { flexDirection: "row", gap: 6 },
  ageBadge: {
    backgroundColor: "rgba(34,197,94,0.2)",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  ageBadgeText: { color: "#22c55e", fontSize: 11, fontWeight: "500" },
  genderBadge: {
    backgroundColor: "rgba(59,130,246,0.2)",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  genderBadgeText: { color: "#3B82F6", fontSize: 11, fontWeight: "500" },
  stateBadge: {
    backgroundColor: "rgba(245,158,11,0.2)",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  stateBadgeText: { color: "#f59e0b", fontSize: 11, fontWeight: "500" },
  teamResultRight: { alignItems: "flex-end" },
  teamResultElo: { color: "#3B82F6", fontSize: 16, fontWeight: "600" },
  teamResultRank: { color: "#9ca3af", fontSize: 12 },
  emptyResults: { padding: 40, alignItems: "center", gap: 12 },
  emptyResultsText: { color: "#6b7280", fontSize: 14 },
});
