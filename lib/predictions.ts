// ============================================================
// TYPES
// ============================================================

export type TeamData = {
  id: string;
  team_name: string;
  elo_rating: number | null;
  matches_played: number | null;
  wins: number | null;
  losses: number | null;
  draws: number | null;
  goals_for: number | null;
  goals_against: number | null;
  state: string | null;
  gender: string | null;
  age_group: string | null;
  national_rank: number | null;
  state_rank: number | null;
  club_name: string | null;
  championships: number | null;
};

export type PredictionFactor = {
  name: string;
  homeValue: number;
  awayValue: number;
  impact: number;
  weight: number;
};

export type PredictionResult = {
  homeWinProbability: number;
  drawProbability: number;
  awayWinProbability: number;
  predictedHomeScore: number;
  predictedAwayScore: number;
  confidence: string;
  confidenceScore: number;
  factors: PredictionFactor[];
  winner: "home" | "away" | "draw";
};

// ============================================================
// PREDICTION ENGINE
// ============================================================

const WEIGHTS = {
  elo: 0.4,
  goals: 0.2,
  winRate: 0.15,
  championships: 0.1,
  commonOpponents: 0.1,
  scheduleStrength: 0.05,
};

function calculateWinRate(team: TeamData): number {
  const totalGames = (team.wins || 0) + (team.losses || 0) + (team.draws || 0);
  if (totalGames === 0) return 0.5;
  return ((team.wins || 0) + (team.draws || 0) * 0.5) / totalGames;
}

function calculateGoalDiff(team: TeamData): number {
  return (team.goals_for || 0) - (team.goals_against || 0);
}

export async function generatePrediction(
  homeTeam: TeamData,
  awayTeam: TeamData,
  homeBoost: number = 0,
  awayBoost: number = 0,
): Promise<PredictionResult> {
  const factors: PredictionFactor[] = [];

  // 1. ELO Rating Factor (40%)
  const homeElo = (homeTeam.elo_rating || 1500) + homeBoost * 10;
  const awayElo = (awayTeam.elo_rating || 1500) + awayBoost * 10;
  const eloDiff = homeElo - awayElo;
  const eloImpact = Math.tanh(eloDiff / 400);

  factors.push({
    name: "ELO Rating",
    homeValue: Math.round(homeElo),
    awayValue: Math.round(awayElo),
    impact: eloImpact,
    weight: WEIGHTS.elo,
  });

  // 2. Goal Difference Factor (20%)
  const homeGoalDiff = calculateGoalDiff(homeTeam);
  const awayGoalDiff = calculateGoalDiff(awayTeam);
  const goalDiffImpact = Math.tanh((homeGoalDiff - awayGoalDiff) / 20);

  factors.push({
    name: "Goal Diff",
    homeValue: homeGoalDiff,
    awayValue: awayGoalDiff,
    impact: goalDiffImpact,
    weight: WEIGHTS.goals,
  });

  // 3. Win Rate Factor (15%)
  const homeWinRate = calculateWinRate(homeTeam);
  const awayWinRate = calculateWinRate(awayTeam);
  const winRateImpact = Math.max(
    -1,
    Math.min(1, (homeWinRate - awayWinRate) * 2),
  );

  factors.push({
    name: "Win Rate",
    homeValue: Math.round(homeWinRate * 100),
    awayValue: Math.round(awayWinRate * 100),
    impact: winRateImpact,
    weight: WEIGHTS.winRate,
  });

  // 4. Championships Factor (10%)
  const homeChamps = homeTeam.championships || 0;
  const awayChamps = awayTeam.championships || 0;
  const champsImpact = Math.tanh((homeChamps - awayChamps) / 2);

  factors.push({
    name: "Awards",
    homeValue: homeChamps,
    awayValue: awayChamps,
    impact: champsImpact,
    weight: WEIGHTS.championships,
  });

  // 5. Rank Factor (10%)
  const homeRank = homeTeam.national_rank || 5000;
  const awayRank = awayTeam.national_rank || 5000;
  const rankImpact = Math.tanh((awayRank - homeRank) / 500);

  factors.push({
    name: "Head-to-Head",
    homeValue: homeRank,
    awayValue: awayRank,
    impact: rankImpact,
    weight: WEIGHTS.commonOpponents,
  });

  // 6. Matches Played Factor (5%)
  const homeMatches = homeTeam.matches_played || 0;
  const awayMatches = awayTeam.matches_played || 0;
  const matchesImpact = Math.tanh((homeMatches - awayMatches) / 20);

  factors.push({
    name: "Strength",
    homeValue: homeMatches,
    awayValue: awayMatches,
    impact: matchesImpact,
    weight: WEIGHTS.scheduleStrength,
  });

  // Calculate weighted total impact
  let totalImpact = 0;
  for (const factor of factors) {
    totalImpact += factor.impact * factor.weight;
  }

  // Convert to probabilities
  const homeAdvantage = 0.03;
  const adjustedImpact = totalImpact + homeAdvantage;

  const homeWinBase = 0.5 + adjustedImpact * 0.35;
  const drawBase = 0.25 - Math.abs(adjustedImpact) * 0.15;

  let homeWinProb = Math.max(0.05, Math.min(0.9, homeWinBase));
  let drawProb = Math.max(0.05, Math.min(0.35, drawBase));
  let awayWinProb = 1 - homeWinProb - drawProb;

  if (awayWinProb < 0.05) {
    const diff = 0.05 - awayWinProb;
    awayWinProb = 0.05;
    homeWinProb -= diff;
  }

  // Predict scores - MUST be consistent with win probabilities
  // Use GPG to determine scoring magnitude, but winner must match probability
  const homeGPG = homeTeam.matches_played
    ? (homeTeam.goals_for || 0) / homeTeam.matches_played
    : 1.5;
  const awayGPG = awayTeam.matches_played
    ? (awayTeam.goals_for || 0) / awayTeam.matches_played
    : 1.5;

  // Average expected goals for this matchup
  const avgGoals = (homeGPG + awayGPG) / 2;
  const baseGoals = Math.max(1, Math.min(3, avgGoals)); // Clamp to realistic range

  // Determine predicted winner from probabilities (single source of truth)
  let predictedHomeScore: number;
  let predictedAwayScore: number;

  if (homeWinProb > awayWinProb && homeWinProb > drawProb) {
    // Home favored - home wins
    const margin = Math.max(1, Math.round(Math.abs(adjustedImpact) * 2));
    predictedHomeScore = Math.round(baseGoals + margin * 0.5);
    predictedAwayScore = Math.round(Math.max(0, baseGoals - margin * 0.5));
    // Ensure home wins
    if (predictedHomeScore <= predictedAwayScore) {
      predictedHomeScore = predictedAwayScore + 1;
    }
  } else if (awayWinProb > homeWinProb && awayWinProb > drawProb) {
    // Away favored - away wins
    const margin = Math.max(1, Math.round(Math.abs(adjustedImpact) * 2));
    predictedAwayScore = Math.round(baseGoals + margin * 0.5);
    predictedHomeScore = Math.round(Math.max(0, baseGoals - margin * 0.5));
    // Ensure away wins
    if (predictedAwayScore <= predictedHomeScore) {
      predictedAwayScore = predictedHomeScore + 1;
    }
  } else {
    // Draw most likely or too close - predict draw
    predictedHomeScore = Math.round(baseGoals);
    predictedAwayScore = Math.round(baseGoals);
  }

  // Clamp to reasonable range (0-6)
  predictedHomeScore = Math.max(0, Math.min(6, predictedHomeScore));
  predictedAwayScore = Math.max(0, Math.min(6, predictedAwayScore));

  // Calculate confidence
  let confidenceScore = 0;
  if (homeTeam.elo_rating && awayTeam.elo_rating) confidenceScore += 30;
  if (
    (homeTeam.matches_played || 0) >= 5 &&
    (awayTeam.matches_played || 0) >= 5
  )
    confidenceScore += 25;
  if (
    (homeTeam.matches_played || 0) >= 10 &&
    (awayTeam.matches_played || 0) >= 10
  )
    confidenceScore += 15;
  if (homeTeam.goals_for !== null && awayTeam.goals_for !== null)
    confidenceScore += 15;
  if (homeTeam.national_rank && awayTeam.national_rank) confidenceScore += 15;

  let confidence: string;
  if (confidenceScore >= 80) confidence = "Very High";
  else if (confidenceScore >= 60) confidence = "High";
  else if (confidenceScore >= 40) confidence = "Medium";
  else confidence = "Low";

  // Determine winner
  let winner: "home" | "away" | "draw";
  if (predictedHomeScore > predictedAwayScore) winner = "home";
  else if (predictedAwayScore > predictedHomeScore) winner = "away";
  else
    winner =
      homeWinProb > awayWinProb
        ? "home"
        : awayWinProb > homeWinProb
          ? "away"
          : "draw";

  return {
    homeWinProbability: homeWinProb,
    drawProbability: drawProb,
    awayWinProbability: awayWinProb,
    predictedHomeScore,
    predictedAwayScore,
    confidence,
    confidenceScore,
    factors,
    winner,
  };
}
