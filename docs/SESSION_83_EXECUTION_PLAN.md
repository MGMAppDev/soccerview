# Session 83: Event Discovery Pipeline + V1 Data Resolution

> **Created:** February 4, 2026
> **Status:** Ready for Implementation

---

## Two Separate Issues to Resolve

### Issue 1: Event Discovery (Coverage Gap) - 51,826 orphan teams
- `discoverGotSportEvents.cjs` is a dead end - reports but doesn't feed into scraping
- Event IDs were discovered in archived wave scripts but NEVER added to database
- Need to make discovery FUNCTIONAL and connected to pipeline

### Issue 2: V1 Staging Records (Data Quality) - 85,722 records
- V1 staging records marked processed but NOT in matches_v2
- Root cause: Original V1 `match_results_deprecated` has NULL team IDs
- Only 1,686 could be recovered; ~84,000 have NULL team_ids in SOURCE data
- These are UNRECOVERABLE - V1 never tracked who played these matches
- Need to mark as terminal failures (not leave in limbo)

---

## Already Discovered Event IDs (from archived wave scripts)

| Event ID | Name | Type |
|----------|------|------|
| `1271` | MLS NEXT League | league |
| `27199` | Girls Academy League | league |
| `36330` | Girls Academy 2024-25 | league |
| `23878` | National Academy League | league |
| `27220` | National Academy Championships | tournament |

**Note:** ECNL event IDs were NOT found in archived scripts - need manual discovery.

---

## Implementation Plan

### Step 1: Add Events to Adapter's staticEvents (CRITICAL)
**File:** `scripts/adapters/gotsport.js`

**Why:** The scraper discovers events from `matches_v2` (existing matches), NOT from the `leagues` table. New events with no matches won't be picked up automatically.

```javascript
staticEvents: [
  // MLS NEXT
  { id: '1271', name: 'MLS NEXT League', type: 'league' },
  { id: '27220', name: 'National Academy Championships', type: 'tournament' },

  // Girls Academy
  { id: '27199', name: 'Girls Academy League', type: 'league' },
  { id: '36330', name: 'Girls Academy 2024-25', type: 'league' },

  // National Academy League
  { id: '23878', name: 'National Academy League', type: 'league' },
],
```

### Step 2: Populate KNOWN_MISSING_EVENTS
**File:** `scripts/daily/discoverGotSportEvents.cjs`

```javascript
const KNOWN_MISSING_EVENTS = [
  { id: '1271', name: 'MLS NEXT League', type: 'league', platform: 'gotsport' },
  { id: '27220', name: 'National Academy Championships (MLS NEXT)', type: 'tournament', platform: 'gotsport' },
  { id: '27199', name: 'Girls Academy League', type: 'league', platform: 'gotsport' },
  { id: '36330', name: 'Girls Academy 2024-25', type: 'league', platform: 'gotsport' },
  { id: '23878', name: 'National Academy League', type: 'league', platform: 'gotsport' },
];
```

### Step 3: Update Workflow
**File:** `.github/workflows/daily-data-sync.yml`

1. Change discover-events to run both `--report` AND `--add-known`
2. Add `needs: discover-events` to sync-gotsport, sync-htgsports, sync-heartland

```yaml
sync-gotsport:
  name: "📊 GotSport Events"
  needs: discover-events  # ← ADD THIS
```

### Step 4: Cleanup V1 Limbo Records
**File:** NEW `scripts/maintenance/cleanupV1Limbo.cjs`

Move unrecoverable V1 records to `staging_rejected`:

```sql
INSERT INTO staging_rejected (source_match_key, home_team_name, away_team_name, match_date, rejection_reason, rejected_at)
SELECT sg.source_match_key, sg.home_team_name, sg.away_team_name, sg.match_date,
  'V1_NULL_TEAM_ID: Original V1 archive has NULL home_team_id or away_team_id', NOW()
FROM staging_games sg
WHERE sg.source_match_key LIKE 'v1-legacy-%'
  AND sg.processed = true
  AND NOT EXISTS (SELECT 1 FROM matches_v2 m WHERE m.source_match_key = sg.source_match_key);
```

---

## Data Flow After Implementation

```
discover-events (--add-known)
       │
       │ Adds MLS NEXT, Girls Academy, NAL to leagues table
       ▼
sync-gotsport (needs: discover-events)
       │
       │ Scrapes those events → staging_games
       ▼
dataQualityEngine
       │
       │ staging → matches_v2
       ▼
Orphan teams get matches → No longer orphans!
```

---

## Files to Modify

| File | Change | Priority |
|------|--------|----------|
| `scripts/adapters/gotsport.js` | Add events to `staticEvents` array | **CRITICAL** |
| `scripts/daily/discoverGotSportEvents.cjs` | Populate KNOWN_MISSING_EVENTS | Medium |
| `.github/workflows/daily-data-sync.yml` | Connect discover-events to scrapers | Medium |
| NEW: `scripts/maintenance/cleanupV1Limbo.cjs` | Move unrecoverable V1 to staging_rejected | Medium |

---

## Verification Steps

1. **After staticEvents update:** Test locally
   ```bash
   node scripts/universal/coreScraper.js --adapter gotsport --event 1271 --dry-run
   ```

2. **After workflow changes:** Trigger manual workflow run
   - Verify discover-events appears CONNECTED to scrapers in GitHub Actions UI

3. **After full pipeline run:**
   ```sql
   SELECT COUNT(*) FROM staging_games WHERE source_match_key LIKE 'gotsport-1271-%';
   SELECT COUNT(*) FROM matches_v2 WHERE source_match_key LIKE 'gotsport-1271-%';
   SELECT COUNT(*) FROM teams_v2 WHERE national_rank IS NOT NULL AND matches_played = 0;
   ```

---

## Future: ECNL Discovery

ECNL event IDs were NOT found in archived scripts. To add ECNL:
1. Search GotSport website: https://system.gotsport.com/events
2. Find ECNL Boys and ECNL Girls event IDs
3. Add to staticEvents and KNOWN_MISSING_EVENTS
