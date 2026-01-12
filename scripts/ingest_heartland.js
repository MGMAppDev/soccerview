/**
 * SoccerView — GotSport ingestion (Supabase JS)
 * Run: node scripts/ingest_heartland.js
 */

import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";
import "dotenv/config";

// ---------------------------
// Config
// ---------------------------

const URLS = [
  // Labor Day 2025 (Heartland)
  "https://system.gotsport.com/org_event/events/43745/schedules?group=380883",
  "https://system.gotsport.com/org_event/events/43745/schedules?group=380882",
  "https://system.gotsport.com/org_event/events/43745/schedules?group=422391",
  "https://system.gotsport.com/org_event/events/43745/schedules?group=380881",
  "https://system.gotsport.com/org_event/events/43745/schedules?group=380879",
  "https://system.gotsport.com/org_event/events/43745/schedules?group=419781",
  "https://system.gotsport.com/org_event/events/43745/schedules?group=380886",
  "https://system.gotsport.com/org_event/events/43745/schedules?group=380887",
  "https://system.gotsport.com/org_event/events/43745/schedules?group=421646",
  "https://system.gotsport.com/org_event/events/43745/schedules?group=380885",
  "https://system.gotsport.com/org_event/events/43745/schedules?group=419782",
  "https://system.gotsport.com/org_event/events/43745/schedules?group=380884",
  "https://system.gotsport.com/org_event/events/43745/schedules?group=419783",
  // President's Day 2025
  "https://system.gotsport.com/org_event/events/33224/schedules?group=273676",
  "https://system.gotsport.com/org_event/events/33224/schedules?group=273678",
  "https://system.gotsport.com/org_event/events/33224/schedules?group=273680",
  "https://system.gotsport.com/org_event/events/33224/schedules?group=273682",
  "https://system.gotsport.com/org_event/events/33224/schedules?group=273684",
];

const DELAY_MS = 2000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing env vars: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required",
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ---------------------------
// Helpers
// ---------------------------

async function getSourceId(url) {
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

function parseDateHeader(text) {
  if (!text) return null;
  text = text
    .replace(
      /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s*/i,
      "",
    )
    .trim();

  const monthMap = {
    jan: 0,
    january: 0,
    feb: 1,
    february: 1,
    mar: 2,
    march: 2,
    apr: 3,
    april: 3,
    may: 4,
    jun: 5,
    june: 5,
    jul: 6,
    july: 6,
    aug: 7,
    august: 7,
    sep: 8,
    sept: 8,
    september: 8,
    oct: 9,
    october: 9,
    nov: 10,
    november: 10,
    dec: 11,
    december: 11,
  };

  const match = text.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (match) {
    const monthStr = match[1].toLowerCase();
    const day = parseInt(match[2], 10);
    const year = parseInt(match[3], 10);
    const month = monthMap[monthStr];
    if (month !== undefined && day && year) {
      return { year, month, day };
    }
  }
  return null;
}

function parseTime(text) {
  if (!text) return null;
  text = text
    .trim()
    .toUpperCase()
    .replace(/\s*(CDT|CST|EDT|EST|PDT|PST|UTC|GMT)\s*/gi, "")
    .trim();

  const match12 = text.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (match12) {
    let hours = parseInt(match12[1], 10);
    const minutes = parseInt(match12[2], 10);
    const ampm = match12[3]?.toUpperCase();

    if (ampm === "PM" && hours < 12) hours += 12;
    if (ampm === "AM" && hours === 12) hours = 0;

    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return { hours, minutes };
    }
  }
  return null;
}

function combineDateAndTime(dateObj, timeObj) {
  if (!dateObj || !timeObj) return null;
  const d = new Date(
    dateObj.year,
    dateObj.month,
    dateObj.day,
    timeObj.hours,
    timeObj.minutes,
    0,
  );
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function parseFullDateTime(text) {
  if (!text) return null;
  text = text.replace(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s*/i, "").trim();
  text = text.replace(/\s+(EDT|EST|CDT|CST|PDT|PST|UTC|GMT)$/i, "").trim();

  const match = text.match(
    /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i,
  );
  if (match) {
    const monthMap = {
      jan: 0,
      feb: 1,
      mar: 2,
      apr: 3,
      may: 4,
      jun: 5,
      jul: 6,
      aug: 7,
      sep: 8,
      oct: 9,
      nov: 10,
      dec: 11,
    };
    const monthStr = match[1].toLowerCase().substring(0, 3);
    const day = parseInt(match[2], 10);
    const year = parseInt(match[3], 10);
    let hours = parseInt(match[4], 10);
    const minutes = parseInt(match[5], 10);
    const ampm = match[6]?.toUpperCase();

    const month = monthMap[monthStr];
    if (month === undefined) return null;

    if (ampm === "PM" && hours < 12) hours += 12;
    if (ampm === "AM" && hours === 12) hours = 0;

    const d = new Date(year, month, day, hours, minutes, 0);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  }
  return null;
}

function parseScores(scoreStr) {
  if (!scoreStr) return { home: null, away: null };
  const scoreMatch = scoreStr.match(/(\d+)\s*-\s*(\d+)/);
  return scoreMatch
    ? { home: parseInt(scoreMatch[1], 10), away: parseInt(scoreMatch[2], 10) }
    : { home: null, away: null };
}

function inferGenderAndAge(groupName) {
  if (!groupName) return { gender: null, age_group: null };
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

async function upsertMatch(sourceId, m) {
  if (!m.match_date) return { ok: false, reason: "missing_match_date" };

  const { error } = await supabase.from("matches").upsert(
    {
      match_id: m.match_id,
      match_date: m.match_date,
      home_team: m.home_team,
      away_team: m.away_team,
      home_score: m.home_score,
      away_score: m.away_score,
      location: m.location,
      competition: m.competition,
      group_name: m.group_name,
      gender: m.gender,
      age_group: m.age_group,
      source_id: sourceId,
    },
    { onConflict: "match_id" },
  );

  if (error) return { ok: false, error };
  return { ok: true };
}

async function parsePage(url) {
  const response = await fetch(url);
  const html = await response.text();
  const $ = cheerio.load(html);

  const matches = [];
  const competition = $("title").text().trim() || "Unknown Competition";
  let currentDate = null;

  $("tr").each((i, tr) => {
    const $tr = $(tr);
    const cells = $tr
      .find("td")
      .map((j, td) => $(td).text().trim())
      .get();
    const cellCount = cells.length;

    // Check for date header
    if (cellCount === 1 || (cellCount <= 2 && !cells[0]?.includes("-"))) {
      const parsed = parseDateHeader(cells.join(" "));
      if (parsed) {
        currentDate = parsed;
        return;
      }
    }

    const thText = $tr.find("th").text().trim();
    if (thText) {
      const parsed = parseDateHeader(thText);
      if (parsed) {
        currentDate = parsed;
        return;
      }
    }

    if (cellCount < 5) return;

    const resultsLink =
      $tr.find("td").eq(3).find("a").attr("href") ||
      $tr.find("a[href*='match=']").attr("href");
    const matchIdMatch = resultsLink?.match(/match=(\d+)/);
    const matchId = matchIdMatch?.[1];
    if (!matchId) return;

    const timeCell = cells[1] || "";
    const homeTeam = cells[2] || "";
    const scoreCell = cells[3] || "";
    const awayTeam = cells[4] || "";
    const location = cells[5] || "";
    const division = cells[6] || cells[cellCount - 1] || "";

    let matchDate = null;
    if (currentDate) {
      const timeObj = parseTime(timeCell);
      if (timeObj) {
        matchDate = combineDateAndTime(currentDate, timeObj);
      }
    }
    if (!matchDate) matchDate = parseFullDateTime(timeCell);
    if (!matchDate) {
      for (const cell of cells) {
        matchDate = parseFullDateTime(cell);
        if (matchDate) break;
      }
    }

    const { home: homeScore, away: awayScore } = parseScores(scoreCell);
    const { gender, age_group } = inferGenderAndAge(division);

    matches.push({
      match_id: matchId,
      competition,
      group_name: division,
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
  console.log("=== SoccerView GotSport Ingestion ===");
  console.log(`Processing ${URLS.length} group URLs...\n`);

  let ok = 0;
  let skipped = 0;
  let errors = 0;

  for (const url of URLS) {
    try {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));

      console.log(`[FETCHING] ${url}`);
      const sourceId = await getSourceId(url);

      const matches = await parsePage(url);
      const uniqueMatches = Array.from(
        new Map(matches.map((m) => [m.match_id, m])).values(),
      );
      console.log(`[PARSED] ${uniqueMatches.length} unique matches`);

      if (uniqueMatches.length > 0) {
        const first = uniqueMatches[0];
        console.log(
          `  [SAMPLE] ID:${first.match_id}, Date:${first.match_date || "NULL"}, ${first.home_team} vs ${first.away_team}`,
        );
      }

      for (const m of uniqueMatches) {
        const r = await upsertMatch(sourceId, m);
        if (r.ok) {
          ok++;
        } else if (r.reason === "missing_match_date") {
          skipped++;
        } else {
          errors++;
          console.error(
            `  [UPSERT ERROR] Match ${m.match_id}:`,
            r.error?.message || r.error,
          );
        }
      }
    } catch (e) {
      errors++;
      console.error(`[URL ERROR] ${url}:`, e.message);
    }
  }

  console.log("\n=== Summary ===");
  console.log(`upsert ok: ${ok}`);
  console.log(`skipped (missing date): ${skipped}`);
  console.log(`errors: ${errors}`);
}

main().catch((e) => {
  console.error("SCRIPT FAILED:", e);
  process.exit(1);
});
