/**
 * Run validation pipeline repeatedly until backlog is cleared
 */

import { createClient } from "@supabase/supabase-js";
import { spawn } from "child_process";
import dotenv from "dotenv";
dotenv.config();

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function getUnprocessedCount() {
  const { count } = await supabase
    .from("staging_games")
    .select("*", { count: "exact", head: true })
    .eq("processed", false);
  return count || 0;
}

async function runPipeline() {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", ["scripts/daily/validationPipeline.js"], {
      cwd: process.cwd(),
      stdio: "pipe",
    });

    let output = "";
    proc.stdout.on("data", (data) => {
      output += data.toString();
      // Show progress
      const match = output.match(/Matches inserted: (\d+)/);
      if (match) {
        process.stdout.write(`\r   Batch complete: ${match[1]} matches inserted`);
      }
    });
    proc.stderr.on("data", (data) => {
      output += data.toString();
    });
    proc.on("close", (code) => {
      const matchesMatch = output.match(/Matches inserted: (\d+)/);
      const inserted = matchesMatch ? parseInt(matchesMatch[1]) : 0;
      resolve({ code, inserted, output });
    });
    proc.on("error", reject);
  });
}

async function main() {
  console.log("🚀 FULL PIPELINE RUNNER");
  console.log("=======================\n");

  let totalProcessed = 0;
  let iteration = 0;
  const startTime = Date.now();

  while (true) {
    const remaining = await getUnprocessedCount();

    if (remaining === 0) {
      console.log("\n\n✅ ALL STAGING RECORDS PROCESSED!");
      break;
    }

    iteration++;
    console.log(`\n📦 Iteration ${iteration}: ${remaining} records remaining...`);

    const { inserted } = await runPipeline();
    totalProcessed += inserted;

    console.log(`   → Inserted ${inserted}, Total: ${totalProcessed}`);

    // Safety limit
    if (iteration > 50) {
      console.log("\n⚠️ Reached iteration limit (50), stopping");
      break;
    }
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log("\n" + "=".repeat(50));
  console.log("📊 SUMMARY");
  console.log("=".repeat(50));
  console.log(`   Total matches inserted: ${totalProcessed}`);
  console.log(`   Iterations: ${iteration}`);
  console.log(`   Runtime: ${elapsed}s (${Math.round(elapsed/60)}m)`);

  // Final count
  const finalCount = await getUnprocessedCount();
  console.log(`   Remaining unprocessed: ${finalCount}`);
}

main().catch(console.error);
