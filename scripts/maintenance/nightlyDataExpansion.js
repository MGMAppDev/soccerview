/**
 * Nightly Data Expansion Master Script
 *
 * Orchestrates the complete soup-to-nuts data scraping workflow:
 * 1. Pre-scrape audit
 * 2. Execute scraper for specified source
 * 3. Run integration pipeline
 * 4. Run QC checks
 * 5. Generate summary report
 *
 * Usage: node scripts/nightlyDataExpansion.js --source [SOURCE_NAME]
 *
 * Available sources (from Priority Queue):
 *   - htgsports-nationwide    (Expand beyond Heartland - 50K+ matches)
 *   - sinc-sports             (NC - 3,172 teams at 20.4%)
 *   - sportsconnect-sc        (SC - 1,205 teams at 17.3%)
 *   - nebraska-ysl            (NE - 911 teams at 26.3%)
 *   - edp-soccer              (Northeast region)
 *   - demosphere              (WI/MI/IA)
 *   - gotsport-expansion      (GA/AL/TN - discover more events)
 *
 * Example:
 *   node scripts/nightlyDataExpansion.js --source htgsports-nationwide
 */

require("dotenv").config();
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Parse arguments
const args = process.argv.slice(2);
const sourceArg = args.find((a) => a.startsWith("--source="));
const sourceName = sourceArg ? sourceArg.split("=")[1] : null;
const dryRun = args.includes("--dry-run");

// Source configurations
// VERIFIED ACCESS METHODS - See DATA_SCRAPING_PLAYBOOK.md Section 4.5
const SOURCE_CONFIG = {
  // === IMPLEMENTED ===
  "htgsports-nationwide": {
    name: "HTGSports Nationwide Expansion",
    scraper: "scrapeHTGSports.js",
    description: "Expand HTGSports scraping beyond Heartland to cover 26+ states",
    estimatedMatches: "50,000+",
    priority: "CRITICAL",
    implemented: true,
    accessMethod: "Division dropdown iteration + HTML parsing",
  },
  "heartland-results": {
    name: "Heartland League Results",
    scraper: "scrapeHeartlandResults.js",
    description: "Scrape Heartland CGI API for match results with scores",
    estimatedMatches: "5,000+",
    priority: "HIGH",
    implemented: true,
    accessMethod: "CGI API endpoint with subdivision parameters",
  },
  "heartland-league": {
    name: "Heartland League Calendar",
    scraper: "scrapeHeartlandLeague.js",
    description: "Scrape Heartland team calendars for schedules",
    estimatedMatches: "3,000+",
    priority: "HIGH",
    implemented: true,
    accessMethod: "Puppeteer DOM scraping",
  },
  "gotsport-sync": {
    name: "GotSport Active Events Sync",
    scraper: "syncActiveEvents.js",
    description: "Sync active GotSport events for latest results",
    estimatedMatches: "varies",
    priority: "DAILY",
    implemented: true,
    accessMethod: "GotSport HTML parsing",
  },

  // === VERIFIED BUT NOT YET IMPLEMENTED ===
  "sinc-sports": {
    name: "SINC Sports (NC)",
    scraper: "scrapeSincSports.js", // To be built
    description: "North Carolina - 3,172 teams at 20.4% coverage",
    estimatedMatches: "25,000+",
    priority: "CRITICAL",
    implemented: false,
    accessMethod: "Excel export (btnExtractSched) + Puppeteer, or AutoComplete.asmx service",
    verifiedUrl: "soccer.sincsports.com/schedule.aspx?tid=NCFL",
    tournamentIds: ["NCFL", "NCCSL"],
  },
  "sportsaffinity-multi": {
    name: "SportsAffinity Multi-State (SC, NE, WA+)",
    scraper: "scrapeSportsAffinity.js", // To be built
    description: "10+ states via iCal calendar feeds - SC (17.3%), NE (26.3%), WA (43.7%)",
    estimatedMatches: "50,000+",
    priority: "CRITICAL",
    implemented: false,
    accessMethod: "iCal calendar feeds - Schedules > Calendar > Sync",
    verifiedSubdomains: [
      "scysa.sportsaffinity.com",
      "nebraskasoccer.sportsaffinity.com",
      "wys.sportsaffinity.com",
    ],
  },
  "edp-soccer": {
    name: "EDP Soccer (Northeast)",
    scraper: "syncActiveEvents.js", // Use existing GotSport scraper!
    description: "NJ, PA, DE, MD, VA, NY, CT, FL, OH - USES GOTSPORT BACKEND",
    estimatedMatches: "30,000+",
    priority: "HIGH",
    implemented: true, // Can use existing scraper, just need event IDs
    accessMethod: "GotSport (Event ID: LeagueFall25, Pin: 6655)",
    note: "Add EDP event IDs to existing GotSport config",
  },
  "demosphere": {
    name: "Demosphere (WI, MI, IA)",
    scraper: "scrapeDemosphere.js", // To be built
    description: "Multiple states via club subdomains",
    estimatedMatches: "20,000+",
    priority: "HIGH",
    implemented: false,
    accessMethod: "iCal exports or HTML scraping per club subdomain",
    note: "Need to compile list of club subdomains per state",
  },
};

function printHeader() {
  console.log("\n" + "═".repeat(70));
  console.log("  SOCCERVIEW NIGHTLY DATA EXPANSION");
  console.log("  " + new Date().toISOString());
  console.log("═".repeat(70) + "\n");
}

function printUsage() {
  console.log("Usage: node scripts/nightlyDataExpansion.js --source=[SOURCE_NAME]\n");
  console.log("Available sources:\n");

  for (const [key, config] of Object.entries(SOURCE_CONFIG)) {
    const status = config.implemented ? "✅" : "⬜ (not yet built)";
    console.log(`  ${key}`);
    console.log(`    ${config.name} - ${config.priority}`);
    console.log(`    Est. matches: ${config.estimatedMatches}`);
    console.log(`    Status: ${status}\n`);
  }

  console.log("\nExample: node scripts/nightlyDataExpansion.js --source=htgsports-nationwide");
}

function runStep(stepName, command) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`▶️ ${stepName}`);
  console.log(`${"─".repeat(60)}\n`);

  if (dryRun) {
    console.log(`[DRY RUN] Would execute: ${command}`);
    return { success: true, duration: 0 };
  }

  const startTime = Date.now();

  try {
    execSync(command, { stdio: "inherit", cwd: process.cwd() });
    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log(`\n✅ ${stepName} complete (${duration} min)`);
    return { success: true, duration };
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log(`\n❌ ${stepName} failed (${duration} min)`);
    return { success: false, duration, error: error.message };
  }
}

async function runNightlyExpansion() {
  printHeader();

  // Validate source
  if (!sourceName) {
    console.log("❌ Error: No source specified\n");
    printUsage();
    process.exit(1);
  }

  const sourceConfig = SOURCE_CONFIG[sourceName];
  if (!sourceConfig) {
    console.log(`❌ Error: Unknown source "${sourceName}"\n`);
    printUsage();
    process.exit(1);
  }

  if (!sourceConfig.implemented) {
    console.log(`❌ Error: Scraper for "${sourceName}" not yet implemented\n`);
    console.log("This source is in the priority queue but needs scraper development.");
    console.log("See DATA_SCRAPING_PLAYBOOK.md Phase 4 for scraper development guide.\n");
    process.exit(1);
  }

  // Show execution plan
  console.log("📋 EXECUTION PLAN");
  console.log("─".repeat(40));
  console.log(`Source: ${sourceConfig.name}`);
  console.log(`Scraper: ${sourceConfig.scraper}`);
  console.log(`Est. Matches: ${sourceConfig.estimatedMatches}`);
  console.log(`Priority: ${sourceConfig.priority}`);
  console.log(`Dry Run: ${dryRun}`);
  console.log("─".repeat(40));

  console.log("\nSteps to execute:");
  console.log("  1. Pre-scrape database audit");
  console.log("  2. Execute scraper");
  console.log("  3. Run integration pipeline");
  console.log("  4. Run QC checks");
  console.log("  5. Generate report\n");

  // Track results
  const results = {
    startTime: new Date().toISOString(),
    source: sourceName,
    steps: [],
  };

  // Step 1: Pre-scrape audit
  const auditResult = runStep(
    "Pre-Scrape Database Audit",
    "node scripts/preScrapeAudit.js"
  );
  results.steps.push({ name: "Pre-Scrape Audit", ...auditResult });

  if (!auditResult.success) {
    console.log("\n⚠️ Database audit failed. Review issues before proceeding.");
    // Continue anyway - audit failures are warnings, not blockers
  }

  // Step 2: Execute scraper
  const scraperResult = runStep(
    `Execute Scraper: ${sourceConfig.scraper}`,
    `node scripts/${sourceConfig.scraper}`
  );
  results.steps.push({ name: "Scraper Execution", ...scraperResult });

  if (!scraperResult.success) {
    console.log("\n❌ Scraper failed. Halting pipeline.");
    generateReport(results);
    process.exit(1);
  }

  // Step 3: Integration pipeline
  const integrationResult = runStep(
    "Integration Pipeline",
    "node scripts/runIntegrationPipeline.js"
  );
  results.steps.push({ name: "Integration Pipeline", ...integrationResult });

  if (!integrationResult.success) {
    console.log("\n⚠️ Integration pipeline had issues. Review before continuing.");
  }

  // Step 4: QC checks
  const qcResult = runStep(
    "Quality Control Checks",
    "node scripts/nightlyQC.js --report"
  );
  results.steps.push({ name: "QC Checks", ...qcResult });

  // Step 5: Generate final report
  results.endTime = new Date().toISOString();
  generateReport(results);

  // Final summary
  console.log("\n" + "═".repeat(70));
  console.log("  NIGHTLY DATA EXPANSION COMPLETE");
  console.log("═".repeat(70) + "\n");

  const totalMinutes = results.steps.reduce(
    (sum, s) => sum + parseFloat(s.duration || 0),
    0
  );
  const failures = results.steps.filter((s) => !s.success).length;

  console.log(`Total time: ${totalMinutes.toFixed(1)} minutes`);
  console.log(`Steps completed: ${results.steps.length - failures}/${results.steps.length}`);

  if (failures > 0) {
    console.log(`\n⚠️ ${failures} step(s) had issues. Review the report.`);
  } else {
    console.log("\n🎉 All steps completed successfully!");
  }

  console.log("\nNext steps:");
  console.log("  1. Review the generated report");
  console.log("  2. Verify data in app (Teams, Rankings, Team Details)");
  console.log("  3. Update CLAUDE.md with new data counts");
  console.log("\n");

  process.exit(failures > 0 ? 1 : 0);
}

function generateReport(results) {
  const reportPath = `nightly_expansion_${results.source}_${
    new Date().toISOString().split("T")[0]
  }.md`;

  let report = `# Nightly Data Expansion Report

## Summary
- **Source:** ${results.source}
- **Start Time:** ${results.startTime}
- **End Time:** ${results.endTime || "N/A"}

## Step Results

| Step | Status | Duration |
|------|--------|----------|
`;

  for (const step of results.steps) {
    const status = step.success ? "✅ Success" : "❌ Failed";
    report += `| ${step.name} | ${status} | ${step.duration} min |\n`;
  }

  report += `
## Next Steps

1. [ ] Verify data in Teams tab (search for team from ${results.source})
2. [ ] Verify data in Rankings tab (filter by state)
3. [ ] Test Team Details page (check League Standings if applicable)
4. [ ] Update CLAUDE.md Quick Reference table
5. [ ] Update Data Completeness Status table

## Notes

Add any manual observations here...
`;

  fs.writeFileSync(reportPath, report);
  console.log(`\n📄 Report saved: ${reportPath}`);
}

// Run
runNightlyExpansion().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
