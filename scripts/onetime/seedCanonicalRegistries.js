/**
 * Seed Canonical Registries (FAST - Bulk SQL)
 * ============================================
 *
 * Bootstrap canonical registries from EXISTING production data.
 * Uses bulk INSERT...SELECT for speed (processes 20K+ records in seconds).
 *
 * What gets seeded:
 * - canonical_teams: From teams_v2 with 5+ matches (established teams)
 * - canonical_events: From leagues/tournaments with 10+ matches
 * - canonical_clubs: From clubs with 3+ linked teams
 *
 * Usage:
 *   node scripts/onetime/seedCanonicalRegistries.js --dry-run
 *   node scripts/onetime/seedCanonicalRegistries.js
 *   node scripts/onetime/seedCanonicalRegistries.js --teams-only
 *   node scripts/onetime/seedCanonicalRegistries.js --events-only
 *   node scripts/onetime/seedCanonicalRegistries.js --clubs-only
 */

import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Configuration thresholds
const CONFIG = {
  MIN_TEAM_MATCHES: 5,      // Teams must have this many matches to be "established"
  MIN_EVENT_MATCHES: 10,    // Events must have this many matches
  MIN_CLUB_TEAMS: 3,        // Clubs must have this many teams
};

/**
 * Seed canonical_teams using bulk SQL
 */
async function seedCanonicalTeams(client, dryRun) {
  console.log('\n📋 Seeding canonical_teams...');

  // Count how many would be inserted
  const { rows: countResult } = await client.query(`
    SELECT COUNT(*) as count
    FROM teams_v2 t
    WHERE t.matches_played >= $1
      AND NOT EXISTS (
        SELECT 1 FROM canonical_teams ct WHERE ct.team_v2_id = t.id
      )
  `, [CONFIG.MIN_TEAM_MATCHES]);

  const toInsert = parseInt(countResult[0].count);
  console.log(`   Found ${toInsert} established teams not in registry`);

  if (dryRun) {
    console.log('   DRY RUN - Would insert these teams');
    return { inserted: 0, wouldInsert: toInsert };
  }

  // Bulk insert using INSERT...SELECT
  const { rowCount } = await client.query(`
    INSERT INTO canonical_teams (canonical_name, birth_year, gender, state, aliases, team_v2_id)
    SELECT
      COALESCE(display_name, canonical_name),
      birth_year,
      gender,
      state,
      ARRAY[]::text[],
      id
    FROM teams_v2 t
    WHERE t.matches_played >= $1
      AND NOT EXISTS (
        SELECT 1 FROM canonical_teams ct WHERE ct.team_v2_id = t.id
      )
    ON CONFLICT DO NOTHING
  `, [CONFIG.MIN_TEAM_MATCHES]);

  console.log(`   ✅ Inserted ${rowCount} canonical team entries`);
  return { inserted: rowCount };
}

/**
 * Seed canonical_events using bulk SQL
 */
async function seedCanonicalEvents(client, dryRun) {
  console.log('\n📋 Seeding canonical_events...');

  // Count leagues
  const { rows: leagueCount } = await client.query(`
    SELECT COUNT(*) as count
    FROM leagues l
    WHERE EXISTS (
      SELECT 1 FROM matches_v2 m WHERE m.league_id = l.id
      GROUP BY m.league_id HAVING COUNT(*) >= $1
    )
    AND NOT EXISTS (
      SELECT 1 FROM canonical_events ce WHERE ce.league_id = l.id
    )
  `, [CONFIG.MIN_EVENT_MATCHES]);

  // Count tournaments
  const { rows: tourneyCount } = await client.query(`
    SELECT COUNT(*) as count
    FROM tournaments t
    WHERE EXISTS (
      SELECT 1 FROM matches_v2 m WHERE m.tournament_id = t.id
      GROUP BY m.tournament_id HAVING COUNT(*) >= $1
    )
    AND NOT EXISTS (
      SELECT 1 FROM canonical_events ce WHERE ce.tournament_id = t.id
    )
  `, [CONFIG.MIN_EVENT_MATCHES]);

  const leaguesToInsert = parseInt(leagueCount[0].count);
  const tourneysToInsert = parseInt(tourneyCount[0].count);
  console.log(`   Found ${leaguesToInsert} leagues + ${tourneysToInsert} tournaments not in registry`);

  if (dryRun) {
    console.log('   DRY RUN - Would insert these events');
    return { inserted: 0, wouldInsert: leaguesToInsert + tourneysToInsert };
  }

  // Bulk insert leagues
  const { rowCount: leaguesInserted } = await client.query(`
    INSERT INTO canonical_events (canonical_name, event_type, state, aliases, league_id)
    SELECT
      l.name,
      'league',
      l.state,
      ARRAY[]::text[],
      l.id
    FROM leagues l
    WHERE EXISTS (
      SELECT 1 FROM matches_v2 m WHERE m.league_id = l.id
      GROUP BY m.league_id HAVING COUNT(*) >= $1
    )
    AND NOT EXISTS (
      SELECT 1 FROM canonical_events ce WHERE ce.league_id = l.id
    )
    ON CONFLICT DO NOTHING
  `, [CONFIG.MIN_EVENT_MATCHES]);

  // Bulk insert tournaments
  const { rowCount: tourneysInserted } = await client.query(`
    INSERT INTO canonical_events (canonical_name, event_type, state, aliases, tournament_id)
    SELECT
      t.name,
      'tournament',
      t.state,
      ARRAY[]::text[],
      t.id
    FROM tournaments t
    WHERE EXISTS (
      SELECT 1 FROM matches_v2 m WHERE m.tournament_id = t.id
      GROUP BY m.tournament_id HAVING COUNT(*) >= $1
    )
    AND NOT EXISTS (
      SELECT 1 FROM canonical_events ce WHERE ce.tournament_id = t.id
    )
    ON CONFLICT DO NOTHING
  `, [CONFIG.MIN_EVENT_MATCHES]);

  console.log(`   ✅ Inserted ${leaguesInserted} leagues + ${tourneysInserted} tournaments`);
  return { inserted: leaguesInserted + tourneysInserted };
}

/**
 * Seed canonical_clubs using bulk SQL
 */
async function seedCanonicalClubs(client, dryRun) {
  console.log('\n📋 Seeding canonical_clubs...');

  // Count clubs
  const { rows: clubCount } = await client.query(`
    SELECT COUNT(*) as count
    FROM clubs c
    WHERE EXISTS (
      SELECT 1 FROM teams_v2 t WHERE t.club_id = c.id
      GROUP BY t.club_id HAVING COUNT(*) >= $1
    )
    AND NOT EXISTS (
      SELECT 1 FROM canonical_clubs cc WHERE cc.club_id = c.id
    )
  `, [CONFIG.MIN_CLUB_TEAMS]);

  const toInsert = parseInt(clubCount[0].count);
  console.log(`   Found ${toInsert} established clubs not in registry`);

  if (dryRun) {
    console.log('   DRY RUN - Would insert these clubs');
    return { inserted: 0, wouldInsert: toInsert };
  }

  // Bulk insert
  const { rowCount } = await client.query(`
    INSERT INTO canonical_clubs (canonical_name, state, aliases, club_id)
    SELECT
      c.name,
      c.state,
      ARRAY[]::text[],
      c.id
    FROM clubs c
    WHERE EXISTS (
      SELECT 1 FROM teams_v2 t WHERE t.club_id = c.id
      GROUP BY t.club_id HAVING COUNT(*) >= $1
    )
    AND NOT EXISTS (
      SELECT 1 FROM canonical_clubs cc WHERE cc.club_id = c.id
    )
    ON CONFLICT DO NOTHING
  `, [CONFIG.MIN_CLUB_TEAMS]);

  console.log(`   ✅ Inserted ${rowCount} canonical club entries`);
  return { inserted: rowCount };
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const teamsOnly = args.includes('--teams-only');
  const eventsOnly = args.includes('--events-only');
  const clubsOnly = args.includes('--clubs-only');

  console.log('🌱 SEED CANONICAL REGISTRIES (FAST - Bulk SQL)');
  console.log('==============================================');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'PRODUCTION'}`);
  console.log(`Thresholds:`);
  console.log(`  - Teams: ${CONFIG.MIN_TEAM_MATCHES}+ matches`);
  console.log(`  - Events: ${CONFIG.MIN_EVENT_MATCHES}+ matches`);
  console.log(`  - Clubs: ${CONFIG.MIN_CLUB_TEAMS}+ teams`);

  const client = await pool.connect();
  const startTime = Date.now();

  try {
    // Get current counts
    const { rows: before } = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM canonical_teams) as teams,
        (SELECT COUNT(*) FROM canonical_events) as events,
        (SELECT COUNT(*) FROM canonical_clubs) as clubs
    `);

    console.log('\n📊 Current registry counts:');
    console.log(`   canonical_teams: ${before[0].teams}`);
    console.log(`   canonical_events: ${before[0].events}`);
    console.log(`   canonical_clubs: ${before[0].clubs}`);

    const results = {};

    // Seed based on flags
    if (!eventsOnly && !clubsOnly) {
      results.teams = await seedCanonicalTeams(client, dryRun);
    }
    if (!teamsOnly && !clubsOnly) {
      results.events = await seedCanonicalEvents(client, dryRun);
    }
    if (!teamsOnly && !eventsOnly) {
      results.clubs = await seedCanonicalClubs(client, dryRun);
    }

    // Get final counts
    if (!dryRun) {
      const { rows: after } = await client.query(`
        SELECT
          (SELECT COUNT(*) FROM canonical_teams) as teams,
          (SELECT COUNT(*) FROM canonical_events) as events,
          (SELECT COUNT(*) FROM canonical_clubs) as clubs
      `);

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      console.log('\n📊 Final registry counts:');
      console.log(`   canonical_teams: ${before[0].teams} → ${after[0].teams} (+${after[0].teams - before[0].teams})`);
      console.log(`   canonical_events: ${before[0].events} → ${after[0].events} (+${after[0].events - before[0].events})`);
      console.log(`   canonical_clubs: ${before[0].clubs} → ${after[0].clubs} (+${after[0].clubs - before[0].clubs})`);
      console.log(`\n⏱️ Completed in ${elapsed}s`);
    }

    console.log('\n✅ Seeding complete');

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(error => {
  console.error('❌ FATAL:', error.message);
  process.exit(1);
});
