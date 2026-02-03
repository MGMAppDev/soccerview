import { getDeviceId } from "./deviceId";
import { supabase } from "./supabase";
import { getUserProfile, saveUserProfile } from "./userProfile";

// ============================================================
// TYPES
// ============================================================

export type UserPrediction = {
  id: string;
  created_at: string;
  device_id: string;
  user_profile_id: string | null;
  team_a_name: string;
  team_b_name: string;
  team_a_state: string | null;
  team_b_state: string | null;
  age_group: string | null;
  gender: string | null;
  user_predicted_score_a: number;
  user_predicted_score_b: number;
  user_predicted_winner: "team_a" | "team_b" | "draw";
  actual_score_a: number | null;
  actual_score_b: number | null;
  actual_winner: string | null;
  match_date: string | null;
  match_result_id: string | null;
  result_entered_at: string | null;
  points_awarded: number;
  winner_correct: boolean | null;
  exact_score: boolean | null;
  status: "pending" | "scored" | "expired";
};

export type SubmitPredictionParams = {
  teamAName: string;
  teamBName: string;
  teamAState?: string;
  teamBState?: string;
  ageGroup?: string;
  gender?: string;
  predictedScoreA: number;
  predictedScoreB: number;
  matchDate?: string;
  matchResultId?: string;
};

// ============================================================
// HELPER: Clean team name for matching
// ============================================================

function cleanTeamName(name: string): string {
  if (!name) return "";
  // Remove age/gender suffix like "(U12 Boys)"
  return name.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

// ============================================================
// HELPER: Find scheduled match between two teams
// ============================================================

async function findScheduledMatch(
  teamAName: string,
  teamBName: string
): Promise<{ id: string; match_date: string } | null> {
  const teamAClean = cleanTeamName(teamAName);
  const teamBClean = cleanTeamName(teamBName);

  // V2 Schema: Query app_upcoming_schedule which has embedded team data
  // Per No Fallback Policy: v2 schema is THE architecture

  // Get upcoming matches and filter by team names
  const { data: matches, error } = await supabase
    .from("app_upcoming_schedule")
    .select("id, match_date, home_team, away_team")
    .gte("match_date", new Date().toISOString().split("T")[0])
    .order("match_date", { ascending: true })
    .limit(100); // Get batch to filter client-side

  if (error || !matches) {
    console.error("Error finding scheduled match:", error);
    return null;
  }

  // Filter for matches between these teams (either direction)
  for (const match of matches) {
    const homeTeam = match.home_team as { name?: string; display_name?: string } | null;
    const awayTeam = match.away_team as { name?: string; display_name?: string } | null;

    const homeName = cleanTeamName(homeTeam?.display_name || homeTeam?.name || "");
    const awayName = cleanTeamName(awayTeam?.display_name || awayTeam?.name || "");

    // Check if team A is home and team B is away (or vice versa)
    if (
      (homeName === teamAClean && awayName === teamBClean) ||
      (homeName === teamBClean && awayName === teamAClean)
    ) {
      return { id: match.id, match_date: match.match_date };
    }
  }

  return null;
}

// ============================================================
// SUBMIT PREDICTION
// ============================================================

export async function submitUserPrediction(
  params: SubmitPredictionParams,
): Promise<UserPrediction | null> {
  try {
    const deviceId = await getDeviceId();

    // Ensure user has a profile
    let profile = await getUserProfile();
    if (!profile) {
      profile = await saveUserProfile("Anonymous", "⚽");
    }

    // Determine predicted winner
    let predictedWinner: "team_a" | "team_b" | "draw";
    if (params.predictedScoreA > params.predictedScoreB) {
      predictedWinner = "team_a";
    } else if (params.predictedScoreB > params.predictedScoreA) {
      predictedWinner = "team_b";
    } else {
      predictedWinner = "draw";
    }

    // Try to find a scheduled match to link this prediction to
    let matchResultId = params.matchResultId || null;
    let matchDate = params.matchDate || null;

    if (!matchResultId) {
      const scheduledMatch = await findScheduledMatch(
        params.teamAName,
        params.teamBName
      );
      
      if (scheduledMatch) {
        matchResultId = scheduledMatch.id;
        matchDate = scheduledMatch.match_date;
        console.log(`📅 Linked prediction to match: ${matchResultId} on ${matchDate}`);
      }
    }

    const { data, error } = await supabase
      .from("user_predictions")
      .insert({
        device_id: deviceId,
        user_profile_id: profile?.id || null,
        team_a_name: params.teamAName,
        team_b_name: params.teamBName,
        team_a_state: params.teamAState || null,
        team_b_state: params.teamBState || null,
        age_group: params.ageGroup || null,
        gender: params.gender || null,
        user_predicted_score_a: params.predictedScoreA,
        user_predicted_score_b: params.predictedScoreB,
        user_predicted_winner: predictedWinner,
        match_result_id: matchResultId,
        match_date: matchDate,
      })
      .select()
      .single();

    if (error) {
      console.error("Error submitting prediction:", error);
      return null;
    }

    // Increment total_predictions on user_profiles so leaderboard shows user
    if (profile?.id) {
      const { error: updateError } = await supabase
        .from("user_profiles")
        .update({ 
          total_predictions: (profile.total_predictions || 0) + 1,
          updated_at: new Date().toISOString()
        })
        .eq("id", profile.id);
      
      if (updateError) {
        console.error("Error updating prediction count:", updateError);
      }
    }

    return data as UserPrediction;
  } catch (error) {
    console.error("Error in submitUserPrediction:", error);
    return null;
  }
}

// ============================================================
// FETCH PREDICTIONS
// ============================================================

export async function getUserPredictions(
  limit: number = 20,
): Promise<UserPrediction[]> {
  try {
    const deviceId = await getDeviceId();

    const { data, error } = await supabase
      .from("user_predictions")
      .select("*")
      .eq("device_id", deviceId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("Error fetching predictions:", error);
      return [];
    }

    return (data as UserPrediction[]) || [];
  } catch (error) {
    console.error("Error in getUserPredictions:", error);
    return [];
  }
}

export async function hasPendingPrediction(
  teamAName: string,
  teamBName: string,
): Promise<boolean> {
  try {
    const deviceId = await getDeviceId();

    const { data, error } = await supabase
      .from("user_predictions")
      .select("id")
      .eq("device_id", deviceId)
      .eq("team_a_name", teamAName)
      .eq("team_b_name", teamBName)
      .eq("status", "pending")
      .limit(1);

    if (error) {
      console.error("Error checking pending prediction:", error);
      return false;
    }

    return (data?.length || 0) > 0;
  } catch (error) {
    console.error("Error in hasPendingPrediction:", error);
    return false;
  }
}

// ============================================================
// LINK EXISTING PREDICTIONS TO MATCHES (Backfill utility)
// ============================================================

export async function linkPredictionsToMatches(): Promise<{
  processed: number;
  linked: number;
}> {
  let processed = 0;
  let linked = 0;

  try {
    // Get all pending predictions without match_result_id
    const { data: predictions, error } = await supabase
      .from("user_predictions")
      .select("*")
      .eq("status", "pending")
      .is("match_result_id", null);

    if (error || !predictions) {
      console.error("Error fetching predictions:", error);
      return { processed: 0, linked: 0 };
    }

    for (const prediction of predictions) {
      processed++;
      
      const scheduledMatch = await findScheduledMatch(
        prediction.team_a_name,
        prediction.team_b_name
      );

      if (scheduledMatch) {
        const { error: updateError } = await supabase
          .from("user_predictions")
          .update({
            match_result_id: scheduledMatch.id,
            match_date: scheduledMatch.match_date,
          })
          .eq("id", prediction.id);

        if (!updateError) {
          linked++;
        }
      }
    }

    return { processed, linked };
  } catch (error) {
    console.error("Error linking predictions:", error);
    return { processed, linked };
  }
}
