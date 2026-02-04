/**
 * Universal Canonical Resolver
 * ============================
 *
 * Session 87 - February 4, 2026
 *
 * Implements a UNIFIED resolution strategy for ALL entity types.
 * Every entity (Team, Match, League, Tournament, Club) resolves to
 * exactly ONE SoccerView ID through the same 6-step algorithm.
 *
 * RESOLUTION PRIORITY ORDER:
 * 1. EXACT ID MATCH      → Check if ID already exists
 * 2. SEMANTIC KEY MATCH  → Check by unique semantic attributes
 * 3. CANONICAL REGISTRY  → Check aliases in canonical_* tables
 * 4. FUZZY MATCH         → pg_trgm similarity with thresholds
 * 5. CREATE NEW          → Only if all above fail
 * 6. SELF-LEARNING       → Update registries after any action
 *
 * CRITICAL: Fuzzy matching requires EXACT match on constraining fields.
 * For teams: birth_year AND gender must match EXACTLY.
 *
 * Usage:
 *   import { resolveEntity } from './canonicalResolver.js';
 *   const result = await resolveEntity(client, 'team', teamData);
 *   // result: { action: 'found'|'merged'|'review'|'created', id: uuid }
 */

import pg from 'pg';
const { Pool } = pg;

// ===========================================
// ENTITY CONFIGURATIONS
// ===========================================

/**
 * Configuration for each entity type.
 *
 * semanticKey: Fields that uniquely identify an entity (used for ON CONFLICT)
 * exactMatchFields: Fields that must match EXACTLY for fuzzy comparison
 * fuzzyField: The field to use for fuzzy comparison (usually name)
 * canonicalTable: The registry table for aliases
 * thresholds: { autoMerge: 0.95, review: 0.85 }
 */
export const ENTITY_CONFIGS = {
  team: {
    tableName: 'teams_v2',
    semanticKey: ['display_name', 'birth_year', 'gender'],
    exactMatchFields: ['birth_year', 'gender'],  // MUST match for fuzzy
    fuzzyField: 'canonical_name',
    canonicalTable: 'canonical_teams',
    canonicalLinkField: 'team_v2_id',
    thresholds: {
      autoMerge: 0.95,   // >= 0.95 with same birth_year + gender = auto-merge
      review: 0.85,      // 0.85-0.95 = flag for review
      ignore: 0.85       // < 0.85 = not a match
    }
  },

  match: {
    tableName: 'matches_v2',
    semanticKey: ['match_date', 'home_team_id', 'away_team_id'],
    exactMatchFields: [],  // All semantic key fields are exact
    fuzzyField: null,      // Matches don't use fuzzy matching
    canonicalTable: null,  // No canonical_matches table
    canonicalLinkField: null,
    thresholds: null       // No fuzzy for matches
  },

  league: {
    tableName: 'leagues',
    semanticKey: ['source_event_id', 'source_platform'],
    exactMatchFields: ['year', 'state'],  // Year and state must match
    fuzzyField: 'name',
    canonicalTable: 'canonical_events',
    canonicalLinkField: 'league_id',
    thresholds: {
      autoMerge: 0.90,
      review: 0.80,
      ignore: 0.80
    }
  },

  tournament: {
    tableName: 'tournaments',
    semanticKey: ['source_event_id', 'source_platform'],
    exactMatchFields: ['start_date', 'state'],  // Date and state must match
    fuzzyField: 'name',
    canonicalTable: 'canonical_events',
    canonicalLinkField: 'tournament_id',
    thresholds: {
      autoMerge: 0.90,
      review: 0.80,
      ignore: 0.80
    }
  },

  club: {
    tableName: 'clubs',
    semanticKey: ['name', 'state'],
    exactMatchFields: ['state'],  // State must match for fuzzy
    fuzzyField: 'name',
    canonicalTable: 'canonical_clubs',
    canonicalLinkField: 'club_id',
    thresholds: {
      autoMerge: 0.90,
      review: 0.80,
      ignore: 0.80
    }
  }
};

// ===========================================
// RESOLUTION FUNCTIONS
// ===========================================

/**
 * Step 1: Check for exact ID match
 */
async function findById(client, entityType, id) {
  if (!id) return null;

  const config = ENTITY_CONFIGS[entityType];
  const { rows } = await client.query(
    `SELECT id FROM ${config.tableName} WHERE id = $1`,
    [id]
  );

  return rows.length > 0 ? rows[0] : null;
}

/**
 * Step 2: Check for semantic key match
 */
async function findBySemanticKey(client, entityType, data) {
  const config = ENTITY_CONFIGS[entityType];

  // Build WHERE clause from semantic key
  const conditions = [];
  const values = [];
  let paramIndex = 1;

  for (const field of config.semanticKey) {
    if (data[field] !== undefined && data[field] !== null) {
      conditions.push(`${field} = $${paramIndex}`);
      values.push(data[field]);
      paramIndex++;
    } else {
      // If a semantic key field is missing, can't do semantic lookup
      return null;
    }
  }

  if (conditions.length !== config.semanticKey.length) {
    return null;  // Need all semantic key fields
  }

  const query = `
    SELECT id FROM ${config.tableName}
    WHERE ${conditions.join(' AND ')}
    LIMIT 1
  `;

  const { rows } = await client.query(query, values);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Step 3: Check canonical registry for alias match
 */
async function findInCanonical(client, entityType, data) {
  const config = ENTITY_CONFIGS[entityType];

  if (!config.canonicalTable || !config.fuzzyField) {
    return null;  // Entity type doesn't use canonical registry
  }

  const searchName = data[config.fuzzyField] || data.name || data.display_name;
  if (!searchName) return null;

  // Build query with exact match constraints
  let query;
  let values;

  if (entityType === 'team') {
    // Teams require birth_year and gender match
    if (!data.birth_year || !data.gender) return null;

    query = `
      SELECT ct.${config.canonicalLinkField} as id
      FROM ${config.canonicalTable} ct
      WHERE $1 = ANY(ct.aliases)
        AND ct.birth_year = $2
        AND ct.gender = $3
      LIMIT 1
    `;
    values = [searchName, data.birth_year, data.gender];

  } else if (entityType === 'league' || entityType === 'tournament') {
    // Events use type column to distinguish
    const eventType = entityType;
    query = `
      SELECT ce.${config.canonicalLinkField} as id
      FROM ${config.canonicalTable} ce
      WHERE $1 = ANY(ce.aliases)
        AND ce.type = $2
      LIMIT 1
    `;
    values = [searchName, eventType];

  } else if (entityType === 'club') {
    // Clubs optionally constrain by state
    if (data.state) {
      query = `
        SELECT cc.${config.canonicalLinkField} as id
        FROM ${config.canonicalTable} cc
        WHERE $1 = ANY(cc.aliases)
          AND cc.state = $2
        LIMIT 1
      `;
      values = [searchName, data.state];
    } else {
      query = `
        SELECT cc.${config.canonicalLinkField} as id
        FROM ${config.canonicalTable} cc
        WHERE $1 = ANY(cc.aliases)
        LIMIT 1
      `;
      values = [searchName];
    }
  } else {
    return null;
  }

  const { rows } = await client.query(query, values);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Step 4: Fuzzy match with exact field constraints
 *
 * CRITICAL: exactMatchFields MUST match exactly for any fuzzy comparison.
 * This prevents "Jackson SC 2015 Girls" from matching "Jackson SC 2015 Boys".
 */
async function findByFuzzyMatch(client, entityType, data) {
  const config = ENTITY_CONFIGS[entityType];

  if (!config.thresholds || !config.fuzzyField) {
    return { match: null, confidence: 0 };
  }

  const searchName = data[config.fuzzyField] || data.name || data.display_name;
  if (!searchName) return { match: null, confidence: 0 };

  // Build exact match constraints
  const exactConditions = [];
  const values = [searchName, config.thresholds.review];
  let paramIndex = 3;

  for (const field of config.exactMatchFields) {
    if (data[field] !== undefined && data[field] !== null) {
      exactConditions.push(`${field} = $${paramIndex}`);
      values.push(data[field]);
      paramIndex++;
    } else {
      // If exact match field is missing, skip fuzzy matching
      // This prevents matching without proper constraints
      return { match: null, confidence: 0 };
    }
  }

  const exactClause = exactConditions.length > 0
    ? `AND ${exactConditions.join(' AND ')}`
    : '';

  const query = `
    SELECT id, ${config.fuzzyField}, similarity(${config.fuzzyField}, $1) as sim
    FROM ${config.tableName}
    WHERE similarity(${config.fuzzyField}, $1) >= $2
      ${exactClause}
    ORDER BY sim DESC
    LIMIT 1
  `;

  const { rows } = await client.query(query, values);

  if (rows.length === 0) {
    return { match: null, confidence: 0 };
  }

  return {
    match: rows[0],
    confidence: parseFloat(rows[0].sim)
  };
}

/**
 * Step 6: Self-learning - update canonical registry after any action
 */
async function updateCanonicalRegistry(client, entityType, entityId, data, mergedNames = []) {
  const config = ENTITY_CONFIGS[entityType];

  if (!config.canonicalTable) return;

  const primaryName = data[config.fuzzyField] || data.name || data.display_name;
  const allAliases = [primaryName, ...mergedNames].filter(Boolean);

  // Check if entry exists
  const { rows: existing } = await client.query(
    `SELECT id, aliases FROM ${config.canonicalTable} WHERE ${config.canonicalLinkField} = $1`,
    [entityId]
  );

  if (existing.length > 0) {
    // Update existing entry with new aliases
    const currentAliases = existing[0].aliases || [];
    const newAliases = [...new Set([...currentAliases, ...allAliases])];

    await client.query(
      `UPDATE ${config.canonicalTable} SET aliases = $1, updated_at = NOW() WHERE id = $2`,
      [newAliases, existing[0].id]
    );
  } else {
    // Create new entry
    if (entityType === 'team') {
      await client.query(`
        INSERT INTO ${config.canonicalTable} (canonical_name, birth_year, gender, state, aliases, ${config.canonicalLinkField})
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT DO NOTHING
      `, [primaryName, data.birth_year, data.gender, data.state, allAliases, entityId]);

    } else if (entityType === 'league' || entityType === 'tournament') {
      await client.query(`
        INSERT INTO ${config.canonicalTable} (canonical_name, type, state, aliases, ${config.canonicalLinkField})
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT DO NOTHING
      `, [primaryName, entityType, data.state, allAliases, entityId]);

    } else if (entityType === 'club') {
      await client.query(`
        INSERT INTO ${config.canonicalTable} (canonical_name, state, aliases, ${config.canonicalLinkField})
        VALUES ($1, $2, $3, $4)
        ON CONFLICT DO NOTHING
      `, [primaryName, data.state, allAliases, entityId]);
    }
  }
}

// ===========================================
// MAIN RESOLUTION FUNCTION
// ===========================================

/**
 * Universal Entity Resolution
 *
 * Resolves any entity to its SoccerView ID using the 6-step algorithm.
 *
 * @param {Client} client - PostgreSQL client
 * @param {string} entityType - 'team' | 'match' | 'league' | 'tournament' | 'club'
 * @param {object} data - Entity data with identifying attributes
 * @returns {object} - { action: string, id: string, confidence?: number }
 *
 * Actions:
 * - 'found': Existing entity found (by ID, semantic key, or canonical alias)
 * - 'merged': High-confidence fuzzy match (>= autoMerge threshold)
 * - 'review': Medium-confidence fuzzy match (review threshold to autoMerge)
 * - 'created': New entity created
 */
export async function resolveEntity(client, entityType, data) {
  const config = ENTITY_CONFIGS[entityType];

  if (!config) {
    throw new Error(`Unknown entity type: ${entityType}`);
  }

  // Step 1: Exact ID match
  if (data.id) {
    const existing = await findById(client, entityType, data.id);
    if (existing) {
      return { action: 'found', id: existing.id, method: 'id_match' };
    }
  }

  // Step 2: Semantic key match
  const semantic = await findBySemanticKey(client, entityType, data);
  if (semantic) {
    return { action: 'found', id: semantic.id, method: 'semantic_key' };
  }

  // Step 3: Canonical registry match
  const canonical = await findInCanonical(client, entityType, data);
  if (canonical) {
    return { action: 'found', id: canonical.id, method: 'canonical_alias' };
  }

  // Step 4: Fuzzy match (only for entities with fuzzy support)
  if (config.thresholds) {
    const fuzzy = await findByFuzzyMatch(client, entityType, data);

    if (fuzzy.match && fuzzy.confidence >= config.thresholds.autoMerge) {
      // High confidence - return as merge candidate
      return {
        action: 'merged',
        id: fuzzy.match.id,
        confidence: fuzzy.confidence,
        method: 'fuzzy_auto'
      };
    }

    if (fuzzy.match && fuzzy.confidence >= config.thresholds.review) {
      // Medium confidence - flag for review
      return {
        action: 'review',
        id: fuzzy.match.id,
        confidence: fuzzy.confidence,
        method: 'fuzzy_review'
      };
    }
  }

  // Step 5: No match - signal that entity should be created
  return { action: 'create_new', id: null, method: 'no_match' };
}

/**
 * Resolve and create if needed
 *
 * Full resolution + creation workflow. Used by dataQualityEngine.
 *
 * @param {Client} client - PostgreSQL client
 * @param {string} entityType - Entity type
 * @param {object} data - Entity data
 * @param {object} options - { createIfNotFound: true, autoMerge: false }
 * @returns {object} - Resolution result with final ID
 */
export async function resolveAndCreate(client, entityType, data, options = {}) {
  const { createIfNotFound = true, autoMerge = false } = options;

  const resolution = await resolveEntity(client, entityType, data);

  // Found by any method - return immediately
  if (resolution.action === 'found') {
    return resolution;
  }

  // Fuzzy merge candidate
  if (resolution.action === 'merged') {
    if (autoMerge) {
      // Step 6: Update canonical registry with merged name
      await updateCanonicalRegistry(client, entityType, resolution.id, data, [
        data[ENTITY_CONFIGS[entityType].fuzzyField] || data.name || data.display_name
      ]);
      return resolution;
    }
    // Not auto-merging, treat as found
    return { ...resolution, action: 'found' };
  }

  // Review candidate - return for manual review
  if (resolution.action === 'review') {
    return resolution;
  }

  // Create new entity
  if (resolution.action === 'create_new' && createIfNotFound) {
    // Note: Actual creation is handled by the caller (dataQualityEngine)
    // This just signals that creation is needed
    return { action: 'create', id: null, method: 'new_entity' };
  }

  return resolution;
}

// ===========================================
// CONVENIENCE FUNCTIONS
// ===========================================

/**
 * Resolve a team to its SoccerView ID
 */
export async function resolveTeam(client, teamData) {
  return resolveEntity(client, 'team', teamData);
}

/**
 * Resolve a match to its SoccerView ID
 */
export async function resolveMatch(client, matchData) {
  return resolveEntity(client, 'match', matchData);
}

/**
 * Resolve a league to its SoccerView ID
 */
export async function resolveLeague(client, leagueData) {
  return resolveEntity(client, 'league', leagueData);
}

/**
 * Resolve a tournament to its SoccerView ID
 */
export async function resolveTournament(client, tournamentData) {
  return resolveEntity(client, 'tournament', tournamentData);
}

/**
 * Resolve a club to its SoccerView ID
 */
export async function resolveClub(client, clubData) {
  return resolveEntity(client, 'club', clubData);
}

// ===========================================
// BATCH RESOLUTION
// ===========================================

/**
 * Resolve multiple entities in batch
 *
 * @param {Client} client - PostgreSQL client
 * @param {string} entityType - Entity type
 * @param {Array} dataArray - Array of entity data objects
 * @returns {Array} - Array of resolution results
 */
export async function resolveEntityBatch(client, entityType, dataArray) {
  const results = [];

  for (const data of dataArray) {
    try {
      const result = await resolveEntity(client, entityType, data);
      results.push({ data, result });
    } catch (error) {
      results.push({ data, result: { action: 'error', error: error.message } });
    }
  }

  return results;
}

// ===========================================
// DIAGNOSTIC FUNCTIONS
// ===========================================

/**
 * Generate a resolution report for an entity type
 */
export async function generateResolutionReport(client, entityType) {
  const config = ENTITY_CONFIGS[entityType];

  // Count total entities
  const { rows: total } = await client.query(
    `SELECT COUNT(*) as count FROM ${config.tableName}`
  );

  // Count entities in canonical registry
  let canonicalCount = 0;
  if (config.canonicalTable) {
    const { rows: canonical } = await client.query(
      `SELECT COUNT(*) as count FROM ${config.canonicalTable} WHERE ${config.canonicalLinkField} IS NOT NULL`
    );
    canonicalCount = parseInt(canonical[0].count);
  }

  // For teams, count those with valid metadata
  let validMetadata = 0;
  if (entityType === 'team') {
    const { rows: valid } = await client.query(
      `SELECT COUNT(*) as count FROM teams_v2 WHERE birth_year IS NOT NULL AND gender IS NOT NULL`
    );
    validMetadata = parseInt(valid[0].count);
  }

  return {
    entityType,
    total: parseInt(total[0].count),
    inCanonicalRegistry: canonicalCount,
    registryCoverage: total[0].count > 0
      ? ((canonicalCount / total[0].count) * 100).toFixed(1) + '%'
      : 'N/A',
    validMetadata: entityType === 'team' ? validMetadata : null,
    metadataCoverage: entityType === 'team' && total[0].count > 0
      ? ((validMetadata / total[0].count) * 100).toFixed(1) + '%'
      : null
  };
}

// ===========================================
// CLI
// ===========================================

async function main() {
  const args = process.argv.slice(2);
  const reportMode = args.includes('--report');
  const testMode = args.includes('--test');
  const entityType = args.find(a => !a.startsWith('--')) || 'team';

  console.log('🎯 UNIVERSAL CANONICAL RESOLVER');
  console.log('='.repeat(40));

  await import('dotenv/config');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const client = await pool.connect();

  try {
    if (reportMode) {
      console.log('\n📊 RESOLUTION REPORTS:\n');

      for (const type of ['team', 'match', 'league', 'tournament', 'club']) {
        const report = await generateResolutionReport(client, type);
        console.log(`${type.toUpperCase()}:`);
        console.log(`  Total: ${report.total.toLocaleString()}`);
        if (report.inCanonicalRegistry !== null) {
          console.log(`  In Registry: ${report.inCanonicalRegistry.toLocaleString()} (${report.registryCoverage})`);
        }
        if (report.validMetadata !== null) {
          console.log(`  Valid Metadata: ${report.validMetadata.toLocaleString()} (${report.metadataCoverage})`);
        }
        console.log();
      }
      return;
    }

    if (testMode) {
      console.log('\n🧪 TEST MODE - Resolving sample entities...\n');

      // Test team resolution
      const testTeam = {
        display_name: 'Sporting BV Pre-NAL 15',
        canonical_name: 'sporting bv pre-nal 15',
        birth_year: 2015,
        gender: 'Boys',
        state: 'KS'
      };

      console.log('Test Team:', testTeam);
      const teamResult = await resolveEntity(client, 'team', testTeam);
      console.log('Result:', teamResult);
      console.log();

      // Test match resolution
      const testMatch = {
        match_date: '2025-03-15',
        home_team_id: 'some-uuid-here',
        away_team_id: 'another-uuid-here'
      };

      console.log('Test Match:', testMatch);
      const matchResult = await resolveEntity(client, 'match', testMatch);
      console.log('Result:', matchResult);
      return;
    }

    // Default: show config
    console.log('\n📋 ENTITY CONFIGURATIONS:\n');
    for (const [type, config] of Object.entries(ENTITY_CONFIGS)) {
      console.log(`${type.toUpperCase()}:`);
      console.log(`  Table: ${config.tableName}`);
      console.log(`  Semantic Key: ${config.semanticKey.join(', ')}`);
      console.log(`  Exact Match Fields: ${config.exactMatchFields.join(', ') || 'none'}`);
      console.log(`  Fuzzy Field: ${config.fuzzyField || 'N/A'}`);
      console.log(`  Canonical Table: ${config.canonicalTable || 'N/A'}`);
      if (config.thresholds) {
        console.log(`  Thresholds: autoMerge=${config.thresholds.autoMerge}, review=${config.thresholds.review}`);
      }
      console.log();
    }

  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1]?.includes('canonicalResolver')) {
  main().catch(e => {
    console.error('❌ Error:', e.message);
    process.exit(1);
  });
}

export default {
  ENTITY_CONFIGS,
  resolveEntity,
  resolveAndCreate,
  resolveTeam,
  resolveMatch,
  resolveLeague,
  resolveTournament,
  resolveClub,
  resolveEntityBatch,
  generateResolutionReport
};
