import { router } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { supabase } from "../../lib/supabase";

/**
 * Rankings tab = ONE tab.
 * Modes:
 *  - National (from team_ranks_daily, scope='national')
 *  - State (from team_ranks_daily, scope='state' + state filter)
 *  - Standings (computed from matches)
 *
 * NOTE: Current DB schema for team_ranks_daily:
 * id, rank_date, team_id, scope, state, rank, rating, source_id
 */

type MatchRow = {
  id: string;
  season: string | null;
  league_id: string | null;
  match_date: string | null;
  status: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  home_score: number | null;
  away_score: number | null;
};

type TeamRow = { id: string; name: string | null };

type LeagueRow = { id: string; name: string | null };

type Standing = {
  team_id: string;
  team_name: string;
  gp: number;
  w: number;
  l: number;
  t: number;
  gf: number;
  ga: number;
  gd: number;
  pts: number;
};

type RankRow = {
  rank_date: string | null;
  team_id: string | null;
  scope: string | null; // 'national' or 'state'
  state: string | null;
  rank: number | null;
  rating: number | null;
  team_name?: string | null; // hydrated client-side
};

function isUuid(v: string | null | undefined) {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v,
  );
}

function safeText(v: any, fallback: string) {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : fallback;
}

function safeNum(n: any) {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

function isCountableMatch(m: MatchRow) {
  const hasScores = m.home_score !== null && m.away_score !== null;
  if (!hasScores) return false;

  const s = (m.status ?? "").toLowerCase().trim();
  if (!s) return true;

  return (
    s === "final" ||
    s.includes("final") ||
    s === "ft" ||
    s.includes("full") ||
    s.includes("complete")
  );
}

const ALL_LEAGUES_ID = "__ALL__";

export default function RankingsTab() {
  // Mode
  const [mode, setMode] = useState<"national" | "state" | "standings">(
    "national",
  );

  // Shared
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ================
  // Standings state
  // ================
  const [seasons, setSeasons] = useState<string[]>([]);
  const [selectedSeason, setSelectedSeason] = useState<string | null>(null);

  const [leagues, setLeagues] = useState<LeagueRow[]>([]);
  const [selectedLeagueId, setSelectedLeagueId] = useState<string | null>(null);

  const [standings, setStandings] = useState<Standing[]>([]);

  // League picker modal (standings)
  const [leaguePickerOpen, setLeaguePickerOpen] = useState(false);
  const [leagueSearch, setLeagueSearch] = useState("");
  const leagueSearchRef = useRef<TextInput>(null);

  const filteredLeaguesForPicker = useMemo(() => {
    const q = leagueSearch.trim().toLowerCase();
    if (!q) return leagues;
    return leagues.filter((l) => (l.name ?? "").toLowerCase().includes(q));
  }, [leagueSearch, leagues]);

  const headerSubtitle = useMemo(() => {
    const season = selectedSeason ?? "—";
    const leagueName =
      selectedLeagueId === null
        ? "All leagues"
        : (leagues.find((l) => l.id === selectedLeagueId)?.name ?? "League");
    return `${season} • ${leagueName}`;
  }, [selectedSeason, selectedLeagueId, leagues]);

  // ================
  // Rankings state
  // ================
  // UI chips kept for MVP roadmap, but DB doesn't support these columns yet.
  const AGE_GROUPS = ["U10", "U11", "U12", "U13"];
  const [ageGroup, setAgeGroup] = useState<(typeof AGE_GROUPS)[number]>("U12");
  const [gender, setGender] = useState<"Boys" | "Girls">("Boys");

  const [rankDate, setRankDate] = useState<string | null>(null);

  const [nationalRanks, setNationalRanks] = useState<RankRow[]>([]);

  // State rankings
  const [states, setStates] = useState<string[]>([]);
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const [stateRanks, setStateRanks] = useState<RankRow[]>([]);

  // State picker modal
  const [statePickerOpen, setStatePickerOpen] = useState(false);
  const [stateSearch, setStateSearch] = useState("");
  const stateSearchRef = useRef<TextInput>(null);

  const filteredStatesForPicker = useMemo(() => {
    const q = stateSearch.trim().toLowerCase();
    if (!q) return states;
    return states.filter((s) => s.toLowerCase().includes(q));
  }, [stateSearch, states]);

  const nationalSubtitle = useMemo(() => {
    const datePart = rankDate ? ` • ${rankDate}` : "";
    return `National${datePart}`;
  }, [rankDate]);

  const stateSubtitle = useMemo(() => {
    const datePart = rankDate ? ` • ${rankDate}` : "";
    const st = selectedState ?? "—";
    return `${st}${datePart}`;
  }, [selectedState, rankDate]);

  // =========================
  // Data loaders
  // =========================
  async function loadSeasons() {
    const { data, error: qErr } = await supabase
      .from("matches")
      .select("season")
      .not("season", "is", null)
      .limit(1000);

    if (qErr) throw qErr;

    const uniq = Array.from(
      new Set((data ?? []).map((r: any) => String(r.season)).filter(Boolean)),
    ).sort((a, b) => (a < b ? 1 : -1)); // newest first

    setSeasons(uniq);
    setSelectedSeason((prev) => prev ?? uniq[0] ?? null);
  }

  async function loadLeagues() {
    const { data, error: qErr } = await supabase
      .from("leagues")
      .select("id, name")
      .order("name", { ascending: true })
      .limit(1000);

    if (qErr) {
      setLeagues([]);
      return;
    }
    setLeagues((data as LeagueRow[]) ?? []);
  }

  async function loadStandings(season: string | null, leagueId: string | null) {
    if (!season) {
      setStandings([]);
      return;
    }

    // 1) Load matches for season (+ optional league)
    let q = supabase
      .from("matches")
      .select(
        "id, season, league_id, match_date, status, home_team_id, away_team_id, home_score, away_score",
      )
      .eq("season", season)
      .limit(5000);

    if (leagueId && leagueId !== ALL_LEAGUES_ID && isUuid(leagueId))
      q = q.eq("league_id", leagueId);

    const { data: mData, error: mErr } = await q;
    if (mErr) throw mErr;

    const matches = (mData as MatchRow[]) ?? [];
    const finals = matches.filter(isCountableMatch);

    if (finals.length === 0) {
      setStandings([]);
      return;
    }

    // 2) Collect team IDs
    const teamIds = Array.from(
      new Set(
        finals
          .flatMap((m) => [m.home_team_id, m.away_team_id])
          .filter((id): id is string => typeof id === "string" && isUuid(id)),
      ),
    );

    // 3) Load team names
    const { data: tData, error: tErr } = await supabase
      .from("teams")
      .select("id, name")
      .in("id", teamIds)
      .limit(5000);
    if (tErr) throw tErr;

    const teamMap = new Map<string, string>();
    (tData as TeamRow[] | null)?.forEach((t) =>
      teamMap.set(t.id, t.name ?? "Unnamed Team"),
    );

    // 4) Compute standings
    const table = new Map<string, Standing>();

    function ensure(team_id: string) {
      if (!table.has(team_id)) {
        table.set(team_id, {
          team_id,
          team_name: teamMap.get(team_id) ?? "Unnamed Team",
          gp: 0,
          w: 0,
          l: 0,
          t: 0,
          gf: 0,
          ga: 0,
          gd: 0,
          pts: 0,
        });
      }
      return table.get(team_id)!;
    }

    for (const m of finals) {
      const homeId = m.home_team_id;
      const awayId = m.away_team_id;
      if (!homeId || !awayId || !isUuid(homeId) || !isUuid(awayId)) continue;

      const hs = safeNum(m.home_score);
      const as = safeNum(m.away_score);

      const home = ensure(homeId);
      const away = ensure(awayId);

      home.gp += 1;
      away.gp += 1;

      home.gf += hs;
      home.ga += as;
      away.gf += as;
      away.ga += hs;

      if (hs > as) {
        home.w += 1;
        away.l += 1;
        home.pts += 3;
      } else if (hs < as) {
        away.w += 1;
        home.l += 1;
        away.pts += 3;
      } else {
        home.t += 1;
        away.t += 1;
        home.pts += 1;
        away.pts += 1;
      }
    }

    const arr = Array.from(table.values()).map((s) => ({
      ...s,
      gd: s.gf - s.ga,
    }));
    arr.sort((a, b) => {
      if (b.pts !== a.pts) return b.pts - a.pts;
      if (b.gd !== a.gd) return b.gd - a.gd;
      if (b.gf !== a.gf) return b.gf - a.gf;
      return a.team_name.localeCompare(b.team_name);
    });

    setStandings(arr);
  }

  async function hydrateTeamNames(rows: RankRow[]) {
    const ids = Array.from(
      new Set(
        rows
          .map((r) => r.team_id)
          .filter((id): id is string => typeof id === "string" && isUuid(id)),
      ),
    );

    if (!ids.length) return rows;

    const { data: tData, error: tErr } = await supabase
      .from("teams")
      .select("id,name")
      .in("id", ids)
      .limit(5000);

    if (tErr) return rows;

    const map = new Map<string, string>();
    (tData as TeamRow[] | null)?.forEach((t) =>
      map.set(t.id, t.name ?? "Unnamed Team"),
    );
    rows.forEach((r) => {
      if (r.team_id && map.has(r.team_id)) r.team_name = map.get(r.team_id);
    });

    return rows;
  }

  async function loadNational() {
    const { data, error: qErr } = await supabase
      .from("team_ranks_daily")
      .select("rank_date, team_id, scope, state, rank, rating")
      .eq("scope", "national")
      .order("rank_date", { ascending: false })
      .order("rank", { ascending: true })
      .limit(200);

    if (qErr) throw qErr;

    const rows: RankRow[] = ((data as any[]) ?? []).map((r) => ({
      rank_date: r.rank_date ?? null,
      team_id: r.team_id ?? null,
      scope: r.scope ?? null,
      state: r.state ?? null,
      rank: r.rank ?? null,
      rating: r.rating ?? null,
    }));

    setRankDate(rows[0]?.rank_date ?? null);

    await hydrateTeamNames(rows);
    setNationalRanks(rows);
  }

  async function loadStatesListIfNeeded() {
    // Light + safe: pull state list from teams table (50-ish values)
    if (states.length) return;

    const { data, error: qErr } = await supabase
      .from("teams")
      .select("state")
      .not("state", "is", null)
      .limit(5000);

    if (qErr) {
      setStates([]);
      return;
    }

    const uniq = Array.from(
      new Set(
        ((data as any[]) ?? [])
          .map((r) =>
            String(r.state ?? "")
              .trim()
              .toUpperCase(),
          )
          .filter((s) => /^[A-Z]{2}$/.test(s)),
      ),
    ).sort();

    setStates(uniq);

    // Pick default state if not set yet
    setSelectedState((prev) => prev ?? uniq[0] ?? null);
  }

  async function loadStateRanks(stateCode: string | null) {
    if (!stateCode) {
      setStateRanks([]);
      return;
    }

    const { data, error: qErr } = await supabase
      .from("team_ranks_daily")
      .select("rank_date, team_id, scope, state, rank, rating")
      .eq("scope", "state")
      .eq("state", stateCode)
      .order("rank_date", { ascending: false })
      .order("rank", { ascending: true })
      .limit(300);

    if (qErr) throw qErr;

    const rows: RankRow[] = ((data as any[]) ?? []).map((r) => ({
      rank_date: r.rank_date ?? null,
      team_id: r.team_id ?? null,
      scope: r.scope ?? null,
      state: r.state ?? null,
      rank: r.rank ?? null,
      rating: r.rating ?? null,
    }));

    // Use the date of whichever ranks are currently visible (keeps subtitle consistent)
    setRankDate(rows[0]?.rank_date ?? null);

    await hydrateTeamNames(rows);
    setStateRanks(rows);
  }

  // =========================
  // Initial load
  // =========================
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);

        // Load standings metadata up-front so switching modes is instant
        await Promise.all([loadSeasons(), loadLeagues()]);
      } catch (e: any) {
        setError(e?.message ?? "Unknown error");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Standings reload when filters change
  useEffect(() => {
    if (mode !== "standings") return;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        await loadStandings(selectedSeason, selectedLeagueId);
      } catch (e: any) {
        setError(e?.message ?? "Unknown error");
        setStandings([]);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selectedSeason, selectedLeagueId]);

  // National reload when mode changes to national
  useEffect(() => {
    if (mode !== "national") return;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        await loadNational();
      } catch (e: any) {
        setError(e?.message ?? "Unknown error");
        setNationalRanks([]);
        setRankDate(null);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // State load (state list + ranks) when mode changes to state OR selectedState changes
  useEffect(() => {
    if (mode !== "state") return;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        await loadStatesListIfNeeded();
      } catch (e: any) {
        // if state list fails, still try ranks based on current selectedState
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    if (mode !== "state") return;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        await loadStateRanks(selectedState);
      } catch (e: any) {
        setError(e?.message ?? "Unknown error");
        setStateRanks([]);
        setRankDate(null);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selectedState]);

  // =========================
  // Pickers
  // =========================
  function openLeaguePicker() {
    setLeaguePickerOpen(true);
    setLeagueSearch("");
    setTimeout(() => leagueSearchRef.current?.focus(), 250);
  }

  function closeLeaguePicker() {
    setLeaguePickerOpen(false);
    setLeagueSearch("");
  }

  function chooseLeague(id: string) {
    closeLeaguePicker();
    if (id === ALL_LEAGUES_ID) setSelectedLeagueId(null);
    else setSelectedLeagueId(id);
  }

  function openStatePicker() {
    setStatePickerOpen(true);
    setStateSearch("");
    setTimeout(() => stateSearchRef.current?.focus(), 250);
  }

  function closeStatePicker() {
    setStatePickerOpen(false);
    setStateSearch("");
  }

  function chooseState(code: string) {
    closeStatePicker();
    setSelectedState(code);
  }

  // =========================
  // UI
  // =========================
  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator />
          <Text style={styles.loadingText}>Loading…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.container}>
          <Text style={styles.title}>Rankings</Text>
          <Text style={[styles.subtle, { marginTop: 10 }]} selectable>
            {error}
          </Text>

          <Pressable
            onPress={() => {
              setError(null);
              setLoading(true);
              (async () => {
                try {
                  if (mode === "national") await loadNational();
                  else if (mode === "state")
                    await loadStateRanks(selectedState);
                  else await loadStandings(selectedSeason, selectedLeagueId);
                } catch (e: any) {
                  setError(e?.message ?? "Unknown error");
                } finally {
                  setLoading(false);
                }
              })();
            }}
            style={{ marginTop: 14 }}
          >
            <Text
              style={{
                fontWeight: "900",
                textDecorationLine: "underline",
                color: "white",
              }}
            >
              Retry
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>Rankings</Text>

        {/* Mode toggle */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          <Pressable
            onPress={() => setMode("national")}
            style={[
              styles.chip,
              mode === "national" ? styles.chipActive : styles.chipInactive,
            ]}
          >
            <Text
              style={[
                styles.chipText,
                mode === "national"
                  ? styles.chipTextActive
                  : styles.chipTextInactive,
              ]}
            >
              National
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setMode("state")}
            style={[
              styles.chip,
              mode === "state" ? styles.chipActive : styles.chipInactive,
            ]}
          >
            <Text
              style={[
                styles.chipText,
                mode === "state"
                  ? styles.chipTextActive
                  : styles.chipTextInactive,
              ]}
            >
              State
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setMode("standings")}
            style={[
              styles.chip,
              mode === "standings" ? styles.chipActive : styles.chipInactive,
            ]}
          >
            <Text
              style={[
                styles.chipText,
                mode === "standings"
                  ? styles.chipTextActive
                  : styles.chipTextInactive,
              ]}
            >
              League Standings
            </Text>
          </Pressable>
        </ScrollView>

        {mode === "national" ? (
          <>
            <Text style={styles.subtle}>{nationalSubtitle}</Text>

            {/* National controls (disabled until DB supports it) */}
            <View style={styles.controls}>
              <View style={styles.controlBlock}>
                <Text style={styles.controlLabel}>Gender (coming soon)</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipRow}
                >
                  {(["Boys", "Girls"] as const).map((g) => (
                    <Pressable
                      key={g}
                      onPress={() => setGender(g)}
                      disabled
                      style={[
                        styles.chip,
                        styles.chipInactive,
                        { opacity: 0.55 },
                      ]}
                    >
                      <Text style={[styles.chipText, styles.chipTextInactive]}>
                        {g}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>

              <View style={styles.controlBlock}>
                <Text style={styles.controlLabel}>Age group (coming soon)</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipRow}
                >
                  {AGE_GROUPS.map((ag) => (
                    <Pressable
                      key={ag}
                      onPress={() => setAgeGroup(ag)}
                      disabled
                      style={[
                        styles.chip,
                        styles.chipInactive,
                        { opacity: 0.55 },
                      ]}
                    >
                      <Text style={[styles.chipText, styles.chipTextInactive]}>
                        {ag}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            </View>

            {/* National table */}
            <View style={styles.tableWrap}>
              <View style={styles.tableHeader}>
                <Text style={[styles.th, styles.colRank]}>#</Text>
                <Text style={[styles.th, styles.colTeam]}>Team</Text>
                <Text style={[styles.th, styles.colPts]}>Rank</Text>
              </View>

              <FlatList
                data={nationalRanks}
                keyExtractor={(item, idx) =>
                  `${item.team_id ?? "x"}-${item.rank_date ?? "d"}-${idx}`
                }
                renderItem={({ item, index }) => {
                  const tid = item.team_id ?? null;
                  const canOpen = isUuid(tid ?? "");
                  const rankVal = item.rank ?? index + 1;

                  return (
                    <Pressable
                      onPress={() => {
                        if (canOpen && tid) router.push(`/team/${tid}`);
                      }}
                      disabled={!canOpen}
                      style={[
                        styles.tr,
                        index % 2 === 0 ? styles.trEven : styles.trOdd,
                        !canOpen ? { opacity: 0.55 } : null,
                      ]}
                    >
                      <Text style={[styles.td, styles.colRank]}>
                        {index + 1}
                      </Text>
                      <Text
                        style={[styles.td, styles.colTeam]}
                        numberOfLines={1}
                      >
                        {safeText(item.team_name, "Unnamed Team")}
                      </Text>
                      <Text style={[styles.td, styles.colPts]}>{rankVal}</Text>
                    </Pressable>
                  );
                }}
                ListEmptyComponent={
                  <View style={styles.empty}>
                    <Text style={styles.emptyTitle}>
                      No national ranks found
                    </Text>
                    <Text style={styles.emptyBody}>
                      We’re reading from team_ranks_daily where scope =
                      national.
                    </Text>
                  </View>
                }
                initialNumToRender={25}
                maxToRenderPerBatch={30}
                windowSize={9}
                removeClippedSubviews={Platform.OS === "android"}
              />
            </View>
          </>
        ) : mode === "state" ? (
          <>
            <Text style={styles.subtle}>{stateSubtitle}</Text>

            {/* State controls */}
            <View style={styles.controls}>
              <View style={styles.controlBlock}>
                <Text style={styles.controlLabel}>State</Text>
                <Pressable onPress={openStatePicker} style={styles.leaguePill}>
                  <Text numberOfLines={1} style={styles.leaguePillText}>
                    {selectedState ?? "Select a state"}
                  </Text>
                  <Text style={styles.leaguePillChevron}>›</Text>
                </Pressable>
              </View>
            </View>

            {/* State table */}
            <View style={styles.tableWrap}>
              <View style={styles.tableHeader}>
                <Text style={[styles.th, styles.colRank]}>#</Text>
                <Text style={[styles.th, styles.colTeam]}>Team</Text>
                <Text style={[styles.th, styles.colPts]}>Rank</Text>
              </View>

              <FlatList
                data={stateRanks}
                keyExtractor={(item, idx) =>
                  `${item.team_id ?? "x"}-${item.rank_date ?? "d"}-${idx}`
                }
                renderItem={({ item, index }) => {
                  const tid = item.team_id ?? null;
                  const canOpen = isUuid(tid ?? "");
                  const rankVal = item.rank ?? index + 1;

                  return (
                    <Pressable
                      onPress={() => {
                        if (canOpen && tid) router.push(`/team/${tid}`);
                      }}
                      disabled={!canOpen}
                      style={[
                        styles.tr,
                        index % 2 === 0 ? styles.trEven : styles.trOdd,
                        !canOpen ? { opacity: 0.55 } : null,
                      ]}
                    >
                      <Text style={[styles.td, styles.colRank]}>
                        {index + 1}
                      </Text>
                      <Text
                        style={[styles.td, styles.colTeam]}
                        numberOfLines={1}
                      >
                        {safeText(item.team_name, "Unnamed Team")}
                      </Text>
                      <Text style={[styles.td, styles.colPts]}>{rankVal}</Text>
                    </Pressable>
                  );
                }}
                ListEmptyComponent={
                  <View style={styles.empty}>
                    <Text style={styles.emptyTitle}>No state ranks found</Text>
                    <Text style={styles.emptyBody}>
                      We’re reading from team_ranks_daily where scope = state
                      and state = {selectedState ?? "—"}.
                    </Text>
                  </View>
                }
                initialNumToRender={25}
                maxToRenderPerBatch={30}
                windowSize={9}
                removeClippedSubviews={Platform.OS === "android"}
              />
            </View>

            {/* State Picker Modal */}
            <Modal
              visible={statePickerOpen}
              animationType="slide"
              transparent
              onRequestClose={closeStatePicker}
            >
              <Pressable
                style={styles.modalBackdrop}
                onPress={closeStatePicker}
              />
              <KeyboardAvoidingView
                behavior={Platform.OS === "ios" ? "padding" : undefined}
                keyboardVerticalOffset={Platform.OS === "ios" ? 20 : 0}
                style={styles.modalCard}
              >
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Select state</Text>
                  <Pressable
                    onPress={closeStatePicker}
                    style={styles.modalClose}
                  >
                    <Text style={styles.modalCloseText}>Close</Text>
                  </Pressable>
                </View>

                <TextInput
                  ref={stateSearchRef}
                  value={stateSearch}
                  onChangeText={setStateSearch}
                  placeholder="Search states… (e.g., KS)"
                  placeholderTextColor="#888"
                  style={styles.searchInput}
                  autoCorrect={false}
                  autoCapitalize="characters"
                  clearButtonMode="while-editing"
                  returnKeyType="search"
                />

                <FlatList
                  data={filteredStatesForPicker}
                  keyExtractor={(s) => s}
                  keyboardShouldPersistTaps="handled"
                  renderItem={({ item }) => {
                    const active = selectedState === item;
                    return (
                      <Pressable
                        onPress={() => chooseState(item)}
                        style={[
                          styles.leagueRow,
                          active ? styles.leagueRowActive : null,
                        ]}
                      >
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.leagueRowText,
                            active ? styles.leagueRowTextActive : null,
                          ]}
                        >
                          {item}
                        </Text>
                        {active ? (
                          <Text style={styles.leagueRowCheck}>✓</Text>
                        ) : null}
                      </Pressable>
                    );
                  }}
                  initialNumToRender={18}
                  maxToRenderPerBatch={24}
                  windowSize={10}
                  removeClippedSubviews={Platform.OS === "android"}
                  ListEmptyComponent={
                    <View style={styles.emptyPicker}>
                      <Text style={styles.emptyTitle}>No states match</Text>
                      <Text style={styles.emptyBody}>
                        Try a shorter search.
                      </Text>
                    </View>
                  }
                />
              </KeyboardAvoidingView>
            </Modal>
          </>
        ) : (
          <>
            <Text style={styles.subtle}>{headerSubtitle}</Text>

            {/* Standings controls */}
            <View style={styles.controls}>
              <View style={styles.controlBlock}>
                <Text style={styles.controlLabel}>Season</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipRow}
                >
                  {seasons.map((s) => (
                    <Pressable
                      key={s}
                      onPress={() => setSelectedSeason(s)}
                      style={[
                        styles.chip,
                        selectedSeason === s
                          ? styles.chipActive
                          : styles.chipInactive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          selectedSeason === s
                            ? styles.chipTextActive
                            : styles.chipTextInactive,
                        ]}
                      >
                        {s}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>

              <View style={styles.controlBlock}>
                <Text style={styles.controlLabel}>League</Text>
                <Pressable onPress={openLeaguePicker} style={styles.leaguePill}>
                  <Text numberOfLines={1} style={styles.leaguePillText}>
                    {selectedLeagueId === null
                      ? "All leagues"
                      : safeText(
                          leagues.find((l) => l.id === selectedLeagueId)?.name,
                          "League",
                        )}
                  </Text>
                  <Text style={styles.leaguePillChevron}>›</Text>
                </Pressable>
              </View>
            </View>

            {/* Standings table */}
            <View style={styles.tableWrap}>
              <View style={styles.tableHeader}>
                <Text style={[styles.th, styles.colRank]}>#</Text>
                <Text style={[styles.th, styles.colTeam]}>Team</Text>
                <Text style={[styles.th, styles.colNum]}>GP</Text>
                <Text style={[styles.th, styles.colNum]}>W</Text>
                <Text style={[styles.th, styles.colNum]}>L</Text>
                <Text style={[styles.th, styles.colNum]}>T</Text>
                <Text style={[styles.th, styles.colPts]}>Pts</Text>
              </View>

              <FlatList
                data={standings}
                keyExtractor={(item) => item.team_id}
                renderItem={({ item, index }) => {
                  const canOpen = isUuid(item.team_id);

                  return (
                    <Pressable
                      onPress={() => {
                        if (canOpen) router.push(`/team/${item.team_id}`);
                      }}
                      disabled={!canOpen}
                      style={[
                        styles.tr,
                        index % 2 === 0 ? styles.trEven : styles.trOdd,
                        !canOpen ? { opacity: 0.55 } : null,
                      ]}
                    >
                      <Text style={[styles.td, styles.colRank]}>
                        {index + 1}
                      </Text>
                      <Text
                        style={[styles.td, styles.colTeam]}
                        numberOfLines={1}
                      >
                        {safeText(item.team_name, "Unnamed Team")}
                      </Text>
                      <Text style={[styles.td, styles.colNum]}>{item.gp}</Text>
                      <Text style={[styles.td, styles.colNum]}>{item.w}</Text>
                      <Text style={[styles.td, styles.colNum]}>{item.l}</Text>
                      <Text style={[styles.td, styles.colNum]}>{item.t}</Text>
                      <Text style={[styles.td, styles.colPts]}>{item.pts}</Text>
                    </Pressable>
                  );
                }}
                ListEmptyComponent={
                  <View style={styles.empty}>
                    <Text style={styles.emptyTitle}>No standings found</Text>
                    <Text style={styles.emptyBody}>
                      Try a different season or league. Standings are computed
                      from matches with status like “final”.
                    </Text>
                  </View>
                }
                initialNumToRender={25}
                maxToRenderPerBatch={30}
                windowSize={9}
                removeClippedSubviews={Platform.OS === "android"}
              />
            </View>

            {/* League Picker Modal */}
            <Modal
              visible={leaguePickerOpen}
              animationType="slide"
              transparent
              onRequestClose={closeLeaguePicker}
            >
              <Pressable
                style={styles.modalBackdrop}
                onPress={closeLeaguePicker}
              />
              <KeyboardAvoidingView
                behavior={Platform.OS === "ios" ? "padding" : undefined}
                keyboardVerticalOffset={Platform.OS === "ios" ? 20 : 0}
                style={styles.modalCard}
              >
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Select league</Text>
                  <Pressable
                    onPress={closeLeaguePicker}
                    style={styles.modalClose}
                  >
                    <Text style={styles.modalCloseText}>Close</Text>
                  </Pressable>
                </View>

                <TextInput
                  ref={leagueSearchRef}
                  value={leagueSearch}
                  onChangeText={setLeagueSearch}
                  placeholder="Search leagues…"
                  placeholderTextColor="#888"
                  style={styles.searchInput}
                  autoCorrect={false}
                  autoCapitalize="none"
                  clearButtonMode="while-editing"
                  returnKeyType="search"
                />

                <FlatList
                  data={[
                    { id: ALL_LEAGUES_ID, name: "All leagues" } as LeagueRow,
                    ...filteredLeaguesForPicker,
                  ]}
                  keyExtractor={(l) => l.id}
                  keyboardShouldPersistTaps="handled"
                  renderItem={({ item }) => {
                    const active =
                      (selectedLeagueId ?? ALL_LEAGUES_ID) === item.id;
                    return (
                      <Pressable
                        onPress={() => chooseLeague(item.id)}
                        style={[
                          styles.leagueRow,
                          active ? styles.leagueRowActive : null,
                        ]}
                      >
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.leagueRowText,
                            active ? styles.leagueRowTextActive : null,
                          ]}
                        >
                          {safeText(item.name, "League")}
                        </Text>
                        {active ? (
                          <Text style={styles.leagueRowCheck}>✓</Text>
                        ) : null}
                      </Pressable>
                    );
                  }}
                  initialNumToRender={18}
                  maxToRenderPerBatch={24}
                  windowSize={10}
                  removeClippedSubviews={Platform.OS === "android"}
                  ListEmptyComponent={
                    <View style={styles.emptyPicker}>
                      <Text style={styles.emptyTitle}>No leagues match</Text>
                      <Text style={styles.emptyBody}>
                        Try a shorter search.
                      </Text>
                    </View>
                  }
                />
              </KeyboardAvoidingView>
            </Modal>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0b0b0b" },
  container: { flex: 1, paddingHorizontal: 14, paddingTop: 10 },

  title: { color: "white", fontSize: 22, fontWeight: "700", marginBottom: 8 },
  subtle: {
    color: "#bdbdbd",
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 10,
  },

  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  loadingText: { color: "#bdbdbd" },

  controls: { gap: 10, marginBottom: 10 },
  controlBlock: { gap: 6 },
  controlLabel: { color: "#bdbdbd", fontSize: 12, fontWeight: "600" },

  chipRow: { gap: 8, paddingVertical: 2 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipActive: { backgroundColor: "#ffffff", borderColor: "#ffffff" },
  chipInactive: { backgroundColor: "transparent", borderColor: "#2b2b2b" },
  chipText: { fontSize: 12, fontWeight: "700" },
  chipTextActive: { color: "#0b0b0b" },
  chipTextInactive: { color: "#d7d7d7" },

  leaguePill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2b2b2b",
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#121212",
  },
  leaguePillText: {
    color: "white",
    fontSize: 13,
    fontWeight: "700",
    flex: 1,
    marginRight: 8,
  },
  leaguePillChevron: { color: "#bdbdbd", fontSize: 14, fontWeight: "900" },

  tableWrap: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#202020",
    overflow: "hidden",
    backgroundColor: "#101010",
  },
  tableHeader: {
    flexDirection: "row",
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#202020",
    backgroundColor: "#141414",
  },
  th: { color: "#bdbdbd", fontSize: 10, fontWeight: "700" },

  tr: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  trEven: { backgroundColor: "#101010" },
  trOdd: { backgroundColor: "#0e0e0e" },
  td: { color: "white", fontSize: 12, fontWeight: "600" },

  colRank: { width: 26, textAlign: "right", paddingRight: 6 },
  colTeam: { flex: 1, minWidth: 160, paddingRight: 6 },
  colNum: { width: 26, textAlign: "right" },
  colPts: { width: 34, textAlign: "right" },

  empty: { padding: 18, gap: 6 },
  emptyTitle: { color: "white", fontWeight: "900" },
  emptyBody: { color: "#bdbdbd", lineHeight: 18 },

  modalBackdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  modalCard: {
    marginTop: "auto",
    backgroundColor: "#0f0f0f",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderColor: "#202020",
    padding: 14,
    maxHeight: "80%",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  modalTitle: { color: "white", fontWeight: "900", fontSize: 16 },
  modalClose: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#2b2b2b",
  },
  modalCloseText: { color: "#d7d7d7", fontWeight: "800" },

  searchInput: {
    borderWidth: 1,
    borderColor: "#2b2b2b",
    backgroundColor: "#121212",
    color: "white",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    marginBottom: 10,
  },

  leagueRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#1d1d1d",
  },
  leagueRowActive: { backgroundColor: "#141414" },
  leagueRowText: {
    color: "#d7d7d7",
    fontWeight: "800",
    flex: 1,
    paddingRight: 10,
  },
  leagueRowTextActive: { color: "white" },
  leagueRowCheck: { color: "white", fontWeight: "900" },

  emptyPicker: { padding: 18, gap: 6 },
});
