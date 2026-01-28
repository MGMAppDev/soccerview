/**
 * SoccerView Prediction Scoring Script v2.0
 * ==========================================
 * 
 * This script automatically scores pending user predictions by matching them
 * to completed matches in the database.
 * 
 * IMPROVEMENTS in v2.0:
 * - Uses match_result_id FK for direct lookup (faster, more reliable)
 * - Falls back to team name matching if no FK exists
 * - Backfills match_result_id for unlinked predictions
 * 
 * Run manually: node scripts/scorePredictions.js
 * Or via GitHub Actions after event scraping completes.
 * 
 * Points System:
 * - Correct winner prediction: +10 points
 * - Correct draw prediction: +15 points  
 * - Exact score bonus: +25 points
 * - Maximum possible: 35-40 points per prediction
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

// Initialize Supabase with SERVICE_ROLE_KEY for admin access
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Missing environment variables:");
  console.error("   EXPO_PUBLIC_SUPABASE_URL:", supabaseUrl ? "✅" : "❌");
  console.error("   SUPABASE_SERVICE_ROLE_KEY:", supabaseKey ? "✅" : "❌");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Clean team name by removing age/gender suffix like "(U12 Boys)"
 */
function cleanTeamName(name) {
  if (!name) return "";
  return name.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

/**
 * Determine winner based on scores
 */
function determineWinner(scoreA, scoreB) {
  if (scoreA > scoreB) return "team_a";
  if (scoreB > scoreA) return "team_b";
  return "draw";
}

/**
 * Calculate points for a prediction
 */
function calculatePoints(prediction, actualScoreA, actualScoreB) {
  const actualWinner = determineWinner(actualScoreA, actualScoreB);
  const predictedWinner = prediction.user_predicted_winner;
  
  let points = 0;
  let winnerCorrect = false;
  let exactScore = false;
  
  // Check if winner prediction was correct
  if (predictedWinner === actualWinner) {
    winnerCorrect = true;
    // Draw correct = 15 points, winner correct = 10 points
    points = actualWinner === "draw" ? 15 : 10;
  }
  
  // Check for exact score match
  if (prediction.user_predicted_score_a === actualScoreA && 
      prediction.user_predicted_score_b === actualScoreB) {
    exactScore = true;
    points += 25; // Exact score bonus
  }
  
  return { points, winnerCorrect, exactScore, actualWinner };
}

// ============================================================
// FIND MATCH - Direct FK or Team Name Matching
// ============================================================

async function findMatchForPrediction(prediction) {
  const teamAClean = cleanTeamName(prediction.team_a_name);
  const teamBClean = cleanTeamName(prediction.team_b_name);

  // METHOD 1: Direct lookup via match_result_id (fastest, most reliable)
  if (prediction.match_result_id) {
    const { data: match, error } = await supabase
      .from("match_results")
      .select("*")
      .eq("id", prediction.match_result_id)
      .eq("status", "completed")
      .not("home_score", "is", null)
      .not("away_score", "is", null)
      .single();

    if (!error && match) {
      // Determine if team A is home or away
      const teamAIsHome = match.home_team_name === teamAClean || 
                          match.home_team_name.includes(teamAClean) ||
                          teamAClean.includes(match.home_team_name);
      
      return {
        match,
        actualScoreA: teamAIsHome ? match.home_score : match.away_score,
        actualScoreB: teamAIsHome ? match.away_score : match.home_score,
        matchMethod: "direct_fk"
      };
    }
  }

  // METHOD 2: Team name matching (fallback)
  // First try: Team A is home, Team B is away
  let { data: matches, error: matchError } = await supabase
    .from("match_results")
    .select("*")
    .eq("status", "completed")
    .not("home_score", "is", null)
    .not("away_score", "is", null)
    .eq("home_team_name", teamAClean)
    .eq("away_team_name", teamBClean)
    .order("match_date", { ascending: false })
    .limit(1);

  if (!matchError && matches && matches.length > 0) {
    return {
      match: matches[0],
      actualScoreA: matches[0].home_score,
      actualScoreB: matches[0].away_score,
      matchMethod: "team_name_exact"
    };
  }

  // Second try: Team A is away, Team B is home
  const result = await supabase
    .from("match_results")
    .select("*")
    .eq("status", "completed")
    .not("home_score", "is", null)
    .not("away_score", "is", null)
    .eq("home_team_name", teamBClean)
    .eq("away_team_name", teamAClean)
    .order("match_date", { ascending: false })
    .limit(1);

  if (!result.error && result.data && result.data.length > 0) {
    return {
      match: result.data[0],
      actualScoreA: result.data[0].away_score, // Team A is away
      actualScoreB: result.data[0].home_score,
      matchMethod: "team_name_reversed"
    };
  }

  return null;
}

// ============================================================
// BACKFILL: Link unlinked predictions to matches
// ============================================================

async function backfillPredictionLinks() {
  console.log("🔗 Backfilling prediction links...");
  
  const { data: unlinked, error } = await supabase
    .from("user_predictions")
    .select("*")
    .eq("status", "pending")
    .is("match_result_id", null);

  if (error || !unlinked || unlinked.length === 0) {
    console.log("   No unlinked predictions to backfill\n");
    return { processed: 0, linked: 0 };
  }

  let processed = 0;
  let linked = 0;

  for (const prediction of unlinked) {
    processed++;
    const teamAClean = cleanTeamName(prediction.team_a_name);
    const teamBClean = cleanTeamName(prediction.team_b_name);

    // Try to find ANY match (scheduled or completed) between these teams
    // NOTE: Use direct eq queries instead of .or() to avoid issues with special
    // characters in team names (quotes, parentheses, etc.)
    let matches = null;

    // Try Team A as home, Team B as away
    const result1 = await supabase
      .from("match_results")
      .select("id, match_date")
      .eq("home_team_name", teamAClean)
      .eq("away_team_name", teamBClean)
      .order("match_date", { ascending: false })
      .limit(1);

    if (result1.data && result1.data.length > 0) {
      matches = result1.data;
    } else {
      // Try Team B as home, Team A as away
      const result2 = await supabase
        .from("match_results")
        .select("id, match_date")
        .eq("home_team_name", teamBClean)
        .eq("away_team_name", teamAClean)
        .order("match_date", { ascending: false })
        .limit(1);

      if (result2.data && result2.data.length > 0) {
        matches = result2.data;
      }
    }

    if (matches && matches.length > 0) {
      const { error: updateError } = await supabase
        .from("user_predictions")
        .update({
          match_result_id: matches[0].id,
          match_date: matches[0].match_date,
        })
        .eq("id", prediction.id);

      if (!updateError) {
        linked++;
        console.log(`   ✅ Linked: ${prediction.team_a_name.substring(0, 30)}...`);
      }
    }
  }

  console.log(`   Processed: ${processed}, Linked: ${linked}\n`);
  return { processed, linked };
}

// ============================================================
// MAIN SCORING FUNCTION
// ============================================================

async function scorePendingPredictions() {
  console.log("🎯 SoccerView Prediction Scorer v2.0");
  console.log("====================================\n");
  
  // Step 0: Backfill any unlinked predictions
  await backfillPredictionLinks();
  
  // Step 1: Fetch all pending predictions
  console.log("📋 Fetching pending predictions...");
  const { data: predictions, error: predError } = await supabase
    .from("user_predictions")
    .select("*")
    .eq("status", "pending");
  
  if (predError) {
    console.error("❌ Error fetching predictions:", predError.message);
    return;
  }
  
  console.log(`   Found ${predictions.length} pending predictions\n`);
  
  if (predictions.length === 0) {
    console.log("✅ No pending predictions to score. All done!");
    return;
  }
  
  // Step 2: Process each prediction
  let processed = 0;
  let scored = 0;
  let noMatch = 0;
  let totalPointsAwarded = 0;
  const matchMethods = { direct_fk: 0, team_name_exact: 0, team_name_reversed: 0 };
  
  for (const prediction of predictions) {
    processed++;
    
    const teamAClean = cleanTeamName(prediction.team_a_name);
    const teamBClean = cleanTeamName(prediction.team_b_name);
    
    console.log(`\n[${processed}/${predictions.length}] Processing:`);
    console.log(`   Team A: ${teamAClean}`);
    console.log(`   Team B: ${teamBClean}`);
    console.log(`   User predicted: ${prediction.user_predicted_score_a}-${prediction.user_predicted_score_b}`);
    if (prediction.match_result_id) {
      console.log(`   🔗 Has match_result_id: ${prediction.match_result_id.substring(0, 8)}...`);
    }
    
    // Find the completed match
    const matchResult = await findMatchForPrediction(prediction);
    
    if (!matchResult) {
      console.log(`   ⏳ No completed match found yet - keeping as pending`);
      noMatch++;
      continue;
    }
    
    const { match, actualScoreA, actualScoreB, matchMethod } = matchResult;
    matchMethods[matchMethod]++;
    
    console.log(`   ✅ Match found via ${matchMethod}! Actual result: ${actualScoreA}-${actualScoreB}`);
    
    // Step 4: Calculate points
    const result = calculatePoints(prediction, actualScoreA, actualScoreB);
    
    console.log(`   🎯 Winner correct: ${result.winnerCorrect ? "YES ✓" : "NO ✗"}`);
    console.log(`   🎯 Exact score: ${result.exactScore ? "YES ✓ (+25 bonus!)" : "NO"}`);
    console.log(`   🏆 Points awarded: ${result.points}`);
    
    // Step 5: Update the prediction record
    const { error: updateError } = await supabase
      .from("user_predictions")
      .update({
        actual_score_a: actualScoreA,
        actual_score_b: actualScoreB,
        actual_winner: result.actualWinner,
        points_awarded: result.points,
        winner_correct: result.winnerCorrect,
        exact_score: result.exactScore,
        result_entered_at: new Date().toISOString(),
        status: "scored",
        match_result_id: match.id, // Ensure FK is set
        match_date: match.match_date,
      })
      .eq("id", prediction.id);
    
    if (updateError) {
      console.log(`   ❌ Error updating prediction: ${updateError.message}`);
      continue;
    }
    
    // Step 6: Update user profile with points
    if (prediction.user_profile_id) {
      // First get current profile stats
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("*")
        .eq("id", prediction.user_profile_id)
        .single();
      
      if (profile) {
        const newStreak = result.winnerCorrect ? (profile.current_streak || 0) + 1 : 0;
        const newBestStreak = Math.max(newStreak, profile.best_streak || 0);
        
        const { error: profileError } = await supabase
          .from("user_profiles")
          .update({
            total_points: (profile.total_points || 0) + result.points,
            weekly_points: (profile.weekly_points || 0) + result.points,
            correct_predictions: (profile.correct_predictions || 0) + (result.winnerCorrect ? 1 : 0),
            exact_scores: (profile.exact_scores || 0) + (result.exactScore ? 1 : 0),
            weekly_correct: (profile.weekly_correct || 0) + (result.winnerCorrect ? 1 : 0),
            current_streak: newStreak,
            best_streak: newBestStreak,
            updated_at: new Date().toISOString()
          })
          .eq("id", prediction.user_profile_id);
        
        if (profileError) {
          console.log(`   ⚠️ Error updating profile: ${profileError.message}`);
        } else {
          console.log(`   👤 User profile updated (+${result.points} pts, streak: ${newStreak})`);
        }
      }
    }
    
    scored++;
    totalPointsAwarded += result.points;
  }
  
  // Final Summary
  console.log("\n====================================");
  console.log("📊 SCORING COMPLETE");
  console.log("====================================");
  console.log(`   Predictions processed: ${processed}`);
  console.log(`   Predictions scored:    ${scored}`);
  console.log(`   No match found:        ${noMatch}`);
  console.log(`   Total points awarded:  ${totalPointsAwarded}`);
  console.log("");
  console.log("🔗 Match Methods Used:");
  console.log(`   Direct FK lookup:      ${matchMethods.direct_fk}`);
  console.log(`   Team name (exact):     ${matchMethods.team_name_exact}`);
  console.log(`   Team name (reversed):  ${matchMethods.team_name_reversed}`);
  console.log("====================================\n");
  
  if (scored > 0) {
    console.log("🎉 Leaderboard has been updated!");
  }
}

// ============================================================
// RUN
// ============================================================

scorePendingPredictions()
  .then(() => {
    console.log("✅ Script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Script failed:", error);
    process.exit(1);
  });
