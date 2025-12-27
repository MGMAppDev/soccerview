#!/usr/bin/env node
/**
 * SoccerView — GotSport ingestion (robust HTML parsing)
 *
 * Changes vs prior version:
 * - Robust date parsing (skip invalid dates/times, log warnings)
 * - Dedup subHrefs with Set (removes page duplicates before fetch/limit)
 * - Added MAX_SUB_LINKS (default 10; --max_subs= CLI) to limit sub-fetches per source
 * - Always use HTML mode (no public exports found; removed branch)
 * - Dynamic column detection (handles varying table headers)
 * - Sub-schedule extraction (if no table, fetch linked /schedules? pages recursively, depth-limited)
 * - Simplified fetch (no cookies for public pages; fixes node-fetch v2/v3 compat)
 * - Login detection (skip if page requires sign-in)
 * - Added mode log for debug
 * - Fix Windows libuv assertion: NO process.exit(), only process.exitCode
 * - Use SUPABASE_SERVICE_ROLE_KEY when available (RLS-safe ingestion)
 *
 * Usage:
 *   node scripts/ingest_gotsport.js
 *   node scripts/ingest_gotsport.js --limit=1
 *   node scripts/ingest_gotsport.js --source_id=<uuid>
 *   node scripts/ingest_gotsport.js --dry_run=1
 *   node scripts/ingest_gotsport.js --max_subs=5  # e.g., limit subs per source
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cheerio = require("cheerio");
const { createClient } = require("@supabase/supabase-js");

// node-fetch@3 is ESM-only; wrapper works in CommonJS
const fetch = (...args) =>
  import("node-fetch").then(({ default: f }) => f(...args));

/** -----------------------------
 * Tiny .env loader (no dotenv dep)
 * ------------------------------ */
function loadDotEnvIfNeeded() {
  const needUrl =
    !process.env.EXPO_PUBLIC_SUPABASE_URL && !process.env.SUPABASE_URL;
  const needAnon =
    !process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY &&
    !process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const needService =
    !process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_SERVICE_KEY;

  if (!needUrl && !needAnon && !needService) return;

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

/** -----------------------------
 * CLI args
 * ------------------------------ */
function getArg(name) {
  const pref = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : null;
}

const LIMIT = (() => {
  const v = getArg("limit");
  const n = v ? Number(v) : null;
  return Number.isFinite(n) && n > 0 ? n : null;
})();

const SOURCE_ID = getArg("source_id");
const DRY_RUN = getArg("dry_run") === "1";
const MAX_SUB_LINKS = (() => {
  const v = getArg("max_subs");
  const n = v ? Number(v) : 10;
  return Number.isFinite(n) && n > 0 ? n : 10;
})();

/** -----------------------------
 * Supabase client (Node)
 * ------------------------------ */
loadDotEnvIfNeeded();

const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  null;

if (!SUPABASE_URL) {
  console.error(
    "Missing env var: EXPO_PUBLIC_SUPABASE_URL (or SUPABASE_URL). Check your .env in project root.",
  );
  process.exitCode = 1;
  // don't throw here—let main() render a clean summary
}

const usingServiceKey = Boolean(SUPABASE_SERVICE_ROLE_KEY);
const supabaseKeyToUse = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;

if (!supabaseKeyToUse) {
  console.error(
    "Missing env var: SUPABASE_SERVICE_ROLE_KEY (preferred) or EXPO_PUBLIC_SUPABASE_ANON_KEY.\n" +
      "Set them in .env (project root).",
  );
  process.exitCode = 1;
}

const supabase =
  SUPABASE_URL && supabaseKeyToUse
    ? createClient(SUPABASE_URL, supabaseKeyToUse, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

/** -----------------------------
 * Helpers
 * ------------------------------ */
function sha1(s) {
  return crypto.createHash("sha1").update(String(s)).digest("hex");
}

function normalizeWhitespace(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .trim();
}

function toIntOrNull(s) {
  const n = Number(String(s).trim());
  return Number.isFinite(n) ? n : null;
}

function parseScore(text) {
  const t = normalizeWhitespace(text).toLowerCase();
  const m = t.match(/(\d{1,2})\s*[-:–]\s*(\d{1,2})/);
  if (!m) return { home: null, away: null };
  return { home: Number(m[1]), away: Number(m[2]) };
}

const MONTH_MAP = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function parseGotSportDate(text, groupDate = null) {
  let t = normalizeWhitespace(text).toLowerCase();
  if (!t) return groupDate ? parseGotSportDate(groupDate) : null;

  const parts = t.split(/[\s,]+/);
  let month = null,
    day = null,
    year = null,
    time = null;

  for (const p of parts) {
    if (MONTH_MAP[p]) {
      month = MONTH_MAP[p];
    } else if (/^\d{1,2}$/.test(p)) {
      if (!day) day = Number(p);
      else year = Number(p);
    } else if (/^\d{4}$/.test(p)) {
      year = Number(p);
    } else if (/^\d{1,2}:\d{2}(am|pm)?$/i.test(p)) {
      time = p;
    }
  }

  if (!month && groupDate) {
    const gd = parseGotSportDate(groupDate);
    if (gd) month = gd.getMonth() + 1;
  }

  if (!year) year = new Date().getFullYear();

  if (
    !month ||
    !day ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(year)
  ) {
    console.warn(`Skipping invalid date: ${text}`);
    return null;
  }

  const dt = new Date(year, month - 1, day);
  if (time) {
    let [h, m] = time.split(":").map(Number);
    if (time.toLowerCase().includes("pm") && h < 12) h += 12;
    dt.setHours(h, m);
  }

  try {
    return dt.toISOString().split("T")[0]; // YYYY-MM-DD
  } catch (e) {
    console.warn(`Invalid date value: ${text}`);
    return null;
  }
}

/** -----------------------------
 * Absolutize relative href
 * ------------------------------ */
function absolutizeUrl(base, href) {
  return new URL(href, base).href;
}

/** -----------------------------
 * HTML to rows (using cheerio, dynamic headers, sub-fetch)
 * ------------------------------ */
async function htmlToMatchRows(html, baseUrl, depth = 0) {
  if (depth > 1) return []; // Prevent deep recursion for MVP

  const $ = cheerio.load(html);

  // Check for login required
  if ($("form#login").length || html.toLowerCase().includes("sign in")) {
    console.log("Login required; skipping.");
    return [];
  }

  const tables = $("table");
  let scheduleTable = null;
  let headers = [];

  // Find schedule table by headers
  const requiredHeaders = [
    "time",
    "home team",
    "away team",
    "location",
    "results",
  ]; // or 'score'

  for (let i = 0; i < tables.length; i++) {
    const firstTr = $(tables[i]).find("tr").first();
    headers = firstTr
      .find("th")
      .map((j, el) => normalizeWhitespace($(el).text()).toLowerCase())
      .get();
    if (
      requiredHeaders.every((h) => headers.some((header) => header.includes(h)))
    ) {
      scheduleTable = $(tables[i]);
      break;
    }
  }

  const rows = [];
  let currentDate = null;

  if (scheduleTable) {
    const headerMap = {};
    headers.forEach((h, i) => {
      if (h.includes("time")) headerMap.time = i;
      if (h.includes("home team")) headerMap.home = i;
      if (h.includes("away team")) headerMap.away = i;
      if (h.includes("location")) headerMap.location = i;
      if (h.includes("results") || h.includes("score")) headerMap.score = i;
    });

    scheduleTable
      .find("tr")
      .slice(1)
      .each((i, el) => {
        const row = $(el);
        const tds = row.find("td");

        if (tds.length < 6) return;

        if (row.hasClass("header") || tds.eq(0).attr("colspan")) {
          currentDate = normalizeWhitespace(tds.eq(0).text());
          return;
        }

        const timeText = normalizeWhitespace(tds.eq(headerMap.time).text());
        const matchDate = parseGotSportDate(timeText, currentDate);
        if (!matchDate) return; // Skip bad dates

        const matchTime =
          timeText.replace(/^[A-Za-z\s,0-9]+(?=\d{1,2}:\d{2})/, "").trim() ||
          null; // Extract time part

        const home = normalizeWhitespace(tds.eq(headerMap.home).text());
        const away = normalizeWhitespace(tds.eq(headerMap.away).text());
        const location = normalizeWhitespace(tds.eq(headerMap.location).text());
        const scoreText = normalizeWhitespace(tds.eq(headerMap.score).text());

        const score = parseScore(scoreText);

        const keyGood = [
          matchDate,
          matchTime,
          home,
          away,
          location,
          scoreText,
        ].join("|");
        const sourceMatchKey = sha1(keyGood);

        rows.push({
          match_date: matchDate,
          match_time: matchTime,
          home_team_name: home,
          away_team_name: away,
          location: location || null,
          home_score: score.home,
          away_score: score.away,
          score_text: scoreText,
          source_match_key: sourceMatchKey,
          source_url: baseUrl,
        });
      });

    return rows;
  } else {
    // No table; look for sub-schedule links
    let subHrefs = [
      ...new Set(
        $('a[href*="/schedules?"]')
          .map((i, el) => $(el).attr("href"))
          .get()
          .filter((href) => href.includes("group=") || href.includes("age=")),
      ),
    ].slice(0, MAX_SUB_LINKS);
    console.log(
      `Found ${subHrefs.length} unique sub-links (limited to ${MAX_SUB_LINKS})`,
    );
    const subRows = [];

    for (const href of subHrefs) {
      const subUrl = absolutizeUrl(baseUrl, href);
      console.log(`Fetching sub-schedule: ${subUrl}`);
      const res = await fetch(subUrl, {
        method: "GET",
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SoccerViewBot/1.0",
          accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9",
        },
      });

      if (!res.ok) {
        console.warn(`Sub-fetch failed: ${res.status}`);
        continue;
      }

      const subHtml = await res.text();
      const parsedSub = await htmlToMatchRows(subHtml, subUrl, depth + 1);
      subRows.push(...parsedSub);
    }

    return subRows;
  }
}

/** -----------------------------
 * Upsert team
 * ------------------------------ */
async function upsertTeam(name) {
  if (DRY_RUN) return { id: "dry_run_team_id" };

  const { data, error } = await supabase
    .from("teams")
    .upsert({ name: normalizeWhitespace(name) }, { onConflict: "name" })
    .select("id")
    .single();

  if (error) throw error;
  return data;
}

/** -----------------------------
 * Upsert match row
 * ------------------------------ */
async function upsertMatchRow(row) {
  if (DRY_RUN) return { skipped: false };

  const homeTeam = await upsertTeam(row.home_team_name);
  const awayTeam = await upsertTeam(row.away_team_name);

  const match = {
    source_id: row.source_id,
    source_match_key: row.source_match_key,
    source_url: row.source_url,
    match_date: row.match_date,
    match_time: row.match_time,
    home_team_id: homeTeam.id,
    away_team_id: awayTeam.id,
    home_score: row.home_score,
    away_score: row.away_score,
    score_text: row.score_text,
    location: row.location,
  };

  const { data, error } = await supabase
    .from("matches")
    .upsert(match, { onConflict: "source_match_key" })
    .select("id");

  if (error) throw error;
  return { skipped: !data || data.length === 0 };
}

/** -----------------------------
 * Load active sources
 * ------------------------------ */
async function loadSources() {
  const q = supabase
    .from("sources")
    .select("*")
    .eq("platform", "gotsport")
    .eq("active", true)
    .order("created_at", { ascending: false });

  if (SOURCE_ID) q.eq("id", SOURCE_ID);
  if (LIMIT) q.limit(LIMIT);

  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

/** -----------------------------
 * Ingest one source
 * ------------------------------ */
async function ingestOneSource(src) {
  const scheduleUrl = src.example_url;
  if (!scheduleUrl) return { ok: false, reason: "missing_example_url" };

  console.log(
    `\n=== Source ${src.id} (mode: ${src.allowed_mode || "default"}) ===`,
  );
  console.log(`Fetching: ${scheduleUrl}`);

  const res = await fetch(scheduleUrl, {
    method: "GET",
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SoccerViewBot/1.0",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
    },
  });

  if (!res.ok) {
    return { ok: false, reason: `fetch_failed_${res.status}` };
  }

  const html = await res.text();
  const parsed = await htmlToMatchRows(html, scheduleUrl);
  console.log(`Parsed rows: ${parsed.length}`);

  let inserted = 0;
  let skipped = 0;

  for (const r of parsed) {
    const rowData = { ...r, source_id: src.id };
    try {
      const result = await upsertMatchRow(rowData);
      if (result.skipped) {
        skipped += 1;
        continue;
      }
      inserted += 1;
    } catch (e) {
      skipped += 1;
      console.warn("Row failed (skipping):", {
        date: r.match_date,
        home: r.home_team_name,
        away: r.away_team_name,
        key: r.source_match_key,
      });
      console.warn(String(e?.message || e));
    }
  }

  return { ok: true, parsed: parsed.length, inserted, skipped };
}

/** -----------------------------
 * Main
 * ------------------------------ */
async function main() {
  console.log("SoccerView — GotSport ingestion");
  console.log(`dry_run=${DRY_RUN ? "1" : "0"}`);
  console.log(`max_subs=${MAX_SUB_LINKS}`);
  if (!usingServiceKey) {
    console.log(
      "WARNING: SUPABASE_SERVICE_ROLE_KEY not found. Using anon key; ingestion may fail due to RLS.",
    );
  } else {
    console.log("Using SUPABASE_SERVICE_ROLE_KEY ✅");
  }

  if (!supabase) {
    console.log("\nCannot proceed (missing Supabase env).");
    process.exitCode = 1;
    return;
  }

  if (SOURCE_ID) console.log(`source_id=${SOURCE_ID}`);
  if (LIMIT) console.log(`limit=${LIMIT}`);

  const sources = await loadSources();

  if (!sources.length) {
    console.log("No active GotSport sources found. Nothing to ingest.");
    return;
  }

  console.log(`Active GotSport sources: ${sources.length}`);

  const results = [];
  for (const s of sources) {
    const r = await ingestOneSource(s);
    results.push({ source_id: s.id, ...r });
  }

  console.log("\n=== Summary ===");
  for (const r of results) {
    console.log(
      `${r.source_id}: ok=${r.ok} parsed=${r.parsed || 0} inserted=${r.inserted || 0} skipped=${
        r.skipped || 0
      } ${r.reason ? `reason=${r.reason}` : ""}`,
    );
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Fatal:", err?.message || err);
  process.exitCode = 1;
});
