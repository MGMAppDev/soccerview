/**
 * Run Migration 030: Create Canonical Registry System
 * Uses direct pg client to execute entire SQL file at once
 */

import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function runMigration() {
  console.log('🔄 Running Migration 030: Canonical Registry System\n');

  const client = await pool.connect();

  try {
    // Execute each major component separately

    // 1. Create extension
    console.log('1. Enabling pg_trgm extension...');
    await client.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    console.log('   ✅ Done');

    // 2. Create canonical_events table
    console.log('2. Creating canonical_events table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS canonical_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        canonical_name TEXT NOT NULL,
        event_type TEXT NOT NULL CHECK (event_type IN ('league', 'tournament')),
        aliases TEXT[] NOT NULL DEFAULT '{}',
        source_patterns JSONB DEFAULT '{}',
        state TEXT,
        region TEXT,
        year INTEGER,
        league_id UUID REFERENCES leagues(id) ON DELETE SET NULL,
        tournament_id UUID REFERENCES tournaments(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(canonical_name, event_type, year)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_canonical_events_aliases ON canonical_events USING GIN (aliases)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_canonical_events_name_trgm ON canonical_events USING GIN (canonical_name gin_trgm_ops)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_canonical_events_year ON canonical_events (year)`);
    console.log('   ✅ Done');

    // 3. Create canonical_teams table
    console.log('3. Creating canonical_teams table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS canonical_teams (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        canonical_name TEXT NOT NULL,
        club_name TEXT,
        birth_year INTEGER,
        gender gender_type,
        state TEXT,
        aliases TEXT[] NOT NULL DEFAULT '{}',
        team_v2_id UUID REFERENCES teams_v2(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(canonical_name, birth_year, gender, state)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_canonical_teams_aliases ON canonical_teams USING GIN (aliases)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_canonical_teams_name_trgm ON canonical_teams USING GIN (canonical_name gin_trgm_ops)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_canonical_teams_lookup ON canonical_teams (birth_year, gender, state)`);
    console.log('   ✅ Done');

    // 4. Create canonical_clubs table
    console.log('4. Creating canonical_clubs table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS canonical_clubs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        canonical_name TEXT NOT NULL UNIQUE,
        aliases TEXT[] NOT NULL DEFAULT '{}',
        state TEXT,
        region TEXT,
        logo_url TEXT,
        club_id UUID REFERENCES clubs(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_canonical_clubs_aliases ON canonical_clubs USING GIN (aliases)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_canonical_clubs_name_trgm ON canonical_clubs USING GIN (canonical_name gin_trgm_ops)`);
    console.log('   ✅ Done');

    // 5. Create resolve_canonical_event function
    console.log('5. Creating resolve_canonical_event() function...');
    await client.query(`
      CREATE OR REPLACE FUNCTION resolve_canonical_event(
        raw_name TEXT,
        p_event_type TEXT DEFAULT NULL
      ) RETURNS TABLE(
        canonical_id UUID,
        canonical_name TEXT,
        event_type TEXT,
        league_id UUID,
        tournament_id UUID
      ) AS $func$
      BEGIN
        RETURN QUERY
        SELECT
          ce.id AS canonical_id,
          ce.canonical_name,
          ce.event_type,
          ce.league_id,
          ce.tournament_id
        FROM canonical_events ce
        WHERE
          ce.canonical_name = raw_name
          OR raw_name = ANY(ce.aliases)
          OR similarity(ce.canonical_name, raw_name) > 0.85
        ORDER BY
          CASE
            WHEN ce.canonical_name = raw_name THEN 0
            WHEN raw_name = ANY(ce.aliases) THEN 1
            ELSE 2
          END,
          similarity(ce.canonical_name, raw_name) DESC
        LIMIT 1;
      END;
      $func$ LANGUAGE plpgsql STABLE
    `);
    console.log('   ✅ Done');

    // 6. Create resolve_canonical_team function
    console.log('6. Creating resolve_canonical_team() function...');
    await client.query(`
      CREATE OR REPLACE FUNCTION resolve_canonical_team(
        raw_name TEXT,
        p_birth_year INTEGER DEFAULT NULL,
        p_gender gender_type DEFAULT NULL
      ) RETURNS TABLE(
        canonical_id UUID,
        canonical_name TEXT,
        team_v2_id UUID
      ) AS $func$
      BEGIN
        RETURN QUERY
        SELECT
          ct.id AS canonical_id,
          ct.canonical_name,
          ct.team_v2_id
        FROM canonical_teams ct
        WHERE
          (ct.canonical_name = raw_name OR raw_name = ANY(ct.aliases))
          AND (p_birth_year IS NULL OR ct.birth_year = p_birth_year)
          AND (p_gender IS NULL OR ct.gender = p_gender)
        ORDER BY
          CASE WHEN ct.canonical_name = raw_name THEN 0 ELSE 1 END
        LIMIT 1;
      END;
      $func$ LANGUAGE plpgsql STABLE
    `);
    console.log('   ✅ Done');

    // 7. Create resolve_canonical_club function
    console.log('7. Creating resolve_canonical_club() function...');
    await client.query(`
      CREATE OR REPLACE FUNCTION resolve_canonical_club(
        raw_name TEXT
      ) RETURNS TABLE(
        canonical_id UUID,
        canonical_name TEXT,
        club_id UUID
      ) AS $func$
      BEGIN
        RETURN QUERY
        SELECT
          cc.id AS canonical_id,
          cc.canonical_name,
          cc.club_id
        FROM canonical_clubs cc
        WHERE
          cc.canonical_name = raw_name
          OR raw_name = ANY(cc.aliases)
          OR similarity(cc.canonical_name, raw_name) > 0.85
        ORDER BY
          CASE
            WHEN cc.canonical_name = raw_name THEN 0
            WHEN raw_name = ANY(cc.aliases) THEN 1
            ELSE 2
          END,
          similarity(cc.canonical_name, raw_name) DESC
        LIMIT 1;
      END;
      $func$ LANGUAGE plpgsql STABLE
    `);
    console.log('   ✅ Done');

    // 8. Seed Heartland data
    console.log('8. Seeding Heartland event mappings...');
    await client.query(`
      INSERT INTO canonical_events (canonical_name, event_type, aliases, state, region, year) VALUES
        ('Heartland Premier League 2025', 'league',
         ARRAY['Heartland Soccer League 2025', 'Heartland League 2025', 'HPL 2025', 'heartland-league-2025', 'heartland-premier-2025'],
         'KS', 'Kansas City', 2025),
        ('Heartland Recreational League 2025', 'league',
         ARRAY['Heartland Rec League 2025', 'HRL 2025'],
         'KS', 'Kansas City', 2025),
        ('Heartland Premier League 2026', 'league',
         ARRAY['Heartland Soccer League 2026', 'Heartland League 2026', 'HPL 2026', 'heartland-league-2026', 'heartland-premier-2026'],
         'KS', 'Kansas City', 2026),
        ('Heartland Recreational League 2026', 'league',
         ARRAY['Heartland Rec League 2026', 'HRL 2026'],
         'KS', 'Kansas City', 2026)
      ON CONFLICT (canonical_name, event_type, year) DO NOTHING
    `);
    console.log('   ✅ Done');

    // 9. Link to actual leagues
    console.log('9. Linking canonical events to league records...');
    const { rowCount } = await client.query(`
      UPDATE canonical_events ce
      SET league_id = l.id
      FROM leagues l
      WHERE ce.event_type = 'league'
        AND l.name ILIKE '%' || SPLIT_PART(ce.canonical_name, ' 20', 1) || '%'
        AND ce.league_id IS NULL
    `);
    console.log(`   ✅ Linked ${rowCount} events`);

    // Verify
    console.log('\n📊 VERIFICATION:');
    const tables = ['canonical_events', 'canonical_teams', 'canonical_clubs'];
    for (const table of tables) {
      const { rows } = await client.query(`SELECT COUNT(*) as count FROM ${table}`);
      console.log(`   ${table}: ${rows[0].count} rows`);
    }

    // Test function
    console.log('\n🧪 Testing resolve_canonical_event():');
    const { rows: testResult } = await client.query(`
      SELECT * FROM resolve_canonical_event('Heartland Soccer League 2025')
    `);
    if (testResult.length > 0) {
      console.log(`   ✅ Resolved "Heartland Soccer League 2025" → "${testResult[0].canonical_name}"`);
    } else {
      console.log(`   ⚠️ No match found`);
    }

    console.log('\n✅ Migration 030 complete!');

  } finally {
    client.release();
    await pool.end();
  }
}

runMigration().catch(err => {
  console.error('Fatal error:', err);
  pool.end();
  process.exit(1);
});
