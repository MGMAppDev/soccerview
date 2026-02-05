# Session 87.3: Documentation Overhaul + Git Cleanup

> **Goal:** Meticulous update of ALL project .md files for Sessions 86-87.2, archive stale docs, commit + push everything, answer user questions.

---

## Answers to User Questions

### Can I test in Expo Go now?
**YES.** The app is ready. All V2 materialized views are correctly referenced, database has current data (410,319 active matches, 161,231 teams, ELO recalculated, views refreshed). 19 TypeScript warnings exist but are type-safety only -- no runtime blockers. Run `npx expo start`.

### What's the diff between Data Expansion Roadmap and Scraping Playbook?

| Document | Answers | Scope |
|----------|---------|-------|
| `DATA_EXPANSION_ROADMAP` | "WHAT to scrape next and WHY" | Strategy: priority queues, coverage gaps by state, which platforms to target |
| `DATA_SCRAPING_PLAYBOOK` | "HOW to scrape" | Procedure: step-by-step commands, adapter creation, pipeline execution, monitoring |

**Current problems:**
- Both duplicate "Universal Framework Scripts" and "Maintenance Scripts" sections
- Both repeat some rules (Premier-only, Nomenclature)
- Roadmap still references archived `validationPipeline.js`
- Neither clearly separates daily automated pipeline from manual new-source onboarding

**Fix:** Add scope statements to both, deduplicate script sections (Roadmap cross-refs Playbook), add "Daily Operations vs New Source Onboarding" section to Playbook.

### Is there a daily scrape playbook and a new sources playbook?
Not currently. The tools are the same (`coreScraper.js` + adapters) but the processes differ:

- **Daily:** Fully automated via GitHub Actions. No manual steps needed unless it fails.
- **New source:** Manual -- research site, create adapter, test, validate, iterate.

**Fix:** Add a clear section in the Playbook distinguishing the two. No need for separate files since the tools are shared.

### Are there 69 pending git pushes?
**No.** Git investigation found 0 unpushed commits -- all commits are already on `origin/main`. What you're seeing is likely 39 untracked files + 7 modified files = 46 pending changes that need to be committed and pushed. VS Code may be counting these as "pending."

---

## Execution Phases

### Phase 0: Delete Garbage + Update .gitignore

**DELETE 9 files** (accidental artifacts from debug sessions):
```
rm away_score away_team_id home_score home_team_id match_date source_match_key nul check_db.cjs check_db.js
```

**Add to .gitignore:**
```
backup_*.json
scripts/.*_checkpoint.json
scripts/.heartland_checkpoint.json
```

**DO NOT commit:** `.claude/settings.local.json` (machine-specific), `backup_*.json` (too large)

### Phase 1: Archive 8 Completed Session Plans

Move to `docs/_archive/`:

| File | Reason |
|------|--------|
| `SESSION_82_EXECUTION_PLAN.md` | V1 migration complete |
| `SESSION_83_EXECUTION_PLAN.md` | V1 extraction complete |
| `SESSION_84_PREMIER_ONLY_PLAN.md` | Recreational removal complete |
| `SESSION_85_SOCCERVIEW_ID_CHECKLIST.md` | Semantic constraint applied, recovered in S86 |
| `SESSION_86_RECOVERY_CHECKLIST.md` | All phases complete (S86+S87+S87.2) |
| `SESSION_87_UNIVERSAL_RESOLVER.md` | Cross-gender fix complete |
| `SESSION_87_2_SCRAPING_PLAN.md` | HTGSports scraping complete |
| `V1_AUDIT_REPORT.md` | Reference-only, V1 migration finished |

**KEEP** in `docs/`: `CANONICAL_RESOLUTION_STRATEGY.md` (active methodology, not a session plan)

### Phase 2: Update docs/1.3-SESSION_HISTORY.md

- Update header: "Session 87.2 Complete" + "February 4, 2026"
- Add 3 rows to Project Phases Overview table (Sessions 86, 87, 87.2)
- Add full Session 86 entry (match recovery, soft-delete migration, 6,053 matches recovered)
- Add full Session 87 entry (gender fix, canonicalResolver.js, 306 teams merged)
- Add full Session 87.2 entry (staging constraint, fastProcessStaging.cjs, 7,200 matches processed)

### Phase 3: Update CLAUDE.md

- Version: 9.1 -> 10.0, date to Feb 4 2026, "Session 87.2 Complete"
- Database Status table: Update counts (161,231 teams, 410,319 matches, 0 unprocessed staging)
- Current Session Status: Replace S82/81/80/79 with S87.2/87/86/85 summaries
- Key Scripts: Add `fastProcessStaging.cjs`, `canonicalResolver.js`
- Fix stale references: All `validationPipeline.js` mentions -> `dataQualityEngine.js`
- Development Commands: Add `fastProcessStaging.cjs` command

### Phase 4: Update docs/1.2-ARCHITECTURE.md

- Version: 3.8 -> 4.0, date to Feb 4 2026
- Update row counts: teams_v2: 161,231, matches_v2: 410,319
- Add soft-delete documentation to matches_v2 schema section
- Add staging_games UNIQUE constraint documentation
- Fix stale references: `validationPipeline.js` -> `dataQualityEngine.js`

### Phase 5: Update docs/3-DATA_EXPANSION_ROADMAP.md

- Version: 2.5 -> 3.0, date to Feb 4 2026
- Add scope statement
- Fix stale `validationPipeline.js` references
- Deduplicate script sections with cross-reference to Playbook

### Phase 6: Update docs/3-DATA_SCRAPING_PLAYBOOK.md

- Add scope statement
- Add "Daily Operations vs New Source Onboarding" section
- Fix ALL stale `validationPipeline.js` references
- Fix Heartland CGI status documentation

### Phase 7: Minor Updates to Other Docs

- `docs/1.1-GUARDRAILS_v2.md` - Add new scripts to reference
- `docs/4-LAUNCH_PLAN.md` - Update team count
- `docs/2-UNIVERSAL_DATA_QUALITY_SPEC.md` - Update status counts

### Phase 8: Stage New Scripts

Stage all untracked scripts created in Sessions 86-87.2 (20+ files).

### Phase 9: Commit and Push

Single commit with comprehensive message, then `git push origin main`.

---

## Verification Checklist

- [ ] `git status` shows clean working tree (no untracked except gitignored files)
- [ ] `git log --oneline -1` shows the new commit
- [ ] VS Code `docs/` folder shows only active docs (session plans archived)
- [ ] All docs reference `dataQualityEngine.js`, not `validationPipeline.js`
- [ ] Database counts are consistent across CLAUDE.md, ARCHITECTURE.md, and SESSION_HISTORY.md
