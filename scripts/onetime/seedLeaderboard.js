/**
 * Seed Leaderboard Demo Data
 * 
 * This script creates demo user profiles and predictions that match
 * real completed matches, then scores them to populate the leaderboard
 * for launch.
 * 
 * Run: node scripts/seedLeaderboard.js
 */

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Demo user profiles
const DEMO_USERS = [
  { device_id: "demo-device-001", display_name: "SoccerDad2024", avatar_emoji: "⚽" },
  { device_id: "demo-device-002", display_name: "CoachMike", avatar_emoji: "🏆" },
  { device_id: "demo-device-003", display_name: "GoalGetter", avatar_emoji: "🥅" },
  { device_id: "demo-device-004", display_name: "FieldMarshal", avatar_emoji: "📊" },
  { device_id: "demo-device-005", display_name: "FutureStar", avatar_emoji: "⭐" },
];

async function seedLeaderboard() {
  console.log("🌱 Seeding Leaderboard Demo Data...\n");

  // Step 1: Create demo user profiles
  console.log("📝 Creating demo user profiles...");
  const userIds = [];
  
  for (const user of DEMO_USERS) {
    const { data, error } = await supabase
      .from("user_profiles")
      .upsert(user, { onConflict: "device_id" })
      .select("id, display_name")
      .single();

    if (error) {
      console.error(`  ❌ Failed to create ${user.display_name}:`, error.message);
    } else {
      console.log(`  ✅ Created: ${data.display_name} (${data.id})`);
      userIds.push({ id: data.id, name: data.display_name, device_id: user.device_id });
    }
  }

  if (userIds.length === 0) {
    console.error("❌ No users created. Exiting.");
    return;
  }

  // Step 2: Get recent completed matches
  console.log("\n🔍 Fetching recent completed matches...");
  const { data: matches, error: matchError } = await supabase
    .from("match_results")
    .select("id, match_date, home_team_name, away_team_name, home_score, away_score, age_group, gender")
    .eq("status", "completed")
    .not("home_score", "is", null)
    .not("away_score", "is", null)
    .gte("match_date", "2025-01-01")
    .order("match_date", { ascending: false })
    .limit(20);

  if (matchError) {
    console.error("❌ Failed to fetch matches:", matchError.message);
    return;
  }

  console.log(`  Found ${matches.length} recent completed matches`);

  // Step 3: Create predictions for these matches
  console.log("\n🎯 Creating predictions for demo users...");
  const predictions = [];

  // Distribute predictions among users
  for (let i = 0; i < matches.length && i < 15; i++) {
    const match = matches[i];
    const userIndex = i % userIds.length;
    const user = userIds[userIndex];

    // Create varied predictions:
    // - Some exact (to show exact score bonus)
    // - Some correct winner only
    // - Some wrong
    let predictedScoreA, predictedScoreB;
    const actualDiff = match.home_score - match.away_score;

    if (i % 4 === 0) {
      // Exact score prediction (25% of predictions)
      predictedScoreA = match.home_score;
      predictedScoreB = match.away_score;
    } else if (i % 4 === 1 || i % 4 === 2) {
      // Correct winner, different score (50% of predictions)
      if (actualDiff > 0) {
        predictedScoreA = Math.max(1, match.home_score + (Math.random() > 0.5 ? 1 : -1));
        predictedScoreB = Math.max(0, match.away_score + (Math.random() > 0.5 ? 1 : -1));
        // Make sure prediction still has correct winner
        if (predictedScoreA <= predictedScoreB) {
          predictedScoreA = predictedScoreB + 1;
        }
      } else if (actualDiff < 0) {
        predictedScoreA = Math.max(0, match.home_score + (Math.random() > 0.5 ? 1 : -1));
        predictedScoreB = Math.max(1, match.away_score + (Math.random() > 0.5 ? 1 : -1));
        if (predictedScoreB <= predictedScoreA) {
          predictedScoreB = predictedScoreA + 1;
        }
      } else {
        // Draw - predict draw
        predictedScoreA = match.home_score;
        predictedScoreB = match.away_score;
      }
    } else {
      // Wrong prediction (25% of predictions)
      if (actualDiff > 0) {
        // Actual winner is home, predict away
        predictedScoreA = 0;
        predictedScoreB = 2;
      } else if (actualDiff < 0) {
        // Actual winner is away, predict home
        predictedScoreA = 2;
        predictedScoreB = 0;
      } else {
        // Actual draw, predict home win
        predictedScoreA = 2;
        predictedScoreB = 1;
      }
    }

    // Determine predicted winner
    let predictedWinner = "draw";
    if (predictedScoreA > predictedScoreB) predictedWinner = "team_a";
    else if (predictedScoreB > predictedScoreA) predictedWinner = "team_b";

    predictions.push({
      device_id: user.device_id,
      user_profile_id: user.id,
      team_a_name: match.home_team_name,
      team_b_name: match.away_team_name,
      team_a_state: "FL", // Most of these are Florida matches
      team_b_state: "FL",
      age_group: match.age_group || "U13",
      gender: match.gender || "Boys",
      user_predicted_score_a: predictedScoreA,
      user_predicted_score_b: predictedScoreB,
      user_predicted_winner: predictedWinner,
      match_date: match.match_date,
      status: "pending",
    });
  }

  // Insert predictions
  const { data: insertedPreds, error: predError } = await supabase
    .from("user_predictions")
    .insert(predictions)
    .select("id, team_a_name, user_predicted_score_a, user_predicted_score_b");

  if (predError) {
    console.error("❌ Failed to create predictions:", predError.message);
    return;
  }

  console.log(`  ✅ Created ${insertedPreds.length} predictions`);

  // Step 4: Score the predictions
  console.log("\n🏅 Scoring predictions...");
  let scoredCount = 0;
  let totalPointsAwarded = 0;

  for (let i = 0; i < insertedPreds.length; i++) {
    const pred = insertedPreds[i];
    const match = matches[i];

    const { data: result, error: scoreError } = await supabase.rpc(
      "award_prediction_points",
      {
        p_prediction_id: pred.id,
        p_actual_score_a: match.home_score,
        p_actual_score_b: match.away_score,
      }
    );

    if (scoreError) {
      console.error(`  ❌ Failed to score prediction ${pred.id}:`, scoreError.message);
    } else if (result && result.length > 0) {
      scoredCount++;
      totalPointsAwarded += result[0].points_awarded || 0;
      const status = result[0].exact_score ? "EXACT! 🎯" : result[0].winner_correct ? "Correct ✓" : "Wrong ✗";
      console.log(`  ${status} +${result[0].points_awarded} pts`);
    }
  }

  console.log(`\n  ✅ Scored ${scoredCount} predictions`);
  console.log(`  🏆 Total points awarded: ${totalPointsAwarded}`);

  // Step 5: Verify leaderboard
  console.log("\n📊 Verifying leaderboard...");
  const { data: leaderboard, error: lbError } = await supabase
    .from("leaderboard_all_time")
    .select("*")
    .order("total_points", { ascending: false })
    .limit(10);

  if (lbError) {
    console.error("❌ Failed to fetch leaderboard:", lbError.message);
  } else {
    console.log("\n🏆 TOP PREDICTORS LEADERBOARD:");
    console.log("─".repeat(50));
    leaderboard.forEach((entry, idx) => {
      const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `#${idx + 1}`;
      console.log(`${medal} ${entry.display_name.padEnd(15)} ${entry.total_points} pts (${entry.accuracy_pct}% accuracy)`);
    });
    console.log("─".repeat(50));
  }

  console.log("\n✅ Leaderboard seeding complete!");
}

seedLeaderboard().catch(console.error);
