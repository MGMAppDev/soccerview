/**
 * Universal Standings Processor
 * ==============================
 * Session 92: Process staging_standings → league_standings (production)
 * Session 92 QC: Lightweight absorption — separate from match pipeline
 *
 * UNIVERSAL PATTERN: Zero source-specific logic. Works for ANY source
 * that writes to staging_standings via scrapeStandings.js.
 *
 * ARCHITECTURAL PRINCIPLE (Principle 36):
 *   Standings data is AUTHORITATIVE — the league publishes it.
 *   This processor uses LIGHTWEIGHT team resolution, NOT the heavy
 *   match pipeline's 3-tier entity resolution with fuzzy matching.
 *
 *   Two data paths (coexisting, independent):
 *     Match data → Heavy SV pipeline → Rankings/ELO/Teams
 *     Standings  → Lightweight absorption → League Standings page
 *
 * Three-Layer Architecture:
 *   Layer 1: staging_standings (raw scraped data, TEXT fields)
 *   Layer 2: league_standings (production, UUID FKs, validated)
 *   Layer 3: app_league_standings view (hybrid: scraped UNION computed)
 *
 * Lightweight Team Resolution (NOT the match pipeline's 3-tier):
 *   Step 1: source_entity_map lookup + METADATA VERIFICATION
 *   Step 2: Exact name + birth_year + gender match
 *   Step 3: Create new team (trust the source — no fuzzy matching)
 *
 * Usage:
 *   node scripts/maintenance/processStandings.cjs
 *   node scripts/maintenance/processStandings.cjs --dry-run
 *   node scripts/maintenance/processStandings.cjs --source heartland
 *   node scripts/maintenance/processStandings.cjs --limit 1000
 */

require('dotenv').config();
const { Pool } = require('pg');
const { removeDuplicatePrefix } = require('../universal/normalizers/cleanTeamName.cjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// =========================================================================
// CLI ARGUMENTS
// =========================================================================

const args = process.argv.slice(2);
const sourceFilter = args.find((_, i) => args[i - 1] === '--source') || null;
const limitArg = parseInt(args.find((_, i) => args[i - 1] === '--limit') || '0', 10);
const isDryRun = args.includes('--dry-run');
const isVerbose = args.includes('--verbose');

// =========================================================================
// NORMALIZERS (reuse existing universal normalizers)
// =========================================================================

/**
 * Normalize gender from source format to DB enum
 * Universal: handles any source's gender format
 */
function normalizeGender(gender) {
  if (!gender) return null;
  const lower = gender.toLowerCase().trim();
  if (lower === 'boys' || lower === 'boy' || lower === 'male' || lower === 'm') return 'M';
  if (lower === 'girls' || lower === 'girl' || lower === 'female' || lower === 'f') return 'F';
  return null;
}

/**
 * Extract birth year from age group string
 * Universal: handles U-11, U11, U-9, 2015, etc.
 */
function ageGroupToBirthYear(ageGroup, seasonYear = 2026) {
  if (!ageGroup) return null;
  // Try "U-11" or "U11" format
  const uMatch = ageGroup.match(/U-?(\d{1,2})/i);
  if (uMatch) return seasonYear - parseInt(uMatch[1], 10);
  // Try birth year format "2015"
  const yearMatch = ageGroup.match(/^(20[01]\d)$/);
  if (yearMatch) return parseInt(yearMatch[1], 10);
  return null;
}

/**
 * Normalize division text
 * Universal: handles "Subdivision 1", "Division 2", "Flight A", etc.
 */
function normalizeDivision(division) {
  if (!division) return null;
  const trimmed = division.trim();
  if (!trimmed) return null;

  // "Subdivision N" → "Division N"
  const subdivMatch = trimmed.match(/^(?:sub)?division\s+(\d+)$/i);
  if (subdivMatch) return `Division ${subdivMatch[1]}`;

  // "Flight A", "Pool B", "Bracket 1"
  const groupMatch = trimmed.match(/^(flight|group|pool|bracket)\s+([A-Za-z0-9]+)$/i);
  if (groupMatch) {
    return `${groupMatch[1].charAt(0).toUpperCase()}${groupMatch[1].slice(1).toLowerCase()} ${groupMatch[2].toUpperCase()}`;
  }

  // "Premier", "Elite", "Gold", etc. — return as-is (title case)
  return trimmed.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

// =========================================================================
// LEAGUE RESOLUTION (unchanged — leagues are few and well-mapped)
// =========================================================================

/**
 * Resolve league: source league ID → leagues.id
 * Tier 1: source_entity_map
 * Tier 2: leagues table by source_event_id or name match
 */
async function resolveLeague(client, sourcePlatform, leagueSourceId) {
  // Tier 1: source_entity_map
  const tier1 = await client.query(
    `SELECT sv_id FROM source_entity_map
     WHERE entity_type = 'league' AND source_platform = $1 AND source_entity_id = $2`,
    [sourcePlatform, leagueSourceId]
  );
  if (tier1.rows.length > 0) return tier1.rows[0].sv_id;

  // Tier 2: leagues table by source_event_id
  const tier2 = await client.query(
    `SELECT id FROM leagues
     WHERE source_event_id = $1 AND source_platform = $2`,
    [leagueSourceId, sourcePlatform]
  );
  if (tier2.rows.length > 0) {
    await registerSourceEntity(client, 'league', sourcePlatform, leagueSourceId, tier2.rows[0].id);
    return tier2.rows[0].id;
  }

  // Tier 2b: leagues table by name pattern match
  const tier2b = await client.query(
    `SELECT id FROM leagues WHERE source_event_id ILIKE $1 LIMIT 1`,
    [`%${leagueSourceId}%`]
  );
  if (tier2b.rows.length > 0) {
    await registerSourceEntity(client, 'league', sourcePlatform, leagueSourceId, tier2b.rows[0].id);
    return tier2b.rows[0].id;
  }

  return null;
}

// =========================================================================
// LIGHTWEIGHT TEAM RESOLUTION — Purpose-built for standings absorption
// =========================================================================
//
// KEY DIFFERENCE from match pipeline's 3-tier resolution:
//   - NO fuzzy/pg_trgm matching (causes false positives on authoritative data)
//   - Metadata VERIFICATION after source_entity_map lookup
//   - Metadata ENRICHMENT when resolved team has NULL birth_year/gender
//   - CREATE new team when no match found (trust the league authority)
//   - Source_entity_map CORRECTION when better record exists
//
// This is safe because standings data is authoritative — the league
// publishes exactly which teams are in which division with age/gender.
// =========================================================================

/**
 * Resolve team for standings: source team ID/name → teams_v2.id
 *
 * Lightweight resolution (NOT the match pipeline's 3-tier):
 *   Step 1: source_entity_map + metadata verification/enrichment
 *   Step 2: Exact name + birth_year + gender match
 *   Step 3: Create new team (trust the source — no fuzzy matching)
 */
async function resolveTeam(client, sourcePlatform, teamSourceId, teamName, birthYear, gender) {
  // Clean duplicate prefix BEFORE any lookup or creation (single source of truth: cleanTeamName.cjs)
  teamName = removeDuplicatePrefix(teamName);
  const normalizedName = teamName.trim().toLowerCase();

  // -----------------------------------------------------------------------
  // STEP 1: source_entity_map lookup + METADATA VERIFICATION
  // -----------------------------------------------------------------------
  if (teamSourceId) {
    const tier1 = await client.query(
      `SELECT sv_id FROM source_entity_map
       WHERE entity_type = 'team' AND source_platform = $1 AND source_entity_id = $2`,
      [sourcePlatform, teamSourceId]
    );

    if (tier1.rows.length > 0) {
      const svId = tier1.rows[0].sv_id;

      // VERIFY metadata compatibility (the key fix — old code skipped this)
      const teamCheck = await client.query(
        `SELECT id, birth_year, gender::TEXT as gender, display_name FROM teams_v2 WHERE id = $1`,
        [svId]
      );

      if (teamCheck.rows.length > 0) {
        const team = teamCheck.rows[0];
        const byOk = !birthYear || team.birth_year === birthYear || team.birth_year === null;
        const gOk = !gender || team.gender === gender || team.gender === null;

        if (byOk && gOk) {
          // Metadata compatible — enrich NULLs from standings data
          const finalId = await ensureTeamMetadata(client, svId, birthYear, gender);
          return finalId;
        }

        // Metadata INCOMPATIBLE — look for better record with correct metadata
        if (isVerbose) {
          console.log(`    Step 1 mismatch: "${team.display_name}" by=${team.birth_year} g=${team.gender} vs standings by=${birthYear} g=${gender}`);
        }

        // Try to find enriched alternative with matching metadata
        const alt = await findTeamByNameAndMetadata(client, normalizedName, birthYear, gender);
        if (alt) {
          // Update source_entity_map to point to correct record
          await client.query(
            `UPDATE source_entity_map SET sv_id = $1
             WHERE entity_type = 'team' AND source_platform = $2 AND source_entity_id = $3`,
            [alt, sourcePlatform, teamSourceId]
          );
          if (isVerbose) console.log(`    Step 1 corrected: ${teamSourceId} → ${alt}`);
          return alt;
        }

        // No enriched alternative — enrich current record's NULL fields
        const finalId2 = await ensureTeamMetadata(client, svId, birthYear, gender);
        return finalId2;
      }
    }
  }

  // -----------------------------------------------------------------------
  // STEP 2: Exact name match with birth_year + gender
  // Prefer records WITH metadata over those with NULL
  // -----------------------------------------------------------------------
  const exactMatch = await findTeamByNameAndMetadata(client, normalizedName, birthYear, gender);
  if (exactMatch) {
    if (teamSourceId) {
      await registerSourceEntity(client, 'team', sourcePlatform, teamSourceId, exactMatch);
    }
    return exactMatch;
  }

  // Also try name-only match (for teams with NULL metadata), then enrich
  const nameOnlyMatch = await client.query(`
    SELECT id FROM teams_v2
    WHERE (LOWER(canonical_name) = $1 OR LOWER(display_name) = $1)
    LIMIT 1
  `, [normalizedName]);

  if (nameOnlyMatch.rows.length > 0) {
    const finalId = await ensureTeamMetadata(client, nameOnlyMatch.rows[0].id, birthYear, gender);
    if (teamSourceId) {
      await registerSourceEntity(client, 'team', sourcePlatform, teamSourceId, finalId);
    }
    return finalId;
  }

  // -----------------------------------------------------------------------
  // STEP 3: Create new team (trust the league authority)
  // NO fuzzy matching — if exact match failed, this team doesn't exist yet.
  // Creating is SAFER than fuzzy-matching to the wrong team.
  // -----------------------------------------------------------------------
  if (!isDryRun) {
    const newTeam = await client.query(`
      INSERT INTO teams_v2 (display_name, canonical_name, birth_year, gender, state, data_quality_score)
      VALUES ($1, $2, $3, $4, $5, 50)
      RETURNING id
    `, [teamName.trim(), teamName.trim().toLowerCase(), birthYear, gender, 'unknown']);

    if (newTeam.rows.length > 0) {
      const newId = newTeam.rows[0].id;
      if (teamSourceId) {
        await registerSourceEntity(client, 'team', sourcePlatform, teamSourceId, newId);
      }
      if (isVerbose) console.log(`    Step 3 created: "${teamName}" (by=${birthYear}, g=${gender}) → ${newId}`);
      return newId;
    }
  }

  return null;
}

/**
 * Find team by exact name + metadata match.
 * Prefers records WITH birth_year and gender over those with NULL.
 */
async function findTeamByNameAndMetadata(client, normalizedName, birthYear, gender) {
  // First try: exact match with full metadata
  if (birthYear && gender) {
    const exact = await client.query(`
      SELECT id FROM teams_v2
      WHERE (LOWER(canonical_name) = $1 OR LOWER(display_name) = $1)
        AND birth_year = $2 AND gender = $3
      LIMIT 1
    `, [normalizedName, birthYear, gender]);
    if (exact.rows.length > 0) return exact.rows[0].id;
  }

  // Second try: name + birth_year (gender might be NULL)
  if (birthYear) {
    const byMatch = await client.query(`
      SELECT id FROM teams_v2
      WHERE (LOWER(canonical_name) = $1 OR LOWER(display_name) = $1)
        AND birth_year = $2
      LIMIT 1
    `, [normalizedName, birthYear]);
    if (byMatch.rows.length > 0) return byMatch.rows[0].id;
  }

  // Third try: name + gender (birth_year might be NULL)
  if (gender) {
    const gMatch = await client.query(`
      SELECT id FROM teams_v2
      WHERE (LOWER(canonical_name) = $1 OR LOWER(display_name) = $1)
        AND gender = $2
      LIMIT 1
    `, [normalizedName, gender]);
    if (gMatch.rows.length > 0) return gMatch.rows[0].id;
  }

  return null;
}

/**
 * Ensure team has birth_year and gender metadata.
 * SAFE: Only fills NULL fields — never overwrites existing data.
 * The league authority knows the team's age/gender — trust it.
 *
 * Returns: the team ID to use (may differ from input if redirect needed
 * due to unique_team_identity constraint — another record already has
 * the enriched metadata).
 */
async function ensureTeamMetadata(client, teamId, birthYear, gender) {
  if (!birthYear && !gender) return teamId;

  const { rows } = await client.query(
    'SELECT birth_year, gender::TEXT as gender, canonical_name, state FROM teams_v2 WHERE id = $1',
    [teamId]
  );
  if (rows.length === 0) return teamId;

  const team = rows[0];
  const updates = [];
  const params = [];
  let paramIdx = 0;

  if (team.birth_year === null && birthYear) {
    paramIdx++;
    updates.push(`birth_year = $${paramIdx}`);
    params.push(birthYear);
  }
  if (team.gender === null && gender) {
    paramIdx++;
    updates.push(`gender = $${paramIdx}`);
    params.push(gender);
  }

  if (updates.length > 0) {
    // Check if enriching would conflict with unique_team_identity constraint
    // (canonical_name, birth_year, gender, state)
    const enrichedBy = birthYear || team.birth_year;
    const enrichedG = gender || team.gender;
    const conflictCheck = await client.query(`
      SELECT id FROM teams_v2
      WHERE canonical_name = $1 AND birth_year = $2 AND gender = $3
        AND COALESCE(state, 'unknown') = COALESCE($4, 'unknown')
        AND id != $5
      LIMIT 1
    `, [team.canonical_name, enrichedBy, enrichedG, team.state, teamId]);

    if (conflictCheck.rows.length > 0) {
      // A record with proper metadata already exists — redirect to it
      const redirectId = conflictCheck.rows[0].id;
      if (isVerbose) {
        console.log(`    Redirect: ${teamId} → ${redirectId} (existing record has enriched metadata)`);
      }
      return redirectId;
    }

    paramIdx++;
    params.push(teamId);
    await client.query(
      `UPDATE teams_v2 SET ${updates.join(', ')} WHERE id = $${paramIdx}`,
      params
    );
    if (isVerbose) {
      console.log(`    Enriched: team=${teamId} → ${updates.join(', ')}`);
    }
  }
  return teamId;
}

/**
 * Register source entity mapping for future Tier 1 lookups
 */
async function registerSourceEntity(client, entityType, sourcePlatform, sourceEntityId, svId) {
  try {
    await client.query(`
      INSERT INTO source_entity_map (entity_type, source_platform, source_entity_id, sv_id)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (entity_type, source_platform, source_entity_id) DO NOTHING
    `, [entityType, sourcePlatform, sourceEntityId, svId]);
  } catch (err) {
    // Non-critical — mapping already exists
  }
}

/**
 * Get current season ID and year
 */
async function getCurrentSeason(client) {
  const result = await client.query(
    `SELECT id, year, start_date, end_date FROM seasons WHERE is_current = true LIMIT 1`
  );
  return result.rows[0] || null;
}

// =========================================================================
// MAIN PROCESSOR
// =========================================================================

async function main() {
  console.log('='.repeat(60));
  console.log('UNIVERSAL STANDINGS PROCESSOR');
  console.log('='.repeat(60));
  console.log(`Source:   ${sourceFilter || 'all'}`);
  console.log(`Dry run:  ${isDryRun}`);
  console.log(`Limit:    ${limitArg || 'none'}`);
  console.log('');

  const client = await pool.connect();

  try {
    // Authorize pipeline writes (teams_v2 has write protection triggers)
    await client.query('SELECT authorize_pipeline_write()');

    const season = await getCurrentSeason(client);
    if (!season) {
      console.error('No current season found in seasons table');
      return;
    }
    console.log(`Current season: ${season.year} (${season.start_date} → ${season.end_date})`);

    // -----------------------------------------------------------------------
    // STEP 1: Load unprocessed staging rows
    // -----------------------------------------------------------------------

    let query = `
      SELECT * FROM staging_standings
      WHERE processed = false
    `;
    const params = [];

    if (sourceFilter) {
      params.push(sourceFilter);
      query += ` AND source_platform = $${params.length}`;
    }

    query += ' ORDER BY created_at ASC';

    if (limitArg > 0) {
      params.push(limitArg);
      query += ` LIMIT $${params.length}`;
    }

    const { rows: stagingRows } = await client.query(query, params);
    console.log(`\nStep 1: Found ${stagingRows.length} unprocessed staging rows`);

    if (stagingRows.length === 0) {
      console.log('Nothing to process.');
      return;
    }

    // -----------------------------------------------------------------------
    // STEP 2: Process each row — resolve entities + upsert
    // -----------------------------------------------------------------------

    console.log('Step 2: Processing...\n');

    let resolved = 0;
    let skippedLeague = 0;
    let skippedTeam = 0;
    let upserted = 0;
    const processedIds = [];

    // Group by source platform + league for efficient resolution
    for (const row of stagingRows) {
      // A. Normalize fields
      const gender = normalizeGender(row.gender);
      const birthYear = ageGroupToBirthYear(row.age_group, season.year);
      const division = normalizeDivision(row.division);

      // B. Resolve league
      const leagueId = await resolveLeague(client, row.source_platform, row.league_source_id);
      if (!leagueId) {
        if (isVerbose) console.log(`  Skip: league not found for "${row.league_source_id}" (${row.source_platform})`);
        skippedLeague++;
        processedIds.push(row.id); // Mark processed so we don't retry — league doesn't exist
        continue;
      }

      // C. Resolve team
      const teamId = await resolveTeam(
        client, row.source_platform, row.team_source_id,
        row.team_name, birthYear, gender
      );
      if (!teamId) {
        if (isVerbose) console.log(`  Skip: team not found for "${row.team_name}" (by=${birthYear}, g=${gender})`);
        skippedTeam++;
        processedIds.push(row.id); // Mark processed — team doesn't exist in teams_v2
        continue;
      }

      resolved++;

      // D. Compute position if not provided
      // (Position will be computed in bulk after all rows processed)
      const position = row.position || null;

      // E. Upsert to league_standings
      if (!isDryRun) {
        await client.query(`
          INSERT INTO league_standings (
            league_id, team_id, division,
            played, wins, losses, draws,
            goals_for, goals_against, points, position,
            red_cards, source_platform, snapshot_date, season_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
          ON CONFLICT (league_id, team_id, division)
          DO UPDATE SET
            played = EXCLUDED.played,
            wins = EXCLUDED.wins,
            losses = EXCLUDED.losses,
            draws = EXCLUDED.draws,
            goals_for = EXCLUDED.goals_for,
            goals_against = EXCLUDED.goals_against,
            points = EXCLUDED.points,
            position = EXCLUDED.position,
            red_cards = EXCLUDED.red_cards,
            snapshot_date = EXCLUDED.snapshot_date,
            updated_at = NOW()
        `, [
          leagueId, teamId, division,
          row.played || 0, row.wins || 0, row.losses || 0, row.draws || 0,
          row.goals_for || 0, row.goals_against || 0, row.points || 0, position,
          row.red_cards || null, row.source_platform,
          row.source_snapshot_date, season.id,
        ]);
        upserted++;
      }

      processedIds.push(row.id);
    }

    // -----------------------------------------------------------------------
    // STEP 3: Compute positions for rows without source-provided position
    // -----------------------------------------------------------------------

    if (!isDryRun && upserted > 0) {
      console.log('\nStep 3: Computing positions...');
      // For each (league_id, division, gender, birth_year) group, rank by points DESC, GD DESC, GF DESC
      // Must match computed fallback's PARTITION BY (league_id, gender, birth_year, division)
      await client.query(`
        WITH ranked AS (
          SELECT ls.id,
            ROW_NUMBER() OVER (
              PARTITION BY ls.league_id, ls.division, t.gender, t.birth_year
              ORDER BY ls.points DESC,
                       ls.goals_for - ls.goals_against DESC,
                       ls.goals_for DESC
            ) as computed_position
          FROM league_standings ls
          JOIN teams_v2 t ON t.id = ls.team_id
          WHERE ls.season_id = $1
        )
        UPDATE league_standings ls
        SET position = r.computed_position
        FROM ranked r
        WHERE ls.id = r.id
          AND (ls.position IS NULL OR ls.position != r.computed_position)
      `, [season.id]);
      console.log('  Positions computed');
    }

    // -----------------------------------------------------------------------
    // STEP 4: Mark staging rows as processed
    // -----------------------------------------------------------------------

    if (!isDryRun && processedIds.length > 0) {
      await client.query(
        `UPDATE staging_standings SET processed = true WHERE id = ANY($1)`,
        [processedIds]
      );
      console.log(`\nStep 4: Marked ${processedIds.length} staging rows as processed`);
    }

    // -----------------------------------------------------------------------
    // SUMMARY
    // -----------------------------------------------------------------------

    console.log('\n' + '='.repeat(60));
    console.log('STANDINGS PROCESSING COMPLETE');
    console.log('='.repeat(60));
    console.log(`Total staging rows:  ${stagingRows.length}`);
    console.log(`Resolved & upserted: ${upserted}`);
    console.log(`Skipped (no league): ${skippedLeague}`);
    console.log(`Skipped (no team):   ${skippedTeam}`);
    console.log(`Dry run:             ${isDryRun}`);
    console.log('');
    if (upserted > 0 && !isDryRun) {
      console.log('Next step: Refresh views to see updated standings in app');
      console.log('  node scripts/refresh_views_manual.js');
    }

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  pool.end().catch(() => {});
  process.exit(1);
});
