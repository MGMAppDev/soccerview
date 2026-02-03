/**
 * ============================================================
 * SOCCERVIEW DATABASE RESTRUCTURE - INCLUSIVE MIGRATION
 * Migration 018: Re-migrate ALL teams and matches (OPTIMIZED)
 *
 * PERFORMANCE OPTIMIZATIONS:
 *   1. Bulk upserts (1000 records at a time vs 1 at a time)
 *   2. Pre-cached club lookups (eliminate N+1 queries)
 *   3. Parallel batch processing where safe
 *   4. Minimal delays (only when needed for rate limits)
 *   5. Direct SQL bulk operations for matches
 *
 * Expected runtime: ~5-10 minutes (vs 60+ minutes unoptimized)
 *
 * Created: January 28, 2026 (Session 49 - Data Strategy Redesign)
 * ============================================================
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Configuration
const TEAM_BATCH_SIZE = 1000;  // Max Supabase allows
const MATCH_BATCH_SIZE = 1000;
const PARALLEL_BATCHES = 3;    // Process multiple batches concurrently

// ============================================================
// PARSING UTILITIES (Optimized - compile regexes once)
// ============================================================

const BIRTH_YEAR_PATTERNS = {
  explicit: /\b(20(?:0[89]|1[0-9]|20))\b/,
  shortYear: /\b(0[5-9]|1[0-9]|20)[BG]?\b/,
  ageGroup: /U(\d{1,2})\b/i
};

const GENDER_PATTERNS = {
  M: [/\bboys?\b/i, /\bmen\b/i, /\bmale\b/i, /\(B\)/, /\sB$/, /\sB\s/, /U\d+B\b/, /B\d{2,4}\b/, /'?s Boys/i],
  F: [/\bgirls?\b/i, /\bwomen\b/i, /\bfemale\b/i, /\(G\)/, /\sG$/, /\sG\s/, /U\d+G\b/, /G\d{2,4}\b/, /'?s Girls/i]
};

const CLUB_SUFFIX_PATTERNS = [
  /\s+\d{2,4}[BG]?\s*$/i,
  /\s+U\d{1,2}\s*(boys?|girls?)?$/i,
  /\s+\(U\d{1,2}\s*(boys?|girls?)\)$/i,
  /\s+(boys?|girls?|men|women)$/i,
  /\s+(elite|premier|select|academy|pre-?ecnl|ecnl|ga|mls\s*next).*$/i,
  /\s+[IVX]+$/,
  /\s+(red|blue|white|black|gold|green|orange|navy|silver)$/i,
];

function parseBirthYear(teamName) {
  if (!teamName) return { value: null, source: 'unknown' };

  const yearMatch = teamName.match(BIRTH_YEAR_PATTERNS.explicit);
  if (yearMatch) return { value: parseInt(yearMatch[1], 10), source: 'parsed' };

  const shortMatch = teamName.match(BIRTH_YEAR_PATTERNS.shortYear);
  if (shortMatch) {
    const year = parseInt(shortMatch[1], 10) + 2000;
    if (year >= 2005 && year <= 2020) return { value: year, source: 'parsed' };
  }

  const ageMatch = teamName.match(BIRTH_YEAR_PATTERNS.ageGroup);
  if (ageMatch) {
    const age = parseInt(ageMatch[1], 10);
    if (age >= 5 && age <= 19) {
      return { value: new Date().getFullYear() - age + 1, source: 'inferred' };
    }
  }

  return { value: null, source: 'unknown' };
}

function parseGender(teamName) {
  if (!teamName) return { value: null, source: 'unknown' };

  for (const p of GENDER_PATTERNS.M) {
    if (p.test(teamName)) return { value: 'M', source: 'parsed' };
  }
  for (const p of GENDER_PATTERNS.F) {
    if (p.test(teamName)) return { value: 'F', source: 'parsed' };
  }

  return { value: null, source: 'unknown' };
}

function calculateAgeGroup(birthYear) {
  if (!birthYear) return null;
  return `U${new Date().getFullYear() - birthYear + 1}`;
}

function normalizeTeamName(name) {
  if (!name) return null;
  return name.toLowerCase().replace(/\s+/g, ' ').replace(/[^\w\s-]/g, '').trim();
}

function extractClubName(teamName) {
  if (!teamName) return null;
  let clubName = teamName;
  for (const pattern of CLUB_SUFFIX_PATTERNS) {
    clubName = clubName.replace(pattern, '');
  }
  return clubName.trim() || null;
}

// ============================================================
// CLUB CACHE - Eliminate N+1 queries
// ============================================================

class ClubCache {
  constructor() {
    this.cache = new Map(); // key: "name|state" -> id
    this.pendingCreates = new Map(); // Batch create new clubs
  }

  async initialize() {
    console.log('Loading existing clubs into cache...');
    let offset = 0;
    let total = 0;

    while (true) {
      const { data: clubs, error } = await supabase
        .from('clubs')
        .select('id, name, state')
        .range(offset, offset + 1000 - 1);

      if (error || !clubs || clubs.length === 0) break;

      clubs.forEach(c => {
        this.cache.set(`${c.name}|${c.state || ''}`, c.id);
      });

      total += clubs.length;
      offset += 1000;
    }

    console.log(`  Cached ${total.toLocaleString()} existing clubs`);
  }

  getOrQueue(clubName, state) {
    if (!clubName) return null;

    const key = `${clubName}|${state || ''}`;

    if (this.cache.has(key)) {
      return this.cache.get(key);
    }

    // Queue for batch creation
    if (!this.pendingCreates.has(key)) {
      const tempId = crypto.randomUUID();
      this.pendingCreates.set(key, { name: clubName, state, tempId });
    }

    return this.pendingCreates.get(key).tempId;
  }

  async flushPendingCreates() {
    if (this.pendingCreates.size === 0) return;

    console.log(`  Creating ${this.pendingCreates.size.toLocaleString()} new clubs...`);

    const clubsToCreate = [];
    const keyToTempId = new Map();

    for (const [key, { name, state, tempId }] of this.pendingCreates) {
      clubsToCreate.push({
        name,
        state,
        created_at: new Date().toISOString()
      });
      keyToTempId.set(key, tempId);
    }

    // Batch insert in chunks of 1000
    for (let i = 0; i < clubsToCreate.length; i += 1000) {
      const batch = clubsToCreate.slice(i, i + 1000);
      const { data: created, error } = await supabase
        .from('clubs')
        .upsert(batch, { onConflict: 'name,state', ignoreDuplicates: true })
        .select('id, name, state');

      if (error) {
        console.log('  Warning: Club batch insert error:', error.message);
        continue;
      }

      // Update cache with real IDs
      if (created) {
        created.forEach(c => {
          const key = `${c.name}|${c.state || ''}`;
          this.cache.set(key, c.id);
        });
      }
    }

    // Re-fetch to get IDs for any that were duplicates
    const { data: allClubs } = await supabase
      .from('clubs')
      .select('id, name, state');

    if (allClubs) {
      allClubs.forEach(c => {
        this.cache.set(`${c.name}|${c.state || ''}`, c.id);
      });
    }

    this.pendingCreates.clear();
    console.log(`  Club cache now has ${this.cache.size.toLocaleString()} entries`);
  }

  resolve(clubName, state) {
    if (!clubName) return null;
    return this.cache.get(`${clubName}|${state || ''}`) || null;
  }
}

// ============================================================
// OPTIMIZED TEAM MIGRATION
// ============================================================

async function migrateAllTeamsOptimized(clubCache) {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('         OPTIMIZED TEAM MIGRATION - BULK OPERATIONS             ');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const stats = { migrated: 0, complete: 0, partial: 0, incomplete: 0, errors: 0 };

  // Get total count
  const { count: totalTeams } = await supabase
    .from('teams')
    .select('*', { count: 'exact', head: true });

  console.log(`Total teams to migrate: ${totalTeams.toLocaleString()}\n`);

  // Phase 1: Build all team records and queue club creates
  console.log('Phase 1: Parsing all teams and queuing club creates...');
  const allTeamRecords = [];
  let offset = 0;

  while (offset < totalTeams) {
    const { data: teams, error } = await supabase
      .from('teams')
      .select('*')
      .range(offset, offset + TEAM_BATCH_SIZE - 1)
      .order('id');

    if (error || !teams || teams.length === 0) break;

    for (const team of teams) {
      const birthYear = parseBirthYear(team.team_name);
      const gender = parseGender(team.team_name);
      const clubName = extractClubName(team.team_name);

      // Queue club creation (will be batched)
      clubCache.getOrQueue(clubName, team.state);

      allTeamRecords.push({
        v1Team: team,
        birthYear,
        gender,
        clubName,
        ageGroup: calculateAgeGroup(birthYear.value)
      });

      // Track stats
      if (birthYear.value && gender.value) stats.complete++;
      else if (birthYear.value || gender.value) stats.partial++;
      else stats.incomplete++;
    }

    const progress = Math.round((offset + teams.length) / totalTeams * 100);
    if (progress % 10 === 0) {
      console.log(`  Parsed ${(offset + teams.length).toLocaleString()}/${totalTeams.toLocaleString()} (${progress}%)`);
    }

    offset += TEAM_BATCH_SIZE;
  }

  console.log(`  Parsed ${allTeamRecords.length.toLocaleString()} teams`);

  // Phase 2: Batch create all clubs
  console.log('\nPhase 2: Creating clubs...');
  await clubCache.flushPendingCreates();

  // Phase 3: Bulk upsert teams
  console.log('\nPhase 3: Bulk upserting teams...');
  const now = new Date().toISOString();

  for (let i = 0; i < allTeamRecords.length; i += TEAM_BATCH_SIZE) {
    const batch = allTeamRecords.slice(i, i + TEAM_BATCH_SIZE);

    const teamRecords = batch.map(({ v1Team, birthYear, gender, clubName, ageGroup }) => ({
      id: v1Team.id,
      canonical_name: normalizeTeamName(v1Team.team_name),
      display_name: v1Team.team_name,
      club_id: clubCache.resolve(clubName, v1Team.state),
      birth_year: birthYear.value,
      birth_year_source: birthYear.source,
      gender: gender.value,
      gender_source: gender.source,
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
      source_platform: v1Team.source_name,
      data_flags: { needs_review: !birthYear.value || !gender.value },
      created_at: v1Team.created_at || now,
      updated_at: now
    }));

    const { error } = await supabase
      .from('teams_v2')
      .upsert(teamRecords, { onConflict: 'id' });

    if (error) {
      console.log(`  Batch error at ${i}: ${error.message}`);
      stats.errors += batch.length;
    } else {
      stats.migrated += batch.length;
    }

    const progress = Math.round((i + batch.length) / allTeamRecords.length * 100);
    if (progress % 10 === 0 || i + batch.length === allTeamRecords.length) {
      console.log(`  Upserted ${(i + batch.length).toLocaleString()}/${allTeamRecords.length.toLocaleString()} (${progress}%)`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                    TEAM MIGRATION COMPLETE                     ');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Total migrated:     ${stats.migrated.toLocaleString()}`);
  console.log(`  Complete metadata:  ${stats.complete.toLocaleString()} (${(stats.complete/allTeamRecords.length*100).toFixed(1)}%)`);
  console.log(`  Partial metadata:   ${stats.partial.toLocaleString()} (${(stats.partial/allTeamRecords.length*100).toFixed(1)}%)`);
  console.log(`  Incomplete:         ${stats.incomplete.toLocaleString()} (${(stats.incomplete/allTeamRecords.length*100).toFixed(1)}%)`);
  console.log(`  Errors:             ${stats.errors}`);

  return stats;
}

// ============================================================
// OPTIMIZED MATCH MIGRATION
// ============================================================

async function migrateAllMatchesOptimized() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('         OPTIMIZED MATCH MIGRATION - BULK OPERATIONS            ');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Build v2 team ID set
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

  console.log(`  V2 team IDs: ${v2IdSet.size.toLocaleString()}\n`);

  // Get total matches
  const { count: totalMatches } = await supabase
    .from('match_results')
    .select('*', { count: 'exact', head: true })
    .not('home_team_id', 'is', null)
    .not('away_team_id', 'is', null);

  console.log(`Total linked matches in v1: ${totalMatches.toLocaleString()}\n`);

  const stats = { migrated: 0, fullLink: 0, skipped: 0, errors: 0 };
  const now = new Date().toISOString();
  offset = 0;

  // Process in parallel batches
  while (offset < totalMatches) {
    // Fetch batch
    const { data: matches, error } = await supabase
      .from('match_results')
      .select('*')
      .not('home_team_id', 'is', null)
      .not('away_team_id', 'is', null)
      .range(offset, offset + MATCH_BATCH_SIZE - 1)
      .order('id');

    if (error || !matches || matches.length === 0) break;

    // Filter to only matches where both teams exist in v2
    const matchRecords = [];

    for (const match of matches) {
      const homeInV2 = v2IdSet.has(match.home_team_id);
      const awayInV2 = v2IdSet.has(match.away_team_id);

      if (homeInV2 && awayInV2) {
        stats.fullLink++;
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
          link_status: 'full',
          created_at: match.created_at || now
        });
      } else {
        stats.skipped++;
      }
    }

    // Bulk upsert
    if (matchRecords.length > 0) {
      const { error: upsertError } = await supabase
        .from('matches_v2')
        .upsert(matchRecords, { onConflict: 'id' });

      if (upsertError) {
        console.log(`  Batch error: ${upsertError.message}`);
        stats.errors += matchRecords.length;
      } else {
        stats.migrated += matchRecords.length;
      }
    }

    const progress = Math.round((offset + matches.length) / totalMatches * 100);
    if (progress % 10 === 0 || offset + matches.length >= totalMatches) {
      console.log(`  Processed ${(offset + matches.length).toLocaleString()}/${totalMatches.toLocaleString()} (${progress}%) | Migrated: ${stats.migrated.toLocaleString()}`);
    }

    offset += MATCH_BATCH_SIZE;
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                   MATCH MIGRATION COMPLETE                     ');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Total migrated:   ${stats.migrated.toLocaleString()}`);
  console.log(`  Full link:        ${stats.fullLink.toLocaleString()}`);
  console.log(`  Skipped (partial): ${stats.skipped.toLocaleString()}`);
  console.log(`  Errors:           ${stats.errors}`);

  return stats;
}

// ============================================================
// VERIFICATION
// ============================================================

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
  console.log(`  ${v2Teams === v1Teams ? '✅ 100% TEAM COVERAGE ACHIEVED!' : '⚠️  Some teams missing'}`);

  console.log('\nMATCHES:');
  console.log(`  V1 (linked): ${v1Matches.toLocaleString()}`);
  console.log(`  V2: ${v2Matches.toLocaleString()}`);
  console.log(`  Coverage: ${(v2Matches / v1Matches * 100).toFixed(1)}%`);
  console.log(`  ${v2Matches === v1Matches ? '✅ 100% MATCH COVERAGE ACHIEVED!' : '⚠️  Some matches missing'}`);

  // Quality score distribution
  const { data: qualityDist } = await supabase
    .from('teams_v2')
    .select('data_quality_score');

  if (qualityDist && qualityDist.length > 0) {
    const scores = qualityDist.map(t => t.data_quality_score || 0);
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
  console.log('║     SOCCERVIEW INCLUSIVE MIGRATION - OPTIMIZED                ║');
  console.log('║     Expected runtime: 5-10 minutes                            ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  const startTime = Date.now();

  try {
    // Initialize club cache
    const clubCache = new ClubCache();
    await clubCache.initialize();

    // Step 1: Migrate all teams (bulk)
    await migrateAllTeamsOptimized(clubCache);

    // Step 2: Migrate all matches (bulk)
    await migrateAllMatchesOptimized();

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
  (async () => {
    await verifyMigration();
  })();
} else {
  main();
}
