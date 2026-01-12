/**
 * SoccerView — Discover Groups for All Tournaments
 * Fetches all tournaments from database and discovers their age groups
 * Run: node scripts/discover_groups.js
 */

import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";
import "dotenv/config";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing env vars");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const DELAY_MS = 2000;
const GOTSPORT_BASE = "https://system.gotsport.com";

async function discoverGroups(eventId) {
  const url = `${GOTSPORT_BASE}/org_event/events/${eventId}/schedules`;

  await new Promise((r) => setTimeout(r, DELAY_MS));

  const response = await fetch(url);
  if (!response.ok) {
    console.log(`  Failed to fetch event ${eventId}: ${response.status}`);
    return [];
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  const groups = [];
  const seen = new Set();

  $('a[href*="group="]').each((i, el) => {
    const href = $(el).attr("href") || "";
    const match = href.match(/group=(\d+)/);
    if (match && !seen.has(match[1])) {
      seen.add(match[1]);
      const divisionName = $(el).text().trim();

      // Infer age/gender
      const lower = divisionName.toLowerCase();
      let ageGroup = null;
      let gender = null;

      const ageMatch = lower.match(/u[- ]?(\d{1,2})/);
      if (ageMatch) ageGroup = `U${ageMatch[1]}`;

      if (
        lower.includes("boys") ||
        / b /.test(lower) ||
        /\bb\d{2}/.test(lower)
      ) {
        gender = "Boys";
      } else if (
        lower.includes("girls") ||
        / g /.test(lower) ||
        /\bg\d{2}/.test(lower)
      ) {
        gender = "Girls";
      }

      groups.push({
        event_id: eventId,
        group_id: match[1],
        url: `${GOTSPORT_BASE}/org_event/events/${eventId}/schedules?group=${match[1]}`,
        division_name: divisionName.substring(0, 255),
        age_group: ageGroup,
        gender: gender,
      });
    }
  });

  return groups;
}

async function main() {
  console.log("=== Discover Groups for All Tournaments ===\n");

  // Fetch all tournaments
  const { data: tournaments, error } = await supabase
    .from("tournament_sources")
    .select("id, event_id, name, state")
    .eq("is_active", true);

  if (error) {
    console.error("Failed to fetch tournaments:", error);
    process.exit(1);
  }

  console.log(`Found ${tournaments.length} tournaments\n`);

  let totalGroups = 0;
  let newGroups = 0;

  for (const tournament of tournaments) {
    console.log(
      `[${tournament.name}] (${tournament.state}) - Event ${tournament.event_id}`,
    );

    const groups = await discoverGroups(tournament.event_id);
    console.log(`  Found ${groups.length} groups`);
    totalGroups += groups.length;

    // Insert groups
    for (const group of groups) {
      const { error: insertError } = await supabase
        .from("scrape_targets")
        .upsert(
          {
            tournament_id: tournament.id,
            event_id: group.event_id,
            group_id: group.group_id,
            url: group.url,
            division_name: group.division_name,
            age_group: group.age_group,
            gender: group.gender,
            state: tournament.state,
            is_active: true,
          },
          { onConflict: "event_id,group_id" },
        );

      if (!insertError) newGroups++;
    }
  }

  // Get final count
  const { count } = await supabase
    .from("scrape_targets")
    .select("*", { count: "exact", head: true })
    .eq("is_active", true);

  console.log("\n=== Summary ===");
  console.log(`Total groups discovered: ${totalGroups}`);
  console.log(`Active scrape targets: ${count}`);
}

main().catch((e) => {
  console.error("Failed:", e);
  process.exit(1);
});
