/**
 * Parallel Comparison: Old vs New Scraper
 * ========================================
 *
 * Runs both the old syncActiveEvents logic and new coreScraper on the same event
 * and compares the output to validate the migration.
 *
 * Usage: node scripts/_debug/compareScrapers.js [eventId]
 */

import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";
import "dotenv/config";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const BASE_URL = "https://system.gotsport.com";
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
];

// ===========================================
// OLD SCRAPER LOGIC (from syncActiveEvents.js)
// ===========================================

async function oldScrapeEvent(eventId) {
  console.log("\n" + "=".repeat(60));
  console.log("🔴 OLD SCRAPER (syncActiveEvents.js logic)");
  console.log("=".repeat(60));

  const startTime = Date.now();
  const allMatches = [];

  // Step 1: Discover groups
  const eventUrl = `${BASE_URL}/org_event/events/${eventId}`;
  console.log(`   Fetching event page: ${eventUrl}`);

  const eventHtml = await fetchHTML(eventUrl);
  if (!eventHtml) {
    console.log("   ❌ Could not fetch event page");
    return { matches: [], groups: 0, elapsed: 0 };
  }

  const $ = cheerio.load(eventHtml);
  const groups = new Set();
  $('a[href*="schedules?group="]').each((_, el) => {
    const href = $(el).attr("href");
    const match = href?.match(/group=(\d+)/);
    if (match) groups.add(match[1]);
  });

  console.log(`   Found ${groups.size} groups`);

  // Step 2: Scrape each group
  for (const groupId of groups) {
    const matches = await oldScrapeGroup(eventId, groupId);
    allMatches.push(...matches);
    await sleep(800);
  }

  // Step 3: Deduplicate
  const uniqueMatches = Array.from(
    new Map(allMatches.map(m => [`${m.event_id}-${m.match_number}`, m])).values()
  );

  const elapsed = Date.now() - startTime;

  console.log(`   Total matches: ${allMatches.length}`);
  console.log(`   Unique matches: ${uniqueMatches.length}`);
  console.log(`   Runtime: ${Math.round(elapsed / 1000)}s`);

  return { matches: uniqueMatches, groups: groups.size, elapsed };
}

async function oldScrapeGroup(eventId, groupId) {
  const url = `${BASE_URL}/org_event/events/${eventId}/schedules?group=${groupId}`;
  const html = await fetchHTML(url);
  if (!html) return [];

  const $ = cheerio.load(html);
  const matches = [];

  $("table tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length === 7) {
      const matchNum = $(cells[0]).text().trim();
      const dateTime = $(cells[1]).text().trim();
      const homeTeam = $(cells[2]).text().trim();
      const scoreText = $(cells[3]).text().trim();
      const awayTeam = $(cells[4]).text().trim();
      const location = $(cells[5]).text().trim();

      if (!scoreText.includes("-")) return;

      const [homeScore, awayScore] = parseScore(scoreText);
      const matchDate = parseDate(dateTime);

      if (matchDate && matchDate < "2023-01-01") return;

      let status = "scheduled";
      if (homeScore !== null && awayScore !== null && matchDate) {
        if (new Date(matchDate) < new Date()) status = "completed";
      }

      matches.push({
        event_id: eventId.toString(),
        match_number: matchNum,
        match_date: matchDate,
        home_team_name: homeTeam,
        away_team_name: awayTeam,
        home_score: homeScore,
        away_score: awayScore,
        status,
        location,
        match_key: `gotsport-${eventId}-${matchNum}`.toLowerCase(),
      });
    }
  });

  return matches;
}

// ===========================================
// NEW SCRAPER LOGIC (from coreScraper.js)
// ===========================================

async function newScrapeEvent(eventId) {
  console.log("\n" + "=".repeat(60));
  console.log("🟢 NEW SCRAPER (coreScraper.js logic)");
  console.log("=".repeat(60));

  const startTime = Date.now();
  const allMatches = [];

  // Step 1: Discover groups (same logic)
  const eventUrl = `${BASE_URL}/org_event/events/${eventId}`;
  console.log(`   Fetching event page: ${eventUrl}`);

  const eventHtml = await fetchHTML(eventUrl);
  if (!eventHtml) {
    console.log("   ❌ Could not fetch event page");
    return { matches: [], groups: 0, elapsed: 0 };
  }

  const $ = cheerio.load(eventHtml);
  const groups = new Set();
  $('a[href*="schedules?group="]').each((_, el) => {
    const href = $(el).attr("href");
    const match = href?.match(/group=(\d+)/);
    if (match) groups.add(match[1]);
  });

  console.log(`   Found ${groups.size} groups`);

  // Step 2: Scrape each group using NEW logic
  for (const groupId of groups) {
    const matches = await newScrapeGroup(eventId, groupId);
    allMatches.push(...matches);
    await sleep(800);
  }

  // Step 3: Deduplicate using NEW key format
  const uniqueMatches = Array.from(
    new Map(allMatches.map(m => [m.match_key, m])).values()
  );

  const elapsed = Date.now() - startTime;

  console.log(`   Total matches: ${allMatches.length}`);
  console.log(`   Unique matches: ${uniqueMatches.length}`);
  console.log(`   Runtime: ${Math.round(elapsed / 1000)}s`);

  return { matches: uniqueMatches, groups: groups.size, elapsed };
}

async function newScrapeGroup(eventId, groupId) {
  const url = `${BASE_URL}/org_event/events/${eventId}/schedules?group=${groupId}`;
  const html = await fetchHTML(url);
  if (!html) return [];

  const $ = cheerio.load(html);
  const matches = [];

  $("table tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length === 7) {
      const matchNum = $(cells[0]).text().trim();
      const dateTime = $(cells[1]).text().trim();
      const homeTeam = $(cells[2]).text().trim();
      const scoreText = $(cells[3]).text().trim();
      const awayTeam = $(cells[4]).text().trim();
      const location = $(cells[5]).text().trim();
      const division = $(cells[6]).text().trim();

      if (!scoreText.includes("-")) return;

      const [homeScore, awayScore] = parseScore(scoreText);
      const matchDate = parseDate(dateTime);

      if (matchDate && matchDate < "2023-01-01") return;

      let status = "scheduled";
      if (homeScore !== null && awayScore !== null && matchDate) {
        if (new Date(matchDate) < new Date()) status = "completed";
      }

      // NEW: Parse division for gender/age
      const { gender, ageGroup } = parseDivision(division);

      matches.push({
        event_id: eventId.toString(),
        match_number: matchNum,
        match_date: matchDate,
        home_team_name: homeTeam?.trim() || "",
        away_team_name: awayTeam?.trim() || "",
        home_score: homeScore,
        away_score: awayScore,
        status,
        location,
        division,
        gender,
        ageGroup,
        // NEW: Match key format
        match_key: `gotsport-${eventId}-${matchNum}`.toLowerCase(),
      });
    }
  });

  return matches;
}

// ===========================================
// SHARED UTILITIES
// ===========================================

async function fetchHTML(url) {
  await sleep(1500 + Math.random() * 1500);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENTS[0],
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!response.ok) return null;
    return await response.text();
  } catch (e) {
    return null;
  }
}

function parseScore(scoreStr) {
  if (!scoreStr) return [null, null];
  const match = scoreStr.trim().match(/(\d+)\s*-\s*(\d+)/);
  if (!match) return [null, null];
  return [parseInt(match[1]), parseInt(match[2])];
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  const datePart = dateStr.split("\n")[0].trim();
  try {
    const date = new Date(datePart);
    if (isNaN(date.getTime())) return null;
    return date.toISOString().split("T")[0];
  } catch {
    return null;
  }
}

function parseDivision(divisionText) {
  if (!divisionText) return { gender: null, ageGroup: null };

  const lower = divisionText.toLowerCase();

  let gender = null;
  if (lower.includes("boys") || lower.includes(" b ") || /\bb\d/i.test(divisionText)) {
    gender = "Boys";
  } else if (lower.includes("girls") || lower.includes(" g ") || /\bg\d/i.test(divisionText)) {
    gender = "Girls";
  }

  let ageGroup = null;
  const ageMatch = lower.match(/u[-]?(\d+)/i);
  if (ageMatch) {
    ageGroup = `U${ageMatch[1]}`;
  }

  return { gender, ageGroup };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ===========================================
// COMPARISON LOGIC
// ===========================================

function compareResults(oldResult, newResult) {
  console.log("\n" + "=".repeat(60));
  console.log("📊 COMPARISON RESULTS");
  console.log("=".repeat(60));

  const oldMatches = oldResult.matches;
  const newMatches = newResult.matches;

  // Basic counts
  console.log("\n### Match Counts ###");
  console.log(`   Old scraper: ${oldMatches.length} matches`);
  console.log(`   New scraper: ${newMatches.length} matches`);
  console.log(`   Difference: ${newMatches.length - oldMatches.length}`);

  // Create lookup maps
  const oldByKey = new Map(oldMatches.map(m => [m.match_key, m]));
  const newByKey = new Map(newMatches.map(m => [m.match_key, m]));

  // Find matches in old but not in new
  const onlyInOld = oldMatches.filter(m => !newByKey.has(m.match_key));
  const onlyInNew = newMatches.filter(m => !oldByKey.has(m.match_key));
  const inBoth = oldMatches.filter(m => newByKey.has(m.match_key));

  console.log("\n### Match Coverage ###");
  console.log(`   In both: ${inBoth.length}`);
  console.log(`   Only in old: ${onlyInOld.length}`);
  console.log(`   Only in new: ${onlyInNew.length}`);

  // Compare field values for matches in both
  let fieldDifferences = {
    home_team_name: 0,
    away_team_name: 0,
    home_score: 0,
    away_score: 0,
    match_date: 0,
    status: 0,
  };

  for (const oldMatch of inBoth) {
    const newMatch = newByKey.get(oldMatch.match_key);

    if (oldMatch.home_team_name !== newMatch.home_team_name) fieldDifferences.home_team_name++;
    if (oldMatch.away_team_name !== newMatch.away_team_name) fieldDifferences.away_team_name++;
    if (oldMatch.home_score !== newMatch.home_score) fieldDifferences.home_score++;
    if (oldMatch.away_score !== newMatch.away_score) fieldDifferences.away_score++;
    if (oldMatch.match_date !== newMatch.match_date) fieldDifferences.match_date++;
    if (oldMatch.status !== newMatch.status) fieldDifferences.status++;
  }

  console.log("\n### Field Value Differences (for matches in both) ###");
  for (const [field, count] of Object.entries(fieldDifferences)) {
    const icon = count === 0 ? "✅" : "⚠️";
    console.log(`   ${icon} ${field}: ${count} differences`);
  }

  // NEW: Check for extra data captured by new scraper
  const newWithDivision = newMatches.filter(m => m.division).length;
  const newWithGender = newMatches.filter(m => m.gender).length;
  const newWithAgeGroup = newMatches.filter(m => m.ageGroup).length;

  console.log("\n### Extra Data in New Scraper ###");
  console.log(`   With division: ${newWithDivision}/${newMatches.length}`);
  console.log(`   With gender: ${newWithGender}/${newMatches.length}`);
  console.log(`   With ageGroup: ${newWithAgeGroup}/${newMatches.length}`);

  // Sample of differences
  if (onlyInOld.length > 0) {
    console.log("\n### Sample: Only in Old (first 3) ###");
    for (const m of onlyInOld.slice(0, 3)) {
      console.log(`   - ${m.match_key}: ${m.home_team_name} vs ${m.away_team_name}`);
    }
  }

  if (onlyInNew.length > 0) {
    console.log("\n### Sample: Only in New (first 3) ###");
    for (const m of onlyInNew.slice(0, 3)) {
      console.log(`   - ${m.match_key}: ${m.home_team_name} vs ${m.away_team_name}`);
    }
  }

  // Verdict
  console.log("\n" + "=".repeat(60));
  const isIdentical = oldMatches.length === newMatches.length &&
                      onlyInOld.length === 0 &&
                      onlyInNew.length === 0 &&
                      Object.values(fieldDifferences).every(v => v === 0);

  if (isIdentical) {
    console.log("✅ VERDICT: NEW SCRAPER PRODUCES IDENTICAL RESULTS");
  } else if (newMatches.length >= oldMatches.length && onlyInOld.length === 0) {
    console.log("✅ VERDICT: NEW SCRAPER CAPTURES ALL OLD DATA (plus extras)");
  } else {
    console.log("⚠️ VERDICT: DIFFERENCES DETECTED - REVIEW REQUIRED");
  }
  console.log("=".repeat(60));

  return {
    identical: isIdentical,
    oldCount: oldMatches.length,
    newCount: newMatches.length,
    inBoth: inBoth.length,
    onlyInOld: onlyInOld.length,
    onlyInNew: onlyInNew.length,
    fieldDifferences,
  };
}

// ===========================================
// MAIN
// ===========================================

async function main() {
  const eventId = process.argv[2] || "39064"; // Default: Mt Olive Cup 2025

  console.log("🔬 PARALLEL SCRAPER COMPARISON TEST");
  console.log("=".repeat(60));
  console.log(`Event ID: ${eventId}`);
  console.log(`Started: ${new Date().toISOString()}`);

  // Run old scraper
  const oldResult = await oldScrapeEvent(eventId);

  // Run new scraper
  const newResult = await newScrapeEvent(eventId);

  // Compare
  const comparison = compareResults(oldResult, newResult);

  console.log("\n📋 SUMMARY");
  console.log(`   Old: ${comparison.oldCount} matches in ${oldResult.groups} groups`);
  console.log(`   New: ${comparison.newCount} matches in ${newResult.groups} groups`);
  console.log(`   Completed: ${new Date().toISOString()}`);
}

main().catch(error => {
  console.error("❌ Error:", error);
  process.exit(1);
});
