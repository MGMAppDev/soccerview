/**
 * Test Prediction Scoring End-to-End
 * ===================================
 * 
 * This script:
 * 1. Finds a completed match
 * 2. Creates a test prediction for it
 * 3. Runs scoring to verify points are awarded
 * 4. Cleans up the test data
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Missing environment variables");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testScoringEndToEnd() {
  console.log("🧪 TESTING PREDICTION SCORING END-TO-END");
  console.log("=========================================\n");

  // Step 1: Find a completed match
  console.log("1️⃣ Finding a completed match...");
  const { data: matches, error: matchError } = await supabase
    .from("match_results")
    .select("id, home_team_name, away_team_name, home_score, away_score, match_date")
    .eq("status", "completed")
    .not("home_score", "is", null)
    .not("away_score", "is", null)
    .order("match_date", { ascending: false })
    .limit(1);

  if (matchError || !matches || matches.length === 0) {
    console.error("❌ No completed matches found:", matchError?.message);
    return;
  }

  const match = matches[0];
  console.log(`   ✅ Found: ${match.home_team_name} vs ${match.away_team_name}`);
  console.log(`   📊 Actual result: ${match.home_score}-${match.away_score}`);
  console.log(`   📅 Date: ${match.match_date}\n`);

  // Step 2: Get a user profile
  console.log("2️⃣ Getting user profile...");
  const { data: profiles } = await supabase
    .from("user_profiles")
    .select("*")
    .limit(1);

  const profile = profiles?.[0];
  if (!profile) {
    console.error("❌ No user profile found");
    return;
  }
  console.log(`   ✅ Profile: ${profile.display_name} (Points: ${profile.total_points})\n`);

  // Step 3: Create test prediction with EXACT SCORE
  console.log("3️⃣ Creating test prediction (EXACT SCORE)...");
  const testPrediction = {
    device_id: "TEST_E2E_SCORING_" + Date.now(),
    user_profile_id: profile.id,
    team_a_name: match.home_team_name,
    team_b_name: match.away_team_name,
    user_predicted_score_a: match.home_score,  // Exact match!
    user_predicted_score_b: match.away_score,  // Exact match!
    user_predicted_winner: match.home_score > match.away_score ? "team_a" : 
                          match.away_score > match.home_score ? "team_b" : "draw",
    match_result_id: match.id,
    match_date: match.match_date,
    status: "pending"
  };

  const { data: inserted, error: insertError } = await supabase
    .from("user_predictions")
    .insert(testPrediction)
    .select()
    .single();

  if (insertError) {
    console.error("❌ Failed to insert test prediction:", insertError.message);
    return;
  }
  console.log(`   ✅ Created prediction ID: ${inserted.id}`);
  console.log(`   🎯 Predicted: ${inserted.user_predicted_score_a}-${inserted.user_predicted_score_b}`);
  console.log(`   🔗 Linked to match: ${inserted.match_result_id}\n`);

  // Step 4: Run scoring logic
  console.log("4️⃣ Running scoring logic...");
  
  // Determine actual scores
  const actualScoreA = match.home_score;
  const actualScoreB = match.away_score;
  const actualWinner = actualScoreA > actualScoreB ? "team_a" : 
                       actualScoreB > actualScoreA ? "team_b" : "draw";
  
  // Calculate points
  let points = 0;
  let winnerCorrect = false;
  let exactScore = false;

  if (testPrediction.user_predicted_winner === actualWinner) {
    winnerCorrect = true;
    points = actualWinner === "draw" ? 15 : 10;
  }

  if (testPrediction.user_predicted_score_a === actualScoreA && 
      testPrediction.user_predicted_score_b === actualScoreB) {
    exactScore = true;
    points += 25;
  }

  console.log(`   🎯 Winner correct: ${winnerCorrect ? "YES ✓" : "NO ✗"}`);
  console.log(`   🎯 Exact score: ${exactScore ? "YES ✓" : "NO"}`);
  console.log(`   🏆 Points to award: ${points}\n`);

  // Step 5: Update prediction as scored
  console.log("5️⃣ Updating prediction as scored...");
  const { error: updateError } = await supabase
    .from("user_predictions")
    .update({
      actual_score_a: actualScoreA,
      actual_score_b: actualScoreB,
      actual_winner: actualWinner,
      points_awarded: points,
      winner_correct: winnerCorrect,
      exact_score: exactScore,
      result_entered_at: new Date().toISOString(),
      status: "scored"
    })
    .eq("id", inserted.id);

  if (updateError) {
    console.error("❌ Failed to update prediction:", updateError.message);
  } else {
    console.log(`   ✅ Prediction marked as scored\n`);
  }

  // Step 6: Update user profile
  console.log("6️⃣ Updating user profile points...");
  const newStreak = winnerCorrect ? (profile.current_streak || 0) + 1 : 0;
  
  const { error: profileError } = await supabase
    .from("user_profiles")
    .update({
      total_points: (profile.total_points || 0) + points,
      weekly_points: (profile.weekly_points || 0) + points,
      correct_predictions: (profile.correct_predictions || 0) + (winnerCorrect ? 1 : 0),
      exact_scores: (profile.exact_scores || 0) + (exactScore ? 1 : 0),
      current_streak: newStreak,
      best_streak: Math.max(newStreak, profile.best_streak || 0),
      updated_at: new Date().toISOString()
    })
    .eq("id", profile.id);

  if (profileError) {
    console.error("❌ Failed to update profile:", profileError.message);
  } else {
    console.log(`   ✅ Profile updated: +${points} points\n`);
  }

  // Step 7: Verify final state
  console.log("7️⃣ Verifying final state...");
  
  const { data: finalPrediction } = await supabase
    .from("user_predictions")
    .select("*")
    .eq("id", inserted.id)
    .single();

  const { data: finalProfile } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("id", profile.id)
    .single();

  console.log("\n=========================================");
  console.log("📊 TEST RESULTS");
  console.log("=========================================");
  console.log(`   Prediction Status: ${finalPrediction?.status}`);
  console.log(`   Points Awarded: ${finalPrediction?.points_awarded}`);
  console.log(`   Winner Correct: ${finalPrediction?.winner_correct}`);
  console.log(`   Exact Score: ${finalPrediction?.exact_score}`);
  console.log("");
  console.log(`   Profile Total Points: ${finalProfile?.total_points}`);
  console.log(`   Profile Exact Scores: ${finalProfile?.exact_scores}`);
  console.log(`   Profile Current Streak: ${finalProfile?.current_streak}`);
  console.log("=========================================\n");

  if (finalPrediction?.status === "scored" && finalPrediction?.points_awarded === points) {
    console.log("✅ SUCCESS! Prediction scoring works end-to-end!\n");
  } else {
    console.log("❌ FAILED! Check the logs above for issues.\n");
  }

  // Step 8: Cleanup option
  console.log("🧹 Test prediction will remain in database for verification.");
  console.log(`   To delete: DELETE FROM user_predictions WHERE id = '${inserted.id}'`);
}

testScoringEndToEnd()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Test failed:", err);
    process.exit(1);
  });
