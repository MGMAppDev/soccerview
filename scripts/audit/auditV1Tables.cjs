/**
 * auditV1Tables.cjs
 * Session 83: Comprehensive V1 Deprecated Tables Audit
 *
 * This script performs a READ-ONLY audit of all V1 deprecated tables to:
 * 1. List all deprecated tables with row counts and sizes
 * 2. Assess data quality per table
 * 3. Check what has already been migrated to V2
 * 4. Identify gaps and opportunities
 *
 * Output: Console report + docs/V1_AUDIT_REPORT.md
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  statement_timeout: 300000, // 5 minutes for large queries
});

// ============================================================================
// AUDIT QUERIES
// ============================================================================

async function listDeprecatedTables() {
  console.log('\n=== 1.1 LISTING ALL DEPRECATED TABLES ===\n');

  const { rows } = await pool.query(`
    SELECT
      table_name,
      pg_size_pretty(pg_total_relation_size(quote_ident(table_name))) as size,
      pg_total_relation_size(quote_ident(table_name)) as size_bytes
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name LIKE '%_deprecated%'
    ORDER BY table_name;
  `);

  console.log('Deprecated Tables Found:');
  console.log('─'.repeat(60));

  for (const row of rows) {
    console.log(`  ${row.table_name.padEnd(35)} ${row.size}`);
  }

  return rows;
}

async function getTableRowCounts(tables) {
  console.log('\n=== 1.2 TABLE ROW COUNTS ===\n');

  const results = [];

  for (const table of tables) {
    try {
      const { rows } = await pool.query(`SELECT COUNT(*) as count FROM ${table.table_name}`);
      const count = parseInt(rows[0].count);
      results.push({
        table: table.table_name,
        rows: count,
        size: table.size
      });
      console.log(`  ${table.table_name.padEnd(35)} ${count.toLocaleString().padStart(12)} rows`);
    } catch (err) {
      console.log(`  ${table.table_name.padEnd(35)} ERROR: ${err.message}`);
      results.push({
        table: table.table_name,
        rows: 'ERROR',
        size: table.size,
        error: err.message
      });
    }
  }

  return results;
}

async function auditMatchResultsDeprecated() {
  console.log('\n=== 1.3 MATCH_RESULTS_DEPRECATED QUALITY ===\n');

  const { rows } = await pool.query(`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL) as has_both_teams,
      COUNT(*) FILTER (WHERE home_team_id IS NULL OR away_team_id IS NULL) as missing_teams,
      COUNT(*) FILTER (WHERE home_team_id IS NULL AND away_team_id IS NULL) as missing_both,
      COUNT(*) FILTER (WHERE match_date IS NOT NULL) as has_date,
      COUNT(*) FILTER (WHERE home_score IS NOT NULL AND away_score IS NOT NULL) as has_scores,
      COUNT(*) FILTER (WHERE event_id IS NOT NULL) as has_event_id,
      MIN(match_date) as earliest_match,
      MAX(match_date) as latest_match
    FROM match_results_deprecated;
  `);

  const r = rows[0];
  console.log('Quality Metrics:');
  console.log('─'.repeat(60));
  console.log(`  Total Records:           ${parseInt(r.total).toLocaleString()}`);
  console.log(`  Has Both Team IDs:       ${parseInt(r.has_both_teams).toLocaleString()} (${(100*r.has_both_teams/r.total).toFixed(1)}%)`);
  console.log(`  Missing Team ID(s):      ${parseInt(r.missing_teams).toLocaleString()} (${(100*r.missing_teams/r.total).toFixed(1)}%)`);
  console.log(`  Missing BOTH Team IDs:   ${parseInt(r.missing_both).toLocaleString()} (${(100*r.missing_both/r.total).toFixed(1)}%)`);
  console.log(`  Has Match Date:          ${parseInt(r.has_date).toLocaleString()} (${(100*r.has_date/r.total).toFixed(1)}%)`);
  console.log(`  Has Scores:              ${parseInt(r.has_scores).toLocaleString()} (${(100*r.has_scores/r.total).toFixed(1)}%)`);
  console.log(`  Has Event ID:            ${parseInt(r.has_event_id).toLocaleString()} (${(100*r.has_event_id/r.total).toFixed(1)}%)`);
  console.log(`  Date Range:              ${r.earliest_match} to ${r.latest_match}`);

  return r;
}

async function auditTeamsDeprecated() {
  console.log('\n=== 1.4 TEAMS_DEPRECATED QUALITY ===\n');

  try {
    // First, get the column names to understand the schema
    const { rows: columns } = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'teams_deprecated'
      ORDER BY ordinal_position;
    `);

    console.log('Schema columns:', columns.map(c => c.column_name).join(', '));

    // Build dynamic query based on available columns
    const columnNames = columns.map(c => c.column_name);
    const hasColumn = (name) => columnNames.includes(name);

    let selectParts = ['COUNT(*) as total'];

    if (hasColumn('team_name') || hasColumn('name')) {
      const nameCol = hasColumn('team_name') ? 'team_name' : 'name';
      selectParts.push(`COUNT(*) FILTER (WHERE ${nameCol} IS NOT NULL AND ${nameCol} != '') as has_name`);
    }
    if (hasColumn('birth_year')) {
      selectParts.push(`COUNT(*) FILTER (WHERE birth_year IS NOT NULL) as has_birth_year`);
    }
    if (hasColumn('gender')) {
      selectParts.push(`COUNT(*) FILTER (WHERE gender IS NOT NULL) as has_gender`);
    }
    if (hasColumn('state')) {
      selectParts.push(`COUNT(*) FILTER (WHERE state IS NOT NULL) as has_state`);
    }
    if (hasColumn('national_rank')) {
      selectParts.push(`COUNT(*) FILTER (WHERE national_rank IS NOT NULL) as has_national_rank`);
    }
    if (hasColumn('elo_rating') || hasColumn('elo')) {
      const eloCol = hasColumn('elo_rating') ? 'elo_rating' : 'elo';
      selectParts.push(`COUNT(*) FILTER (WHERE ${eloCol} IS NOT NULL AND ${eloCol} != 1500) as has_elo`);
    }

    const { rows } = await pool.query(`SELECT ${selectParts.join(', ')} FROM teams_deprecated;`);

    const r = rows[0];
    console.log('Quality Metrics:');
    console.log('─'.repeat(60));
    console.log(`  Total Records:           ${parseInt(r.total).toLocaleString()}`);
    if (r.has_name !== undefined) console.log(`  Has Team Name:           ${parseInt(r.has_name).toLocaleString()} (${(100*r.has_name/r.total).toFixed(1)}%)`);
    if (r.has_birth_year !== undefined) console.log(`  Has Birth Year:          ${parseInt(r.has_birth_year).toLocaleString()} (${(100*r.has_birth_year/r.total).toFixed(1)}%)`);
    if (r.has_gender !== undefined) console.log(`  Has Gender:              ${parseInt(r.has_gender).toLocaleString()} (${(100*r.has_gender/r.total).toFixed(1)}%)`);
    if (r.has_state !== undefined) console.log(`  Has State:               ${parseInt(r.has_state).toLocaleString()} (${(100*r.has_state/r.total).toFixed(1)}%)`);
    if (r.has_national_rank !== undefined) console.log(`  Has National Rank:       ${parseInt(r.has_national_rank).toLocaleString()} (${(100*r.has_national_rank/r.total).toFixed(1)}%)`);
    if (r.has_elo !== undefined) console.log(`  Has Non-Default ELO:     ${parseInt(r.has_elo).toLocaleString()} (${(100*r.has_elo/r.total).toFixed(1)}%)`);

    return { ...r, columns: columnNames };
  } catch (err) {
    console.log(`  Error: ${err.message}`);
    return { error: err.message };
  }
}

async function auditRankHistoryDeprecated() {
  console.log('\n=== 1.5 RANK_HISTORY_DEPRECATED QUALITY ===\n');

  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE team_id IS NOT NULL) as has_team_id,
        COUNT(*) FILTER (WHERE snapshot_date IS NOT NULL) as has_date,
        COUNT(*) FILTER (WHERE national_rank IS NOT NULL) as has_national_rank,
        COUNT(*) FILTER (WHERE state_rank IS NOT NULL) as has_state_rank,
        COUNT(*) FILTER (WHERE elo_rating IS NOT NULL) as has_elo,
        COUNT(DISTINCT team_id) as unique_teams,
        COUNT(DISTINCT snapshot_date) as unique_dates,
        MIN(snapshot_date) as earliest_snapshot,
        MAX(snapshot_date) as latest_snapshot
      FROM rank_history_deprecated;
    `);

    const r = rows[0];
    console.log('Quality Metrics:');
    console.log('─'.repeat(60));
    console.log(`  Total Records:           ${parseInt(r.total).toLocaleString()}`);
    console.log(`  Has Team ID:             ${parseInt(r.has_team_id).toLocaleString()} (${(100*r.has_team_id/r.total).toFixed(1)}%)`);
    console.log(`  Has Snapshot Date:       ${parseInt(r.has_date).toLocaleString()} (${(100*r.has_date/r.total).toFixed(1)}%)`);
    console.log(`  Has National Rank:       ${parseInt(r.has_national_rank).toLocaleString()} (${(100*r.has_national_rank/r.total).toFixed(1)}%)`);
    console.log(`  Has State Rank:          ${parseInt(r.has_state_rank).toLocaleString()} (${(100*r.has_state_rank/r.total).toFixed(1)}%)`);
    console.log(`  Has ELO Rating:          ${parseInt(r.has_elo).toLocaleString()} (${(100*r.has_elo/r.total).toFixed(1)}%)`);
    console.log(`  Unique Teams:            ${parseInt(r.unique_teams).toLocaleString()}`);
    console.log(`  Unique Dates:            ${parseInt(r.unique_dates).toLocaleString()}`);
    console.log(`  Date Range:              ${r.earliest_snapshot} to ${r.latest_snapshot}`);

    return r;
  } catch (err) {
    console.log(`  Table may not exist or has different schema: ${err.message}`);
    return { error: err.message };
  }
}

async function auditEventRegistryDeprecated() {
  console.log('\n=== 1.6 EVENT_REGISTRY_DEPRECATED QUALITY ===\n');

  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE event_name IS NOT NULL) as has_name,
        COUNT(*) FILTER (WHERE source_event_id IS NOT NULL) as has_source_id,
        COUNT(*) FILTER (WHERE event_type IS NOT NULL) as has_type,
        COUNT(*) FILTER (WHERE state IS NOT NULL) as has_state,
        COUNT(DISTINCT source_event_id) as unique_events
      FROM event_registry_deprecated;
    `);

    const r = rows[0];
    console.log('Quality Metrics:');
    console.log('─'.repeat(60));
    console.log(`  Total Records:           ${parseInt(r.total).toLocaleString()}`);
    console.log(`  Has Event Name:          ${parseInt(r.has_name).toLocaleString()} (${(100*r.has_name/r.total).toFixed(1)}%)`);
    console.log(`  Has Source Event ID:     ${parseInt(r.has_source_id).toLocaleString()} (${(100*r.has_source_id/r.total).toFixed(1)}%)`);
    console.log(`  Has Event Type:          ${parseInt(r.has_type).toLocaleString()} (${(100*r.has_type/r.total).toFixed(1)}%)`);
    console.log(`  Has State:               ${parseInt(r.has_state).toLocaleString()} (${(100*r.has_state/r.total).toFixed(1)}%)`);
    console.log(`  Unique Events:           ${parseInt(r.unique_events).toLocaleString()}`);

    return r;
  } catch (err) {
    console.log(`  Table may not exist or has different schema: ${err.message}`);
    return { error: err.message };
  }
}

async function auditTeamNameAliasesDeprecated() {
  console.log('\n=== 1.7 TEAM_NAME_ALIASES_DEPRECATED QUALITY ===\n');

  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE canonical_name IS NOT NULL) as has_canonical,
        COUNT(*) FILTER (WHERE alias_name IS NOT NULL) as has_alias,
        COUNT(DISTINCT canonical_name) as unique_canonicals,
        COUNT(DISTINCT alias_name) as unique_aliases
      FROM team_name_aliases_deprecated;
    `);

    const r = rows[0];
    console.log('Quality Metrics:');
    console.log('─'.repeat(60));
    console.log(`  Total Records:           ${parseInt(r.total).toLocaleString()}`);
    console.log(`  Has Canonical Name:      ${parseInt(r.has_canonical).toLocaleString()} (${(100*r.has_canonical/r.total).toFixed(1)}%)`);
    console.log(`  Has Alias Name:          ${parseInt(r.has_alias).toLocaleString()} (${(100*r.has_alias/r.total).toFixed(1)}%)`);
    console.log(`  Unique Canonical Names:  ${parseInt(r.unique_canonicals).toLocaleString()}`);
    console.log(`  Unique Alias Names:      ${parseInt(r.unique_aliases).toLocaleString()}`);

    return r;
  } catch (err) {
    console.log(`  Table may not exist or has different schema: ${err.message}`);
    return { error: err.message };
  }
}

async function checkAlreadyMigrated() {
  console.log('\n=== 1.8 ALREADY MIGRATED (Session 82) ===\n');

  // V1 matches in V2
  const { rows: v2Matches } = await pool.query(`
    SELECT COUNT(*) as count FROM matches_v2 WHERE source_match_key LIKE 'v1-legacy-%';
  `);

  // V1 matches still in staging (limbo)
  const { rows: limboMatches } = await pool.query(`
    SELECT COUNT(*) as count FROM staging_games
    WHERE source_match_key LIKE 'v1-legacy-%'
      AND processed = true
      AND NOT EXISTS (SELECT 1 FROM matches_v2 m WHERE m.source_match_key = staging_games.source_match_key);
  `);

  // V1 matches in staging not yet processed
  const { rows: unprocessed } = await pool.query(`
    SELECT COUNT(*) as count FROM staging_games
    WHERE source_match_key LIKE 'v1-legacy-%'
      AND processed = false;
  `);

  // Total current V2 state
  const { rows: totalV2 } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM teams_v2) as teams,
      (SELECT COUNT(*) FROM matches_v2) as matches,
      (SELECT COUNT(*) FROM canonical_teams) as canonical_teams,
      (SELECT COUNT(*) FROM canonical_events) as canonical_events;
  `);

  console.log('Migration Status:');
  console.log('─'.repeat(60));
  console.log(`  V1 Matches in matches_v2:    ${parseInt(v2Matches[0].count).toLocaleString()}`);
  console.log(`  V1 Matches in Limbo:         ${parseInt(limboMatches[0].count).toLocaleString()}`);
  console.log(`  V1 Matches Unprocessed:      ${parseInt(unprocessed[0].count).toLocaleString()}`);
  console.log('');
  console.log('Current V2 State:');
  console.log('─'.repeat(60));
  console.log(`  teams_v2:                    ${parseInt(totalV2[0].teams).toLocaleString()}`);
  console.log(`  matches_v2:                  ${parseInt(totalV2[0].matches).toLocaleString()}`);
  console.log(`  canonical_teams:             ${parseInt(totalV2[0].canonical_teams).toLocaleString()}`);
  console.log(`  canonical_events:            ${parseInt(totalV2[0].canonical_events).toLocaleString()}`);

  return {
    v1_in_v2: parseInt(v2Matches[0].count),
    v1_limbo: parseInt(limboMatches[0].count),
    v1_unprocessed: parseInt(unprocessed[0].count),
    current_v2: totalV2[0]
  };
}

async function checkRankHistoryV2() {
  console.log('\n=== 1.9 RANK_HISTORY_V2 CURRENT STATE ===\n');

  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(DISTINCT team_id) as unique_teams,
        COUNT(DISTINCT snapshot_date) as unique_dates,
        MIN(snapshot_date) as earliest,
        MAX(snapshot_date) as latest,
        COUNT(*) FILTER (WHERE elo_rating IS NOT NULL) as has_elo,
        COUNT(*) FILTER (WHERE national_rank IS NOT NULL) as has_gs_rank
      FROM rank_history_v2;
    `);

    const r = rows[0];
    console.log('V2 Rank History State:');
    console.log('─'.repeat(60));
    console.log(`  Total Records:           ${parseInt(r.total).toLocaleString()}`);
    console.log(`  Unique Teams:            ${parseInt(r.unique_teams).toLocaleString()}`);
    console.log(`  Unique Dates:            ${parseInt(r.unique_dates).toLocaleString()}`);
    console.log(`  Date Range:              ${r.earliest} to ${r.latest}`);
    console.log(`  Has ELO Rating:          ${parseInt(r.has_elo).toLocaleString()}`);
    console.log(`  Has GS National Rank:    ${parseInt(r.has_gs_rank).toLocaleString()}`);

    return r;
  } catch (err) {
    console.log(`  Error: ${err.message}`);
    return { error: err.message };
  }
}

async function checkV1TeamIDsInV2() {
  console.log('\n=== 1.10 V1 TEAM IDs STILL VALID IN V2 ===\n');

  try {
    // Check how many V1 team IDs exist in V2
    const { rows } = await pool.query(`
      SELECT
        (SELECT COUNT(DISTINCT team_id) FROM rank_history_deprecated WHERE team_id IS NOT NULL) as v1_team_ids,
        (SELECT COUNT(*) FROM teams_v2 WHERE id IN (SELECT DISTINCT team_id FROM rank_history_deprecated WHERE team_id IS NOT NULL)) as still_in_v2;
    `);

    const r = rows[0];
    const v1Count = parseInt(r.v1_team_ids);
    const v2Count = parseInt(r.still_in_v2);

    console.log('Team ID Migration:');
    console.log('─'.repeat(60));
    console.log(`  V1 Unique Team IDs:      ${v1Count.toLocaleString()}`);
    console.log(`  Still Valid in V2:       ${v2Count.toLocaleString()} (${(100*v2Count/v1Count).toFixed(1)}%)`);
    console.log(`  Lost/Changed:            ${(v1Count - v2Count).toLocaleString()} (${(100*(v1Count-v2Count)/v1Count).toFixed(1)}%)`);

    return { v1_team_ids: v1Count, still_in_v2: v2Count };
  } catch (err) {
    console.log(`  Error: ${err.message}`);
    return { error: err.message };
  }
}

// ============================================================================
// REPORT GENERATION
// ============================================================================

function generateMarkdownReport(auditResults) {
  const now = new Date().toISOString().split('T')[0];

  let md = `# V1 Deprecated Tables Audit Report

> **Generated:** ${now}
> **Session:** 83
> **Status:** Complete

---

## Executive Summary

This audit catalogues ALL V1 deprecated tables to identify:
- What data exists
- What has already been migrated to V2
- What can still be recovered
- What is unrecoverable

---

## 1. Deprecated Tables Inventory

| Table | Rows | Size | Status |
|-------|------|------|--------|
`;

  for (const table of auditResults.tables) {
    md += `| ${table.table} | ${typeof table.rows === 'number' ? table.rows.toLocaleString() : table.rows} | ${table.size} | TBD |\n`;
  }

  md += `
---

## 2. Match Results Quality (match_results_deprecated)

| Metric | Value | Percentage |
|--------|-------|------------|
| Total Records | ${parseInt(auditResults.matchResults.total).toLocaleString()} | 100% |
| Has Both Team IDs | ${parseInt(auditResults.matchResults.has_both_teams).toLocaleString()} | ${(100*auditResults.matchResults.has_both_teams/auditResults.matchResults.total).toFixed(1)}% |
| Missing Team ID(s) | ${parseInt(auditResults.matchResults.missing_teams).toLocaleString()} | ${(100*auditResults.matchResults.missing_teams/auditResults.matchResults.total).toFixed(1)}% |
| Has Scores | ${parseInt(auditResults.matchResults.has_scores).toLocaleString()} | ${(100*auditResults.matchResults.has_scores/auditResults.matchResults.total).toFixed(1)}% |
| Has Event ID | ${parseInt(auditResults.matchResults.has_event_id).toLocaleString()} | ${(100*auditResults.matchResults.has_event_id/auditResults.matchResults.total).toFixed(1)}% |

**Date Range:** ${auditResults.matchResults.earliest_match} to ${auditResults.matchResults.latest_match}

---

## 3. Teams Quality (teams_deprecated)

| Metric | Value | Percentage |
|--------|-------|------------|
| Total Records | ${parseInt(auditResults.teams.total).toLocaleString()} | 100% |
| Has Team Name | ${parseInt(auditResults.teams.has_name).toLocaleString()} | ${(100*auditResults.teams.has_name/auditResults.teams.total).toFixed(1)}% |
| Has Birth Year | ${parseInt(auditResults.teams.has_birth_year).toLocaleString()} | ${(100*auditResults.teams.has_birth_year/auditResults.teams.total).toFixed(1)}% |
| Has Gender | ${parseInt(auditResults.teams.has_gender).toLocaleString()} | ${(100*auditResults.teams.has_gender/auditResults.teams.total).toFixed(1)}% |
| Has National Rank | ${parseInt(auditResults.teams.has_national_rank).toLocaleString()} | ${(100*auditResults.teams.has_national_rank/auditResults.teams.total).toFixed(1)}% |

---

## 4. Rank History (rank_history_deprecated)

`;

  if (auditResults.rankHistory.error) {
    md += `**Error:** ${auditResults.rankHistory.error}\n`;
  } else {
    md += `| Metric | Value |
|--------|-------|
| Total Records | ${parseInt(auditResults.rankHistory.total).toLocaleString()} |
| Unique Teams | ${parseInt(auditResults.rankHistory.unique_teams).toLocaleString()} |
| Unique Dates | ${parseInt(auditResults.rankHistory.unique_dates).toLocaleString()} |
| Date Range | ${auditResults.rankHistory.earliest_snapshot} to ${auditResults.rankHistory.latest_snapshot} |
| Has National Rank | ${parseInt(auditResults.rankHistory.has_national_rank).toLocaleString()} |
| Has ELO Rating | ${parseInt(auditResults.rankHistory.has_elo).toLocaleString()} |
`;
  }

  md += `
---

## 5. Event Registry (event_registry_deprecated)

`;

  if (auditResults.eventRegistry.error) {
    md += `**Error:** ${auditResults.eventRegistry.error}\n`;
  } else {
    md += `| Metric | Value |
|--------|-------|
| Total Records | ${parseInt(auditResults.eventRegistry.total).toLocaleString()} |
| Unique Events | ${parseInt(auditResults.eventRegistry.unique_events).toLocaleString()} |
| Has Event Name | ${parseInt(auditResults.eventRegistry.has_name).toLocaleString()} |
| Has Source Event ID | ${parseInt(auditResults.eventRegistry.has_source_id).toLocaleString()} |
`;
  }

  md += `
---

## 6. Team Name Aliases (team_name_aliases_deprecated)

`;

  if (auditResults.aliases.error) {
    md += `**Error:** ${auditResults.aliases.error}\n`;
  } else {
    md += `| Metric | Value |
|--------|-------|
| Total Records | ${parseInt(auditResults.aliases.total).toLocaleString()} |
| Unique Canonical Names | ${parseInt(auditResults.aliases.unique_canonicals).toLocaleString()} |
| Unique Aliases | ${parseInt(auditResults.aliases.unique_aliases).toLocaleString()} |
`;
  }

  md += `
---

## 7. Migration Status (Session 82)

| Metric | Value |
|--------|-------|
| V1 Matches in matches_v2 | ${auditResults.migrationStatus.v1_in_v2.toLocaleString()} |
| V1 Matches in Limbo | ${auditResults.migrationStatus.v1_limbo.toLocaleString()} |
| V1 Matches Unprocessed | ${auditResults.migrationStatus.v1_unprocessed.toLocaleString()} |

### Current V2 State

| Table | Rows |
|-------|------|
| teams_v2 | ${parseInt(auditResults.migrationStatus.current_v2.teams).toLocaleString()} |
| matches_v2 | ${parseInt(auditResults.migrationStatus.current_v2.matches).toLocaleString()} |
| canonical_teams | ${parseInt(auditResults.migrationStatus.current_v2.canonical_teams).toLocaleString()} |
| canonical_events | ${parseInt(auditResults.migrationStatus.current_v2.canonical_events).toLocaleString()} |

---

## 8. Rank History V2 State

`;

  if (auditResults.rankHistoryV2.error) {
    md += `**Error:** ${auditResults.rankHistoryV2.error}\n`;
  } else {
    md += `| Metric | Value |
|--------|-------|
| Total Records | ${parseInt(auditResults.rankHistoryV2.total).toLocaleString()} |
| Unique Teams | ${parseInt(auditResults.rankHistoryV2.unique_teams).toLocaleString()} |
| Unique Dates | ${parseInt(auditResults.rankHistoryV2.unique_dates).toLocaleString()} |
| Date Range | ${auditResults.rankHistoryV2.earliest} to ${auditResults.rankHistoryV2.latest} |
`;
  }

  md += `
---

## 9. V1 Team IDs in V2

`;

  if (auditResults.teamIdMigration.error) {
    md += `**Error:** ${auditResults.teamIdMigration.error}\n`;
  } else {
    md += `| Metric | Value |
|--------|-------|
| V1 Unique Team IDs | ${auditResults.teamIdMigration.v1_team_ids.toLocaleString()} |
| Still Valid in V2 | ${auditResults.teamIdMigration.still_in_v2.toLocaleString()} |
| Lost/Changed | ${(auditResults.teamIdMigration.v1_team_ids - auditResults.teamIdMigration.still_in_v2).toLocaleString()} |
`;
  }

  md += `
---

## 10. Triage Decision Matrix

| V1 Table | Category | Rationale | Action |
|----------|----------|-----------|--------|
| match_results_deprecated (with teams) | ALREADY_DONE | Session 82 migrated | Verify only |
| match_results_deprecated (NULL teams) | UNRECOVERABLE | No team identification | Move to staging_rejected |
| teams_deprecated | REFERENCE_ONLY | Teams exist in V2 | Use for name matching |
| rank_history_deprecated | TBD | Historical data | Analyze overlap with V2 |
| team_name_aliases_deprecated | TBD | Deduplication value | Check if useful |
| event_registry_deprecated | TBD | Event metadata | Check against canonical_events |
| predictions_deprecated | NOT_NEEDED | User feature | Document and ignore |

---

## Next Steps

1. **Phase 2:** Complete triage classification based on this audit
2. **Phase 3:** Extract MIGRATE-category data to staging
3. **Phase 4:** Process through dataQualityEngine
4. **Phase 5:** Verify data integrity

---

*Generated by auditV1Tables.cjs*
`;

  return md;
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║       SESSION 83: V1 DEPRECATED TABLES COMPREHENSIVE AUDIT     ║');
  console.log('║                        READ-ONLY OPERATION                      ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');

  try {
    // 1.1 List all deprecated tables
    const tables = await listDeprecatedTables();

    // 1.2 Get row counts
    const tableCounts = await getTableRowCounts(tables);

    // 1.3-1.7 Audit each table
    const matchResults = await auditMatchResultsDeprecated();
    const teams = await auditTeamsDeprecated();
    const rankHistory = await auditRankHistoryDeprecated();
    const eventRegistry = await auditEventRegistryDeprecated();
    const aliases = await auditTeamNameAliasesDeprecated();

    // 1.8 Check migration status
    const migrationStatus = await checkAlreadyMigrated();

    // 1.9 Check V2 rank history
    const rankHistoryV2 = await checkRankHistoryV2();

    // 1.10 Check V1 team IDs in V2
    const teamIdMigration = await checkV1TeamIDsInV2();

    // Compile results
    const auditResults = {
      tables: tableCounts,
      matchResults,
      teams,
      rankHistory,
      eventRegistry,
      aliases,
      migrationStatus,
      rankHistoryV2,
      teamIdMigration
    };

    // Generate markdown report
    const reportContent = generateMarkdownReport(auditResults);

    // Write report
    const reportPath = path.join(__dirname, '../../docs/V1_AUDIT_REPORT.md');
    fs.writeFileSync(reportPath, reportContent);

    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║                      AUDIT COMPLETE                             ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log(`\n✅ Report saved to: docs/V1_AUDIT_REPORT.md\n`);

  } catch (err) {
    console.error('AUDIT FAILED:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
