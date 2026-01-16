/**
 * SoccerView - GotSport Rankings API Scraper v7 - FULL DATA IMPORT
 *
 * Uses the correct search parameter format discovered:
 * ?search[team_country]=USA&search[age]=13&search[gender]=m&search[page]=1
 *
 * This unlocks access to 100,000+ teams across all age groups!
 *
 * v7 CHANGES:
 * - Fixed importToSupabase to include ALL GotSport fields (national_rank, goals, awards, etc.)
 * - Fixed saveResults to include ALL fields in supabase JSON export
 * - Added sample record logging after import for verification
 *
 * Usage:
 *   node scripts/scrape_gotsport_rankings.js                    # Scrape all
 *   node scripts/scrape_gotsport_rankings.js --ages U13,U14     # Specific ages
 *   node scripts/scrape_gotsport_rankings.js --genders Boys     # Specific gender
 *   node scripts/scrape_gotsport_rankings.js --state CA         # Specific state
 *   node scripts/scrape_gotsport_rankings.js --import           # Import to Supabase
 *   node scripts/scrape_gotsport_rankings.js --max-pages 5      # Limit pages per category
 */

import { createClient } from "@supabase/supabase-js";
import "dotenv/config";
import fs from "fs";

// ============================================================
// CONFIGURATION
// ============================================================

const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const supabase =
  SUPABASE_URL && SUPABASE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_KEY)
    : null;

// GotSport Rankings API endpoint - THE CORRECT FORMAT!
const API_URL = "https://system.gotsport.com/api/v1/team_ranking_data";

// Age groups (U10-U19 = ages 10-19)
const AGE_GROUPS = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];

// Genders
const GENDERS = [
  { code: "m", label: "Boys" },
  { code: "f", label: "Girls" },
];

// Rate limiting - be respectful
const DELAY_BETWEEN_REQUESTS = 1500; // 1.5 seconds between API calls

// Output directory
const OUTPUT_DIR = "gotsport_rankings_data";

// Default max pages per category (0 = unlimited)
const DEFAULT_MAX_PAGES = 0;

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message, level = "INFO") {
  const timestamp = new Date().toISOString().split("T")[1].split(".")[0];
  console.log(`[${timestamp}] [${level}] ${message}`);
}

// Map state association codes to state abbreviations
const STATE_ASSOCIATION_MAP = {
  CTE: "CT",
  EMA: "MA",
  ME: "ME",
  NHE: "NH",
  NYE: "NY",
  PAE: "PA",
  RIE: "RI",
  VTE: "VT",
  WVE: "WV",
  ILE: "IL",
  INE: "IN",
  MIE: "MI",
  OHN: "OH",
  OHS: "OH",
  WIE: "WI",
  KYE: "KY",
  ALE: "AL",
  FLE: "FL",
  GAE: "GA",
  LAE: "LA",
  MSE: "MS",
  NCE: "NC",
  SCE: "SC",
  TNE: "TN",
  VAE: "VA",
  TXN: "TX",
  TXS: "TX",
  AKE: "AK",
  AZE: "AZ",
  CAL: "CA",
  CAN: "CA",
  CAS: "CA",
  COE: "CO",
  HIE: "HI",
  IDE: "ID",
  MTE: "MT",
  NVE: "NV",
  NME: "NM",
  ORE: "OR",
  UTE: "UT",
  WAE: "WA",
  WYE: "WY",
  DCE: "DC",
  MDE: "MD",
  NJE: "NJ",
  DEE: "DE",
  KSE: "KS",
  MOE: "MO",
  NEE: "NE",
  IAE: "IA",
  MNE: "MN",
  NDE: "ND",
  SDE: "SD",
  ARE: "AR",
  OKE: "OK",
};

function getStateFromAssociation(association) {
  if (!association) return null;
  if (STATE_ASSOCIATION_MAP[association]) {
    return STATE_ASSOCIATION_MAP[association];
  }
  // Try first 2 characters as state code
  const prefix = association.substring(0, 2).toUpperCase();
  if (/^[A-Z]{2}$/.test(prefix)) {
    return prefix;
  }
  return null;
}

// ============================================================
// API SCRAPER - THE CORRECT FORMAT!
// ============================================================

async function fetchRankingsPage(age, genderCode, page = 1, state = null) {
  // Build URL with search[] parameter format
  const params = new URLSearchParams();
  params.set("search[team_country]", "USA");
  params.set("search[age]", age.toString());
  params.set("search[gender]", genderCode);
  params.set("search[page]", page.toString());

  // Optional state filter
  if (state) {
    params.set("search[state]", state);
  }

  const url = `${API_URL}?${params.toString()}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Accept-Language": "en-US,en;q=0.5",
        Connection: "keep-alive",
        Origin: "https://rankings.gotsport.com",
        Referer: "https://rankings.gotsport.com/",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-site",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
        "sec-ch-ua": '"Chromium";v="144", "Not A(Brand";v="99"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    // API returns { team_ranking_data: [...], pagination: {...} }
    return {
      teams: data.team_ranking_data || [],
      pagination: data.pagination || {
        current_page: 1,
        total_pages: 1,
        total_count: 0,
      },
    };
  } catch (error) {
    log(
      `Error fetching U${age} ${genderCode} page ${page}: ${error.message}`,
      "ERROR",
    );
    return {
      teams: [],
      pagination: { current_page: 1, total_pages: 1, total_count: 0 },
    };
  }
}

// Fetch all pages for a category
async function fetchAllPagesForCategory(
  age,
  genderCode,
  maxPages = 0,
  state = null,
) {
  const allTeams = [];
  let page = 1;
  let totalPages = 1;
  let totalCount = 0;

  // First fetch to get pagination info
  const firstResult = await fetchRankingsPage(age, genderCode, 1, state);

  if (firstResult.teams.length === 0) {
    return allTeams;
  }

  allTeams.push(...firstResult.teams);
  totalPages = firstResult.pagination.total_pages;
  totalCount = firstResult.pagination.total_count;

  log(
    `    Page 1/${totalPages}: ${firstResult.teams.length} teams (${totalCount} total in category)`,
  );

  // Determine how many pages to fetch
  const pagesToFetch =
    maxPages > 0 ? Math.min(maxPages, totalPages) : totalPages;

  // Fetch remaining pages
  for (page = 2; page <= pagesToFetch; page++) {
    await sleep(DELAY_BETWEEN_REQUESTS);

    const result = await fetchRankingsPage(age, genderCode, page, state);

    if (result.teams.length === 0) {
      break;
    }

    allTeams.push(...result.teams);
    log(
      `    Page ${page}/${totalPages}: ${result.teams.length} teams (collected: ${allTeams.length})`,
    );
  }

  if (pagesToFetch < totalPages) {
    log(
      `    ⚠ Stopped at page ${pagesToFetch}/${totalPages} (use --max-pages 0 for all)`,
    );
  }

  return allTeams;
}

// Main scraping function
async function scrapeAllRankings(options = {}) {
  const {
    ages = AGE_GROUPS,
    genders = GENDERS,
    maxPages = DEFAULT_MAX_PAGES,
    state = null,
  } = options;

  log("═".repeat(70));
  log("🎉 GOTSPORT RANKINGS API SCRAPER v7 - FULL DATA IMPORT! 🎉");
  log("═".repeat(70));
  log(`API: ${API_URL}`);
  log(`Parameter format: search[age], search[gender], search[page]`);
  log(`Age groups: U${ages.join(", U")}`);
  log(`Genders: ${genders.map((g) => g.label).join(", ")}`);
  log(`Max pages per category: ${maxPages || "unlimited"}`);
  log(`State filter: ${state || "None (all states)"}`);
  log("");

  const allTeams = [];
  const seenIds = new Set();
  let totalCombinations = ages.length * genders.length;
  let count = 0;

  for (const gender of genders) {
    for (const age of ages) {
      count++;
      const ageLabel = `U${age}`;
      log(
        `[${count}/${totalCombinations}] Fetching ${gender.label} ${ageLabel}...`,
      );

      const teams = await fetchAllPagesForCategory(
        age,
        gender.code,
        maxPages,
        state,
      );

      if (teams.length > 0) {
        // Transform and deduplicate
        let added = 0;
        for (const team of teams) {
          if (!seenIds.has(team.id)) {
            seenIds.add(team.id);
            allTeams.push(transformTeam(team, gender.label));
            added++;
          }
        }
        log(
          `  ✓ Total: ${teams.length} teams, ${added} new (${seenIds.size} unique total)`,
        );
      } else {
        log(`  ⚠ No teams found`, "WARN");
      }

      await sleep(DELAY_BETWEEN_REQUESTS);
    }
  }

  // Summary
  log("");
  log("═".repeat(70));
  log("🏆 SCRAPING COMPLETE - GOLDMINE UNLOCKED! 🏆");
  log("═".repeat(70));
  log(`Total unique teams collected: ${allTeams.length}`);

  // Breakdown by age/gender
  const summary = {};
  allTeams.forEach((t) => {
    const key = `${t.gender} ${t.age_group}`;
    summary[key] = (summary[key] || 0) + 1;
  });
  log("\nBreakdown by category:");
  Object.entries(summary)
    .sort()
    .forEach(([key, count]) => {
      log(`  ${key}: ${count} teams`);
    });

  // Breakdown by state
  const byState = {};
  allTeams.forEach((t) => {
    const st = t.state || "Unknown";
    byState[st] = (byState[st] || 0) + 1;
  });
  log("\nTop states:");
  Object.entries(byState)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .forEach(([state, count]) => {
      log(`  ${state}: ${count} teams`);
    });

  return allTeams;
}

// Transform API team to our format
function transformTeam(team, genderLabel) {
  const ageGroup = `U${team.age}`;

  return {
    gotsport_id: team.id,
    gotsport_team_id: team.team_id,
    age_group: ageGroup,
    gender: genderLabel,
    gender_code: team.gender,

    club_name: team.club_name?.trim() || "",
    team_name: team.team_name?.trim() || "",
    full_name:
      `${team.club_name?.trim() || ""} ${team.team_name?.trim() || ""} (${ageGroup} ${genderLabel})`.trim(),

    // Rankings
    total_points: team.total_points,
    national_rank: team.national_rank,
    global_rank: team.global_rank,
    regional_rank: team.regional_rank,
    association_rank: team.association_rank,

    // Stats
    total_wins: team.total_wins,
    total_losses: team.total_losses,
    total_draws: team.total_draws,
    total_matches: team.total_matches,
    win_percent: parseFloat(team.win_percent) || 0,
    total_goals: team.total_goals,
    total_goals_against: team.total_goals_against,

    // Location
    team_country: team.team_country,
    team_association: team.team_association,
    team_region: team.team_region,
    state: getStateFromAssociation(team.team_association),

    // Awards
    national_award: team.national_award?.tooltip || null,
    regional_award: team.regional_award?.tooltip || null,
    state_cup_award: team.state_cup_award?.tooltip || null,

    // Metadata
    ranking_date: team.ranking_date,
    logo_url: team.logo_url_full
      ? `https://system.gotsport.com${team.logo_url_full}`
      : null,
    source: "gotsport_rankings_api_v7",
    scraped_at: new Date().toISOString(),
  };
}

// ============================================================
// SAVE RESULTS - v7 FIXED: Includes ALL GotSport fields
// ============================================================

async function saveResults(teams) {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().split("T")[0].replace(/-/g, "_");

  // Save full data
  const fullFile = `${OUTPUT_DIR}/gotsport_rankings_full_${timestamp}.json`;
  fs.writeFileSync(fullFile, JSON.stringify(teams, null, 2));
  log(`\nSaved: ${fullFile}`);

  // Save Supabase-ready format - v7 FIXED: ALL FIELDS INCLUDED!
  const supabaseTeams = teams.map((t) => ({
    // Basic fields
    team_name: t.full_name.substring(0, 255),
    elo_rating: 1500 + Math.round((t.total_points || 0) / 100),
    matches_played: t.total_matches || 0,
    wins: t.total_wins || 0,
    losses: t.total_losses || 0,
    draws: t.total_draws || 0,
    state: t.state,
    gender: t.gender,
    age_group: t.age_group,

    // GotSport-specific fields (v7 FIX!)
    gotsport_id: t.gotsport_id || null,
    gotsport_team_id: t.gotsport_team_id || null,
    national_rank: t.national_rank || null,
    regional_rank: t.regional_rank || null,
    state_rank: t.association_rank || null, // association_rank = state rank
    gotsport_points: t.total_points || null,
    goals_for: t.total_goals || null,
    goals_against: t.total_goals_against || null,
    win_percent: t.win_percent || null,
    club_name: t.club_name || null,
    logo_url: t.logo_url || null,
    national_award: t.national_award || null,
    regional_award: t.regional_award || null,
    state_cup_award: t.state_cup_award || null,
    ranking_date: t.ranking_date || null,
    source_name: "gotsport_rankings",
  }));

  const supabaseFile = `${OUTPUT_DIR}/gotsport_rankings_supabase_${timestamp}.json`;
  fs.writeFileSync(supabaseFile, JSON.stringify(supabaseTeams, null, 2));
  log(`Saved: ${supabaseFile}`);

  // Save CSV
  const csvHeader =
    "national_rank,team_name,club_name,age_group,gender,state,points,wins,losses,draws,matches,goals_for,goals_against\n";
  const csvRows = teams
    .sort((a, b) => {
      if (a.age_group !== b.age_group)
        return a.age_group.localeCompare(b.age_group);
      if (a.gender !== b.gender) return a.gender.localeCompare(b.gender);
      return (a.national_rank || 99999) - (b.national_rank || 99999);
    })
    .map((t) =>
      [
        t.national_rank || "",
        `"${t.full_name.replace(/"/g, '""')}"`,
        `"${(t.club_name || "").replace(/"/g, '""')}"`,
        t.age_group,
        t.gender,
        t.state || "",
        t.total_points || 0,
        t.total_wins || 0,
        t.total_losses || 0,
        t.total_draws || 0,
        t.total_matches || 0,
        t.total_goals || 0,
        t.total_goals_against || 0,
      ].join(","),
    )
    .join("\n");

  const csvFile = `${OUTPUT_DIR}/gotsport_rankings_${timestamp}.csv`;
  fs.writeFileSync(csvFile, csvHeader + csvRows);
  log(`Saved: ${csvFile}`);

  return { fullFile, supabaseFile, csvFile };
}

// ============================================================
// IMPORT TO SUPABASE - v7 FIXED: Includes ALL GotSport fields
// ============================================================

async function importToSupabase(teams) {
  if (!supabase) {
    log("\nSupabase not configured - skipping import", "WARN");
    log("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env");
    return;
  }

  log("\n" + "─".repeat(50));
  log("📥 IMPORTING TO SUPABASE (v7 - Full GotSport Data)");
  log("─".repeat(50));

  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

  const records = teams.map((t) => ({
    // Basic fields
    team_name: t.full_name.substring(0, 255),
    elo_rating: 1500 + Math.round((t.total_points || 0) / 100),
    matches_played: t.total_matches || 0,
    wins: t.total_wins || 0,
    losses: t.total_losses || 0,
    draws: t.total_draws || 0,
    state: t.state,
    gender: t.gender,
    age_group: t.age_group,

    // GotSport-specific fields (v7 FIX - THE CRITICAL ADDITION!)
    gotsport_id: t.gotsport_id || null,
    gotsport_team_id: t.gotsport_team_id || null,
    national_rank: t.national_rank || null,
    regional_rank: t.regional_rank || null,
    state_rank: t.association_rank || null, // association_rank = state rank
    gotsport_points: t.total_points || null,
    goals_for: t.total_goals || null,
    goals_against: t.total_goals_against || null,
    win_percent: t.win_percent || null,
    club_name: t.club_name || null,
    logo_url: t.logo_url || null,
    national_award: t.national_award || null,
    regional_award: t.regional_award || null,
    state_cup_award: t.state_cup_award || null,
    ranking_date: today,
    source_name: "gotsport_rankings",
    updated_at: new Date().toISOString(),
  }));

  // Batch upsert
  const BATCH_SIZE = 50;
  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);

    const { data, error } = await supabase.from("team_elo").upsert(batch, {
      onConflict: "team_name",
      ignoreDuplicates: false,
    });

    if (error) {
      // Try one by one for this batch
      for (const record of batch) {
        const { error: singleError } = await supabase
          .from("team_elo")
          .upsert(record, { onConflict: "team_name" });

        if (singleError) {
          errors++;
          // Log first few errors for debugging
          if (errors <= 3) {
            log(
              `  Error on ${record.team_name}: ${singleError.message}`,
              "ERROR",
            );
          }
        } else {
          inserted++;
        }
      }
    } else {
      inserted += batch.length;
    }

    process.stdout.write(
      `\r  Progress: ${inserted + errors}/${records.length} (${errors} errors)...`,
    );
    await sleep(100);
  }

  log(`\n  ✓ Complete: ${inserted} teams imported, ${errors} errors`);

  // v7: Show sample record to verify fields are populated
  if (records.length > 0) {
    log("\n  📋 Sample record (verify fields populated):");
    const sample = records[0];
    log(`     Team: ${sample.team_name}`);
    log(`     National Rank: ${sample.national_rank}`);
    log(`     Regional Rank: ${sample.regional_rank}`);
    log(`     State Rank: ${sample.state_rank}`);
    log(`     GotSport Points: ${sample.gotsport_points}`);
    log(`     Goals For/Against: ${sample.goals_for}/${sample.goals_against}`);
    log(`     Win %: ${sample.win_percent}`);
    log(`     Logo URL: ${sample.logo_url ? "Yes" : "None"}`);
    log(
      `     Awards: ${sample.national_award || sample.regional_award || sample.state_cup_award || "None"}`,
    );
  }
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  const args = process.argv.slice(2);

  // Parse options
  const options = {
    ages: AGE_GROUPS,
    genders: GENDERS,
    maxPages: DEFAULT_MAX_PAGES,
    state: null,
    doImport: args.includes("--import"),
  };

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--ages" && args[i + 1]) {
      options.ages = args[i + 1]
        .split(",")
        .map((a) => {
          const num = parseInt(a.replace(/[Uu]/g, ""));
          return isNaN(num) ? null : num;
        })
        .filter(Boolean);
      i++;
    } else if (args[i] === "--genders" && args[i + 1]) {
      const g = args[i + 1].toLowerCase();
      if (g.includes("boy") || g === "m" || g === "male") {
        options.genders = [{ code: "m", label: "Boys" }];
      } else if (g.includes("girl") || g === "f" || g === "female") {
        options.genders = [{ code: "f", label: "Girls" }];
      }
      i++;
    } else if (args[i] === "--state" && args[i + 1]) {
      options.state = args[i + 1].toUpperCase();
      i++;
    } else if (args[i] === "--max-pages" && args[i + 1]) {
      options.maxPages = parseInt(args[i + 1]) || 0;
      i++;
    } else if (args[i] === "--help") {
      console.log(`
🎉 GotSport Rankings API Scraper v7 - FULL DATA IMPORT! 🎉

This scraper uses the correct search[] parameter format to access
the full GotSport rankings database of 100,000+ teams!

v7 includes ALL GotSport fields: national_rank, goals, awards, logos, etc.

Usage:
  node scripts/scrape_gotsport_rankings.js [options]

Options:
  --ages U12,U13,U14     Specific age groups (default: U10-U19)
  --genders Boys         Boys, Girls, or both (default: both)
  --state CA             Filter by state abbreviation
  --max-pages 5          Limit pages per category (default: unlimited)
  --import               Import results to Supabase
  --help                 Show this help message

Examples:
  # Quick test - just Boys U13, first 2 pages
  node scripts/scrape_gotsport_rankings.js --ages U13 --genders Boys --max-pages 2

  # Full scrape of one age group
  node scripts/scrape_gotsport_rankings.js --ages U13 --import

  # Full nationwide scrape (will take ~2-3 hours)
  node scripts/scrape_gotsport_rankings.js --import

  # Scrape specific state
  node scripts/scrape_gotsport_rankings.js --state TX --import
`);
      return;
    }
  }

  try {
    // Scrape rankings
    const teams = await scrapeAllRankings(options);

    if (teams.length > 0) {
      // Save results
      await saveResults(teams);

      // Import to Supabase if requested
      if (options.doImport) {
        await importToSupabase(teams);
      } else {
        log("\n💡 Tip: Add --import flag to import to Supabase");
      }
    } else {
      log("\n⚠ No teams collected", "WARN");
    }
  } catch (error) {
    log(`Fatal error: ${error.message}`, "ERROR");
    console.error(error);
    process.exit(1);
  }
}

main();
