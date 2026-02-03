/**
 * Integration Pipeline Runner
 *
 * Runs all post-scrape integration steps in the correct order:
 * 1. Create teams from new match data
 * 2. Link matches to team IDs
 * 3. Recalculate ELO ratings
 * 4. Sync match counts (for app visibility)
 *
 * Usage: node scripts/runIntegrationPipeline.js [--source SOURCE_PLATFORM]
 *
 * Options:
 *   --source    Only process matches from this source platform
 *   --skip-elo  Skip ELO recalculation (faster, for testing)
 *   --dry-run   Show what would be done without executing
 */

require("dotenv").config();
const { execSync, spawn } = require("child_process");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Parse command line arguments
const args = process.argv.slice(2);
const sourceArg = args.find((a) => a.startsWith("--source="));
const sourcePlatform = sourceArg ? sourceArg.split("=")[1] : null;
const skipElo = args.includes("--skip-elo");
const dryRun = args.includes("--dry-run");

// Pipeline steps
const PIPELINE_STEPS = [
  {
    name: "Integrate Teams",
    description: "Extract unique team names from matches and create team records",
    script: "integrateHeartlandTeams.js",
    optional: false,
    skipCondition: null,
  },
  {
    name: "Link Matches",
    description: "Link match team names to team IDs using fuzzy matching",
    script: "linkTeams.js",
    optional: false,
    skipCondition: null,
  },
  {
    name: "Recalculate ELO",
    description: "Recalculate ELO ratings for all teams with linked matches",
    script: "recalculate_elo_v2.js",
    optional: true,
    skipCondition: () => skipElo,
  },
  {
    name: "Sync Match Counts",
    description: "Update teams.matches_played for app visibility",
    script: "syncMatchCounts.js",
    optional: false,
    skipCondition: null,
  },
];

async function getPreStats() {
  console.log("\n📊 Pre-Integration Stats:");

  const { count: teamCount } = await supabase
    .from("teams")
    .select("*", { count: "exact", head: true });

  const { count: matchCount } = await supabase
    .from("match_results")
    .select("*", { count: "exact", head: true });

  const { count: linkedCount } = await supabase
    .from("match_results")
    .select("*", { count: "exact", head: true })
    .not("home_team_id", "is", null);

  const linkRate = matchCount ? ((linkedCount / matchCount) * 100).toFixed(1) : 0;

  console.log(`   Teams: ${teamCount?.toLocaleString()}`);
  console.log(`   Matches: ${matchCount?.toLocaleString()}`);
  console.log(`   Linked: ${linkedCount?.toLocaleString()} (${linkRate}%)`);

  return { teamCount, matchCount, linkedCount, linkRate };
}

async function getPostStats() {
  console.log("\n📊 Post-Integration Stats:");

  const { count: teamCount } = await supabase
    .from("teams")
    .select("*", { count: "exact", head: true });

  const { count: matchCount } = await supabase
    .from("match_results")
    .select("*", { count: "exact", head: true });

  const { count: linkedCount } = await supabase
    .from("match_results")
    .select("*", { count: "exact", head: true })
    .not("home_team_id", "is", null);

  const { count: teamsWithMatches } = await supabase
    .from("teams")
    .select("*", { count: "exact", head: true })
    .gt("matches_played", 0);

  const linkRate = matchCount ? ((linkedCount / matchCount) * 100).toFixed(1) : 0;

  console.log(`   Teams: ${teamCount?.toLocaleString()}`);
  console.log(`   Matches: ${matchCount?.toLocaleString()}`);
  console.log(`   Linked: ${linkedCount?.toLocaleString()} (${linkRate}%)`);
  console.log(`   Teams with match history: ${teamsWithMatches?.toLocaleString()}`);

  return { teamCount, matchCount, linkedCount, linkRate, teamsWithMatches };
}

function runScript(scriptName) {
  return new Promise((resolve, reject) => {
    const scriptPath = `scripts/${scriptName}`;
    console.log(`   Running: node ${scriptPath}`);

    if (dryRun) {
      console.log("   [DRY RUN - Skipped]");
      resolve({ success: true, duration: 0 });
      return;
    }

    const startTime = Date.now();

    try {
      execSync(`node ${scriptPath}`, {
        stdio: "inherit",
        cwd: process.cwd(),
      });

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      resolve({ success: true, duration });
    } catch (error) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      reject({ success: false, duration, error: error.message });
    }
  });
}

async function runPipeline() {
  console.log("\n" + "=".repeat(60));
  console.log("SOCCERVIEW INTEGRATION PIPELINE");
  console.log("=".repeat(60));

  if (sourcePlatform) {
    console.log(`\nSource filter: ${sourcePlatform}`);
  }
  if (skipElo) {
    console.log("Skipping ELO recalculation (--skip-elo)");
  }
  if (dryRun) {
    console.log("DRY RUN MODE - No changes will be made");
  }

  // Get pre-stats
  const preStats = await getPreStats();

  // Run each step
  const results = [];
  let stepNum = 1;

  for (const step of PIPELINE_STEPS) {
    console.log("\n" + "-".repeat(60));
    console.log(`STEP ${stepNum}/${PIPELINE_STEPS.length}: ${step.name}`);
    console.log(`   ${step.description}`);
    console.log("-".repeat(60));

    // Check skip condition
    if (step.skipCondition && step.skipCondition()) {
      console.log(`   ⏭️ SKIPPED (${step.optional ? "optional" : "condition met"})`);
      results.push({
        step: step.name,
        status: "SKIPPED",
        duration: 0,
      });
      stepNum++;
      continue;
    }

    try {
      const result = await runScript(step.script);
      console.log(`   ✅ Complete (${result.duration}s)`);
      results.push({
        step: step.name,
        status: "SUCCESS",
        duration: result.duration,
      });
    } catch (error) {
      console.log(`   ❌ Failed: ${error.error}`);
      results.push({
        step: step.name,
        status: "FAILED",
        duration: error.duration,
        error: error.error,
      });

      // Stop pipeline on critical failure
      if (!step.optional) {
        console.log("\n❌ PIPELINE HALTED - Critical step failed");
        break;
      }
    }

    stepNum++;
  }

  // Get post-stats
  const postStats = await getPostStats();

  // Print summary
  console.log("\n" + "=".repeat(60));
  console.log("PIPELINE SUMMARY");
  console.log("=".repeat(60) + "\n");

  console.log("Step Results:");
  for (const result of results) {
    const icon =
      result.status === "SUCCESS"
        ? "✅"
        : result.status === "SKIPPED"
        ? "⏭️"
        : "❌";
    console.log(`   ${icon} ${result.step}: ${result.status} (${result.duration}s)`);
  }

  console.log("\nData Changes:");
  console.log(
    `   Teams: ${preStats.teamCount?.toLocaleString()} → ${postStats.teamCount?.toLocaleString()} (+${(
      postStats.teamCount - preStats.teamCount
    ).toLocaleString()})`
  );
  console.log(
    `   Link Rate: ${preStats.linkRate}% → ${postStats.linkRate}% (+${(
      parseFloat(postStats.linkRate) - parseFloat(preStats.linkRate)
    ).toFixed(1)}%)`
  );
  console.log(
    `   Teams Visible: ${postStats.teamsWithMatches?.toLocaleString()}`
  );

  const failed = results.filter((r) => r.status === "FAILED").length;
  const success = results.filter((r) => r.status === "SUCCESS").length;

  console.log("\n" + "-".repeat(60));
  if (failed === 0) {
    console.log("🎉 INTEGRATION PIPELINE COMPLETE");
  } else {
    console.log(`⚠️ PIPELINE COMPLETED WITH ${failed} FAILURES`);
  }
  console.log("-".repeat(60) + "\n");

  return failed === 0;
}

// Run
runPipeline()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((err) => {
    console.error("Pipeline failed:", err);
    process.exit(1);
  });
