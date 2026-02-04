/**
 * Intake Validator v1.0
 * =====================
 *
 * Pre-staging validation gate that rejects garbage data BEFORE it enters the pipeline.
 * Part of V2 Architecture Enforcement (Session 79).
 *
 * VALIDATION RULES:
 * - EMPTY_TEAM_NAME: home_team_name or away_team_name is empty/null
 * - INVALID_DATE: match_date is null or unparseable
 * - FUTURE_DATE_2027: match_date is after 2027-12-31 (impossibly far in future)
 * - INVALID_BIRTH_YEAR: extractable birth year indicates invalid age group (U1, U2, U20+)
 * - UNKNOWN_PLATFORM: source_platform is not recognized
 * - SAME_TEAM: home_team_name equals away_team_name (team playing itself)
 * - MALFORMED_KEY: source_match_key contains newlines or other invalid characters
 *
 * MODES:
 * --validate-batch <json>   Validate a batch of records (returns valid/invalid arrays)
 * --clean-staging           Move invalid records from staging_games to staging_rejected
 * --report                  Report on current staging data quality
 *
 * Usage:
 *   node scripts/universal/intakeValidator.js --report
 *   node scripts/universal/intakeValidator.js --clean-staging --dry-run
 *   node scripts/universal/intakeValidator.js --clean-staging --limit 1000
 *   node scripts/universal/intakeValidator.js --clean-staging
 */

import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

// ===========================================
// CONFIGURATION
// ===========================================

const CONFIG = {
  KNOWN_PLATFORMS: ['gotsport', 'htgsports', 'heartland'],
  MAX_VALID_DATE: new Date('2027-12-31'),  // Anything beyond this is garbage
  MIN_VALID_DATE: new Date('2020-01-01'),  // Anything before this is suspicious
  MIN_VALID_BIRTH_YEAR: 2005,              // U20 in 2025 (oldest valid youth)
  MAX_VALID_BIRTH_YEAR: 2020,              // U5 in 2025 (youngest valid youth)
  BATCH_SIZE: 1000,
  VALIDATOR_VERSION: '1.1',  // Updated in Session 84

  // Session 84: Premier-only policy - reject recreational data
  // See CLAUDE.md Principle 28 and docs/SESSION_84_PREMIER_ONLY_PLAN.md
  RECREATIONAL_PATTERNS: [
    /heartland-recreational/i,       // Heartland recreational source_match_key
    /recreational.*league/i,         // "Recreational League" in event name
    /\brec\s+(soccer|league|team)/i, // "Rec soccer", "Rec league", "Rec team"
  ],
};

// Rejection codes
const REJECTION_CODES = {
  EMPTY_HOME_TEAM: 'EMPTY_HOME_TEAM',
  EMPTY_AWAY_TEAM: 'EMPTY_AWAY_TEAM',
  INVALID_DATE: 'INVALID_DATE',
  FUTURE_DATE_2027: 'FUTURE_DATE_2027',
  PAST_DATE_2020: 'PAST_DATE_2020',
  INVALID_BIRTH_YEAR: 'INVALID_BIRTH_YEAR',
  UNKNOWN_PLATFORM: 'UNKNOWN_PLATFORM',
  SAME_TEAM: 'SAME_TEAM',
  MALFORMED_KEY: 'MALFORMED_KEY',
  RECREATIONAL_LEVEL: 'RECREATIONAL_LEVEL',  // Session 84: Premier-only policy
};

// ===========================================
// DATABASE CONNECTION
// ===========================================

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ Missing DATABASE_URL environment variable');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// ===========================================
// VALIDATION FUNCTIONS
// ===========================================

/**
 * Extract birth year from team name using common patterns
 * Returns null if not extractable
 */
function extractBirthYear(teamName) {
  if (!teamName) return null;

  // Pattern 1: "2015" as standalone or with prefix (B2015, G2015)
  const yearMatch = teamName.match(/\b(20[01]\d)\b/);
  if (yearMatch) {
    return parseInt(yearMatch[1], 10);
  }

  // Pattern 2: "U11", "U-11", "U 11" -> Calculate birth year
  const ageMatch = teamName.match(/\bU[-\s]?(\d{1,2})\b/i);
  if (ageMatch) {
    const age = parseInt(ageMatch[1], 10);
    // Current year minus age = birth year (approximate)
    const currentYear = new Date().getFullYear();
    return currentYear - age;
  }

  return null;
}

/**
 * Validate and optionally fix a single record
 * Returns { valid: boolean, rejections: [{code, reason}], fixes: [{field, oldValue, newValue}], record }
 *
 * Fixable issues (auto-corrected):
 * - Malformed source_match_key (newlines stripped)
 *
 * Rejection issues (data rejected):
 * - Empty team names
 * - Invalid dates
 * - Invalid birth years
 * - Unknown platforms
 * - Same team playing itself
 */
function validateRecord(record, autoFix = true) {
  const rejections = [];
  const fixes = [];

  // Create a copy for potential fixes
  const fixedRecord = { ...record };

  // 1. Empty team names
  if (!record.home_team_name || record.home_team_name.trim() === '') {
    rejections.push({
      code: REJECTION_CODES.EMPTY_HOME_TEAM,
      reason: 'Home team name is empty or null',
    });
  }

  if (!record.away_team_name || record.away_team_name.trim() === '') {
    rejections.push({
      code: REJECTION_CODES.EMPTY_AWAY_TEAM,
      reason: 'Away team name is empty or null',
    });
  }

  // 2. Same team playing itself
  if (
    record.home_team_name &&
    record.away_team_name &&
    record.home_team_name.trim().toLowerCase() === record.away_team_name.trim().toLowerCase()
  ) {
    rejections.push({
      code: REJECTION_CODES.SAME_TEAM,
      reason: `Same team playing itself: "${record.home_team_name}"`,
    });
  }

  // 3. Invalid date
  if (!record.match_date) {
    rejections.push({
      code: REJECTION_CODES.INVALID_DATE,
      reason: 'Match date is null',
    });
  } else {
    const matchDate = new Date(record.match_date);
    if (isNaN(matchDate.getTime())) {
      rejections.push({
        code: REJECTION_CODES.INVALID_DATE,
        reason: `Invalid match date: "${record.match_date}"`,
      });
    } else if (matchDate > CONFIG.MAX_VALID_DATE) {
      rejections.push({
        code: REJECTION_CODES.FUTURE_DATE_2027,
        reason: `Match date too far in future: ${record.match_date} (max: 2027-12-31)`,
      });
    } else if (matchDate < CONFIG.MIN_VALID_DATE) {
      rejections.push({
        code: REJECTION_CODES.PAST_DATE_2020,
        reason: `Match date too far in past: ${record.match_date} (min: 2020-01-01)`,
      });
    }
  }

  // 4. Unknown platform
  if (!CONFIG.KNOWN_PLATFORMS.includes(record.source_platform)) {
    rejections.push({
      code: REJECTION_CODES.UNKNOWN_PLATFORM,
      reason: `Unknown source platform: "${record.source_platform}"`,
    });
  }

  // 5. Malformed source_match_key (newlines, control characters) - AUTO-FIX
  if (record.source_match_key && /[\n\r\t]/.test(record.source_match_key)) {
    if (autoFix) {
      // Fix by taking only the part before the first newline/control char
      const cleanedKey = record.source_match_key.split(/[\n\r\t]/)[0].trim();
      fixes.push({
        field: 'source_match_key',
        oldValue: record.source_match_key,
        newValue: cleanedKey,
      });
      fixedRecord.source_match_key = cleanedKey;
    } else {
      // If not auto-fixing, just report it (for informational purposes)
      fixes.push({
        field: 'source_match_key',
        oldValue: record.source_match_key,
        newValue: record.source_match_key.split(/[\n\r\t]/)[0].trim(),
        wouldFix: true,
      });
    }
  }

  // 6. Invalid birth year (from team names)
  const homeBirthYear = extractBirthYear(record.home_team_name);
  const awayBirthYear = extractBirthYear(record.away_team_name);

  // Check if extracted birth year is outside valid range
  for (const [name, birthYear] of [
    [record.home_team_name, homeBirthYear],
    [record.away_team_name, awayBirthYear],
  ]) {
    if (birthYear !== null) {
      if (birthYear < CONFIG.MIN_VALID_BIRTH_YEAR || birthYear > CONFIG.MAX_VALID_BIRTH_YEAR) {
        // Calculate implied age
        const currentYear = new Date().getFullYear();
        const impliedAge = currentYear - birthYear;
        rejections.push({
          code: REJECTION_CODES.INVALID_BIRTH_YEAR,
          reason: `Invalid birth year ${birthYear} (implies U${impliedAge}) in team: "${name}"`,
        });
      }
    }
  }

  // 7. Recreational level check (Session 84: Premier-only policy)
  // See CLAUDE.md Principle 28 and docs/SESSION_84_PREMIER_ONLY_PLAN.md
  const isRecreational = CONFIG.RECREATIONAL_PATTERNS.some(pattern =>
    pattern.test(record.source_match_key || '') ||
    pattern.test(record.event_name || '')
  );

  if (isRecreational) {
    rejections.push({
      code: REJECTION_CODES.RECREATIONAL_LEVEL,
      reason: `Recreational data rejected per Premier-only policy: ${record.event_name || record.source_match_key}`,
    });
  }

  return {
    valid: rejections.length === 0,
    rejections,
    fixes,
    record: fixedRecord,
  };
}

/**
 * Validate a batch of records (for use by scrapers before staging insert)
 * Returns { valid: [], rejected: [], fixed: number }
 *
 * Valid records are returned with any auto-fixes applied.
 */
export function validateBatch(records, autoFix = true) {
  const valid = [];
  const rejected = [];
  let fixCount = 0;

  for (const record of records) {
    const result = validateRecord(record, autoFix);
    if (result.valid) {
      // Use the fixed record (with auto-fixes applied)
      valid.push(result.record);
      if (result.fixes.length > 0) {
        fixCount += result.fixes.length;
      }
    } else {
      rejected.push({
        record,
        rejections: result.rejections,
      });
    }
  }

  return { valid, rejected, fixed: fixCount };
}

// ===========================================
// DATABASE OPERATIONS
// ===========================================

/**
 * Move invalid records from staging_games to staging_rejected
 */
async function cleanStagingGames(options = {}) {
  const { dryRun = false, limit = CONFIG.BATCH_SIZE } = options;

  console.log('\n=== Cleaning Staging Games ===');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'EXECUTE'}`);
  console.log(`Limit: ${limit}`);

  const stats = {
    scanned: 0,
    valid: 0,
    fixed: 0,
    rejected: 0,
    byCode: {},
    byFix: {},
  };

  // Fetch unprocessed staging records
  const { rows: records } = await pool.query(
    `
    SELECT * FROM staging_games
    WHERE processed = false
    ORDER BY scraped_at DESC
    LIMIT $1
  `,
    [limit]
  );

  console.log(`\nFetched ${records.length} unprocessed records`);
  stats.scanned = records.length;

  const toReject = [];
  const toFix = [];  // Records that only need fixes (no rejections)

  for (const record of records) {
    const result = validateRecord(record, true);  // Enable auto-fix

    if (result.valid) {
      stats.valid++;
      // Check if any fixes were applied
      if (result.fixes.length > 0) {
        stats.fixed++;
        for (const fix of result.fixes) {
          stats.byFix[fix.field] = (stats.byFix[fix.field] || 0) + 1;
        }
        toFix.push({
          id: record.id,
          fixes: result.fixes,
        });
      }
    } else {
      stats.rejected++;
      // Track first rejection reason
      const primaryCode = result.rejections[0].code;
      stats.byCode[primaryCode] = (stats.byCode[primaryCode] || 0) + 1;

      toReject.push({
        original_staging_id: record.id,
        match_date: record.match_date,
        match_time: record.match_time,
        home_team_name: record.home_team_name,
        away_team_name: record.away_team_name,
        home_score: record.home_score,
        away_score: record.away_score,
        event_name: record.event_name,
        event_id: record.event_id,
        venue_name: record.venue_name,
        field_name: record.field_name,
        division: record.division,
        source_platform: record.source_platform,
        source_match_key: record.source_match_key,
        raw_data: record.raw_data,
        scraped_at: record.scraped_at,
        rejection_code: primaryCode,
        rejection_reason: result.rejections.map((r) => r.reason).join('; '),
      });
    }
  }

  console.log(`\n=== Validation Results ===`);
  console.log(`Valid: ${stats.valid} (${stats.fixed} auto-fixed)`);
  console.log(`Rejected: ${stats.rejected}`);

  if (Object.keys(stats.byFix).length > 0) {
    console.log(`\nAuto-fixes applied:`);
    for (const [field, count] of Object.entries(stats.byFix).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${field}: ${count}`);
    }
  }

  if (Object.keys(stats.byCode).length > 0) {
    console.log(`\nRejections by code:`);
    for (const [code, count] of Object.entries(stats.byCode).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${code}: ${count}`);
    }
  }

  // Apply fixes to staging_games (UPDATE in place)
  if (!dryRun && toFix.length > 0) {
    console.log(`\nApplying ${toFix.length} fixes to staging_games...`);

    // Group by fix type for bulk updates
    const keyFixes = toFix.filter((f) => f.fixes.some((fix) => fix.field === 'source_match_key'));

    if (keyFixes.length > 0) {
      // Bulk update source_match_key
      const ids = [];
      const newKeys = [];
      for (const record of keyFixes) {
        const keyFix = record.fixes.find((f) => f.field === 'source_match_key');
        if (keyFix) {
          ids.push(record.id);
          newKeys.push(keyFix.newValue);
        }
      }

      // Use CASE statement for bulk update
      await pool.query(
        `
        UPDATE staging_games
        SET source_match_key = updates.new_key
        FROM (
          SELECT unnest($1::uuid[]) as id, unnest($2::text[]) as new_key
        ) as updates
        WHERE staging_games.id = updates.id
      `,
        [ids, newKeys]
      );

      console.log(`  Fixed ${keyFixes.length} malformed source_match_keys`);
    }
  }

  if (!dryRun && toReject.length > 0) {
    console.log(`\nMoving ${toReject.length} records to staging_rejected...`);

    // Insert to staging_rejected in batches
    for (let i = 0; i < toReject.length; i += CONFIG.BATCH_SIZE) {
      const batch = toReject.slice(i, i + CONFIG.BATCH_SIZE);

      // Build bulk insert
      const values = [];
      const placeholders = [];
      let paramIdx = 1;

      for (const r of batch) {
        const rowPlaceholders = [];
        for (const val of [
          r.original_staging_id,
          r.match_date,
          r.match_time,
          r.home_team_name,
          r.away_team_name,
          r.home_score,
          r.away_score,
          r.event_name,
          r.event_id,
          r.venue_name,
          r.field_name,
          r.division,
          r.source_platform,
          r.source_match_key,
          JSON.stringify(r.raw_data),
          r.scraped_at,
          r.rejection_code,
          r.rejection_reason,
        ]) {
          values.push(val);
          rowPlaceholders.push(`$${paramIdx++}`);
        }
        placeholders.push(`(${rowPlaceholders.join(', ')})`);
      }

      await pool.query(
        `
        INSERT INTO staging_rejected (
          original_staging_id, match_date, match_time, home_team_name, away_team_name,
          home_score, away_score, event_name, event_id, venue_name, field_name,
          division, source_platform, source_match_key, raw_data, scraped_at,
          rejection_code, rejection_reason
        )
        VALUES ${placeholders.join(', ')}
      `,
        values
      );

      console.log(`  Inserted batch ${Math.floor(i / CONFIG.BATCH_SIZE) + 1}`);
    }

    // Delete from staging_games
    const idsToDelete = toReject.map((r) => r.original_staging_id);
    await pool.query(
      `
      DELETE FROM staging_games WHERE id = ANY($1::uuid[])
    `,
      [idsToDelete]
    );

    console.log(`Deleted ${idsToDelete.length} records from staging_games`);
  }

  return stats;
}

/**
 * Generate a quality report on staging data
 */
async function generateReport() {
  console.log('\n=== Staging Data Quality Report ===');
  console.log(`Generated: ${new Date().toISOString()}`);

  // Summary stats
  const { rows: summary } = await pool.query(`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE processed = false) as unprocessed,
      COUNT(*) FILTER (WHERE processed = true) as processed,
      COUNT(DISTINCT source_platform) as platforms
    FROM staging_games
  `);

  console.log('\n--- Summary ---');
  console.log(`Total records: ${summary[0].total}`);
  console.log(`Unprocessed: ${summary[0].unprocessed}`);
  console.log(`Processed: ${summary[0].processed}`);
  console.log(`Source platforms: ${summary[0].platforms}`);

  // By platform
  const { rows: byPlatform } = await pool.query(`
    SELECT source_platform, COUNT(*) as count,
           COUNT(*) FILTER (WHERE processed = false) as unprocessed
    FROM staging_games
    GROUP BY source_platform
    ORDER BY count DESC
  `);

  console.log('\n--- By Platform ---');
  for (const p of byPlatform) {
    console.log(`  ${p.source_platform}: ${p.count} total, ${p.unprocessed} unprocessed`);
  }

  // Potential issues (sample validation on unprocessed)
  const { rows: sample } = await pool.query(`
    SELECT * FROM staging_games
    WHERE processed = false
    LIMIT 5000
  `);

  const issueStats = {
    empty_home: 0,
    empty_away: 0,
    same_team: 0,
    null_date: 0,
    future_date: 0,
    past_date: 0,
    malformed_key: 0,
    invalid_birth_year: 0,
    unknown_platform: 0,
  };

  for (const r of sample) {
    const result = validateRecord(r);
    for (const rejection of result.rejections) {
      switch (rejection.code) {
        case REJECTION_CODES.EMPTY_HOME_TEAM:
          issueStats.empty_home++;
          break;
        case REJECTION_CODES.EMPTY_AWAY_TEAM:
          issueStats.empty_away++;
          break;
        case REJECTION_CODES.SAME_TEAM:
          issueStats.same_team++;
          break;
        case REJECTION_CODES.INVALID_DATE:
          issueStats.null_date++;
          break;
        case REJECTION_CODES.FUTURE_DATE_2027:
          issueStats.future_date++;
          break;
        case REJECTION_CODES.PAST_DATE_2020:
          issueStats.past_date++;
          break;
        case REJECTION_CODES.MALFORMED_KEY:
          issueStats.malformed_key++;
          break;
        case REJECTION_CODES.INVALID_BIRTH_YEAR:
          issueStats.invalid_birth_year++;
          break;
        case REJECTION_CODES.UNKNOWN_PLATFORM:
          issueStats.unknown_platform++;
          break;
      }
    }
  }

  console.log(`\n--- Validation Issues (sampled ${sample.length} unprocessed) ---`);
  console.log(`  Empty home team: ${issueStats.empty_home}`);
  console.log(`  Empty away team: ${issueStats.empty_away}`);
  console.log(`  Same team: ${issueStats.same_team}`);
  console.log(`  Null date: ${issueStats.null_date}`);
  console.log(`  Future date (>2027): ${issueStats.future_date}`);
  console.log(`  Past date (<2020): ${issueStats.past_date}`);
  console.log(`  Malformed key: ${issueStats.malformed_key}`);
  console.log(`  Invalid birth year: ${issueStats.invalid_birth_year}`);
  console.log(`  Unknown platform: ${issueStats.unknown_platform}`);

  // Rejected stats
  const { rows: rejectedStats } = await pool.query(`
    SELECT rejection_code, COUNT(*) as count
    FROM staging_rejected
    GROUP BY rejection_code
    ORDER BY count DESC
  `);

  if (rejectedStats.length > 0) {
    console.log('\n--- Previously Rejected ---');
    for (const r of rejectedStats) {
      console.log(`  ${r.rejection_code}: ${r.count}`);
    }
  } else {
    console.log('\n--- Previously Rejected ---');
    console.log('  No rejected records yet');
  }

  console.log('\n=== End Report ===\n');
}

// ===========================================
// MAIN
// ===========================================

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.length === 0) {
    console.log(`
Intake Validator v${CONFIG.VALIDATOR_VERSION}
=============================

Usage:
  node scripts/universal/intakeValidator.js --report
  node scripts/universal/intakeValidator.js --clean-staging [--dry-run] [--limit N]

Options:
  --report         Generate quality report on staging data
  --clean-staging  Move invalid records from staging_games to staging_rejected
  --dry-run        Show what would happen without making changes
  --limit N        Limit number of records to process (default: ${CONFIG.BATCH_SIZE})
  --help           Show this help message

Validation Rules:
  - EMPTY_HOME_TEAM: home_team_name is empty/null
  - EMPTY_AWAY_TEAM: away_team_name is empty/null
  - SAME_TEAM: home_team_name equals away_team_name
  - INVALID_DATE: match_date is null or unparseable
  - FUTURE_DATE_2027: match_date is after 2027-12-31
  - PAST_DATE_2020: match_date is before 2020-01-01
  - UNKNOWN_PLATFORM: source_platform not in [${CONFIG.KNOWN_PLATFORMS.join(', ')}]
  - MALFORMED_KEY: source_match_key contains newlines/control chars
  - INVALID_BIRTH_YEAR: birth year implies U<5 or U>20 age group
    `);
    process.exit(0);
  }

  try {
    if (args.includes('--report')) {
      await generateReport();
    } else if (args.includes('--clean-staging')) {
      const dryRun = args.includes('--dry-run');
      const limitIdx = args.indexOf('--limit');
      const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : CONFIG.BATCH_SIZE;

      await cleanStagingGames({ dryRun, limit });
    } else {
      console.error('Unknown command. Use --help for usage.');
      process.exit(1);
    }
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Export for use by other modules (validateBatch already exported above)
export { validateRecord, extractBirthYear, REJECTION_CODES, CONFIG };

// Run if called directly
main();
