import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import React, { useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const ONBOARDING_KEY = "soccerview_onboarding_complete";

interface OnboardingSlide {
  id: number;
  icon: string;
  title: string;
  description: string;
  color: string;
}

const slides: OnboardingSlide[] = [
  {
    id: 0,
    icon: "⚽",
    title: "Welcome to SoccerView",
    description:
      "The ultimate youth soccer ranking app. Track thousands of teams across the nation with real match data and ELO-based rankings.",
    color: "#10b981",
  },
  {
    id: 1,
    icon: "🏆",
    title: "National & State Rankings",
    description:
      "See how teams stack up nationally or filter by state. Rankings are updated daily based on actual match results using proven ELO methodology.",
    color: "#3b82f6",
  },
  {
    id: 2,
    icon: "📊",
    title: "Team Stats & Match History",
    description:
      "Dive deep into any team's performance. View win/loss records, ELO history, and complete match results all in one place.",
    color: "#8b5cf6",
  },
  {
    id: 3,
    icon: "🔍",
    title: "Find Any Team",
    description:
      "Search over 100,000 ranked teams nationwide. Filter by state, gender, and age group to find exactly what you're looking for.",
    color: "#f59e0b",
  },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scrollViewRef = useRef<ScrollView>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isNavigating, setIsNavigating] = useState(false);

  const handleScroll = Animated.event(
    [{ nativeEvent: { contentOffset: { x: scrollX } } }],
    {
      useNativeDriver: false,
      listener: (event: any) => {
        const index = Math.round(
          event.nativeEvent.contentOffset.x / SCREEN_WIDTH,
        );
        if (index >= 0 && index < slides.length) {
          setCurrentIndex(index);
        }
      },
    },
  );

  const goToSlide = (index: number) => {
    scrollViewRef.current?.scrollTo({
      x: index * SCREEN_WIDTH,
      animated: true,
    });
  };

  const handleNext = () => {
    if (currentIndex < slides.length - 1) {
      goToSlide(currentIndex + 1);
    } else {
      completeOnboarding();
    }
  };

  const handleSkip = () => {
    completeOnboarding();
  };

  const completeOnboarding = async () => {
    // Prevent double-tap
    if (isNavigating) return;
    setIsNavigating(true);

    console.log("[Onboarding] Completing onboarding...");

    try {
      // Save onboarding complete status
      await AsyncStorage.setItem(ONBOARDING_KEY, "true");
      console.log("[Onboarding] Status saved to AsyncStorage");
    } catch (error) {
      console.error("[Onboarding] Error saving status:", error);
    }

    // Navigate to main app - use replace to prevent going back to onboarding
    console.log("[Onboarding] Navigating to home...");

    try {
      // Small delay to ensure state is saved
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Use replace to prevent back navigation to onboarding
      router.replace("/");
    } catch (navError) {
      console.error("[Onboarding] Navigation error:", navError);

      // Fallback approaches
      try {
        router.push("/");
      } catch (fallbackError) {
        console.error("[Onboarding] Fallback push failed:", fallbackError);

        // Last resort for web
        if (Platform.OS === "web" && typeof window !== "undefined") {
          window.location.href = "/";
        }
      }
    }
  };

  const isLastSlide = currentIndex === slides.length - 1;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Skip button - always visible except on last slide */}
      {!isLastSlide && (
        <TouchableOpacity
          style={[styles.skipButton, { top: insets.top + 16 }]}
          onPress={handleSkip}
          activeOpacity={0.7}
        >
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      )}

      {/* Slides */}
      <Animated.ScrollView
        ref={scrollViewRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        decelerationRate="fast"
        style={styles.scrollView}
      >
        {slides.map((slide) => (
          <View key={slide.id} style={styles.slide}>
            <View style={styles.slideContent}>
              {/* Icon */}
              <View
                style={[
                  styles.iconContainer,
                  { backgroundColor: slide.color + "20" },
                ]}
              >
                <Text style={styles.icon}>{slide.icon}</Text>
              </View>

              {/* Title */}
              <Text style={styles.title}>{slide.title}</Text>

              {/* Description */}
              <Text style={styles.description}>{slide.description}</Text>
            </View>
          </View>
        ))}
      </Animated.ScrollView>

      {/* Bottom section */}
      <View
        style={[styles.bottomSection, { paddingBottom: insets.bottom + 24 }]}
      >
        {/* Pagination dots */}
        <View style={styles.pagination}>
          {slides.map((_, index) => {
            const inputRange = [
              (index - 1) * SCREEN_WIDTH,
              index * SCREEN_WIDTH,
              (index + 1) * SCREEN_WIDTH,
            ];

            const dotWidth = scrollX.interpolate({
              inputRange,
              outputRange: [8, 24, 8],
              extrapolate: "clamp",
            });

            const dotOpacity = scrollX.interpolate({
              inputRange,
              outputRange: [0.3, 1, 0.3],
              extrapolate: "clamp",
            });

            return (
              <Animated.View
                key={index}
                style={[
                  styles.dot,
                  {
                    width: dotWidth,
                    opacity: dotOpacity,
                    backgroundColor:
                      currentIndex === index
                        ? slides[currentIndex].color
                        : "#666",
                  },
                ]}
              />
            );
          })}
        </View>

        {/* Action button */}
        <TouchableOpacity
          style={[
            styles.actionButton,
            { backgroundColor: slides[currentIndex].color },
            isNavigating && styles.actionButtonDisabled,
          ]}
          onPress={handleNext}
          activeOpacity={0.8}
          disabled={isNavigating}
        >
          <Text style={styles.actionButtonText}>
            {isNavigating ? "Loading..." : isLastSlide ? "Get Started" : "Next"}
          </Text>
        </TouchableOpacity>

        {/* Page indicator text */}
        <Text style={styles.pageIndicator}>
          {currentIndex + 1} of {slides.length}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  skipButton: {
    position: "absolute",
    right: 20,
    zIndex: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  skipText: {
    color: "#9ca3af",
    fontSize: 16,
    fontWeight: "500",
  },
  scrollView: {
    flex: 1,
  },
  slide: {
    width: SCREEN_WIDTH,
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },
  slideContent: {
    alignItems: "center",
    maxWidth: 400,
  },
  iconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 40,
  },
  icon: {
    fontSize: 56,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#fff",
    textAlign: "center",
    marginBottom: 16,
    ...Platform.select({
      web: { fontFamily: "system-ui, -apple-system, sans-serif" },
    }),
  },
  description: {
    fontSize: 17,
    color: "#9ca3af",
    textAlign: "center",
    lineHeight: 26,
    ...Platform.select({
      web: { fontFamily: "system-ui, -apple-system, sans-serif" },
    }),
  },
  bottomSection: {
    paddingHorizontal: 24,
    alignItems: "center",
  },
  pagination: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 32,
    gap: 8,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  actionButton: {
    width: "100%",
    maxWidth: 360,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  actionButtonDisabled: {
    opacity: 0.7,
  },
  actionButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
    ...Platform.select({
      web: { fontFamily: "system-ui, -apple-system, sans-serif" },
    }),
  },
  pageIndicator: {
    marginTop: 16,
    fontSize: 14,
    color: "#6b7280",
  },
});
