# Session 85: Universal SoccerView ID Architecture

> **Date:** February 4, 2026
> **Goal:** Align `matches_v2` uniqueness with SoccerView ID strategy (like all other entities)
> **Issue:** Duplicate matches appearing in Team Details due to source-specific `source_match_key`

---

## Pre-Flight Checks

- [ ] Read GUARDRAILS.md in full
- [ ] Read DATA_ISSUE_PROTOCOL.md
- [ ] Confirm: No UI changes will be made (data layer fix only)
- [ ] Confirm: All fixes are universal (not single-team fixes)

---

## Execution Checklist

### Phase 1: Diagnose Current State
- [ ] Run `node scripts/universal/deduplication/matchDedup.js --report`
- [ ] Document: How many semantic duplicate groups exist?
- [ ] Document: Sample of duplicate source_match_keys for same match

### Phase 2: Fix Existing Duplicates
- [ ] Run dry run: `node scripts/universal/deduplication/matchDedup.js --verbose`
- [ ] Review output: Verify correct matches will be kept
- [ ] Run execute: `node scripts/universal/deduplication/matchDedup.js --execute --verbose`
- [ ] Verify: Report shows 0 duplicate groups after fix

### Phase 3: Add Semantic Unique Constraint
- [ ] Create migration file: `scripts/migrations/085_add_semantic_match_constraint.sql`
- [ ] Create migration runner: `scripts/migrations/run_migration_085.js`
- [ ] Run migration (applies constraint to matches_v2)
- [ ] Verify constraint exists in database

### Phase 4: Update Data Quality Engine
- [ ] Backup: `scripts/universal/dataQualityEngine.js`
- [ ] Modify PROMOTE step (~line 1036): Change `ON CONFLICT (source_match_key)` to `ON CONFLICT (match_date, home_team_id, away_team_id)`
- [ ] Add score update logic using `GREATEST()`
- [ ] Test with staging data

### Phase 5: Update Daily Verification
- [ ] Add semantic duplicate check to `scripts/daily/verifyDataIntegrity.js`
- [ ] Test verification script runs successfully

### Phase 6: Audit GitHub Workflows
- [ ] Review `daily-data-sync.yml` for any source_match_key dependencies
- [ ] Review `capture-rank-snapshot.yml` for any impacts
- [ ] Update workflows if needed to align with semantic uniqueness
- [ ] Document any workflow changes made

### Phase 7: Recalculate Downstream Data
- [ ] Run: `node scripts/daily/recalculate_elo_v2.js`
- [ ] Run: `node scripts/daily/verifyDataIntegrity.js --fix`
- [ ] Run: `node scripts/refresh_views_manual.js`
- [ ] Verify: ELO ratings look reasonable (spot check 5 teams)

### Phase 8: Update Project Documentation
- [ ] Update `CLAUDE.md` - Add Principle 29: Universal SoccerView ID Architecture
- [ ] Update `docs/1.1-GUARDRAILS_v2.md` - Add match uniqueness rule
- [ ] Update `docs/1.2-ARCHITECTURE.md` - Update matches_v2 constraint documentation
- [ ] Update `docs/1.3-SESSION_HISTORY.md` - Add Session 85 summary

### Phase 9: Final Verification
- [ ] Run: `node scripts/universal/deduplication/matchDedup.js --report` (expect 0 duplicates)
- [ ] Run: `node scripts/daily/verifyDataIntegrity.js --halt-on-fail` (all checks pass)
- [ ] Manual spot check: Open Team Details page in app, verify no duplicate matches
- [ ] Verify: Season Stats match count equals Match History count

### Phase 10: Git Commit and Push
- [ ] Run: `git status` to review all changes
- [ ] Stage relevant files (NOT .env)
- [ ] Commit with message: "Session 85: Universal SoccerView ID architecture for matches"
- [ ] Push to remote: `git push origin main`
- [ ] Verify push succeeded

---

## Files Modified

| File | Change Type | Description |
|------|-------------|-------------|
| `scripts/migrations/085_add_semantic_match_constraint.sql` | NEW | Add semantic unique constraint |
| `scripts/migrations/run_migration_085.js` | NEW | Migration runner |
| `scripts/universal/dataQualityEngine.js` | MODIFY | Change ON CONFLICT clause |
| `scripts/daily/verifyDataIntegrity.js` | MODIFY | Add semantic duplicate check |
| `CLAUDE.md` | MODIFY | Add Principle 29 |
| `docs/1.1-GUARDRAILS_v2.md` | MODIFY | Add match uniqueness rule |
| `docs/1.2-ARCHITECTURE.md` | MODIFY | Update constraint docs |
| `docs/1.3-SESSION_HISTORY.md` | MODIFY | Add Session 85 |

---

## GitHub Workflow Audit

### daily-data-sync.yml
| Component | Uses source_match_key? | Action Needed |
|-----------|----------------------|---------------|
| Phase 1: Data Collection | No (writes to staging) | None |
| Phase 2: Validation Pipeline | Yes (dataQualityEngine) | Will use new semantic constraint |
| Phase 2.25: Weekly Dedup | Yes (matchDedup.js) | Already uses semantic grouping |
| Phase 2.75: Verify Integrity | No | Add semantic check |
| Phase 3-5: ELO/Predictions/Views | No | None |

### capture-rank-snapshot.yml
| Component | Uses source_match_key? | Action Needed |
|-----------|----------------------|---------------|
| captureRankSnapshot.js | No (reads teams_v2) | None |

---

## Rollback Plan

If issues occur:
1. Revert dataQualityEngine.js from backup
2. Drop new constraint: `ALTER TABLE matches_v2 DROP CONSTRAINT IF EXISTS unique_match_semantic;`
3. Re-add old constraint if needed: `ALTER TABLE matches_v2 ADD CONSTRAINT unique_match UNIQUE (match_date, home_team_id, away_team_id, home_score, away_score);`

---

## Success Criteria

- [ ] `matchDedup.js --report` shows 0 duplicate groups
- [ ] `verifyDataIntegrity.js` all checks pass
- [ ] Team Details page shows no duplicate matches
- [ ] Season Stats match count = Match History count
- [ ] ELO ratings recalculated correctly
- [ ] All changes committed and pushed to git

---

## Architecture After Implementation

| Entity | Uniqueness Strategy | Uses SoccerView IDs? |
|--------|--------------------|--------------------|
| Teams | canonical_teams → team_v2_id | ✅ |
| Clubs | canonical_clubs → club_id | ✅ |
| Leagues | canonical_events → league_id | ✅ |
| Tournaments | canonical_events → tournament_id | ✅ |
| Schedules | (date, home_team_id, away_team_id) | ✅ |
| **Matches** | **(date, home_team_id, away_team_id)** | ✅ **FIXED** |

**Result:** ALL entities use SoccerView IDs as their uniqueness anchor.
