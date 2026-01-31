# UI Archive Index

> **PURPOSE**: Protected archive of UI components. Golden versions are LOCKED and must never be modified.

## LOCKED GOLDEN VERSIONS

| Component | Archive Path | Status | Locked Date | Description |
|-----------|--------------|--------|-------------|-------------|
| Team Details | `team-details/v1.0_golden_2026-01-31.tsx` | GOLDEN | 2026-01-31 | League/Tournament grouping, Charts, Power Rating cards |
| Rankings | `rankings/v1.0_golden_2026-01-31.tsx` | GOLDEN | 2026-01-31 | Filters, search, infinite scroll |
| Matches | `matches/v1.0_golden_2026-01-31.tsx` | GOLDEN | 2026-01-31 | Match cards, date grouping |
| Teams | `teams/v1.0_golden_2026-01-31.tsx` | GOLDEN | 2026-01-31 | Team browser, filters, search |
| Home | `home/v1.0_golden_2026-01-31.tsx` | GOLDEN | 2026-01-31 | Dashboard, quick stats |

## Archive Protocol

### Before ANY UI Modification:
1. Check if file is LOCKED in table above
2. Run: `node scripts/ui-backup.js <file-path>`
3. Make minimal, surgical changes only
4. Test UI renders correctly
5. If successful, create new versioned archive

### After Successful Feature Completion:
1. Copy working file to archive: `ui-archives/[component]/v1.X_[description]_[date].tsx`
2. Update this index
3. Mark as GOLDEN if stable

### Recovery Procedure:
1. Identify component from archive table
2. Copy golden version back: `cp ui-archives/[component]/v1.X_golden_*.tsx app/[path]/`
3. Verify UI loads correctly

## Version History

### team-details/
- v1.0_golden_2026-01-31.tsx - Initial golden archive (League/Tournament grouping, all cards working)

### rankings/
- v1.0_golden_2026-01-31.tsx - Initial golden archive

### matches/
- v1.0_golden_2026-01-31.tsx - Initial golden archive

### teams/
- v1.0_golden_2026-01-31.tsx - Initial golden archive

### home/
- v1.0_golden_2026-01-31.tsx - Initial golden archive
