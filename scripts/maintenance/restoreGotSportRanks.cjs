/**
 * restoreGotSportRanks.cjs — Authoritative GotSport rankings refresh
 *
 * Fetches current GotSport rankings from their public API and REPLACES
 * stale rank data with fresh authoritative values. Uses clear-then-set:
 *   1. CLEAR all GotSport rank columns for age/gender groups being updated
 *   2. SET fresh values directly from API (no LEAST — this is authoritative data)
 *
 * WHY NOT LEAST? LEAST is correct for team MERGES (two records combining),
 * but wrong for daily authoritative refresh. GotSport is the source of truth
 * for these columns — stale ranks must be cleared, not merely improved.
 * LEAST is preserved in all 7 other files that handle merge operations.
 *
 * OPTIMIZED: Parallel page fetching + bulk SQL matching (not row-by-row)
 *
 * Usage:
 *   node scripts/maintenance/restoreGotSportRanks.cjs              # Dry run
 *   node scripts/maintenance/restoreGotSportRanks.cjs --execute     # Apply
 *   node scripts/maintenance/restoreGotSportRanks.cjs --execute --ages=11  # Just U11
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { authorizePipelineWrite } = require('../universal/pipelineAuthCJS.cjs');
const { removeDuplicatePrefix } = require('../universal/normalizers/cleanTeamName.cjs');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const API_URL = 'https://system.gotsport.com/api/v1/team_ranking_data';
const DELAY_MS = 800;       // 800ms between page batches
const CONCURRENCY = 3;      // 3 concurrent page fetches per category
const AGE_GROUPS = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
const GENDERS = [{ code: 'm', label: 'Boys', db: 'M' }, { code: 'f', label: 'Girls', db: 'F' }];
const SEASON_YEAR = 2026;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchPage(age, genderCode, page, retries = 2) {
  const params = new URLSearchParams({
    'search[team_country]': 'USA',
    'search[age]': age.toString(),
    'search[gender]': genderCode,
    'search[page]': page.toString(),
  });

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(`${API_URL}?${params}`, {
        headers: {
          'Accept': 'application/json',
          'Origin': 'https://rankings.gotsport.com',
          'Referer': 'https://rankings.gotsport.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      return {
        teams: data.team_ranking_data || [],
        totalPages: data.pagination?.total_pages || 1,
        totalCount: data.pagination?.total_count || 0,
      };
    } catch (err) {
      if (attempt < retries) { await sleep(2000); continue; }
      console.error(`  Failed U${age} ${genderCode} p${page}: ${err.message}`);
      return { teams: [], totalPages: 1, totalCount: 0 };
    }
  }
}

// Fetch all pages for a category with parallel batches
async function fetchCategory(age, genderCode) {
  const first = await fetchPage(age, genderCode, 1);
  if (first.teams.length === 0) return [];

  const pages = first.totalPages;
  let allTeams = [...first.teams];

  // Fetch remaining pages in parallel batches
  for (let batchStart = 2; batchStart <= pages; batchStart += CONCURRENCY) {
    const batchEnd = Math.min(batchStart + CONCURRENCY - 1, pages);
    const promises = [];
    for (let p = batchStart; p <= batchEnd; p++) {
      promises.push(fetchPage(age, genderCode, p));
    }
    const results = await Promise.all(promises);
    for (const r of results) {
      allTeams.push(...r.teams);
    }
    if (batchEnd < pages) await sleep(DELAY_MS);
  }

  return allTeams;
}

// Map association code to US state abbreviation
const STATE_MAP = {
  CTE: 'CT', EMA: 'MA', ME: 'ME', NH: 'NH', RI: 'RI', VT: 'VT',
  ENY: 'NY', WNY: 'NY', NJ: 'NJ', EPA: 'PA', WPA: 'PA', MD: 'MD',
  VA: 'VA', DC: 'DC', DE: 'DE', WV: 'WV', NC: 'NC', SC: 'SC',
  GA: 'GA', FL: 'FL', AL: 'AL', MS: 'MS', TN: 'TN', KY: 'KY',
  OH: 'OH', OHN: 'OH', OHS: 'OH', MI: 'MI', IN: 'IN', IL: 'IL',
  WI: 'WI', MN: 'MN', IA: 'IA', ND: 'ND', SD: 'SD', NE: 'NE',
  KS: 'KS', MO: 'MO', OK: 'OK', AR: 'AR', TX: 'TX', TXN: 'TX',
  TXS: 'TX', LA: 'LA', CO: 'CO', NM: 'NM', WY: 'WY', MT: 'MT',
  UT: 'UT', AZ: 'AZ', NV: 'NV', ID: 'ID', OR: 'OR', WA: 'WA',
  AK: 'AK', HI: 'HI', CA: 'CA', CAN: 'CA', CAS: 'CA',
};

function getState(association) {
  if (!association) return null;
  const code = association.trim().toUpperCase();
  if (STATE_MAP[code]) return STATE_MAP[code];
  const prefix = code.substring(0, 2);
  if (/^[A-Z]{2}$/.test(prefix)) return prefix;
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const isExecute = args.includes('--execute');
  const ageFilter = args.find(a => a.startsWith('--ages'))?.split('=')[1]?.split(',').map(Number);
  const ages = ageFilter || AGE_GROUPS;

  console.log('=== GotSport Rankings Recovery (LEAST/GREATEST) ===');
  console.log(`Mode: ${isExecute ? 'EXECUTE' : 'DRY RUN'}`);
  console.log(`Ages: U${ages.join(', U')}`);
  console.log(`Genders: Boys, Girls`);
  console.log(`Parallel: ${CONCURRENCY} concurrent pages, ${DELAY_MS}ms between batches\n`);

  // Phase 1: Fetch all rankings from GotSport API (or load from cache)
  const cacheFile = path.join(__dirname, '..', '_debug', 'gotsport_rank_cache.json');
  const useCache = args.includes('--cached') && fs.existsSync(cacheFile);

  console.log('--- Phase 1: Fetching from GotSport API ---');
  const startFetch = Date.now();
  let allTeams = [];

  if (useCache) {
    allTeams = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    console.log(`  Loaded ${allTeams.length} teams from cache: ${cacheFile}`);
  } else {
    const seenIds = new Set();

    for (const gender of GENDERS) {
      for (const age of ages) {
        const birthYear = SEASON_YEAR - age;
        const catStart = Date.now();
        process.stdout.write(`  U${age} ${gender.label}: `);

        const teams = await fetchCategory(age, gender.code);
        if (teams.length === 0) { console.log('0 teams'); await sleep(DELAY_MS); continue; }

        let added = 0;
        for (const t of teams) {
          if (seenIds.has(t.id)) continue;
          seenIds.add(t.id);
          allTeams.push({
            name: `${(t.club_name || '').trim()} ${(t.team_name || '').trim()} (U${age} ${gender.label})`.trim(),
            clubName: (t.club_name || '').trim(),
            teamName: (t.team_name || '').trim(),
            birthYear,
            gender: gender.db,
            state: getState(t.team_association),
            nationalRank: t.national_rank || null,
            stateRank: t.association_rank || null,
            regionalRank: t.regional_rank || null,
            gotsportPoints: t.total_points || null,
            gotsportTeamId: t.team_id?.toString() || null,
          });
          added++;
        }
        const catSec = ((Date.now() - catStart) / 1000).toFixed(1);
        console.log(`${added} teams in ${catSec}s`);
        await sleep(DELAY_MS);
      }
    }

    // Save cache for future --cached runs
    try {
      fs.writeFileSync(cacheFile, JSON.stringify(allTeams));
      console.log(`  Cached ${allTeams.length} teams to ${cacheFile}`);
    } catch (e) { /* non-critical */ }
  }

  const fetchSec = ((Date.now() - startFetch) / 1000).toFixed(0);
  console.log(`\nTotal fetched: ${allTeams.length} unique teams in ${fetchSec}s`);
  const withRank = allTeams.filter(t => t.nationalRank != null);
  console.log(`With national_rank: ${withRank.length}`);

  // Phase 2: BULK match to teams_v2 and update using LEAST/GREATEST
  console.log('\n--- Phase 2: Bulk Matching & Updating teams_v2 ---');
  const matchStart = Date.now();

  const client = await pool.connect();
  try {
    if (isExecute) {
      await client.query('BEGIN');
      await authorizePipelineWrite(client);
    }

    // Pre-load source_entity_map for gotsport teams (Tier 1)
    const semQ = await client.query(`
      SELECT source_entity_id, sv_id FROM source_entity_map
      WHERE entity_type = 'team' AND source_platform = 'gotsport'
    `);
    const semMap = new Map(semQ.rows.map(r => [r.source_entity_id, r.sv_id]));
    console.log(`  Tier 1 source_entity_map: ${semMap.size} entries`);

    // Pre-load teams_v2 index for Tier 2 exact matching (display_name|birth_year|gender → id)
    const teamsQ = await client.query(`
      SELECT id, display_name, birth_year, gender FROM teams_v2
      WHERE birth_year IS NOT NULL AND gender IS NOT NULL
    `);
    const teamIndex = new Map();
    for (const r of teamsQ.rows) {
      const key = `${r.display_name}|${r.birth_year}|${r.gender}`;
      if (!teamIndex.has(key)) teamIndex.set(key, r.id);
    }
    console.log(`  Tier 2 team index: ${teamIndex.size} entries`);

    // Pre-load canonical_name index for Tier 3 (canonical_name|birth_year|gender → id)
    const canonQ = await client.query(`
      SELECT id, canonical_name, birth_year, gender FROM teams_v2
      WHERE canonical_name IS NOT NULL AND birth_year IS NOT NULL AND gender IS NOT NULL
    `);
    const canonIndex = new Map();
    for (const r of canonQ.rows) {
      const key = `${r.canonical_name}|${r.birth_year}|${r.gender}`;
      if (!canonIndex.has(key)) canonIndex.set(key, r.id);
    }
    console.log(`  Tier 3 canonical index: ${canonIndex.size} entries`);

    // Match all teams using in-memory indexes
    const updates = [];
    const newSemMappings = []; // GotSport team ID → SV UUID for source_entity_map backfill
    let tier1 = 0, tier2 = 0, tier3 = 0, notFound = 0;

    for (const t of withRank) {
      let teamId = null;

      // Tier 1: source_entity_map lookup
      if (t.gotsportTeamId) {
        teamId = semMap.get(t.gotsportTeamId) || null;
        if (teamId) tier1++;
      }

      // Tier 2: Exact display_name + birth_year + gender
      // Apply removeDuplicatePrefix to handle "Club Club Team" → "Club Team" normalization
      if (!teamId) {
        // 2a: Full name with suffix (GotSport-imported teams keep suffix in display_name)
        const fullNorm = removeDuplicatePrefix(t.name);
        const key2a = `${fullNorm}|${t.birthYear}|${t.gender}`;
        teamId = teamIndex.get(key2a) || null;

        // 2b: Without suffix (pipeline-created teams don't have it)
        if (!teamId) {
          const baseName = removeDuplicatePrefix(`${t.clubName} ${t.teamName}`.trim());
          const key2b = `${baseName}|${t.birthYear}|${t.gender}`;
          teamId = teamIndex.get(key2b) || null;
        }

        // 2c: team_name only (handles "Captains Soccer Club" + "Captains SC Boys 15/16 Blue"
        //     where club_name isn't an exact prefix repeat of team_name)
        if (!teamId && t.teamName) {
          const key2c = `${t.teamName}|${t.birthYear}|${t.gender}`;
          teamId = teamIndex.get(key2c) || null;
        }
        if (teamId) tier2++;
      }

      // Tier 3: canonical_name match (lowercase, dedup prefix)
      if (!teamId && t.clubName && t.teamName) {
        // 3a: Full club + team deduped
        const raw = `${t.clubName} ${t.teamName}`;
        const deduped = removeDuplicatePrefix(raw);
        const canonical = deduped.toLowerCase().replace(/\s+/g, ' ').trim();
        const key3 = `${canonical}|${t.birthYear}|${t.gender}`;
        teamId = canonIndex.get(key3) || null;

        // 3b: team_name only canonical
        if (!teamId) {
          const canonTeam = t.teamName.toLowerCase().replace(/\s+/g, ' ').trim();
          const key3b = `${canonTeam}|${t.birthYear}|${t.gender}`;
          teamId = canonIndex.get(key3b) || null;
        }
        if (teamId) tier3++;
      }

      if (!teamId) { notFound++; continue; }

      // Track for source_entity_map backfill
      if (t.gotsportTeamId && !semMap.has(t.gotsportTeamId)) {
        newSemMappings.push([t.gotsportTeamId, teamId]);
      }

      updates.push({
        teamId,
        nationalRank: t.nationalRank,
        stateRank: t.stateRank,
        regionalRank: t.regionalRank,
        gotsportPoints: t.gotsportPoints,
      });
    }

    const matchSec = ((Date.now() - matchStart) / 1000).toFixed(1);
    console.log(`\nMatching complete in ${matchSec}s:`);
    console.log(`  Tier 1 (source_entity_map): ${tier1}`);
    console.log(`  Tier 2 (exact name):        ${tier2}`);
    console.log(`  Tier 3 (canonical name):     ${tier3}`);
    console.log(`  Not found:                   ${notFound}`);
    console.log(`  Total matched:               ${updates.length}`);

    if (!isExecute) {
      // Dry run — show sample updates
      console.log('\nSample updates (first 15):');
      for (const u of updates.slice(0, 15)) {
        const cur = await client.query(
          'SELECT display_name, national_rank, state_rank, gotsport_points FROM teams_v2 WHERE id = $1',
          [u.teamId]
        );
        if (cur.rows.length > 0) {
          const c = cur.rows[0];
          const natResult = c.national_rank == null ? u.nationalRank : Math.min(c.national_rank, u.nationalRank);
          const stResult = c.state_rank == null ? u.stateRank : (u.stateRank == null ? c.state_rank : Math.min(c.state_rank, u.stateRank));
          const ptsResult = c.gotsport_points == null ? u.gotsportPoints : (u.gotsportPoints == null ? c.gotsport_points : Math.max(parseFloat(c.gotsport_points), u.gotsportPoints));
          const natChanged = natResult !== c.national_rank;
          const stChanged = stResult !== c.state_rank;
          const ptsChanged = ptsResult !== parseFloat(c.gotsport_points);
          console.log(`  "${c.display_name}"`);
          console.log(`    nat: ${c.national_rank} → ${natResult}${natChanged ? ' ENHANCED' : ''} | state: ${c.state_rank} → ${stResult}${stChanged ? ' ENHANCED' : ''} | pts: ${c.gotsport_points} → ${ptsResult}${ptsChanged ? ' ENHANCED' : ''}`);
        }
      }

      // Show KS U11 Boys specific preview
      console.log('\n--- KS U11 Boys preview ---');
      const ksUpdates = updates.filter(u => {
        const t = withRank.find(w => w.gotsportTeamId && semMap.get(w.gotsportTeamId) === u.teamId);
        return false; // Can't easily filter by state here
      });

      const verifyQ = await client.query(`
        SELECT state_rank, national_rank, display_name, gotsport_points
        FROM teams_v2
        WHERE state = 'KS' AND birth_year = 2015 AND gender = 'M'
          AND national_rank IS NOT NULL
        ORDER BY state_rank ASC NULLS LAST
        LIMIT 15
      `);
      console.log('Current KS U11 Boys state_ranks:');
      verifyQ.rows.forEach(r => {
        console.log(`  state#${r.state_rank} nat#${r.national_rank} pts=${r.gotsport_points} | ${r.display_name}`);
      });

      console.log('\n--- DRY RUN COMPLETE. Use --execute to apply. ---');
      await pool.end();
      return;
    }

    // EXECUTE: Clear stale ranks, then SET fresh authoritative values

    // Step 1: Collect distinct (birth_year, gender) groups from fetched data
    const groupSet = new Set();
    for (const t of allTeams) {
      if (t.birthYear && t.gender) groupSet.add(`${t.birthYear}|${t.gender}`);
    }
    const groups = [...groupSet].map(g => {
      const [by, gen] = g.split('|');
      return { birthYear: parseInt(by), gender: gen };
    });

    // Step 2: Clear ALL GotSport rank columns for groups being refreshed
    // This removes stale ranks from unmatched/merged teams (the root cause of duplicate ranks)
    console.log(`\nClearing stale GotSport ranks for ${groups.length} age/gender groups...`);
    let cleared = 0;
    for (const g of groups) {
      const res = await client.query(`
        UPDATE teams_v2
        SET national_rank = NULL, state_rank = NULL, regional_rank = NULL, gotsport_points = NULL
        WHERE birth_year = $1 AND gender = $2
          AND (national_rank IS NOT NULL OR state_rank IS NOT NULL
               OR regional_rank IS NOT NULL OR gotsport_points IS NOT NULL)
      `, [g.birthYear, g.gender]);
      cleared += res.rowCount;
    }
    console.log(`  Cleared ${cleared} teams with stale GotSport rank data`);

    // Step 3: SET fresh authoritative values (no LEAST — GotSport is source of truth)
    console.log('\nApplying fresh ranks...');
    let updated = 0;
    const BATCH = 500;
    for (let i = 0; i < updates.length; i += BATCH) {
      const batch = updates.slice(i, i + BATCH);

      const vals = batch.map((u, idx) => {
        const base = idx * 5;
        return `($${base+1}::uuid, $${base+2}::int, $${base+3}::int, $${base+4}::int, $${base+5}::decimal)`;
      }).join(',');

      const params = batch.flatMap(u => [
        u.teamId, u.nationalRank, u.stateRank, u.regionalRank, u.gotsportPoints
      ]);

      const result = await client.query(`
        UPDATE teams_v2 t
        SET national_rank  = v.national_rank,
            state_rank     = v.state_rank,
            regional_rank  = v.regional_rank,
            gotsport_points = v.gotsport_points,
            updated_at = NOW()
        FROM (VALUES ${vals}) AS v(id, national_rank, state_rank, regional_rank, gotsport_points)
        WHERE t.id = v.id
      `, params);

      updated += result.rowCount;
      process.stdout.write(`\r  Updated: ${updated}/${updates.length}`);
    }
    console.log('');

    await client.query('COMMIT');
    console.log(`\nCleared ${cleared} stale → Applied ${updated} fresh GotSport ranks`);

    // Backfill source_entity_map for future Tier 1 matching
    if (newSemMappings.length > 0) {
      console.log(`\nBackfilling ${newSemMappings.length} GotSport team IDs to source_entity_map...`);
      const SEM_BATCH = 500;
      let semInserted = 0;
      for (let i = 0; i < newSemMappings.length; i += SEM_BATCH) {
        const batch = newSemMappings.slice(i, i + SEM_BATCH);
        const vals = batch.map((_, idx) =>
          `('team', 'gotsport', $${idx*2+1}, $${idx*2+2}::uuid)`
        ).join(',');
        const params = batch.flatMap(([gsId, svId]) => [gsId, svId]);
        const res = await client.query(`
          INSERT INTO source_entity_map (entity_type, source_platform, source_entity_id, sv_id)
          VALUES ${vals}
          ON CONFLICT (entity_type, source_platform, source_entity_id) DO NOTHING
        `, params);
        semInserted += res.rowCount;
      }
      console.log(`  Registered ${semInserted} new GotSport team IDs`);
    }

    // Phase 3: Verify KS U11 Boys
    console.log('\n--- Verification: KS U11 Boys ---');
    const verifyQ = await client.query(`
      SELECT state_rank, national_rank, display_name, gotsport_points
      FROM teams_v2
      WHERE state = 'KS' AND birth_year = 2015 AND gender = 'M'
        AND national_rank IS NOT NULL
      ORDER BY state_rank ASC NULLS LAST
      LIMIT 15
    `);
    verifyQ.rows.forEach(r => {
      console.log(`  state#${r.state_rank} nat#${r.national_rank} pts=${r.gotsport_points} | ${r.display_name}`);
    });

    // Check for gaps
    const ranks = verifyQ.rows.map(r => r.state_rank).filter(r => r != null);
    const gaps = [];
    for (let i = 1; i < ranks.length; i++) {
      if (ranks[i] - ranks[i-1] > 1) {
        for (let g = ranks[i-1] + 1; g < ranks[i]; g++) gaps.push(g);
      }
    }
    if (gaps.length > 0) {
      console.log(`\n  Remaining gaps: ${gaps.join(', ')}`);
    } else {
      console.log('\n  No gaps in top 15 state ranks!');
    }

    const totalSec = ((Date.now() - startFetch) / 1000).toFixed(0);
    console.log(`\n=== RECOVERY COMPLETE (${totalSec}s total) ===`);

  } catch (err) {
    console.error('Error:', err.message);
    console.error(err.stack);
    try { await client.query('ROLLBACK'); } catch (e) { /* ignore */ }
  } finally {
    client.release();
    await pool.end();
  }
}

main();
