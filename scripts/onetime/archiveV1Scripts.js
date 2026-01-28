/**
 * Archive V1 Scripts
 * ==================
 * Moves deprecated V1 linking/reconciliation scripts to _archive folder.
 * Run this ONCE after confirming V2 architecture is working.
 *
 * Usage:
 *   node scripts/archiveV1Scripts.js --dry-run   # Preview what will be moved
 *   node scripts/archiveV1Scripts.js             # Actually move the files
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCRIPTS_DIR = __dirname;
const ARCHIVE_DIR = path.join(__dirname, "_archive");

// Scripts to archive (replaced by validationPipeline.js or obsolete with V2)
const SCRIPTS_TO_ARCHIVE = [
  // Linking scripts
  "fastLink.js",
  "fastLinkV2.js",
  "fastLinkV3.js",
  "fastLinkV3_resume.js",
  "fastLinkV3Parallel.js",
  "linkTeams.js",
  "linkTeamsV2.js",
  "linkTeamsV5.js",
  "bulkLinkTeams.js",
  "batchFuzzyLink.js",
  "indexedFuzzyLink.js",
  "fastNormalizedLink.js",
  "chunkedLink.js",
  "fixedLinkTeams.js",
  "linkMatchesComprehensive.js",
  "linkMatchesFast.js",
  "linkMatchesBatched.js",
  "linkViaAliases.js",
  "linkHeartlandMatches.js",
  "linkHeartlandMatchesV2.js",

  // Reconciliation scripts
  "reconcileRankedTeams.js",
  "reconcileRankedTeamsParallel.js",
  "reconcileFast.js",
  "reconcilePureSQL.js",

  // Alias management scripts
  "populateAliases.js",
  "createAliasIndex.js",
  "addColorRemovedAliases.js",
  "setupLinkingInfrastructure.js",
  "cleanupYearMismatchAliases.js",

  // Integration scripts
  "integrateHeartlandTeams.js",
  "runIntegrationPipeline.js",

  // Fix scripts
  "fixMislinkedTeams.js",
  "fixDuplicateTeamNames.js",
  "fixDuplicateTeamNamesV2.js",
  "fixMislinkedMatches.js",
  "findMislinkedMatches.js",
  "unlinkYearMismatches.js",
  "fixTeamDataIntegrity.js",
  "verifyLinkFix.js",

  // Diagnostic scripts (V1 specific)
  "checkLinkingStatus.js",
  "checkReconcileStatus.js",

  // Legacy ELO (V2 is recalculate_elo_v2.js)
  "recalculate_elo.js",

  // Deduplication (handled by V2 architecture)
  "deduplicateTeams.js",

  // Transfer/sync scripts (obsolete)
  "transferRankings.js",
  "syncMatchCounts.js",
];

const isDryRun = process.argv.includes("--dry-run");

async function main() {
  console.log("═".repeat(60));
  console.log("Archive V1 Scripts to _archive folder");
  console.log("═".repeat(60));
  console.log(`Mode: ${isDryRun ? "DRY RUN (no changes)" : "LIVE"}`);
  console.log("");

  // Ensure archive directory exists
  if (!fs.existsSync(ARCHIVE_DIR)) {
    if (!isDryRun) {
      fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
    }
    console.log(`Created archive directory: ${ARCHIVE_DIR}`);
  }

  const moved = [];
  const notFound = [];
  const errors = [];

  console.log("📦 Processing scripts...");
  console.log("-".repeat(40));

  for (const script of SCRIPTS_TO_ARCHIVE) {
    const sourcePath = path.join(SCRIPTS_DIR, script);
    const destPath = path.join(ARCHIVE_DIR, script);

    if (!fs.existsSync(sourcePath)) {
      notFound.push(script);
      continue;
    }

    if (isDryRun) {
      console.log(`  Would move: ${script}`);
      moved.push(script);
    } else {
      try {
        // Move file
        fs.renameSync(sourcePath, destPath);
        console.log(`  ✓ Moved: ${script}`);
        moved.push(script);
      } catch (e) {
        console.log(`  ✗ Error moving ${script}: ${e.message}`);
        errors.push({ script, error: e.message });
      }
    }
  }

  console.log("");
  console.log("═".repeat(60));
  console.log("📊 Summary");
  console.log("═".repeat(60));
  console.log(`  ${isDryRun ? "Would move" : "Moved"}: ${moved.length} scripts`);
  console.log(`  Not found (already archived?): ${notFound.length} scripts`);
  if (errors.length > 0) {
    console.log(`  Errors: ${errors.length} scripts`);
  }

  if (notFound.length > 0) {
    console.log("");
    console.log("Not found:");
    notFound.forEach((s) => console.log(`  - ${s}`));
  }

  if (errors.length > 0) {
    console.log("");
    console.log("Errors:");
    errors.forEach((e) => console.log(`  - ${e.script}: ${e.error}`));
  }

  console.log("");
  if (isDryRun) {
    console.log("This was a dry run. Run without --dry-run to actually move files.");
  } else {
    console.log("✅ Archival complete!");
    console.log(`   Scripts moved to: ${ARCHIVE_DIR}`);
    console.log("   See _archive/README.md for documentation.");
  }
}

main().catch((e) => {
  console.error("Fatal error:", e.message);
  process.exit(1);
});
