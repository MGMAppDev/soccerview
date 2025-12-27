/**
 * SoccerView — GotSport ingestion (automated adapter)
 *
 * Full-file replacement for: scripts/ingest_heartland.js
 *
 * Automated, scalable for US youth soccer (team/group pages with match links/results)
 * Polite scraping (2s delay)
 * Extracts match_id from results column link (eq(3))
 * Infers gender/age from group/division
 *
 * Run:
 *   node scripts/ingest_heartland.js
 */

import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";
import "dotenv/config";

// ---------------------------
// Config
// ---------------------------

// Completed public GotSport group URLs with match links/results (public/legal; add more completed events)
const URLS = [
  "https://system.gotsport.com/org_event/events/43745/schedules?group=380883", // U13 Boys Gold (Labor Day 2025—completed)
  "https://system.gotsport.com/org_event/events/43745/schedules?group=380882", // U13 Boys Silver
  "https://system.gotsport.com/org_event/events/43745/schedules?group=422391", // U13 Boys Silver II
  "https://system.gotsport.com/org_event/events/43745/schedules?group=380881", // U13 Boys Bronze
  "https://system.gotsport.com/org_event/events/43745/schedules?group=380879", // U13 Girls Gold
  "https://system.gotsport.com/org_event/events/43745/schedules?group=419781", // U13 Girls Silver
  "https://system.gotsport.com/org_event/events/43745/schedules?group=380886", // U14 Boys Gold
  "https://system.gotsport.com/org_event/events/43745/schedules?group=380887", // U14 Boys Silver
  "https://system.gotsport.com/org_event/events/43745/schedules?group=421646", // U14 Boys Silver II
  "https://system.gotsport.com/org_event/events/43745/schedules?group=380885", // U14 Boys Bronze
  "https://system.gotsport.com/org_event/events/43745/schedules?group=419782", // U14 Girls Gold
  "https://system.gotsport.com/org_event/events/43745/schedules?group=380884", // U14 Girls Silver
  "https://system.gotsport.com/org_event/events/43745/schedules?group=419783", // U14 Girls Bronze
  // New added for expansion (from President's Day Soccer 2025—completed Feb 2025)
  "https://system.gotsport.com/org_event/events/33224/schedules?group=273676",
  "https://system.gotsport.com/org_event/events/33224/schedules?group=273678",
  "https://system.gotsport.com/org_event/events/33224/schedules?group=273680",
  "https://system.gotsport.com/org_event/events/33224/schedules?group=273682",
  "https://system.gotsport.com/org_event/events/33224/schedules?group=273684",
  // Add more completed group URLs (search GotSport completed events U13-U19 boys/girls, copy ?group=ID with scores)
];

const DELAY_MS = 2000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing env vars.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ---------------------------
// Helpers
// ---------------------------

async function getSourcesRow({ url }) {
  const { data, error } = await supabase
    .from("sources")
    .select("id")
    .eq("url", url)
    .maybeSingle();

  if (error) throw error;

  if (data) return data.id;

  const { data: insertData, error: insertError } = await supabase
    .from("sources")
    .insert({ url, provider: "gotsport" })
    .select("id")
    .single();

  if (insertError) throw insertError;

  return insertData.id;
}

function parseDate(timeStr) {
  if (!timeStr) return null;

  // Example: "Aug 30, 2025 9:30 AM EDT" or "Sat, Aug 30, 2025 9:30 AM EDT"
  timeStr = timeStr.replace(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s*/i, ""); // Strip day name
  timeStr = timeStr.replace(/\s(EDT|EST|CDT|CST|PDT|PST|UTC|GMT)$/i, ""); // Strip timezone

  const parts = timeStr.split(" ");
  if (parts.length < 5) return null;

  const month = parts[0];
  const day = parseInt(parts[1].replace(",", ""), 10);
  const year = parseInt(parts[2], 10);
  const time = parts[3];
  const ampm = parts[4];

  const monthMap = {
    Jan: 0,
    Feb: 1,
    Mar: 2,
    Apr: 3,
    May: 4,
    Jun: 5,
    Jul: 6,
    Aug: 7,
    Sep: 8,
    Oct: 9,
    Nov: 10,
    Dec: 11,
    January: 0,
    February: 1,
    March: 2,
    April: 3,
    May: 4,
    June: 5,
    July: 6,
    August: 7,
    September: 8,
    October: 9,
    November: 10,
    December: 11,
  };

  const m = monthMap[month];
  if (m === undefined) return null;

  const [hoursStr, minutesStr] = time.split(":");
  let hours = parseInt(hoursStr, 10);
  const minutes = parseInt(minutesStr, 10);

  if (ampm.toUpperCase() === "PM" && hours < 12) hours += 12;
  if (ampm.toUpperCase() === "AM" && hours === 12) hours = 0;

  const d = new Date(year, m, day, hours, minutes, 0);
  if (isNaN(d.getTime())) return null;

  return d.toISOString();
}

function parseScores(scoreStr) {
  const scoreMatch = scoreStr.match(/(\d+)\s*-\s*(\d+)/);
  return scoreMatch
    ? { home: parseInt(scoreMatch[1], 10), away: parseInt(scoreMatch[2], 10) }
    : { home: null, away: null };
}

function inferGenderAndAge(groupName) {
  const lower = groupName.toLowerCase();
  const gender = lower.includes("boys")
    ? "Boys"
    : lower.includes("girls")
      ? "Girls"
      : null;
  const ageMatch = lower.match(/u(\d+)/);
  const age_group = ageMatch ? `U${ageMatch[1]}` : null;
  return { gender, age_group };
}

async function upsertMatch({ sourceId, m }) {
  if (!m.match_date) return { ok: false, reason: "missing_match_date" };

  const { data, error } = await supabase
    .from("matches")
    .upsert(
      {
        source_id: sourceId,
        match_id: m.match_id,
        competition: m.competition,
        group_name: m.group_name,
        match_date: m.match_date,
        home_team: m.home_team,
        away_team: m.away_team,
        home_score: m.home_score,
        away_score: m.away_score,
        location: m.location,
        gender: m.gender,
        age_group: m.age_group,
      },
      { onConflict: "match_id" },
    )
    .select();

  if (error) return { ok: false, error };

  return { ok: true, data };
}

async function parsePage(sourceId, url) {
  const response = await fetch(url);
  const html = await response.text();
  const $ = cheerio.load(html);

  let matches = [];

  $("tr").each((i, tr) => {
    const cells = $(tr)
      .find("td")
      .map((j, td) => $(td).text().trim())
      .get();

    if (cells.length < 7) return; // Skip non-match rows (need Match#, Time, Home, Results, Away, Location, Division)

    const resultsLink = $(tr).find("td").eq(3).find("a").attr("href");
    const matchId = resultsLink ? resultsLink.match(/match=(\d+)/)?.[1] : null;
    if (!matchId) return; // Skip if no results link

    const time = cells[1]; // Full date-time string
    const homeTeam = cells[2];
    const score = cells[3];
    const awayTeam = cells[4];
    const location = cells[5];
    const division = cells[6];

    const { home: homeScore, away: awayScore } = parseScores(score);

    const matchDate = parseDate(time);

    const groupOrDivision = division; // Use division since no group_header
    const { gender, age_group } = inferGenderAndAge(groupOrDivision);

    matches.push({
      match_id: matchId,
      competition: $("title").text().trim(),
      group_name: groupOrDivision,
      match_date: matchDate,
      home_team: homeTeam,
      away_team: awayTeam,
      home_score: homeScore,
      away_score: awayScore,
      location,
      gender,
      age_group,
    });
  });

  return matches;
}

// ---------------------------
// Main
// ---------------------------

async function main() {
  let ok = 0;
  let skipped = 0;
  let errors = 0;

  for (const url of URLS) {
    try {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));

      const sourceId = await getSourcesRow({ url });

      const matches = await parsePage(sourceId, url);

      const uniqueMatches = Array.from(
        new Map(matches.map((m) => [m.match_id, m])).values(),
      );
      console.log(`Parsed matches from ${url}: ${uniqueMatches.length}`);

      for (const m of uniqueMatches) {
        const r = await upsertMatch({ sourceId, m });
        if (r.ok) ok++;
        else if (r.reason === "missing_match_date") skipped++;
        else errors++;
      }
    } catch (e) {
      errors++;
      console.error("URL PROCESS ERROR:", { url, error: e.message });
    }
  }

  console.log("=== Summary ===");
  console.log("upsert ok:", ok);
  console.log("skipped (missing date):", skipped);
  console.log("errors:", errors);
}

main().catch((e) => console.error("SCRIPT FAILED:", e));
