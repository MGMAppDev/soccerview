# UI Protection Protocol

> **Version 1.3** | Updated: February 5, 2026 | Session 90
>
> **🚨 Read [GUARDRAILS](1.1-GUARDRAILS_v2.md) first - UI protection is Rule #1.**

UI files are **PROTECTED ARTIFACTS**. They require mandatory backups before any modification.

---

## Locked UI Components

| Component | File | Golden Archive |
|-----------|------|----------------|
| Team Details | `app/team/[id].tsx` | `ui-archives/team-details/v1.0_golden_2026-01-31.tsx` |
| Rankings | `app/(tabs)/rankings.tsx` | `ui-archives/rankings/v1.0_golden_2026-01-31.tsx` |
| Matches | `app/(tabs)/matches.tsx` | `ui-archives/matches/v1.0_golden_2026-01-31.tsx` |
| Teams | `app/(tabs)/teams.tsx` | `ui-archives/teams/v1.0_golden_2026-01-31.tsx` |
| Home | `app/(tabs)/index.tsx` | `ui-archives/home/v1.0_golden_2026-01-31.tsx` |
| VS Battle (Predict) | `app/predict/index.tsx` | *(needs golden archive)* |

---

## Mandatory Pre-Edit Protocol

**Before touching ANY file in `/app/` or `/components/`:**

1. **CREATE BACKUP**: `node scripts/ui-backup.js app/team/[id].tsx`
2. **READ FULL FILE**: Understand existing structure before changes
3. **MINIMAL CHANGES ONLY**: Fix specific issue, do NOT refactor
4. **TEST**: Verify UI renders correctly after each change

---

## Forbidden Operations

- `git checkout HEAD -- app/**/*.tsx` (WIPES UNCOMMITTED WORK)
- `git reset` on UI files
- Rewriting entire components
- Changing data types/interfaces without mapping
- Removing features to "simplify"
- Batch changes to multiple UI files

---

## Required Operations

- Run `node scripts/ui-backup.js <file>` BEFORE any edit
- Read and understand existing code structure
- Make surgical, minimal changes
- Map new data structures to existing UI expectations
- Test UI after each change
- Archive successful changes as new version

---

## When Database Schema Changes

When V1->V2 or any schema migration affects UI:

1. **NEVER change UI types/interfaces**
2. **Map data to fit existing UI expectations**:
```javascript
// Example: display_name -> team_name mapping
const mappedTeam = {
  ...teamData,
  team_name: teamData.display_name,  // UI expects team_name
};
```
3. **Keep column references in query layer, not UI layer**

---

## Disaster Recovery

If UI breaks:

1. **STOP** - Do not make more changes
2. **RESTORE**:
```bash
# List available versions
node scripts/ui-restore.js team-details

# Restore golden version
node scripts/ui-restore.js team-details golden
```
3. **VERIFY** - Reload app, confirm UI works
4. **REPORT** - Document what caused the issue

---

## Utility Scripts

| Script | Purpose | Usage |
|--------|---------|-------|
| `scripts/ui-backup.js` | Create timestamped backup | `node scripts/ui-backup.js app/team/[id].tsx` |
| `scripts/ui-restore.js` | List/restore from archive | `node scripts/ui-restore.js team-details golden` |

---

## Archive Location

- **Index**: `ui-archives/ARCHIVE_INDEX.md`
- **Golden versions**: `ui-archives/[component]/v1.X_golden_*.tsx`
- **Pre-edit backups**: `ui-archives/[component]/backup_*.tsx`

---

## Why This Matters

Session 66 lost hours of UI work when `git checkout` was run to fix a database issue. The League/Tournament grouping feature had to be completely rebuilt.

**Prevention > Recovery**: Always backup before editing.

---

## Change Log

| Session | File | Change | Impact |
|---------|------|--------|--------|
| 90 | `app/team/[id].tsx` | `renderExpandedMatch()`: `View` → `TouchableOpacity` with match navigation | ZERO design change — adds tap handler only |
| 90 | `app/match/[id].tsx` | Icons swapped (league=⚽, tournament=🏆), remove name truncation, align scores, gender M/F→Boys/Girls | ZERO design change — data display fixes only |
| 90 | `app/team/[id].tsx` | `renderRecentMatch()`: icon swap (league=⚽, tournament=🏆) | ZERO design change — corrects emoji only |
