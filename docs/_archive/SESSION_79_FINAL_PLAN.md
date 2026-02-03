# SoccerView V2 Architecture Enforcement - FINAL PLAN
## Session 79 Completion + Future-Proofing

**Created:** February 2, 2026

---

## 🚨 ABSOLUTE CONSTRAINT: UI DESIGN IS LOCKED 🚨

### What This Means:
- **NO changes** to any file in `/app/**/*`
- **NO changes** to any file in `/components/**/*`
- **NO changes** to styling, layout, spacing, colors, or component structure
- **NO changes** to `.tsx` files whatsoever

### What IS Allowed:
- Data flowing INTO the UI may change (that's the point - cleaner data)
- Database tables, views, and queries that FEED the UI
- Backend scripts that process data BEFORE it reaches the UI

### Enforcement:
- This plan contains **ZERO** modifications to any UI files
- All changes are to:
  - `scripts/**/*` (backend processing)
  - `docs/**/*` (documentation)
  - `.github/workflows/**/*` (CI/CD)
  - Database (migrations, triggers)

### Verification:
Before any implementation, I will confirm:
- [ ] File is NOT in `/app/`
- [ ] File is NOT in `/components/`
- [ ] Change does NOT affect UI rendering

**IF ANY DOUBT: STOP AND ASK**

---

## Executive Summary

Three critical gaps remain in the V2 architecture:
1. **Write Protection Bypass**: 32 scripts can write to production without authorization
2. **Adaptive Learning Incomplete**: System learns patterns but doesn't USE them
3. **Phase 5 Clean Rebuild**: Never implemented from original plan

This plan completes Session 79 and creates a bulletproof, self-improving system.

---

## Current State (from Exploration)

### Data Health: ✅ HEALTHY
| Metric | Value | Status |
|--------|-------|--------|
| teams_v2 | 148,391 | ✅ |
| matches_v2 | 314,852 | ✅ |
| Duplicate source_match_keys | 0 | ✅ |
| canonical_teams coverage | 93.1% | ✅ |
| NULL birth_year | 2.2% | ✅ |
| Orphan rate | 25.9% | ⚠️ (coverage gap, not bug) |

### Write Protection: ⚠️ GAPS
| Category | Count | Protected | Gap |
|----------|-------|-----------|-----|
| Core Pipeline | 4 | ✅ 4 | 0 |
| Maintenance .cjs | 20 | ❌ 0 | **20** |
| Supabase scripts | 7 | ❌ 0 | **7** |
| Debug scripts | 40+ | ❌ 0 | **5 critical** |

### Adaptive Learning: ⚠️ INCOMPLETE
- `learned_patterns` table: EXISTS
- Weekly learning job: RUNS
- Pattern USAGE in normalizers: **NOT WORKING**
- Root cause: `initializeLearnedPatterns()` called but patterns may be empty

---

## Implementation Plan

### Phase A: Complete Write Protection (Priority 1)

**Problem**: 32 scripts bypass write protection because:
- 20 .cjs files can't import ES modules
- 7 Supabase scripts can't use session variables

**Solution**: Create CommonJS wrapper + convert critical Supabase scripts

#### A1. Create CommonJS Authorization Wrapper
**File**: `scripts/universal/pipelineAuthCJS.cjs`
```javascript
require('dotenv').config();

async function authorizePipelineWrite(poolOrClient) {
  await poolOrClient.query('SELECT authorize_pipeline_write()');
}

async function withPipelineAuth(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('SELECT authorize_pipeline_write()');
    return await fn(client);
  } finally {
    try { await client.query('SELECT revoke_pipeline_write()'); } catch {}
    client.release();
  }
}

module.exports = { authorizePipelineWrite, withPipelineAuth };
```

#### A2. Update Critical Maintenance Scripts
Add authorization to these .cjs files:
- [ ] `scripts/maintenance/populateCanonicalTeams.cjs`
- [ ] `scripts/maintenance/fixNullMetadataAndMerge.cjs`
- [ ] `scripts/maintenance/mergeOrphansByNormalizedName.cjs`
- [ ] `scripts/maintenance/fixDataDisconnect.cjs`
- [ ] `scripts/maintenance/recalculateHistoricalRanks.cjs`
- [ ] `scripts/maintenance/fixBirthYearFromNames.cjs`

#### A3. Convert Critical Supabase Scripts to pg Pool
Convert these to use pg Pool (enables authorization):
- [ ] `scripts/daily/captureRankSnapshot.js` (writes rank_history_v2)
- [ ] `scripts/maintenance/cleanupGarbageMatches.js` (deletes matches_v2)

#### A4. Create Script Manifest
**File**: `scripts/manifests/authorized_writers.json`
Document all scripts and their authorization status.

---

### Phase B: Activate Adaptive Learning (Priority 2)

**Problem**: Patterns are learned and stored but not USED because:
1. `learned_patterns` table may be empty (weekly job hasn't populated it)
2. Normalizers check for patterns but find none

**Solution**: Bootstrap patterns + verify usage

#### B1. Verify/Bootstrap Learned Patterns
```bash
# Check if patterns exist
node -e "require('dotenv').config(); const {Pool}=require('pg'); new Pool({connectionString:process.env.DATABASE_URL}).query('SELECT COUNT(*) FROM learned_patterns').then(r=>console.log(r.rows[0]))"

# If empty, bootstrap:
node scripts/universal/adaptiveLearning.js --learn-teams --source all
node scripts/universal/adaptiveLearning.js --learn-events --source all
```

#### B2. Add Pattern Loading Verification
Update `dataQualityEngine.js` to log pattern counts:
```javascript
console.log(`📚 Loaded ${teamPatternCount} team patterns, ${eventPatternCount} event patterns`);
```

#### B3. Create Adaptive Learning Verification Script
**File**: `scripts/daily/verifyAdaptiveLearning.js`
- Check learned_patterns has data
- Check patterns have usage_count > 0 (being applied)
- Alert if system not improving

---

### Phase C: Data Provenance Audit (Priority 3)

**Problem**: 6.9% of teams (10,139) not in canonical_teams registry

**Solution**: Diagnose before deciding on cleanup

#### C1. Run Diagnostic Query
```sql
SELECT
  COUNT(*) as total_not_in_registry,
  COUNT(*) FILTER (WHERE matches_played = 0) as orphans_no_matches,
  COUNT(*) FILTER (WHERE matches_played > 0) as has_matches,
  COUNT(*) FILTER (WHERE created_at < '2026-01-30') as legacy_pre_v2
FROM teams_v2 t
WHERE NOT EXISTS (
  SELECT 1 FROM canonical_teams ct WHERE ct.team_v2_id = t.id
);
```

#### C2. Decision Tree
- If all are orphans (0 matches): **No action needed** - coverage gaps
- If some have matches: **Run populateCanonicalTeams.cjs** to fill gaps
- If legacy data has issues: **Targeted cleanup only** (not full rebuild)

#### C3. Create Audit Script
**File**: `scripts/maintenance/auditNonRegistryTeams.js`
Report on teams not in canonical registry with match counts.

---

### Phase D: Future Safeguards (Priority 4)

#### D1. Update GUARDRAILS Documentation
Add to `docs/1.1-GUARDRAILS_v2.md`:
- CJS authorization pattern
- Script categories (authorized vs emergency)
- New source onboarding checklist

#### D2. Create CI Validation
**File**: `scripts/ci/validateWriteAuth.js`
Scan all scripts for:
- Writes to teams_v2/matches_v2 without authorization
- Unauthorized Supabase client usage
Run in pre-commit hook.

#### D3. Create New Source Onboarding Doc
**File**: `docs/4-NEW_SOURCE_ONBOARDING.md`
Checklist for adding data sources safely.

---

### Phase E: Preventive Maintenance (Priority 5)

#### Daily (Automated)
| Time | Task | Script |
|------|------|--------|
| 6:00 | Data Collection | coreScraper.js |
| 6:15 | Intake Validation | intakeValidator.js |
| 6:30 | Data Quality Engine | dataQualityEngine.js |
| 7:00 | Integrity Check | verifyDataIntegrity.js |
| 7:15 | **Adaptive Learning Check** | verifyAdaptiveLearning.js |
| 7:30 | ELO Calculation | recalculate_elo_v2.js |

#### Weekly (Sunday)
- Deduplication reports
- Pattern learning (`adaptiveLearning.js --learn-*`)
- Registry growth report

#### Monthly (Manual)
- Review `pipeline_blocked_writes` log
- Review `staging_rejected` patterns
- Audit orphan rate by state

---

### Phase F: Historical Data Reprocessing (CRITICAL)

**🚨 THIS IS THE WHOLE POINT - USE V2 TO CLEAN EXISTING DATA 🚨**

**Problem**: Current production data is "all over the place" because:
- Multiple import paths were used before V2 enforcement
- GotSport rankings scraper bypassed normalizers
- Some data never went through canonical registry
- Inconsistent team names, duplicate entries, fragmented match histories

**Solution**: Parallel table rebuild with atomic swap

#### F1. Create Clean Parallel Tables
```sql
-- Create pristine copies of production tables
CREATE TABLE teams_v2_clean (LIKE teams_v2 INCLUDING ALL);
CREATE TABLE matches_v2_clean (LIKE matches_v2 INCLUDING ALL);

-- Reset canonical registries for fresh build
TRUNCATE canonical_teams CASCADE;
TRUNCATE canonical_events CASCADE;
TRUNCATE canonical_clubs CASCADE;
```

#### F2. Reprocess ALL Staging Data Through V2 Pipeline
```bash
# This processes ALL staging_games through dataQualityEngine
# Writing to the _clean tables instead of production

node scripts/maintenance/rebuildFromStaging.js --target clean --verbose
```

The script will:
1. Read all records from `staging_games` (86,491 records)
2. Pass each through `intakeValidator.js` (reject garbage)
3. Pass valid records through `dataQualityEngine.js`:
   - Team normalization (birth_year extraction, gender, club parsing)
   - Event normalization (league vs tournament classification)
   - Match normalization (source_match_key generation)
   - Canonical registry resolution (deduplication)
4. Write to `teams_v2_clean` and `matches_v2_clean`

#### F3. Validate Clean Data vs Current Data
```bash
node scripts/maintenance/validateRebuild.js
```

Validation checks:
| Check | Expectation |
|-------|-------------|
| Total teams | Should be FEWER (duplicates merged) |
| Total matches | Should be SAME or FEWER (duplicates removed) |
| Canonical coverage | 100% (all teams registered) |
| NULL birth_year | 0% (all extracted from names) |
| Duplicate source_match_keys | 0 (UNIQUE enforced) |
| Orphan rate | Lower (better team matching) |

#### F4. Generate Comparison Report
```bash
node scripts/maintenance/generateRebuildReport.js
```

Report shows:
- Teams merged (with old → new mapping)
- Matches deduplicated
- Birth years fixed
- Events consolidated
- Canonical registry growth

#### F5. Atomic Swap (After User Approval)
```sql
-- ONLY after user reviews and approves the comparison report

BEGIN;
-- Archive current production
ALTER TABLE teams_v2 RENAME TO teams_v2_archived_YYYYMMDD;
ALTER TABLE matches_v2 RENAME TO matches_v2_archived_YYYYMMDD;

-- Promote clean to production
ALTER TABLE teams_v2_clean RENAME TO teams_v2;
ALTER TABLE matches_v2_clean RENAME TO matches_v2;

-- Rebuild all indexes
REINDEX TABLE teams_v2;
REINDEX TABLE matches_v2;

-- Refresh all views
SELECT refresh_app_views();
COMMIT;
```

#### F6. Recalculate ELO on Clean Data
```bash
# Full ELO recalculation from scratch on clean data
node scripts/daily/recalculate_elo_v2.js --full-rebuild
```

---

### Phase F Safety Mechanisms

| Risk | Mitigation |
|------|------------|
| Data loss | Original tables archived, not deleted |
| Bad rebuild | Validation script catches issues before swap |
| Rollback needed | Archived tables can be restored instantly |
| Partial failure | Transaction ensures atomic swap |

### Phase F Scripts to Create

| Script | Purpose |
|--------|---------|
| `scripts/maintenance/rebuildFromStaging.js` | Main rebuild orchestrator |
| `scripts/maintenance/validateRebuild.js` | Compare clean vs current |
| `scripts/maintenance/generateRebuildReport.js` | Human-readable diff |
| `scripts/maintenance/executeSwap.js` | Atomic swap (requires --confirm) |

### Why Phase F Is CRITICAL

**Without Phase F:**
- V2 system protects FUTURE data only
- Current messy data remains messy
- Users still see duplicates, wrong birth years, fragmented histories
- The whole system is "theoretical" - never applied to real data

**With Phase F:**
- ALL data passes through V2 pipeline
- Every team normalized, deduplicated, registered
- Every match linked to canonical teams
- App shows CLEAN data immediately
- V2 system is PROVEN on real data

---

## Files to Create/Modify

### CREATE:
| File | Purpose |
|------|---------|
| `scripts/universal/pipelineAuthCJS.cjs` | CJS authorization wrapper |
| `scripts/manifests/authorized_writers.json` | Script classification |
| `scripts/daily/verifyAdaptiveLearning.js` | Learning verification |
| `scripts/maintenance/auditNonRegistryTeams.js` | Data provenance |
| `scripts/ci/validateWriteAuth.js` | CI validation |
| `docs/4-NEW_SOURCE_ONBOARDING.md` | Onboarding checklist |
| `scripts/maintenance/rebuildFromStaging.js` | **Phase F** Main rebuild orchestrator |
| `scripts/maintenance/validateRebuild.js` | **Phase F** Compare clean vs current |
| `scripts/maintenance/generateRebuildReport.js` | **Phase F** Human-readable diff |
| `scripts/maintenance/executeSwap.js` | **Phase F** Atomic swap |

### MODIFY:
| File | Change |
|------|--------|
| 6x .cjs maintenance scripts | Add authorization |
| 2x Supabase scripts | Convert to pg Pool |
| `docs/1.1-GUARDRAILS_v2.md` | Add CJS pattern |
| `.github/workflows/daily-data-sync.yml` | Add learning verification |

### 🚫 ABSOLUTELY DO NOT TOUCH - UI DESIGN LOCKED:
| Directory | Files | Status |
|-----------|-------|--------|
| `/app/**/*` | All .tsx files | 🔒 **LOCKED** |
| `/components/**/*` | All .tsx files | 🔒 **LOCKED** |

**The UI design CANNOT change. Only backend data processing is modified.**
**Data flowing to the UI will be cleaner - but the UI itself stays exactly as-is.**

---

## Success Criteria

### After Phase A-E (System Complete)
| Metric | Target |
|--------|--------|
| Write protection coverage | 100% of critical scripts |
| Learned patterns count | > 100 |
| All integrity checks | 7/7 passing |

### After Phase F (Historical Data Clean)
| Metric | Target |
|--------|--------|
| **Canonical registry coverage** | **100%** (not 93%) |
| **Duplicate teams** | **0** |
| **NULL birth_year** | **0%** (not 2.2%) |
| **Orphan rate** | **< 10%** (not 26%) |
| **ELO accuracy** | Recalculated on clean data |

### Week 1 (Post-Swap)
| Metric | Target |
|--------|--------|
| Zero unauthorized writes | 0 in blocked_writes log |
| Pattern usage_count | Growing |
| App data quality issues reported | 0 |

### Month 1
| Metric | Target |
|--------|--------|
| Orphan rate | Stable or improving |
| New source onboarding | < 1 day |
| Zero architecture bypasses | 0 incidents |

---

## Verification Steps

1. **Write Protection**: Attempt unauthorized INSERT to teams_v2 → should fail
2. **Authorization**: Run `test_write_protection.js` → all tests pass
3. **Adaptive Learning**: Check `learned_patterns` has data and usage_count > 0
4. **Integrity**: Run `verifyDataIntegrity.js` → 7/7 checks pass
5. **Full Pipeline**: Dry-run data collection → processing → verification

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Breaking scripts | All changes use `--dry-run` first |
| Emergency access | `disable_write_protection()` available |
| Bad patterns | Confidence thresholds + cleanup |
| Future bypasses | CI validation + pre-commit hooks |

---

## Timeline

| Day | Focus |
|-----|-------|
| 1 | Create pipelineAuthCJS.cjs + update 6 .cjs scripts |
| 2 | Convert 2 Supabase scripts + create manifest |
| 3 | Bootstrap adaptive learning + create verification |
| 4 | Run data provenance audit + targeted cleanup |
| 5 | Update documentation + create CI validation |
| 6 | Full pipeline test + verification |
| 7 | **Phase F: Create rebuild scripts + run on staging data** |
| 8 | **Phase F: Validate rebuilt data + generate comparison report** |
| 9 | **Phase F: User reviews report → approves/rejects swap** |
| 10 | **Phase F: Execute atomic swap + full ELO recalculation** |

---

## What "Final Review + Production Verification" Means

### After Day 6 (System Complete):
| Guarantee | How Verified |
|-----------|--------------|
| All FUTURE data flows through V2 pipeline | Write protection triggers block bypasses |
| Adaptive learning is active | `learned_patterns` populated, usage tracked |
| All integrity checks pass | `verifyDataIntegrity.js` = 7/7 |

### After Day 10 (Historical Data Cleaned via Phase F):
| Guarantee | How Verified |
|-----------|--------------|
| **100% of teams in canonical registry** | Phase F rebuild + validation |
| **0 duplicate teams** | Normalizer deduplication during rebuild |
| **All birth years extracted** | Team normalizer processes every record |
| **All matches linked to canonical teams** | dataQualityEngine resolution |
| **0 duplicate source_match_keys** | UNIQUE constraint on clean tables |
| **ELO reflects clean data** | Full recalculation post-swap |
| **App shows pristine data** | Views refresh from clean tables |

### Why Phase F Is Non-Negotiable

**The user's exact concern (and they're RIGHT):**
> "The data is all over the place as it lands in the app... if we don't use the tools for our current data as it is right now - what's the point of having this system in place!?!?"

**Phase F answers this:**
- ALL existing data reprocessed through V2 pipeline
- Every team normalized + deduplicated + registered
- Every match linked to canonical teams
- The app shows CLEAN data, not theoretical future cleanliness

### The Parallel Rebuild Approach

This is SAFE because:
1. **Original data preserved** - archived, not deleted
2. **Validation before swap** - comparison report reviewed by user
3. **Atomic transaction** - swap succeeds completely or not at all
4. **Instant rollback** - if issues found, restore archived tables

---

## Quick Reference Checklist

### Phase A: Write Protection
- [ ] A1: Create `pipelineAuthCJS.cjs`
- [ ] A2: Update 6 .cjs maintenance scripts
- [ ] A3: Convert 2 Supabase scripts to pg Pool
- [ ] A4: Create `authorized_writers.json` manifest

### Phase B: Adaptive Learning
- [ ] B1: Verify/bootstrap `learned_patterns`
- [ ] B2: Add pattern count logging
- [ ] B3: Create `verifyAdaptiveLearning.js`

### Phase C: Data Provenance
- [ ] C1: Run diagnostic query
- [ ] C2: Execute decision tree
- [ ] C3: Create `auditNonRegistryTeams.js`

### Phase D: Safeguards
- [ ] D1: Update GUARDRAILS docs
- [ ] D2: Create `validateWriteAuth.js`
- [ ] D3: Create onboarding doc

### Phase E: Maintenance
- [ ] E1: Update GitHub Actions pipeline
- [ ] E2: Create maintenance schedule doc

### Phase F: Historical Data Reprocessing (THE POINT OF ALL THIS)
- [ ] F1: Create `rebuildFromStaging.js` orchestrator script
- [ ] F2: Create `validateRebuild.js` comparison script
- [ ] F3: Create `generateRebuildReport.js` human-readable diff
- [ ] F4: Create `executeSwap.js` atomic swap script
- [ ] F5: Run rebuild on staging data → `teams_v2_clean`, `matches_v2_clean`
- [ ] F6: Generate and review comparison report
- [ ] F7: **USER APPROVES** comparison report
- [ ] F8: Execute atomic swap
- [ ] F9: Full ELO recalculation on clean data
- [ ] F10: Verify app shows clean data
