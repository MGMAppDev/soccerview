import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { supabase } from "../../lib/supabase";

type MatchRow = Record<string, any>;

type TeamResolvedRow = {
  team_id: string | null;
  effective_team_id: string | null;
  display_name?: string | null;
  team_name?: string | null;
  name?: string | null;
};

function pickTeamName(
  t: TeamResolvedRow | null | undefined,
  fallback: string
) {
  const n = t?.display_name ?? t?.team_name ?? t?.name ?? null;
  return n && String(n).trim().length ? String(n) : fallback;
}

function formatDate(value: any) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString();
}

export default function MatchDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();

  const matchId = useMemo(() => {
    const raw = params?.id;
    return Array.isArray(raw) ? raw[0] : raw;
  }, [params]);

  const [loading, setLoading] = useState(true);
  const [match, setMatch] = useState<MatchRow | null>(null);
  const [homeTeam, setHomeTeam] = useState<TeamResolvedRow | null>(null);
  const [awayTeam, setAwayTeam] = useState<TeamResolvedRow | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);

      const { data: mData } = await supabase
        .from("v_matches_resolved")
        .select("*")
        .eq("id", matchId)
        .maybeSingle();

      if (cancelled) return;

      if (!mData) {
        setMatch(null);
        setHomeTeam(null);
        setAwayTeam(null);
        setLoading(false);
        return;
      }

      setMatch(mData);

      async function fetchTeam(
        effectiveId: string | null,
        rawId: string | null
      ) {
        if (!effectiveId && !rawId) return null;

        const parts: string[] = [];
        if (effectiveId) parts.push(`effective_team_id.eq.${effectiveId}`);
        if (rawId) parts.push(`team_id.eq.${rawId}`);

        const { data } = await supabase
          .from("v_teams_resolved")
          .select("team_id,effective_team_id,display_name,team_name,name")
          .or(parts.join(","))
          .limit(1);

        return data?.[0] ?? null;
      }

      const [h, a] = await Promise.all([
        fetchTeam(
          mData.home_effective_team_id ?? null,
          mData.home_team_id ?? null
        ),
        fetchTeam(
          mData.away_effective_team_id ?? null,
          mData.away_team_id ?? null
        ),
      ]);

      if (cancelled) return;

      setHomeTeam(h);
      setAwayTeam(a);
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [matchId]);

  const homeName = pickTeamName(homeTeam, "Home");
  const awayName = pickTeamName(awayTeam, "Away");

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
      {formatDate(match?.played_at) ? (
        <Text style={{ opacity: 0.7 }}>
          {formatDate(match?.played_at)}
        </Text>
      ) : null}

      <View
        style={{
          padding: 14,
          borderWidth: 1,
          borderRadius: 14,
        }}
      >
        <Text style={{ fontSize: 16, fontWeight: "700" }}>
          Score
        </Text>
        <Text style={{ fontSize: 18 }}>
          {homeName}: {match?.home_score ?? "—"} |{" "}
          {awayName}: {match?.away_score ?? "—"}
        </Text>
      </View>

      <View style={{ gap: 10 }}>
        <Text style={{ fontSize: 16, fontWeight: "700" }}>
          Teams
        </Text>

        <Pressable
          onPress={() =>
            match?.home_effective_team_id &&
            router.push(`/team/${match.home_effective_team_id}`)
          }
          style={{
            padding: 14,
            borderWidth: 1,
            borderRadius: 14,
          }}
        >
          <Text style={{ fontWeight: "700" }}>{homeName}</Text>
          <Text style={{ opacity: 0.7 }}>View team</Text>
        </Pressable>

        <Pressable
          onPress={() =>
            match?.away_effective_team_id &&
            router.push(`/team/${match.away_effective_team_id}`)
          }
          style={{
            padding: 14,
            borderWidth: 1,
            borderRadius: 14,
          }}
        >
          <Text style={{ fontWeight: "700" }}>{awayName}</Text>
          <Text style={{ opacity: 0.7 }}>View team</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
