/**
 * SoccerView — GotSport Ingestion (Database-Driven)
 * Pulls scrape targets from Supabase and ingests match data.
 *
 * Run: node scripts/ingest_heartland.js
 *
 * This script:
 * 1. Fetches active scrape targets from scrape_targets table
 * 2. Scrapes each URL for match data
 * 3. Upserts matches to matches table
 * 4. Updates last_scraped_at and match counts
 */

import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";
import "dotenv/config";

// ---------------------------
// Config
// ---------------------------

const DELAY_MS = 2000;
const BATCH_SIZE = 50; // Process in batches to avoid timeouts

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
// Fallback URLs (if no scrape_targets exist yet)
// ---------------------------

const FALLBACK_URLS = [
  // Labor Day 2025 (Heartland) - Jacksonville, FL
  {
    url: "https://system.gotsport.com/org_event/events/43745/schedules?group=380883",
    state: "FL",
  },
  {
    url: "https://system.gotsport.com/org_event/events/43745/schedules?group=380882",
    state: "FL",
  },
  {
    url: "https://system.gotsport.com/org_event/events/43745/schedules?group=422391",
    state: "FL",
  },
  {
    url: "https://system.gotsport.com/org_event/events/43745/schedules?group=380881",
    state: "FL",
  },
  {
    url: "https://system.gotsport.com/org_event/events/43745/schedules?group=380879",
    state: "FL",
  },
  {
    url: "https://system.gotsport.com/org_event/events/43745/schedules?group=419781",
    state: "FL",
  },
  {
    url: "https://system.gotsport.com/org_event/events/43745/schedules?group=380886",
    state: "FL",
  },
  {
    url: "https://system.gotsport.com/org_event/events/43745/schedules?group=380887",
    state: "FL",
  },
  {
    url: "https://system.gotsport.com/org_event/events/43745/schedules?group=421646",
    state: "FL",
  },
  {
    url: "https://system.gotsport.com/org_event/events/43745/schedules?group=380885",
    state: "FL",
  },
  {
    url: "https://system.gotsport.com/org_event/events/43745/schedules?group=419782",
    state: "FL",
  },
  {
    url: "https://system.gotsport.com/org_event/events/43745/schedules?group=380884",
    state: "FL",
  },
  {
    url: "https://system.gotsport.com/org_event/events/43745/schedules?group=419783",
    state: "FL",
  },
  // President's Day 2025 - FL
  {
    url: "https://system.gotsport.com/org_event/events/33224/schedules?group=273676",
    state: "FL",
  },
  {
    url: "https://system.gotsport.com/org_event/events/33224/schedules?group=273678",
    state: "FL",
  },
  {
    url: "https://system.gotsport.com/org_event/events/33224/schedules?group=273680",
    state: "FL",
  },
  {
    url: "https://system.gotsport.com/org_event/events/33224/schedules?group=273682",
    state: "FL",
  },
  {
    url: "https://system.gotsport.com/org_event/events/33224/schedules?group=273684",
    state: "FL",
  },
];

// ---------------------------
// Helpers
// ---------------------------

async function getScrapeTargets() {
  /**
   * Fetch active scrape targets from database.
   * Falls back to hardcoded URLs if table is empty.
   */
  try {
    const { data, error } = await supabase
      .from("scrape_targets")
      .select("id, url, state, age_group, gender, event_id, group_id")
      .eq("is_active", true)
      .order("last_scraped_at", { ascending: true, nullsFirst: true })
      .limit(500);

    if (error) {
      console.warn("Error fetching scrape_targets:", error.message);
      console.log("Using fallback URLs...");
      return FALLBACK_URLS.map((u) => ({ ...u, id: null }));
    }

    if (!data || data.length === 0) {
      console.log("No scrape targets in database, using fallback URLs...");
      return FALLBACK_URLS.map((u) => ({ ...u, id: null }));
    }

    console.log(`Found ${data.length} active scrape targets in database`);
    return data;
  } catch (e) {
    console.warn("Failed to query scrape_targets:", e.message);
    return FALLBACK_URLS.map((u) => ({ ...u, id: null }));
  }
}

async function updateScrapeTarget(targetId, matchCount) {
  /**
   * Update last_scraped_at and match count for a scrape target.
   */
  if (!targetId) return;

  try {
    await supabase
      .from("scrape_targets")
      .update({
        last_scraped_at: new Date().toISOString(),
        last_match_count: matchCount,
      })
      .eq("id", targetId);
  } catch (e) {
    console.warn(`Failed to update scrape target ${targetId}:`, e.message);
  }
}

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

  // Gender detection
  let gender = null;
  if (
    lower.includes("boys") ||
    lower.includes(" b ") ||
    /\bb\d{2,4}\b/.test(lower)
  ) {
    gender = "Boys";
  } else if (
    lower.includes("girls") ||
    lower.includes(" g ") ||
    /\bg\d{2,4}\b/.test(lower)
  ) {
    gender = "Girls";
  }

  // Age group detection
  let age_group = null;
  const ageMatch = lower.match(/u(\d+)/);
  if (ageMatch) {
    age_group = `U${ageMatch[1]}`;
  } else {
    // Birth year pattern (2010, 2011, etc.)
    const yearMatch = lower.match(/\b(20[01]\d)\b/);
    if (yearMatch) {
      const birthYear = parseInt(yearMatch[1], 10);
      const currentYear = new Date().getFullYear();
      const age = currentYear - birthYear;
      age_group = `U${age}`;
    }
  }

  return { gender, age_group };
}

async function upsertMatch(sourceId, m, targetState) {
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
  console.log("=== SoccerView GotSport Ingestion (Database-Driven) ===");
  console.log(`Started at: ${new Date().toISOString()}\n`);

  // Fetch scrape targets
  const targets = await getScrapeTargets();
  console.log(`Processing ${targets.length} URLs...\n`);

  let ok = 0;
  let skipped = 0;
  let errors = 0;
  const stateCounts = {};

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const { url, state, id: targetId } = target;

    try {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));

      console.log(
        `[${i + 1}/${targets.length}] Fetching: ${url.substring(0, 80)}...`,
      );
      const sourceId = await getSourceId(url);

      const matches = await parsePage(url);
      const uniqueMatches = Array.from(
        new Map(matches.map((m) => [m.match_id, m])).values(),
      );
      console.log(`  Parsed ${uniqueMatches.length} unique matches`);

      let targetOk = 0;
      for (const m of uniqueMatches) {
        const r = await upsertMatch(sourceId, m, state);
        if (r.ok) {
          ok++;
          targetOk++;
          if (state) {
            stateCounts[state] = (stateCounts[state] || 0) + 1;
          }
        } else if (r.reason === "missing_match_date") {
          skipped++;
        } else {
          errors++;
          if (errors <= 5) {
            console.error(
              `  [ERROR] Match ${m.match_id}:`,
              r.error?.message || r.error,
            );
          }
        }
      }

      // Update scrape target with results
      await updateScrapeTarget(targetId, targetOk);
    } catch (e) {
      errors++;
      console.error(`[URL ERROR] ${url}:`, e.message);
    }
  }

  console.log("\n" + "=".repeat(50));
  console.log("SUMMARY");
  console.log("=".repeat(50));
  console.log(`Total upserted: ${ok}`);
  console.log(`Skipped (missing date): ${skipped}`);
  console.log(`Errors: ${errors}`);

  if (Object.keys(stateCounts).length > 0) {
    console.log("\nMatches by state:");
    for (const [st, count] of Object.entries(stateCounts).sort(
      (a, b) => b[1] - a[1],
    )) {
      console.log(`  ${st}: ${count}`);
    }
  }

  console.log(`\nCompleted at: ${new Date().toISOString()}`);
}

main().catch((e) => {
  console.error("SCRIPT FAILED:", e);
  process.exit(1);
});
