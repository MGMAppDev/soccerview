/**
 * ============================================================
 * SOCCERVIEW DATABASE RESTRUCTURE - INCLUSIVE MIGRATION
 * Migration 018: Re-migrate ALL teams and matches
 *
 * Purpose: Fix the data loss from the original migration that
 * excluded teams without parseable birth_year/gender.
 *
 * Strategy:
 *   1. Include ALL teams from v1 (not just parseable ones)
 *   2. Set birth_year/gender to NULL if not parseable
 *   3. Track data source (parsed/inferred/official/unknown)
 *   4. Calculate quality scores
 *   5. Migrate ALL linked matches
 *
 * Created: January 28, 2026 (Session 49 - Data Strategy Redesign)
 * ============================================================
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ============================================================
// PARSING UTILITIES
// ============================================================

/**
 * Improved birth year parser with multiple patterns
 */
function parseBirthYear(teamName) {
  if (!teamName) return { value: null, source: 'unknown' };

  // Pattern 1: Explicit 4-digit year (2008-2020)
  const yearMatch = teamName.match(/\b(20(?:0[89]|1[0-9]|20))\b/);
  if (yearMatch) {
    return { value: parseInt(yearMatch[1], 10), source: 'parsed' };
  }

  // Pattern 2: 2-digit year prefix (e.g., "08", "15")
  const shortYearMatch = teamName.match(/\b(0[5-9]|1[0-9]|20)[BG]?\b/);
  if (shortYearMatch) {
    const year = parseInt(shortYearMatch[1], 10);
    const fullYear = year + 2000;
    if (fullYear >= 2005 && fullYear <= 2020) {
      return { value: fullYear, source: 'parsed' };
    }
  }

  // Pattern 3: Age group (U9-U19) - infer from current year
  const ageMatch = teamName.match(/U(\d{1,2})\b/i);
  if (ageMatch) {
    const age = parseInt(ageMatch[1], 10);
    if (age >= 5 && age <= 19) {
      const currentYear = new Date().getFullYear();
      const birthYear = currentYear - age + 1;
      return { value: birthYear, source: 'inferred' };
    }
  }

  return { value: null, source: 'unknown' };
}

/**
 * Improved gender parser with multiple patterns
 */
function parseGender(teamName) {
  if (!teamName) return { value: null, source: 'unknown' };

  const patterns = {
    M: [
      /\bboys?\b/i,
      /\bmen\b/i,
      /\bmale\b/i,
      /\(B\)/,
      /\sB$/,
      /\sB\s/,
      /U\d+B\b/,
      /B\d{2,4}\b/,
      /'?s Boys/i,
    ],
    F: [
      /\bgirls?\b/i,
      /\bwomen\b/i,
      /\bfemale\b/i,
      /\(G\)/,
      /\sG$/,
      /\sG\s/,
      /U\d+G\b/,
      /G\d{2,4}\b/,
      /'?s Girls/i,
    ]
  };

  for (const p of patterns.M) {
    if (p.test(teamName)) return { value: 'M', source: 'parsed' };
  }

  for (const p of patterns.F) {
    if (p.test(teamName)) return { value: 'F', source: 'parsed' };
  }

  return { value: null, source: 'unknown' };
}

/**
 * Calculate age group from birth year
 */
function calculateAgeGroup(birthYear) {
  if (!birthYear) return null;
  const currentYear = new Date().getFullYear();
  const age = currentYear - birthYear + 1;
  return `U${age}`;
}

/**
 * Normalize team name to canonical form
 */
function normalizeTeamName(name) {
  if (!name) return null;
  return name
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s-]/g, '')
    .trim();
}

/**
 * Extract club name from team name
 */
function extractClubName(teamName) {
  if (!teamName) return null;

  // Common patterns to remove to get club name
  const suffixPatterns = [
    /\s+\d{2,4}[BG]?\s*$/i,          // Year suffix (2015, 15B, etc.)
    /\s+U\d{1,2}\s*(boys?|girls?)?$/i, // Age group (U11 Boys)
    /\s+\(U\d{1,2}\s*(boys?|girls?)\)$/i, // (U11 Boys)
    /\s+(boys?|girls?|men|women)$/i,  // Gender suffix
    /\s+(elite|premier|select|academy|pre-?ecnl|ecnl|ga|mls\s*next).*$/i, // Program names
    /\s+[IVX]+$/,                      // Roman numerals
    /\s+(red|blue|white|black|gold|green|orange|navy|silver)$/i, // Colors
  ];

  let clubName = teamName;
  for (const pattern of suffixPatterns) {
    clubName = clubName.replace(pattern, '');
  }

  return clubName.trim() || null;
}

// ============================================================
// MIGRATION FUNCTIONS
// ============================================================

/**
 * Get or create club
 */
async function getOrCreateClub(clubName, state) {
  if (!clubName) return null;

  // Check if club exists
  const { data: existing } = await supabase
    .from('clubs')
    .select('id')
    .eq('name', clubName)
    .eq('state', state || '')
    .single();

  if (existing) return existing.id;

  // Create new club
  const { data: newClub, error } = await supabase
    .from('clubs')
    .insert({
      name: clubName,
      state: state,
      created_at: new Date().toISOString()
    })
    .select('id')
    .single();

  if (error) {
    console.log(`Warning: Could not create club "${clubName}":`, error.message);
    return null;
  }

  return newClub?.id || null;
}

/**
 * Migrate a single team from v1 to v2 (INCLUSIVE - never skip)
 */
async function migrateTeam(v1Team, stats) {
  const teamName = v1Team.team_name;

  // Parse metadata - BUT DON'T SKIP IF UNPARSEABLE
  const birthYearResult = parseBirthYear(teamName);
  const genderResult = parseGender(teamName);
  const ageGroup = calculateAgeGroup(birthYearResult.value);
  const clubName = extractClubName(teamName);

  // Get or create club
  let clubId = null;
  if (clubName) {
    clubId = await getOrCreateClub(clubName, v1Team.state);
  }

  // Build team record - ALL TEAMS INCLUDED
  const teamRecord = {
    id: v1Team.id,
    canonical_name: normalizeTeamName(teamName),
    display_name: teamName,
    club_id: clubId,
    birth_year: birthYearResult.value,  // Can be NULL
    birth_year_source: birthYearResult.source,
    gender: genderResult.value,         // Can be NULL
    gender_source: genderResult.source,
    age_group: ageGroup,
    state: v1Team.state,
    elo_rating: v1Team.elo_rating || 1500,
    national_rank: v1Team.national_rank,
    state_rank: v1Team.state_rank,
    regional_rank: v1Team.regional_rank,
    gotsport_rank: v1Team.gotsport_rank,
    gotsport_points: v1Team.gotsport_points,
    wins: v1Team.wins || 0,
    losses: v1Team.losses || 0,
    draws: v1Team.draws || 0,
    matches_played: v1Team.matches_played || 0,
    goals_for: v1Team.goals_for || 0,
    goals_against: v1Team.goals_against || 0,
    known_aliases: v1Team.known_aliases || [],
    source_name: v1Team.source_name,
    data_flags: {
      needs_review: !birthYearResult.value || !genderResult.value,
    },
    created_at: v1Team.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  // Upsert to teams_v2
  const { error } = await supabase
    .from('teams_v2')
    .upsert(teamRecord, { onConflict: 'id' });

  if (error) {
    stats.errors++;
    if (stats.errors <= 10) {
      console.log(`Error migrating team ${v1Team.id}:`, error.message);
    }
    return false;
  }

  // Track stats
  if (birthYearResult.value && genderResult.value) {
    stats.complete++;
  } else if (birthYearResult.value || genderResult.value) {
    stats.partial++;
  } else {
    stats.incomplete++;
  }

  stats.migrated++;
  return true;
}

/**
 * Migrate teams in batches
 */
async function migrateAllTeams() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('         INCLUSIVE TEAM MIGRATION - ZERO DATA LOSS             ');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const stats = {
    migrated: 0,
    complete: 0,
    partial: 0,
    incomplete: 0,
    errors: 0
  };

  // Get total count
  const { count: totalTeams } = await supabase
    .from('teams')
    .select('*', { count: 'exact', head: true });

  console.log(`Total teams to migrate: ${totalTeams.toLocaleString()}\n`);

  // Process in batches
  const batchSize = 500;
  let offset = 0;
  let batch = 1;

  while (offset < totalTeams) {
    const { data: teams, error } = await supabase
      .from('teams')
      .select('*')
      .range(offset, offset + batchSize - 1)
      .order('id');

    if (error) {
      console.log('Error fetching batch:', error.message);
      break;
    }

    if (!teams || teams.length === 0) break;

    // Process batch
    for (const team of teams) {
      await migrateTeam(team, stats);
    }

    // Progress
    const progress = Math.round((offset + teams.length) / totalTeams * 100);
    console.log(`Batch ${batch}: ${offset + teams.length}/${totalTeams} (${progress}%) | Complete: ${stats.complete} | Partial: ${stats.partial} | Incomplete: ${stats.incomplete}`);

    offset += batchSize;
    batch++;

    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 100));
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                    TEAM MIGRATION COMPLETE                     ');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`\nResults:`);
  console.log(`  Total migrated:     ${stats.migrated.toLocaleString()}`);
  console.log(`  Complete metadata:  ${stats.complete.toLocaleString()} (${(stats.complete/stats.migrated*100).toFixed(1)}%)`);
  console.log(`  Partial metadata:   ${stats.partial.toLocaleString()} (${(stats.partial/stats.migrated*100).toFixed(1)}%)`);
  console.log(`  Incomplete:         ${stats.incomplete.toLocaleString()} (${(stats.incomplete/stats.migrated*100).toFixed(1)}%)`);
  console.log(`  Errors:             ${stats.errors}`);

  return stats;
}

/**
 * Migrate all matches
 */
async function migrateAllMatches() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('         INCLUSIVE MATCH MIGRATION - ZERO DATA LOSS            ');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Get v2 team IDs for link verification
  console.log('Building v2 team ID set...');
  const v2IdSet = new Set();
  let offset = 0;

  while (true) {
    const { data: v2Ids } = await supabase
      .from('teams_v2')
      .select('id')
      .range(offset, offset + 1000 - 1);

    if (!v2Ids || v2Ids.length === 0) break;
    v2Ids.forEach(t => v2IdSet.add(t.id));
    offset += 1000;
  }

  console.log(`V2 team IDs: ${v2IdSet.size.toLocaleString()}\n`);

  // Get total matches with linked teams
  const { count: totalMatches } = await supabase
    .from('match_results')
    .select('*', { count: 'exact', head: true })
    .not('home_team_id', 'is', null)
    .not('away_team_id', 'is', null);

  console.log(`Total linked matches in v1: ${totalMatches.toLocaleString()}\n`);

  const stats = {
    migrated: 0,
    fullLink: 0,
    partialLink: 0,
    errors: 0
  };

  // Process in batches
  const batchSize = 500;
  offset = 0;
  let batch = 1;

  while (offset < totalMatches) {
    const { data: matches, error } = await supabase
      .from('match_results')
      .select('*')
      .not('home_team_id', 'is', null)
      .not('away_team_id', 'is', null)
      .range(offset, offset + batchSize - 1)
      .order('id');

    if (error) {
      console.log('Error fetching match batch:', error.message);
      break;
    }

    if (!matches || matches.length === 0) break;

    // Build batch of match records
    const matchRecords = [];

    for (const match of matches) {
      const homeInV2 = v2IdSet.has(match.home_team_id);
      const awayInV2 = v2IdSet.has(match.away_team_id);

      let linkStatus = 'unlinked';
      if (homeInV2 && awayInV2) {
        linkStatus = 'full';
        stats.fullLink++;
      } else if (homeInV2 || awayInV2) {
        linkStatus = 'partial';
        stats.partialLink++;
      }

      // Only migrate matches where BOTH teams are in v2
      if (linkStatus === 'full') {
        matchRecords.push({
          id: match.id,
          match_date: match.match_date,
          match_time: match.match_time,
          home_team_id: match.home_team_id,
          away_team_id: match.away_team_id,
          home_score: match.home_score || 0,
          away_score: match.away_score || 0,
          league_id: match.league_id,
          tournament_id: match.tournament_id,
          source_platform: match.source_platform,
          source_match_key: match.source_match_key,
          link_status: linkStatus,
          created_at: match.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      }
    }

    // Bulk upsert
    if (matchRecords.length > 0) {
      const { error: upsertError } = await supabase
        .from('matches_v2')
        .upsert(matchRecords, { onConflict: 'id' });

      if (upsertError) {
        console.log('Error upserting matches:', upsertError.message);
        stats.errors += matchRecords.length;
      } else {
        stats.migrated += matchRecords.length;
      }
    }

    // Progress
    const progress = Math.round((offset + matches.length) / totalMatches * 100);
    console.log(`Batch ${batch}: ${offset + matches.length}/${totalMatches} (${progress}%) | Full link: ${stats.fullLink} | Partial: ${stats.partialLink}`);

    offset += batchSize;
    batch++;

    await new Promise(r => setTimeout(r, 50));
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                   MATCH MIGRATION COMPLETE                     ');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`\nResults:`);
  console.log(`  Total migrated:   ${stats.migrated.toLocaleString()}`);
  console.log(`  Full link:        ${stats.fullLink.toLocaleString()}`);
  console.log(`  Partial link:     ${stats.partialLink.toLocaleString()} (not migrated - teams missing)`);
  console.log(`  Errors:           ${stats.errors}`);

  return stats;
}

/**
 * Verify migration results
 */
async function verifyMigration() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                    MIGRATION VERIFICATION                      ');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const { count: v1Teams } = await supabase.from('teams').select('*', { count: 'exact', head: true });
  const { count: v2Teams } = await supabase.from('teams_v2').select('*', { count: 'exact', head: true });
  const { count: v1Matches } = await supabase.from('match_results').select('*', { count: 'exact', head: true }).not('home_team_id', 'is', null).not('away_team_id', 'is', null);
  const { count: v2Matches } = await supabase.from('matches_v2').select('*', { count: 'exact', head: true });

  console.log('TEAMS:');
  console.log(`  V1: ${v1Teams.toLocaleString()}`);
  console.log(`  V2: ${v2Teams.toLocaleString()}`);
  console.log(`  Coverage: ${(v2Teams / v1Teams * 100).toFixed(1)}%`);

  console.log('\nMATCHES:');
  console.log(`  V1 (linked): ${v1Matches.toLocaleString()}`);
  console.log(`  V2: ${v2Matches.toLocaleString()}`);
  console.log(`  Coverage: ${(v2Matches / v1Matches * 100).toFixed(1)}%`);

  // Quality score distribution
  const { data: qualityDist } = await supabase
    .from('teams_v2')
    .select('data_quality_score')
    .order('data_quality_score');

  if (qualityDist) {
    const scores = qualityDist.map(t => t.data_quality_score);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const complete = scores.filter(s => s >= 60).length;

    console.log('\nDATA QUALITY:');
    console.log(`  Average score: ${avg.toFixed(1)}`);
    console.log(`  Complete (60+): ${complete.toLocaleString()} (${(complete / scores.length * 100).toFixed(1)}%)`);
  }
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║     SOCCERVIEW INCLUSIVE MIGRATION - SESSION 49               ║');
  console.log('║     Zero Data Loss Strategy Implementation                    ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  const startTime = Date.now();

  try {
    // Step 1: Migrate all teams
    await migrateAllTeams();

    // Step 2: Migrate all matches
    await migrateAllMatches();

    // Step 3: Verify
    await verifyMigration();

    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log(`\n✅ Migration complete in ${duration} minutes`);

  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

// Check for --dry-run flag
if (process.argv.includes('--dry-run')) {
  console.log('DRY RUN MODE - No changes will be made\n');
  // Just verify current state
  (async () => {
    await verifyMigration();
  })();
} else {
  main();
}
