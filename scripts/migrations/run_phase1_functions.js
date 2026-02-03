/**
 * Phase 1: Create resolve functions and seed data
 */

import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function createFunctions() {
  console.log('Creating resolve functions and seeding data...\n');

  const client = await pool.connect();

  try {
    // Create resolve_canonical_event function
    console.log('1. Creating resolve_canonical_event()...');
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

    // Create resolve_canonical_team function
    console.log('2. Creating resolve_canonical_team()...');
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

    // Create resolve_canonical_club function
    console.log('3. Creating resolve_canonical_club()...');
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

    // Seed Heartland data
    console.log('4. Seeding Heartland event mappings...');
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
    console.log('   ✅ Seeded 4 Heartland league entries');

    // Link to actual leagues
    console.log('5. Linking to league records...');
    const { rowCount } = await client.query(`
      UPDATE canonical_events ce
      SET league_id = l.id
      FROM leagues l
      WHERE ce.event_type = 'league'
        AND l.name ILIKE '%Heartland%' AND l.name ILIKE '%' || ce.year::text || '%'
        AND ce.league_id IS NULL
    `);
    console.log(`   ✅ Linked ${rowCount} events to league records`);

    // Verify
    console.log('\n📊 VERIFICATION:');
    const { rows: eventCount } = await client.query('SELECT COUNT(*) FROM canonical_events');
    console.log(`   canonical_events: ${eventCount[0].count} rows`);

    // Test function
    console.log('\n🧪 Testing resolve_canonical_event():');
    const { rows: test1 } = await client.query("SELECT * FROM resolve_canonical_event('Heartland Soccer League 2025')");
    if (test1.length > 0) {
      console.log(`   ✅ "Heartland Soccer League 2025" → ${test1[0].canonical_name}`);
    }

    const { rows: test2 } = await client.query("SELECT * FROM resolve_canonical_event('HPL 2026')");
    if (test2.length > 0) {
      console.log(`   ✅ "HPL 2026" → ${test2[0].canonical_name}`);
    }

    console.log('\n✅ Phase 1 functions and seed data complete!');

  } finally {
    client.release();
    await pool.end();
  }
}

createFunctions().catch(err => {
  console.error('Fatal error:', err);
  pool.end();
  process.exit(1);
});
