#!/usr/bin/env node
/**
 * SoccerView — compute_rankings_daily (MVP)
 *
 * National rankings for current_date based on FINAL matches.
 * rating = (3*wins + 1*draws) + goal_diff*0.01
 *
 * Writes to public.team_ranks_daily:
 * - scope = 'national'
 * - state = null
 * - rank_date = current_date
 *
 * Strategy: delete today's national rows then insert fresh (idempotent).
 */

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

/** ---------- .env loader (no dotenv dep) ---------- */
function loadDotEnvIfNeeded() {
  const needUrl =
    !process.env.SUPABASE_URL && !process.env.EXPO_PUBLIC_SUPABASE_URL;
  const needService =
    !process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_SERVICE_KEY;

  if (!needUrl && !needService) return;

  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;

  const txt = fs.readFileSync(envPath, "utf8");
  for (const line of txt.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

loadDotEnvIfNeeded();

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE;

if (!SUPABASE_URL) {
  console.error("Missing SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL) in .env");
  process.exitCode = 1;
  return;
}
if (!SERVICE_KEY) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY (recommended) in .env");
  process.exitCode = 1;
  return;
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function safeNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function isoDateToday() {
  // Use local date (matches your current_date queries in Supabase UI)
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function fetchAllMatchesFinal() {
  const pageSize = 1000;
  let from = 0;
  let all = [];

  while (true) {
    const to = from + pageSize - 1;

    const { data, error } = await supabase
      .from("matches")
      .select(
        "id, match_date, status, home_team_id, away_team_id, home_score, away_score",
      )
      .not("match_date", "is", null)
      .not("home_team_id", "is", null)
      .not("away_team_id", "is", null)
      .range(from, to);

    if (error) throw error;

    if (!data || data.length === 0) break;

    all = all.concat(data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  // FINAL filter: prefer status='final', but also accept rows with both scores present
  const finals = all.filter((m) => {
    const hs = safeNum(m.home_score);
    const as = safeNum(m.away_score);
    const hasScores = hs !== null && as !== null;
    const isFinal = String(m.status || "").toLowerCase() === "final";
    return isFinal || hasScores;
  });

  return finals;
}

function computeTeamStats(matches) {
  // Map team_id -> stats
  const stats = new Map();

  function get(tid) {
    if (!stats.has(tid)) {
      stats.set(tid, {
        team_id: tid,
        games: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        gf: 0,
        ga: 0,
        gd: 0,
      });
    }
    return stats.get(tid);
  }

  for (const m of matches) {
    const homeId = m.home_team_id;
    const awayId = m.away_team_id;
    const hs = safeNum(m.home_score);
    const as = safeNum(m.away_score);

    if (!homeId || !awayId) continue;
    if (hs === null || as === null) continue;

    const home = get(homeId);
    const away = get(awayId);

    home.games += 1;
    away.games += 1;

    home.gf += hs;
    home.ga += as;
    away.gf += as;
    away.ga += hs;

    if (hs > as) {
      home.wins += 1;
      away.losses += 1;
    } else if (hs < as) {
      away.wins += 1;
      home.losses += 1;
    } else {
      home.draws += 1;
      away.draws += 1;
    }
  }

  for (const s of stats.values()) {
    s.gd = s.gf - s.ga;
  }

  return [...stats.values()].filter((s) => s.games > 0);
}

function scoreTeam(s) {
  // MVP rating: points + tiny goal-diff boost
  const points = s.wins * 3 + s.draws * 1;
  const rating = points + s.gd * 0.01;
  return rating;
}

function rankTeams(statsArr) {
  const rows = statsArr
    .map((s) => {
      const rating = scoreTeam(s);
      return { ...s, rating };
    })
    .sort((a, b) => {
      // Primary: rating desc
      if (b.rating !== a.rating) return b.rating - a.rating;
      // Tie-breakers:
      if (b.games !== a.games) return b.games - a.games;
      if (b.gd !== a.gd) return b.gd - a.gd;
      if (b.gf !== a.gf) return b.gf - a.gf;
      // stable-ish fallback
      return String(a.team_id).localeCompare(String(b.team_id));
    });

  return rows.map((r, idx) => ({
    team_id: r.team_id,
    rank: idx + 1,
    rating: r.rating,
    games: r.games,
    wins: r.wins,
    draws: r.draws,
    losses: r.losses,
    gf: r.gf,
    ga: r.ga,
    gd: r.gd,
  }));
}

async function deleteTodayNational(rankDate) {
  const { error } = await supabase
    .from("team_ranks_daily")
    .delete()
    .eq("rank_date", rankDate)
    .eq("scope", "national");

  if (error) throw error;
}

async function insertRanks(rankDate, rankedRows) {
  const payload = rankedRows.map((r) => ({
    team_id: r.team_id,
    rank_date: rankDate,
    scope: "national",
    state: null,
    rank: r.rank,
    rating: r.rating,
  }));

  // Insert in chunks (safe)
  const chunkSize = 500;
  for (let i = 0; i < payload.length; i += chunkSize) {
    const chunk = payload.slice(i, i + chunkSize);
    const { error } = await supabase.from("team_ranks_daily").insert(chunk);
    if (error) throw error;
  }
}

async function main() {
  const rankDate = isoDateToday();

  console.log("SoccerView — compute_rankings_daily (MVP)");
  console.log("rank_date =", rankDate);
  console.log("scope = national");

  const matches = await fetchAllMatchesFinal();
  console.log("final_matches =", matches.length);

  const stats = computeTeamStats(matches);
  console.log("teams_with_games =", stats.length);

  if (stats.length === 0) {
    console.log("No team stats computed; nothing to rank.");
    return;
  }

  const ranked = rankTeams(stats);

  console.log("Deleting existing national rows for today...");
  await deleteTodayNational(rankDate);

  console.log("Inserting ranks...");
  await insertRanks(rankDate, ranked);

  console.log("Done. Inserted rows =", ranked.length);
}

main().catch((e) => {
  console.error("Fatal:", e?.message || e);
  process.exitCode = 1;
});
