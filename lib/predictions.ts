/**
 * SoccerView Prediction Engine v1.1 - ALL FIXES
 *
 * Multi-factor AI prediction algorithm that goes beyond basic ELO.
 * Uses 6 weighted factors for accurate game predictions.
 *
 * v1.1 FIXES:
 * - Improved confidence calculation (much more generous)
 * - Better number formatting (integers for ELO)
 * - Clearer factor naming ("Win Rate" instead of "Form")
 * - Fixed decimal overflow issues
 *
 * Factors:
 * 1. ELO Difference (40%) - Core prediction model
 * 2. Goals For/Against (20%) - Scoring power and defensive strength
 * 3. Win Rate (15%) - Historical win percentage
 * 4. Championship Pedigree (10%) - Teams with awards perform better
 * 5. Head-to-Head (10%) - Future enhancement
 * 6. Schedule Strength (5%) - Quality of competition faced
 */

export type TeamStats = {
  id: string;
  team_name: string;
  elo_rating: number | null;
  matches_played: number | null;
  wins: number | null;
  losses: number | null;
  draws: number | null;
  state: string | null;
  gender: string | null;
  age_group: string | null;
  // GotSport data
  national_rank: number | null;
  regional_rank: number | null;
  state_rank: number | null;
  gotsport_points: number | null;
  goals_for: number | null;
  goals_against: number | null;
  win_percent: number | null;
  national_award: string | null;
  regional_award: string | null;
  state_cup_award: string | null;
  logo_url: string | null;
  club_name: string | null;
};

export type PredictionResult = {
  // Core prediction
  predictedHomeScore: number;
  predictedAwayScore: number;
  homeWinProbability: number;
  drawProbability: number;
  awayWinProbability: number;

  // Confidence
  confidenceLevel: "Low" | "Medium" | "High" | "Very High";
  confidencePercent: number;

  // Factor breakdown
  factors: {
    name: string;
    homeValue: number | string;
    awayValue: number | string;
    homeAdvantage: number; // -100 to +100
    weight: number;
  }[];

  // Tale of the tape stats
  comparison: {
    category: string;
    homeValue: string;
    awayValue: string;
    winner: "home" | "away" | "tie";
  }[];
};

// ============================================================
// CONSTANTS
// ============================================================

// Factor weights (must sum to 1.0)
const WEIGHTS = {
  ELO: 0.4,
  GOALS: 0.2,
  FORM: 0.15,
  CHAMPIONSHIP: 0.1,
  COMMON_OPPONENTS: 0.1,
  SCHEDULE_STRENGTH: 0.05,
};

// ELO constants
const DEFAULT_ELO = 1500;
const ELO_K_FACTOR = 400;

// Expected goals per game in youth soccer
const AVG_GOALS_PER_GAME = 2.5;

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Calculate win probability from ELO difference using logistic function
 */
function eloWinProbability(ratingDiff: number): number {
  return 1 / (1 + Math.pow(10, -ratingDiff / ELO_K_FACTOR));
}

/**
 * Calculate goal differential ratio
 */
function getGoalDiffRatio(goalsFor: number, goalsAgainst: number): number {
  const total = goalsFor + goalsAgainst;
  if (total === 0) return 0;
  return (goalsFor - goalsAgainst) / total;
}

/**
 * Calculate championship pedigree score (0-3)
 */
function getChampionshipScore(team: TeamStats): number {
  let score = 0;
  if (team.national_award) score += 3;
  if (team.regional_award) score += 2;
  if (team.state_cup_award) score += 1;
  return score;
}

/**
 * Get win rate score based on win percentage
 */
function getWinRateScore(team: TeamStats): number {
  // Prefer explicit win_percent from GotSport
  if (team.win_percent !== null && team.win_percent > 0) {
    return team.win_percent;
  }

  // Calculate from W-L-D
  const matches = team.matches_played || 0;
  const wins = team.wins || 0;
  if (matches === 0) return 0.5;

  return wins / matches;
}

/**
 * Estimate schedule strength from national rank
 */
function getScheduleStrength(team: TeamStats): number {
  const rank = team.national_rank;
  if (!rank) return 0.5;

  if (rank <= 100) return 0.85;
  if (rank <= 250) return 0.75;
  if (rank <= 500) return 0.65;
  if (rank <= 1000) return 0.55;
  return 0.45;
}

/**
 * Convert advantage score to expected goal differential
 */
function advantageToGoalDiff(advantage: number): number {
  return (advantage - 0.5) * 6;
}

/**
 * Calculate confidence level - v1.1 FIXED: Much more generous
 *
 * The old algorithm required too much data. New algorithm:
 * - Base 40% just for having two teams with ELO
 * - Bonus points for additional data
 * - More forgiving thresholds
 */
function calculateConfidence(
  homeTeam: TeamStats,
  awayTeam: TeamStats,
): {
  level: "Low" | "Medium" | "High" | "Very High";
  percent: number;
} {
  let score = 0;

  // BASE: Both teams exist with some data = 40%
  score += 40;

  // ELO available and different from default (+15%)
  const homeElo = homeTeam.elo_rating || DEFAULT_ELO;
  const awayElo = awayTeam.elo_rating || DEFAULT_ELO;
  if (homeElo !== DEFAULT_ELO && awayElo !== DEFAULT_ELO) {
    score += 15;
  } else if (homeElo !== DEFAULT_ELO || awayElo !== DEFAULT_ELO) {
    score += 8;
  }

  // Win/Loss record available (+15%)
  const homeMatches = homeTeam.matches_played || 0;
  const awayMatches = awayTeam.matches_played || 0;
  if (homeMatches > 0 && awayMatches > 0) {
    score += 15;
  } else if (homeMatches > 0 || awayMatches > 0) {
    score += 8;
  }

  // Same age group and gender (+15%)
  if (
    homeTeam.age_group &&
    awayTeam.age_group &&
    homeTeam.gender &&
    awayTeam.gender
  ) {
    if (
      homeTeam.age_group === awayTeam.age_group &&
      homeTeam.gender === awayTeam.gender
    ) {
      score += 15;
    } else {
      score += 5; // Partial credit
    }
  }

  // Bonus: Goals data (+10%)
  if ((homeTeam.goals_for || 0) > 0 || (awayTeam.goals_for || 0) > 0) {
    score += 10;
  }

  // Bonus: National rank (+5%)
  if (homeTeam.national_rank || awayTeam.national_rank) {
    score += 5;
  }

  // Cap at 100
  const percent = Math.min(100, score);

  // Determine level with lower thresholds
  let level: "Low" | "Medium" | "High" | "Very High";
  if (percent >= 85) level = "Very High";
  else if (percent >= 65) level = "High";
  else if (percent >= 50) level = "Medium";
  else level = "Low";

  return { level, percent };
}

// ============================================================
// MAIN PREDICTION FUNCTION
// ============================================================

export function predictMatch(
  homeTeam: TeamStats,
  awayTeam: TeamStats,
): PredictionResult {
  const factors: PredictionResult["factors"] = [];
  let totalHomeAdvantage = 0;

  // ============================================================
  // FACTOR 1: ELO DIFFERENCE (40%)
  // ============================================================
  // FIXED: Round to integer
  const homeElo = Math.round(homeTeam.elo_rating || DEFAULT_ELO);
  const awayElo = Math.round(awayTeam.elo_rating || DEFAULT_ELO);
  const eloDiff = homeElo - awayElo;
  const eloAdvantage = eloWinProbability(eloDiff);

  factors.push({
    name: "ELO Rating",
    homeValue: homeElo,
    awayValue: awayElo,
    homeAdvantage: Math.round((eloAdvantage - 0.5) * 200),
    weight: WEIGHTS.ELO,
  });
  totalHomeAdvantage += eloAdvantage * WEIGHTS.ELO;

  // ============================================================
  // FACTOR 2: GOALS FOR/AGAINST (20%)
  // ============================================================
  const homeGF = homeTeam.goals_for || 0;
  const homeGA = homeTeam.goals_against || 0;
  const awayGF = awayTeam.goals_for || 0;
  const awayGA = awayTeam.goals_against || 0;

  const homeGoalRatio = getGoalDiffRatio(homeGF, homeGA);
  const awayGoalRatio = getGoalDiffRatio(awayGF, awayGA);
  const goalAdvantage = 0.5 + (homeGoalRatio - awayGoalRatio) / 2;

  const homeGD = homeGF - homeGA;
  const awayGD = awayGF - awayGA;

  factors.push({
    name: "Goal Diff",
    homeValue: homeGD >= 0 ? `+${homeGD}` : `${homeGD}`,
    awayValue: awayGD >= 0 ? `+${awayGD}` : `${awayGD}`,
    homeAdvantage: Math.round((goalAdvantage - 0.5) * 200),
    weight: WEIGHTS.GOALS,
  });
  totalHomeAdvantage += Math.max(0, Math.min(1, goalAdvantage)) * WEIGHTS.GOALS;

  // ============================================================
  // FACTOR 3: WIN RATE (15%) - Renamed from "Form"
  // ============================================================
  const homeWinRate = getWinRateScore(homeTeam);
  const awayWinRate = getWinRateScore(awayTeam);
  const winRateAdvantage = 0.5 + (homeWinRate - awayWinRate) / 2;

  factors.push({
    name: "Win Rate",
    homeValue: `${Math.round(homeWinRate * 100)}%`,
    awayValue: `${Math.round(awayWinRate * 100)}%`,
    homeAdvantage: Math.round((winRateAdvantage - 0.5) * 200),
    weight: WEIGHTS.FORM,
  });
  totalHomeAdvantage +=
    Math.max(0, Math.min(1, winRateAdvantage)) * WEIGHTS.FORM;

  // ============================================================
  // FACTOR 4: CHAMPIONSHIP PEDIGREE (10%)
  // ============================================================
  const homeChamp = getChampionshipScore(homeTeam);
  const awayChamp = getChampionshipScore(awayTeam);
  const maxChamp = Math.max(homeChamp, awayChamp, 1);
  const champAdvantage = 0.5 + ((homeChamp - awayChamp) / maxChamp) * 0.5;

  const homeAwards =
    [
      homeTeam.national_award ? "🏆" : "",
      homeTeam.regional_award ? "🥇" : "",
      homeTeam.state_cup_award ? "🥈" : "",
    ]
      .filter(Boolean)
      .join("") || "—";

  const awayAwards =
    [
      awayTeam.national_award ? "🏆" : "",
      awayTeam.regional_award ? "🥇" : "",
      awayTeam.state_cup_award ? "🥈" : "",
    ]
      .filter(Boolean)
      .join("") || "—";

  factors.push({
    name: "Awards",
    homeValue: homeAwards,
    awayValue: awayAwards,
    homeAdvantage: Math.round((champAdvantage - 0.5) * 200),
    weight: WEIGHTS.CHAMPIONSHIP,
  });
  totalHomeAdvantage +=
    Math.max(0, Math.min(1, champAdvantage)) * WEIGHTS.CHAMPIONSHIP;

  // ============================================================
  // FACTOR 5: HEAD-TO-HEAD (10%) - Future enhancement
  // ============================================================
  const commonOppAdvantage = 0.5;
  factors.push({
    name: "Head-to-Head",
    homeValue: "—",
    awayValue: "—",
    homeAdvantage: 0,
    weight: WEIGHTS.COMMON_OPPONENTS,
  });
  totalHomeAdvantage += commonOppAdvantage * WEIGHTS.COMMON_OPPONENTS;

  // ============================================================
  // FACTOR 6: SCHEDULE STRENGTH (5%)
  // ============================================================
  const homeSchedule = getScheduleStrength(homeTeam);
  const awaySchedule = getScheduleStrength(awayTeam);
  const scheduleAdvantage = 0.5 + (homeSchedule - awaySchedule) / 2;

  factors.push({
    name: "Strength",
    homeValue: Math.round(homeSchedule * 100),
    awayValue: Math.round(awaySchedule * 100),
    homeAdvantage: Math.round((scheduleAdvantage - 0.5) * 200),
    weight: WEIGHTS.SCHEDULE_STRENGTH,
  });
  totalHomeAdvantage +=
    Math.max(0, Math.min(1, scheduleAdvantage)) * WEIGHTS.SCHEDULE_STRENGTH;

  // ============================================================
  // CALCULATE FINAL PROBABILITIES
  // ============================================================
  const normalizedAdvantage = Math.max(
    0.05,
    Math.min(0.95, totalHomeAdvantage),
  );

  // Draw probability (soccer typically has ~20% draws)
  const drawBase = 0.2;
  const dominance = Math.abs(normalizedAdvantage - 0.5) * 2;
  const drawProbability = Math.max(0.08, drawBase * (1 - dominance * 0.7));

  const remainingProb = 1 - drawProbability;
  const homeWinProbability = normalizedAdvantage * remainingProb;
  const awayWinProbability = (1 - normalizedAdvantage) * remainingProb;

  // ============================================================
  // PREDICT SCORE
  // ============================================================
  const goalDiff = advantageToGoalDiff(normalizedAdvantage);
  const homeExpectedGoals = AVG_GOALS_PER_GAME / 2 + goalDiff / 2;
  const awayExpectedGoals = AVG_GOALS_PER_GAME / 2 - goalDiff / 2;

  const predictedHomeScore = Math.max(0, Math.round(homeExpectedGoals));
  const predictedAwayScore = Math.max(0, Math.round(awayExpectedGoals));

  // ============================================================
  // CONFIDENCE CALCULATION - v1.1 FIXED
  // ============================================================
  const confidence = calculateConfidence(homeTeam, awayTeam);

  // ============================================================
  // TALE OF THE TAPE - FIXED: Integer formatting
  // ============================================================
  const comparison: PredictionResult["comparison"] = [];

  // Record
  comparison.push({
    category: "Record",
    homeValue: `${homeTeam.wins || 0}-${homeTeam.losses || 0}-${homeTeam.draws || 0}`,
    awayValue: `${awayTeam.wins || 0}-${awayTeam.losses || 0}-${awayTeam.draws || 0}`,
    winner:
      (homeTeam.wins || 0) > (awayTeam.wins || 0)
        ? "home"
        : (homeTeam.wins || 0) < (awayTeam.wins || 0)
          ? "away"
          : "tie",
  });

  // National Rank
  comparison.push({
    category: "Nat'l Rank",
    homeValue: homeTeam.national_rank ? `#${homeTeam.national_rank}` : "—",
    awayValue: awayTeam.national_rank ? `#${awayTeam.national_rank}` : "—",
    winner:
      homeTeam.national_rank && awayTeam.national_rank
        ? homeTeam.national_rank < awayTeam.national_rank
          ? "home"
          : homeTeam.national_rank > awayTeam.national_rank
            ? "away"
            : "tie"
        : "tie",
  });

  // Goals For
  comparison.push({
    category: "Goals For",
    homeValue: String(homeTeam.goals_for || 0),
    awayValue: String(awayTeam.goals_for || 0),
    winner:
      (homeTeam.goals_for || 0) > (awayTeam.goals_for || 0)
        ? "home"
        : (homeTeam.goals_for || 0) < (awayTeam.goals_for || 0)
          ? "away"
          : "tie",
  });

  // Goals Against (lower is better)
  comparison.push({
    category: "Goals Ag.",
    homeValue: String(homeTeam.goals_against || 0),
    awayValue: String(awayTeam.goals_against || 0),
    winner:
      (homeTeam.goals_against || 0) < (awayTeam.goals_against || 0)
        ? "home"
        : (homeTeam.goals_against || 0) > (awayTeam.goals_against || 0)
          ? "away"
          : "tie",
  });

  // Points
  comparison.push({
    category: "Points",
    homeValue: String(Math.round(homeTeam.gotsport_points || 0)),
    awayValue: String(Math.round(awayTeam.gotsport_points || 0)),
    winner:
      (homeTeam.gotsport_points || 0) > (awayTeam.gotsport_points || 0)
        ? "home"
        : (homeTeam.gotsport_points || 0) < (awayTeam.gotsport_points || 0)
          ? "away"
          : "tie",
  });

  // ELO - FIXED: Use rounded integers
  comparison.push({
    category: "ELO",
    homeValue: String(homeElo),
    awayValue: String(awayElo),
    winner: homeElo > awayElo ? "home" : homeElo < awayElo ? "away" : "tie",
  });

  return {
    predictedHomeScore,
    predictedAwayScore,
    homeWinProbability: Math.round(homeWinProbability * 100),
    drawProbability: Math.round(drawProbability * 100),
    awayWinProbability: Math.round(awayWinProbability * 100),
    confidenceLevel: confidence.level,
    confidencePercent: confidence.percent,
    factors,
    comparison,
  };
}

/**
 * Get short team name for display - FIXED: More aggressive truncation
 */
export function getShortTeamName(
  fullName: string,
  maxLength: number = 18,
): string {
  // Remove age/gender suffix like "(U15 Boys)"
  const withoutSuffix = fullName.replace(/\s*\([^)]+\)\s*$/, "").trim();

  if (withoutSuffix.length > maxLength) {
    return withoutSuffix.substring(0, maxLength - 1) + "…";
  }

  return withoutSuffix;
}

/**
 * Get very short team name for tight spaces (probability bar labels)
 */
export function getVeryShortTeamName(fullName: string): string {
  return getShortTeamName(fullName, 10);
}

/**
 * Get color for probability bar
 */
export function getProbabilityColor(
  percent: number,
  type: "win" | "draw",
): string {
  if (type === "draw") return "#f59e0b";

  if (percent >= 60) return "#10b981";
  if (percent >= 45) return "#3B82F6";
  if (percent >= 30) return "#f59e0b";
  return "#ef4444";
}

/**
 * Get confidence bar color
 */
export function getConfidenceColor(
  level: "Low" | "Medium" | "High" | "Very High",
): string {
  switch (level) {
    case "Very High":
      return "#10b981";
    case "High":
      return "#3B82F6";
    case "Medium":
      return "#f59e0b";
    case "Low":
      return "#ef4444";
  }
}
