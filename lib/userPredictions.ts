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
};

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
      })
      .select()
      .single();

    if (error) {
      console.error("Error submitting prediction:", error);
      return null;
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
