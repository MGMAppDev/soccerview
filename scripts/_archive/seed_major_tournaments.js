import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("ERROR: Missing Supabase credentials");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// VERIFIED REAL EVENT IDs FROM GOTSPORT (January 2025/2026)
const MAJOR_TOURNAMENTS = [
  {
    event_id: "42591",
    name: "Copa Gulf Coast 2025 (TX)",
    state: "TX",
    priority: 8,
  },
  {
    event_id: "38927",
    name: "SOCAL State Cup 2025",
    state: "CA",
    priority: 10,
  },
  { event_id: "42973", name: "California Cup", state: "CA", priority: 9 },
  { event_id: "43745", name: "Florida Cup", state: "FL", priority: 9 },
  {
    event_id: "44517",
    name: "Chargers Labor Day (FL)",
    state: "FL",
    priority: 9,
  },
  { event_id: "34489", name: "Orlando Soccer Event", state: "FL", priority: 8 },
  {
    event_id: "35869",
    name: "International Showcase FL",
    state: "FL",
    priority: 9,
  },
  {
    event_id: "35673",
    name: "FFC Park Tournament (VA)",
    state: "VA",
    priority: 8,
  },
  {
    event_id: "39393",
    name: "Virginia State Cup 2025",
    state: "VA",
    priority: 9,
  },
  { event_id: "38489", name: "Indy Burn Cup 2025", state: "IN", priority: 8 },
  {
    event_id: "42118",
    name: "US Youth Soccer Midwest Regional",
    state: "OH",
    priority: 10,
  },
  {
    event_id: "43121",
    name: "US Youth Soccer Southern Regional",
    state: "GA",
    priority: 10,
  },
  {
    event_id: "38506",
    name: "Ridgefield Fall Classic (CT)",
    state: "CT",
    priority: 7,
  },
];

async function discoverGroups(eventId, state) {
  const url = `https://system.gotsport.com/org_event/events/${eventId}/schedules`;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!response.ok) {
      console.log(`    Event ${eventId}: HTTP ${response.status}`);
      return [];
    }

    const html = await response.text();
    const groups = [];
    const groupMatches = html.matchAll(/group=(\d+)/g);
    const seenGroups = new Set();

    for (const match of groupMatches) {
      const groupId = match[1];
      if (!seenGroups.has(groupId)) {
        seenGroups.add(groupId);
        groups.push({
          event_id: eventId,
          group_id: groupId,
          url: `https://system.gotsport.com/org_event/events/${eventId}/schedules?group=${groupId}`,
          state: state,
        });
      }
    }
    return groups;
  } catch (error) {
    console.log(`    Event ${eventId}: Error - ${error.message}`);
    return [];
  }
}

async function insertTargets(targets) {
  if (targets.length === 0) return 0;
  let inserted = 0;

  for (const target of targets) {
    const { error } = await supabase.from("scrape_targets").upsert(
      {
        event_id: target.event_id,
        group_id: target.group_id,
        url: target.url,
        state: target.state,
        is_active: true,
      },
      { onConflict: "event_id,group_id", ignoreDuplicates: true },
    );

    if (!error) inserted++;
  }
  return inserted;
}

async function main() {
  console.log("=".repeat(60));
  console.log("MAJOR TOURNAMENT SEEDER");
  console.log("=".repeat(60));
  console.log(`\nTournaments to process: ${MAJOR_TOURNAMENTS.length}\n`);

  let totalTargets = 0;
  let successfulEvents = 0;

  for (let i = 0; i < MAJOR_TOURNAMENTS.length; i++) {
    const tournament = MAJOR_TOURNAMENTS[i];
    console.log(`[${i + 1}/${MAJOR_TOURNAMENTS.length}] ${tournament.name}`);

    await new Promise((resolve) => setTimeout(resolve, 1500));

    const groups = await discoverGroups(tournament.event_id, tournament.state);

    if (groups.length > 0) {
      console.log(`    Found ${groups.length} groups`);
      const inserted = await insertTargets(groups);
      console.log(`    Inserted ${inserted} new targets`);
      totalTargets += inserted;
      successfulEvents++;
    } else {
      console.log(`    No groups found`);
    }
  }

  const { count } = await supabase
    .from("scrape_targets")
    .select("*", { count: "exact", head: true })
    .eq("is_active", true);

  console.log("\n" + "=".repeat(60));
  console.log("SEEDING COMPLETE");
  console.log("=".repeat(60));
  console.log(`  Events with groups: ${successfulEvents}`);
  console.log(`  New targets added: ${totalTargets}`);
  console.log(`  Total active targets: ${count}`);
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
