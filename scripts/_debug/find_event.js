// Find a real GotSport event ID for testing
import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Find a recent tournament with GotSport source
const { data: tournaments } = await supabase
  .from("tournaments")
  .select("id, name, source_event_id")
  .not("source_event_id", "is", null)
  .order("id", { ascending: false })
  .limit(5);

console.log("Recent tournaments with source_event_id:");
for (const t of tournaments || []) {
  console.log(`  - ${t.name}: ${t.source_event_id}`);
}

// Find a recent league with GotSport source
const { data: leagues } = await supabase
  .from("leagues")
  .select("id, name, source_event_id")
  .not("source_event_id", "is", null)
  .order("id", { ascending: false })
  .limit(5);

console.log("\nRecent leagues with source_event_id:");
for (const l of leagues || []) {
  console.log(`  - ${l.name}: ${l.source_event_id}`);
}
