/**
 * GotSport Match Results Scraper (ES Module)
 * Phase 15.5 - SoccerView
 *
 * Usage:
 *   node scripts/scrapeMatches.js [event_id]
 *   node scripts/scrapeMatches.js 30789  # Revolution Cup 2024
 */

import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";
import "dotenv/config";

// ============================================================
// CONFIGURATION
// ============================================================

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Missing environment variables:");
  console.error("   EXPO_PUBLIC_SUPABASE_URL:", SUPABASE_URL ? "✓" : "✗");
  console.error(
    "   SUPABASE_SERVICE_ROLE_KEY:",
    SUPABASE_SERVICE_KEY ? "✓" : "✗",
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const BASE_URL = "https://system.gotsport.com";
const DELAY_MS = 500;

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchHTML(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.text();
    } catch (error) {
      console.error(
        `   Attempt ${attempt}/${retries} failed: ${error.message}`,
      );
      if (attempt === retries) throw error;
      await sleep(1000 * attempt);
    }
  }
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

function parseTime(dateStr) {
  if (!dateStr) return null;
  const lines = dateStr.split("\n");
  if (lines.length < 2) return null;

  const timePart = lines[1].trim();
  const timeMatch = timePart.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!timeMatch) return null;

  let hours = parseInt(timeMatch[1]);
  const minutes = timeMatch[2];
  const ampm = timeMatch[3].toUpperCase();

  if (ampm === "PM" && hours !== 12) hours += 12;
  if (ampm === "AM" && hours === 12) hours = 0;

  return `${hours.toString().padStart(2, "0")}:${minutes}:00`;
}

function parseScore(scoreStr) {
  if (!scoreStr) return [null, null];
  const match = scoreStr.trim().match(/(\d+)\s*-\s*(\d+)/);
  if (!match) return [null, null];
  return [parseInt(match[1]), parseInt(match[2])];
}

function extractAgeGroup(divisionText, teamName) {
  const patterns = [divisionText, teamName];
  for (const text of patterns) {
    if (!text) continue;
    const match =
      text.match(/\bU-?(\d{1,2})\b/i) ||
      text.match(/\b(\d{1,2})B\b/) ||
      text.match(/\b(\d{1,2})G\b/);
    if (match) {
      const age = parseInt(match[1]);
      if (age >= 8 && age <= 19) return `U${age}`;
    }
  }
  return null;
}

function extractGender(divisionText, teamName) {
  const text = `${divisionText || ""} ${teamName || ""}`.toLowerCase();
  if (
    text.includes("boys") ||
    text.includes(" b ") ||
    text.match(/\d+b\b/) ||
    text.includes("male")
  )
    return "Boys";
  if (
    text.includes("girls") ||
    text.includes(" g ") ||
    text.match(/\d+g\b/) ||
    text.includes("female")
  )
    return "Girls";
  return null;
}

// ============================================================
// CORE SCRAPING FUNCTIONS
// ============================================================

async function discoverGroups(eventId) {
  console.log(`\n📋 Discovering groups for event ${eventId}...`);

  const url = `${BASE_URL}/org_event/events/${eventId}`;
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);

  const groups = new Set();
  $('a[href*="schedules?group="]').each((_, el) => {
    const href = $(el).attr("href");
    const match = href.match(/group=(\d+)/);
    if (match) groups.add(match[1]);
  });

  const groupList = Array.from(groups);
  console.log(`   Found ${groupList.length} groups`);
  return groupList;
}

async function scrapeGroupSchedule(eventId, groupId, eventName) {
  const url = `${BASE_URL}/org_event/events/${eventId}/schedules?group=${groupId}`;

  try {
    const html = await fetchHTML(url);
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
        const matchTime = parseTime(dateTime);

        let status = "scheduled";
        if (homeScore !== null && awayScore !== null && matchDate) {
          if (new Date(matchDate) < new Date()) status = "completed";
        }

        matches.push({
          event_id: eventId.toString(),
          event_name: eventName,
          match_number: matchNum,
          match_date: matchDate,
          match_time: matchTime,
          home_team_name: homeTeam,
          home_score: homeScore,
          away_team_name: awayTeam,
          away_score: awayScore,
          status,
          age_group: extractAgeGroup(division, homeTeam),
          gender: extractGender(division, homeTeam),
          location,
        });
      }
    });

    return matches;
  } catch (error) {
    console.error(`   ❌ Error scraping group ${groupId}: ${error.message}`);
    return [];
  }
}

async function getEventName(eventId) {
  const url = `${BASE_URL}/org_event/events/${eventId}`;
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);
  return (
    $("title").text().split("|")[0].trim() ||
    $("h1").first().text().trim() ||
    `Event ${eventId}`
  );
}

// ============================================================
// DATABASE FUNCTIONS
// ============================================================

async function upsertMatches(matches) {
  if (matches.length === 0) return { inserted: 0 };

  const { data, error } = await supabase
    .from("match_results")
    .upsert(matches, {
      onConflict: "event_id,match_number",
      ignoreDuplicates: false,
    })
    .select();

  if (error) {
    console.error("❌ Database error:", error.message);
    return { inserted: 0, error: error.message };
  }

  return { inserted: data?.length || 0 };
}

// ============================================================
// MAIN EXECUTION
// ============================================================

async function scrapeEvent(eventId) {
  console.log("═".repeat(60));
  console.log(`🏆 GOTSPORT MATCH SCRAPER - Event ${eventId}`);
  console.log("═".repeat(60));

  const startTime = Date.now();
  const eventName = await getEventName(eventId);
  console.log(`\n📌 Event: ${eventName}`);

  const groups = await discoverGroups(eventId);
  if (groups.length === 0) {
    console.log("❌ No groups found");
    return;
  }

  let allMatches = [];
  for (let i = 0; i < groups.length; i++) {
    process.stdout.write(`\r   Scraping group ${i + 1}/${groups.length}...`);
    const matches = await scrapeGroupSchedule(eventId, groups[i], eventName);
    allMatches = allMatches.concat(matches);
    await sleep(DELAY_MS);
  }

  console.log(`\n\n📊 Scraped ${allMatches.length} total matches`);

  const uniqueMatches = Array.from(
    new Map(
      allMatches.map((m) => [`${m.event_id}-${m.match_number}`, m]),
    ).values(),
  );
  console.log(`   ${uniqueMatches.length} unique matches`);

  const byStatus = uniqueMatches.reduce((acc, m) => {
    acc[m.status] = (acc[m.status] || 0) + 1;
    return acc;
  }, {});
  console.log("   Status:", byStatus);

  console.log("\n💾 Saving to database...");
  const result = await upsertMatches(uniqueMatches);
  console.log(`   ✓ ${result.inserted} matches saved`);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n" + "═".repeat(60));
  console.log(`✅ COMPLETE in ${elapsed}s - ${uniqueMatches.length} matches`);
  console.log("═".repeat(60));
}

// CLI
const eventId = process.argv[2];
if (!eventId) {
  console.log("Usage: node scripts/scrapeMatches.js <event_id>");
  console.log("Example: node scripts/scrapeMatches.js 30789");
  process.exit(1);
}

scrapeEvent(eventId);
