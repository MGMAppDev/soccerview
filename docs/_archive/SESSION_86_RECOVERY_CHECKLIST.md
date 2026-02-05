# Session 86: Match Data Recovery Checklist

> **Date:** February 4, 2026
> **Severity:** CRITICAL - Data Loss Recovery
> **Status:** PARTIAL COMPLETION - Phase 1-3 done, Phase 4+ pending

---

## Problem Statement

Session 85's "Universal SoccerView ID Architecture" deleted 8,251 matches via `matchDedup.js --execute`. These were NOT duplicates - they were the same real-world matches from different data sources (V1 archive + live scrapers).

**Symptom:** Team Details pages show 0 matches, 0 stats, no ELO rankings.

**Root Cause:** `matchDedup.js` used hard DELETE instead of soft delete.

**Recovery Source:** All deleted matches exist in `audit_log.old_data` as JSONB.

---

## Master Checklist

### Phase 0: Pre-Flight Verification ✅ COMPLETE
- [x] Verify audit_log contains deleted match records
- [x] Count deleted matches in audit_log (~9,160 on 2026-02-04)
- [x] Sample deleted matches to confirm data completeness
- [x] Check current matches_v2 count (baseline)

### Phase 1: Match Recovery ✅ COMPLETE
- [x] Create `scripts/maintenance/recoverSession85Matches.cjs`
- [x] Query audit_log for DELETE actions by matchDedup
- [x] Parse JSONB old_data to extract match fields
- [x] Use ON CONFLICT (match_date, home_team_id, away_team_id) DO UPDATE
- [x] Merge scores: COALESCE(existing, recovered)
- [x] Add pipeline authorization
- [x] Execute recovery: **6,053 matches recovered**

### Phase 2: Add Soft-Delete to matches_v2 ✅ COMPLETE
- [x] Create migration `scripts/migrations/086_add_soft_delete_matches.sql`
- [x] Add column: `deleted_at TIMESTAMPTZ`
- [x] Add column: `deletion_reason TEXT`
- [x] Run migration

### Phase 3: Fix matchDedup.js ✅ COMPLETE
- [x] Change DELETE to UPDATE with soft delete
- [x] Set `deleted_at = NOW()`
- [x] Set `deletion_reason = 'Semantic duplicate of ' || keep_id`
- [x] Keep audit_log INSERT
- [x] Add `WHERE deleted_at IS NULL` to detection query

### Phase 4: Team Deduplication 🔄 PARTIAL
- [x] Identified 5,352 duplicate display_name groups (6,244 extra teams)
- [x] Created `scripts/maintenance/bulkMergeDuplicateTeams.cjs`
- [ ] Full execution (connection timeouts, needs smaller batches)
- [ ] Verify Sporting BV team shows correct match count

### Phase 5: Update Documentation ✅ COMPLETE
- [x] Created `docs/CANONICAL_RESOLUTION_STRATEGY.md`
- [x] Updated `CLAUDE.md` with Session 86 summary
- [x] Added Principle 30: Soft Delete for Matches
- [x] Updated `docs/1.1-GUARDRAILS_v2.md` with soft-delete requirement

### Phase 6: Pending
- [ ] Run ELO recalculation
- [ ] Refresh app views
- [ ] Final verification of Sporting BV team

---

## Key Metrics

| Metric | Before | After | Target |
|--------|--------|-------|--------|
| audit_log DELETE records | 9,160 | - | ~9,160 |
| Matches recovered | 0 | 6,053 | ~8,251 |
| Duplicate teams identified | - | 6,244 | 0 |
| Sporting BV matches | 0 | 27* | 19** |

*27 matches due to opponent team duplicates not yet merged
**Estimated unique after opponent dedup

---

## Files Created

| File | Purpose | Status |
|------|---------|--------|
| `scripts/maintenance/recoverSession85Matches.cjs` | Restore matches from audit_log | ✅ |
| `scripts/migrations/086_add_soft_delete_matches.sql` | Add soft-delete columns | ✅ |
| `scripts/maintenance/bulkMergeDuplicateTeams.cjs` | Universal team deduplication | ✅ |
| `docs/CANONICAL_RESOLUTION_STRATEGY.md` | Entity resolution methodology | ✅ |

## Files Modified

| File | Change | Status |
|------|--------|--------|
| `scripts/universal/deduplication/matchDedup.js` | Soft delete | ✅ |
| `scripts/universal/deduplication/teamDedup.js` | Same-name dedup | ✅ |
| `docs/1.1-GUARDRAILS_v2.md` | Soft-delete requirement | ✅ |
| `CLAUDE.md` | Session 86 summary, Principle 30 | ✅ |

---

## Remaining Work

1. **Team Deduplication:** Run bulkMergeDuplicateTeams.cjs in smaller batches
2. **ELO Recalculation:** Run after team dedup completes
3. **View Refresh:** Refresh all materialized views
4. **Final Verification:** Confirm Sporting BV shows correct 19 matches

---

## Architecture Improvements

### New Soft-Delete Pattern

```sql
-- matches_v2 schema additions
deleted_at TIMESTAMPTZ  -- NULL = active, timestamp = soft-deleted
deletion_reason TEXT    -- Why it was soft-deleted

-- matchDedup.js now uses:
UPDATE matches_v2 SET deleted_at = NOW(), deletion_reason = '...'
-- Instead of: DELETE FROM matches_v2
```

### Canonical Resolution Strategy

Created unified methodology for resolving entities to single SoccerView IDs:
1. EXACT ID MATCH
2. SEMANTIC KEY MATCH
3. CANONICAL REGISTRY (aliases)
4. FUZZY MATCH (pg_trgm >= 0.95)
5. CREATE NEW
6. SELF-LEARNING

See `docs/CANONICAL_RESOLUTION_STRATEGY.md` for full specification.
