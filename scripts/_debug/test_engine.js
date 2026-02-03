// Quick test of Universal Scraper Engine components
import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log("=== Universal Scraper Engine Test ===\n");

// Test 1: Environment
console.log("1. Environment variables:");
console.log("   SUPABASE_URL:", SUPABASE_URL ? "✅ Set" : "❌ Missing");
console.log("   SERVICE_ROLE_KEY:", SUPABASE_KEY ? `✅ Set (${SUPABASE_KEY.length} chars)` : "❌ Missing");

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.log("\n❌ Cannot continue without env vars");
  process.exit(1);
}

// Test 2: Database connection
console.log("\n2. Database connection:");
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

try {
  const { count, error } = await supabase
    .from("staging_games")
    .select("*", { count: "exact", head: true });

  if (error) {
    console.log("   ❌ Query failed:", error.message);
  } else {
    console.log("   ✅ staging_games count:", count);
  }
} catch (e) {
  console.log("   ❌ Connection error:", e.message);
}

// Test 3: Adapter import
console.log("\n3. Adapter import:");
try {
  const adapter = await import("file://c:/Users/MathieuMiles/Projects/soccerview/scripts/adapters/gotsport.js");
  console.log("   ✅ GotSport adapter loaded");
  console.log("   - ID:", adapter.default.id);
  console.log("   - Technology:", adapter.default.technology);
  console.log("   - Endpoints:", Object.keys(adapter.default.endpoints).join(", "));
} catch (e) {
  console.log("   ❌ Import error:", e.message);
}

console.log("\n=== Test Complete ===");
