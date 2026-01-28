/**
 * Nightly QC Checks
 *
 * Automated quality control checks to run after every data injection.
 * Verifies data integrity and identifies issues before they affect the app.
 *
 * Usage: node scripts/nightlyQC.js [--verbose] [--fix]
 *
 * Options:
 *   --verbose  Show detailed output for each check
 *   --fix      Attempt to auto-fix issues where possible
 *   --report   Generate markdown report file
 */

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Parse arguments
const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const autoFix = args.includes("--fix");
const generateReport = args.includes("--report");

// QC Check definitions
const QC_CHECKS = [
  {
    id: "orphaned_events",
    name: "Orphaned Event IDs",
    description: "Matches with event_id not in event_registry",
    severity: "CRITICAL",
    threshold: 0,
    check: async () => {
      const { data } = await supabase
        .from("match_results")
        .select("event_id, source_platform")
        .not("event_id", "is", null)
        .limit(10000);

      if (!data) return { value: 0, details: [] };

      const eventIds = [...new Set(data.map((m) => m.event_id))];
      const { data: registered } = await supabase
        .from("event_registry")
        .select("event_id")
        .in("event_id", eventIds);

      const registeredIds = new Set(registered?.map((e) => e.event_id) || []);
      const orphaned = eventIds.filter((id) => !registeredIds.has(id));

      // Get details
      const details = orphaned.slice(0, 10).map((id) => {
        const matches = data.filter((m) => m.event_id === id);
        return {
          event_id: id,
          source: matches[0]?.source_platform,
          match_count: matches.length,
        };
      });

      return { value: orphaned.length, details };
    },
    fix: async (details) => {
      // Auto-fix: Create event_registry entries for orphaned events
      for (const orphan of details.slice(0, 10)) {
        console.log(`   Creating registry entry for: ${orphan.event_id}`);
        await supabase.from("event_registry").insert({
          event_id: orphan.event_id,
          event_name: `Unknown Event (${orphan.event_id})`,
          source_type: "tournament", // Default, may need manual update
          source_platform: orphan.source,
          match_count: orphan.match_count,
        });
      }
      return details.length;
    },
  },
  {
    id: "recent_unlinked",
    name: "Recently Added Unlinked Matches",
    description: "Matches added in last 24h without team IDs",
    severity: "HIGH",
    threshold: 20, // Max 20% unlinked is acceptable
    check: async () => {
      // Get recent matches
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];

      const { count: total } = await supabase
        .from("match_results")
        .select("*", { count: "exact", head: true })
        .gte("created_at", yesterday);

      const { count: unlinked } = await supabase
        .from("match_results")
        .select("*", { count: "exact", head: true })
        .gte("created_at", yesterday)
        .is("home_team_id", null);

      const rate = total ? ((unlinked / total) * 100).toFixed(1) : 0;

      return {
        value: parseFloat(rate),
        details: { total, unlinked, rate: `${rate}%` },
      };
    },
    fix: null, // Run linkTeams.js manually
  },
  {
    id: "missing_scores",
    name: "Past Matches Missing Scores",
    description: "Completed matches (date < today) without scores",
    severity: "MEDIUM",
    threshold: 500, // Some schedule-only data is OK
    check: async () => {
      const today = new Date().toISOString().split("T")[0];

      const { count } = await supabase
        .from("match_results")
        .select("*", { count: "exact", head: true })
        .lt("match_date", today)
        .is("home_score", null);

      // Get breakdown by source
      const { data: bySource } = await supabase
        .from("match_results")
        .select("source_platform")
        .lt("match_date", today)
        .is("home_score", null);

      const breakdown = {};
      bySource?.forEach((m) => {
        const src = m.source_platform || "unknown";
        breakdown[src] = (breakdown[src] || 0) + 1;
      });

      return { value: count || 0, details: breakdown };
    },
    fix: null, // Need to scrape results
  },
  {
    id: "invalid_state",
    name: "Invalid State Codes",
    description: "Matches with non-standard state codes",
    severity: "LOW",
    threshold: 0,
    check: async () => {
      const VALID_STATES = [
        "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
        "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
        "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
        "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
        "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
        "DC",
      ];

      const { data } = await supabase
        .from("match_results")
        .select("state")
        .not("state", "is", null);

      const invalidStates = {};
      data?.forEach((m) => {
        if (!VALID_STATES.includes(m.state)) {
          invalidStates[m.state] = (invalidStates[m.state] || 0) + 1;
        }
      });

      return {
        value: Object.values(invalidStates).reduce((a, b) => a + b, 0),
        details: invalidStates,
      };
    },
    fix: null,
  },
  {
    id: "duplicate_teams",
    name: "Potential Duplicate Teams",
    description: "Teams with very similar names that may be duplicates",
    severity: "MEDIUM",
    threshold: 100, // Some duplicates are expected
    check: async () => {
      // Check for exact duplicate names
      const { data } = await supabase.rpc("find_duplicate_team_names").catch(
        () => ({ data: null })
      );

      // Fallback: basic check
      if (!data) {
        const { data: teams } = await supabase
          .from("teams")
          .select("team_name")
          .limit(5000);

        const names = teams?.map((t) => t.team_name.toLowerCase().trim()) || [];
        const seen = new Set();
        const duplicates = [];

        for (const name of names) {
          if (seen.has(name)) {
            duplicates.push(name);
          }
          seen.add(name);
        }

        return {
          value: duplicates.length,
          details: duplicates.slice(0, 10),
        };
      }

      return { value: data?.length || 0, details: data?.slice(0, 10) };
    },
    fix: null, // Run deduplicateTeams.js
  },
  {
    id: "teams_zero_matches",
    name: "Teams with Zero Match Count",
    description: "Teams where matches_played = 0 but have linked matches",
    severity: "HIGH",
    threshold: 0,
    check: async () => {
      // This would require a complex query
      // For now, just check teams with 0 that were recently created
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];

      const { count } = await supabase
        .from("teams")
        .select("*", { count: "exact", head: true })
        .gte("created_at", yesterday)
        .eq("matches_played", 0);

      return {
        value: count || 0,
        details: { message: "Run syncMatchCounts.js to fix" },
      };
    },
    fix: null, // Run syncMatchCounts.js
  },
  {
    id: "source_distribution",
    name: "Match Source Distribution",
    description: "Distribution of matches by source platform",
    severity: "INFO",
    threshold: null, // Info only
    check: async () => {
      const { data } = await supabase
        .from("match_results")
        .select("source_platform");

      const distribution = {};
      data?.forEach((m) => {
        const src = m.source_platform || "unknown";
        distribution[src] = (distribution[src] || 0) + 1;
      });

      return {
        value: Object.keys(distribution).length,
        details: distribution,
      };
    },
    fix: null,
  },
  {
    id: "event_type_distribution",
    name: "Event Type Distribution",
    description: "Distribution of events by source_type (league vs tournament)",
    severity: "INFO",
    threshold: null,
    check: async () => {
      const { data } = await supabase
        .from("event_registry")
        .select("source_type");

      const distribution = {};
      data?.forEach((e) => {
        const type = e.source_type || "unknown";
        distribution[type] = (distribution[type] || 0) + 1;
      });

      return {
        value: Object.keys(distribution).length,
        details: distribution,
      };
    },
    fix: null,
  },
];

async function runQC() {
  console.log("\n" + "=".repeat(60));
  console.log("SOCCERVIEW NIGHTLY QC");
  console.log("=".repeat(60));
  console.log(`Date: ${new Date().toISOString()}`);
  console.log("=".repeat(60) + "\n");

  const results = [];
  let issueCount = 0;

  for (const check of QC_CHECKS) {
    console.log(`\n🔍 ${check.name}`);
    console.log(`   ${check.description}`);

    try {
      const result = await check.check();

      const passed =
        check.threshold === null ||
        (check.severity === "INFO"
          ? true
          : check.id === "recent_unlinked"
          ? result.value <= check.threshold
          : result.value <= check.threshold);

      const status = check.severity === "INFO" ? "ℹ️" : passed ? "✅" : "❌";

      console.log(`   ${status} Value: ${result.value}`);

      if (verbose && result.details) {
        console.log("   Details:", JSON.stringify(result.details, null, 2));
      }

      if (!passed && autoFix && check.fix) {
        console.log("   🔧 Attempting auto-fix...");
        const fixed = await check.fix(result.details);
        console.log(`   Fixed ${fixed} issues`);
      }

      results.push({
        id: check.id,
        name: check.name,
        severity: check.severity,
        value: result.value,
        threshold: check.threshold,
        passed,
        details: result.details,
      });

      if (!passed && check.severity !== "INFO") {
        issueCount++;
      }
    } catch (error) {
      console.log(`   ⚠️ Check failed: ${error.message}`);
      results.push({
        id: check.id,
        name: check.name,
        severity: check.severity,
        value: "ERROR",
        passed: false,
        error: error.message,
      });
      issueCount++;
    }
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("QC SUMMARY");
  console.log("=".repeat(60) + "\n");

  const critical = results.filter(
    (r) => r.severity === "CRITICAL" && !r.passed
  );
  const high = results.filter((r) => r.severity === "HIGH" && !r.passed);
  const medium = results.filter((r) => r.severity === "MEDIUM" && !r.passed);
  const low = results.filter((r) => r.severity === "LOW" && !r.passed);

  if (critical.length) {
    console.log(`🔴 CRITICAL: ${critical.length} issues`);
    critical.forEach((r) => console.log(`   - ${r.name}: ${r.value}`));
  }
  if (high.length) {
    console.log(`🟠 HIGH: ${high.length} issues`);
    high.forEach((r) => console.log(`   - ${r.name}: ${r.value}`));
  }
  if (medium.length) {
    console.log(`🟡 MEDIUM: ${medium.length} issues`);
    medium.forEach((r) => console.log(`   - ${r.name}: ${r.value}`));
  }
  if (low.length) {
    console.log(`🟢 LOW: ${low.length} issues`);
    low.forEach((r) => console.log(`   - ${r.name}: ${r.value}`));
  }

  console.log("\n" + "-".repeat(60));
  if (issueCount === 0) {
    console.log("✅ ALL QC CHECKS PASSED");
  } else {
    console.log(`⚠️ ${issueCount} ISSUES REQUIRE ATTENTION`);
  }
  console.log("-".repeat(60));

  // Generate report if requested
  if (generateReport) {
    const reportPath = `qc_report_${new Date().toISOString().split("T")[0]}.md`;
    const report = generateMarkdownReport(results, issueCount);
    fs.writeFileSync(reportPath, report);
    console.log(`\n📄 Report saved: ${reportPath}`);
  }

  return issueCount === 0;
}

function generateMarkdownReport(results, issueCount) {
  const date = new Date().toISOString();

  let report = `# Nightly QC Report - ${date.split("T")[0]}

## Summary
- **Date:** ${date}
- **Issues Found:** ${issueCount}

## Check Results

| Check | Severity | Value | Threshold | Status |
|-------|----------|-------|-----------|--------|
`;

  for (const r of results) {
    const status = r.passed ? "✅ PASS" : r.severity === "INFO" ? "ℹ️ INFO" : "❌ FAIL";
    report += `| ${r.name} | ${r.severity} | ${r.value} | ${r.threshold || "N/A"} | ${status} |\n`;
  }

  report += `
## Details

`;

  for (const r of results) {
    if (!r.passed && r.details) {
      report += `### ${r.name}
\`\`\`json
${JSON.stringify(r.details, null, 2)}
\`\`\`

`;
    }
  }

  report += `
## Recommendations

`;

  const critical = results.filter((r) => r.severity === "CRITICAL" && !r.passed);
  if (critical.length) {
    report += `### Critical (Fix Immediately)
`;
    for (const r of critical) {
      report += `- **${r.name}**: ${getRecommendation(r.id)}
`;
    }
  }

  return report;
}

function getRecommendation(checkId) {
  const recommendations = {
    orphaned_events:
      "Run event registry fix or manually add missing events to event_registry table",
    recent_unlinked: "Run `node scripts/linkTeams.js` to link new matches",
    missing_scores: "Re-scrape source to get updated scores",
    duplicate_teams: "Run `node scripts/deduplicateTeams.js` to merge duplicates",
    teams_zero_matches: "Run `node scripts/syncMatchCounts.js` to update counts",
  };
  return recommendations[checkId] || "Review manually";
}

// Run
runQC()
  .then((passed) => {
    process.exit(passed ? 0 : 1);
  })
  .catch((err) => {
    console.error("QC failed:", err);
    process.exit(1);
  });
