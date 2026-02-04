# Session 84: Premier-Only Data Migration Plan

> **Status:** APPROVED FOR EXECUTION
> **Date:** February 3, 2026
> **Goal:** Remove all recreational soccer data - SoccerView is Premier-only

---

## CRITICAL REFERENCES

| Document | Why It Matters |
|----------|----------------|
| **[GUARDRAILS_v2.md](1.1-GUARDRAILS_v2.md)** | **READ FIRST** - Absolute rules that CANNOT be violated |
| [ARCHITECTURE.md](1.2-ARCHITECTURE.md) | V2 data flow - must not be broken |
| [CLAUDE.md](../CLAUDE.md) | Project principles - add Principle 28 |

---

## GUARANTEES (Non-Negotiable)

### Guarantee 1: V2 Architecture Will NOT Be Broken

| Component | Status | Explanation |
|-----------|--------|-------------|
| `teams_v2` table schema | **UNCHANGED** | No columns added/removed |
| `matches_v2` table schema | **UNCHANGED** | No columns added/removed |
| `leagues` table schema | **UNCHANGED** | No columns added/removed |
| `dataQualityEngine.js` | **UNCHANGED** | Pipeline processor not modified |
| `recalculate_elo_v2.js` | **UNCHANGED** | ELO script not modified |
| `captureRankSnapshot.js` | **UNCHANGED** | Snapshot script not modified |
| Materialized views | **UNCHANGED** | No view definitions modified |
| Pipeline flow | **UNCHANGED** | Staging → DQE → Production → Views |

**How we achieve this:** We filter at the SOURCE (adapter) and INTAKE (validator), not in the core pipeline. Data that enters staging is already premier-only.

### Guarantee 2: UI Will NOT Be Changed

| Aspect | Status | Explanation |
|--------|--------|-------------|
| `.tsx` files | **ZERO CHANGES** | Per GUARDRAILS §1: Never touch UI files |
| Component structure | **UNCHANGED** | No layout/styling changes |
| Data schema to UI | **UNCHANGED** | Views return same columns |
| App behavior | **UNCHANGED** | Same queries, same responses |

**How we achieve this:** Per GUARDRAILS §1: "If the UI shows wrong data, fix the data source — not the UI." We fix at data layer only.

### Guarantee 3: No Data Loss (Premier Data)

| Data Type | Status | Explanation |
|-----------|--------|-------------|
| Premier matches | **PRESERVED** | Only `heartland-recreational-%` keys deleted |
| Premier teams | **PRESERVED** | Teams NOT deleted (stats recalculate) |
| GotSport data | **PRESERVED** | No GotSport data matches rec patterns |
| HTGSports data | **PRESERVED** | No HTGSports data matches rec patterns |
| Backup | **30 DAYS** | `_archived_recreational_matches` table |

---

## MIXED TEAMS CLARIFICATION

**Question:** Will teams that played BOTH premier AND recreational matches appear in rankings?

**Answer:** YES - but only based on their PREMIER performance.

| Scenario | What Happens | Appears in App? | In ELO Calc? |
|----------|--------------|-----------------|--------------|
| Team with ONLY rec matches | Rec matches deleted, stats → 0 | **NO** (0 matches) | **NO** |
| Team with ONLY premier matches | No change | **YES** | **YES** |
| Team with BOTH | Rec matches deleted, stats recalculated from premier only | **YES** | **YES** (premier only) |
| Team with GotSport rank + rec matches | Rec matches deleted, keeps GS rank | **YES** | **YES** |

**Why teams aren't deleted:**
- `teams_v2` is the entity table - deleting teams breaks foreign keys
- Teams with GotSport `national_rank` should appear even if no matches
- After cleanup, `recalculate_elo_v2.js` recalculates stats from remaining matches
- `app_rankings` view filters: `WHERE matches_played > 0 OR national_rank IS NOT NULL`

**Result:** Teams with 0 premier matches AND no GotSport rank will NOT appear in rankings.

---

## MASTER EXECUTION CHECKLIST

### Pre-Flight (Before ANY Changes)

- [ ] **READ [GUARDRAILS_v2.md](1.1-GUARDRAILS_v2.md) IN FULL**
- [ ] Verify current database state with analysis script
- [ ] Confirm recreational match count in matches_v2
- [ ] Confirm recreational league count in leagues
- [ ] Document current team/match counts for comparison

### Phase 1: Analysis (Read-Only)

- [ ] Create `scripts/audit/analyzeRecreationalData.cjs`
- [ ] Run analysis script
- [ ] Record counts:
  - [ ] Recreational matches in matches_v2: ______
  - [ ] Recreational leagues: ______
  - [ ] Teams with ONLY rec matches: ______
  - [ ] Teams with BOTH rec and premier: ______
- [ ] Review counts - proceed only if reasonable

### Phase 2: Stop the Source (Adapter)

- [ ] **BACKUP** `scripts/adapters/heartland.js` before editing
- [ ] Remove `Recreational` from `leagues` config
- [ ] Remove `heartland-recreational-2026` from `staticEvents`
- [ ] Add `isRecreationalTeam()` filter function
- [ ] Add filter to `scrapeCalendarSchedules()`
- [ ] Add filter to `scrapeTeamSchedule()`
- [ ] Test adapter with dry run (no database writes)
- [ ] Verify adapter only returns premier data

### Phase 3: Defense Layer (Intake Validator)

- [ ] **BACKUP** `scripts/universal/intakeValidator.js` before editing
- [ ] Add `RECREATIONAL_PATTERNS` to CONFIG
- [ ] Add `RECREATIONAL_LEVEL` to REJECTION_CODES
- [ ] Add validation rule in `validateRecord()`
- [ ] Test validator with sample recreational data
- [ ] Verify rejection works correctly

### Phase 4: Historical Data Cleanup

- [ ] Create `scripts/migrations/080_remove_recreational_data.sql`
- [ ] Create `scripts/migrations/run_migration_080.js`
- [ ] **DRY RUN** - run with SELECT to see affected rows
- [ ] Verify affected row count matches Phase 1 analysis
- [ ] **EXECUTE** migration
- [ ] Verify backup table `_archived_recreational_matches` created
- [ ] Verify deletion counts logged

### Phase 5: Recalculate Stats & ELO

- [ ] Run `node scripts/daily/recalculate_elo_v2.js`
- [ ] Verify ELO script completes without errors
- [ ] Run `node scripts/refresh_views_manual.js`
- [ ] Verify view refresh completes without errors

### Phase 6: Verification

- [ ] Create `scripts/audit/verifyPremierOnly.cjs`
- [ ] Run verification script
- [ ] Confirm all checks pass:
  - [ ] 0 recreational matches in matches_v2
  - [ ] 0 recreational leagues
  - [ ] 0 recreational in staging_games
  - [ ] Stats integrity (matches_played = W + L + D)
- [ ] Manual app check:
  - [ ] Rankings page - no rec teams visible
  - [ ] Team search - no rec teams in results
  - [ ] Upcoming games - premier teams only
  - [ ] Team detail pages load correctly

### Phase 7: Documentation

- [ ] Update CLAUDE.md - Add Principle 28
- [ ] Update docs/1.1-GUARDRAILS_v2.md - Add to common mistakes
- [ ] Update docs/1.2-ARCHITECTURE.md - Note premier-only
- [ ] Update docs/2-UNIVERSAL_DATA_QUALITY_SPEC.md - Add rejection rule
- [ ] Update docs/3-DATA_SCRAPING_PLAYBOOK.md - Update Heartland section
- [ ] Update docs/3-DATA_EXPANSION_ROADMAP.md - Add premier requirement
- [ ] Update docs/2-RANKING_METHODOLOGY.md - Note premier scope

### Post-Execution

- [ ] Git commit all changes with message: "Session 84: Premier-only data migration"
- [ ] Git push to remote
- [ ] Schedule reminder: DROP `_archived_recreational_matches` after 30 days
- [ ] Update SESSION_HISTORY.md with session summary

---

## FILES TO CREATE

| File | Purpose |
|------|---------|
| `scripts/audit/analyzeRecreationalData.cjs` | Pre-migration analysis |
| `scripts/migrations/080_remove_recreational_data.sql` | SQL cleanup |
| `scripts/migrations/run_migration_080.js` | Migration runner |
| `scripts/audit/verifyPremierOnly.cjs` | Post-migration verification |

## FILES TO MODIFY

| File | Change | GUARDRAILS Compliance |
|------|--------|----------------------|
| `scripts/adapters/heartland.js` | Remove Recreational, add calendar filter | ✅ Adapter is Layer 1 |
| `scripts/universal/intakeValidator.js` | Add recreational rejection | ✅ Validator is Layer 1.5 |
| `CLAUDE.md` | Add Principle 28 | ✅ Documentation |
| `docs/1.1-GUARDRAILS_v2.md` | Add to common mistakes | ✅ Documentation |
| `docs/1.2-ARCHITECTURE.md` | Note premier-only | ✅ Documentation |
| `docs/2-UNIVERSAL_DATA_QUALITY_SPEC.md` | Add rejection rule | ✅ Documentation |
| `docs/3-DATA_SCRAPING_PLAYBOOK.md` | Update Heartland | ✅ Documentation |
| `docs/3-DATA_EXPANSION_ROADMAP.md` | Add premier requirement | ✅ Documentation |
| `docs/2-RANKING_METHODOLOGY.md` | Note premier scope | ✅ Documentation |

## FILES NOT MODIFIED (Guaranteed)

| File | Reason |
|------|--------|
| `scripts/daily/recalculate_elo_v2.js` | Works on matches_v2 - already premier-only after cleanup |
| `scripts/daily/captureRankSnapshot.js` | Works on teams_v2 - already premier-only after cleanup |
| `scripts/universal/dataQualityEngine.js` | Processes staging - already premier-only after adapter change |
| `app/**/*.tsx` | **UI PROTECTED** per GUARDRAILS §1 |
| All materialized view definitions | No schema changes needed |

---

## ROLLBACK PLAN

If issues discovered at any phase:

```bash
# Phase 2-3 rollback (adapter/validator)
git checkout HEAD~1 scripts/adapters/heartland.js
git checkout HEAD~1 scripts/universal/intakeValidator.js

# Phase 4 rollback (data cleanup)
psql $DATABASE_URL -c "INSERT INTO matches_v2 SELECT * FROM _archived_recreational_matches;"

# Phase 5 rollback (recalculation)
node scripts/daily/recalculate_elo_v2.js
node scripts/refresh_views_manual.js
```

---

## GUARDRAILS COMPLIANCE CHECKLIST

| GUARDRAILS Rule | This Plan Complies? | How |
|-----------------|---------------------|-----|
| §1 UI Protection | ✅ | Zero .tsx files touched |
| §2 V2 Architecture | ✅ | Filter at source, not pipeline |
| §3 Data Integrity | ✅ | Backup created, NULL scores preserved |
| §5 Three-Layer Lifecycle | ✅ | Changes at Layer 1 (intake) only |
| §7 Schema Protection | ✅ | No schema changes |
| §15 Git Hygiene | ✅ | Commit after completion |

---

## SUCCESS CRITERIA

1. **Zero recreational matches** in `matches_v2`
2. **Zero recreational leagues** in `leagues`
3. **Premier teams ONLY** visible in app Rankings
4. **Upcoming Games** shows premier schedules only
5. **ELO rankings** based on premier matches only
6. **No UI changes** - app looks identical
7. **No pipeline changes** - V2 architecture intact
8. **All documentation** updated with premier-only policy
