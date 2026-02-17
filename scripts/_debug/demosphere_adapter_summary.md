# Demosphere Adapter v1.0 - Complete

## Status: ✅ WORKING

The Demosphere adapter is now fully functional and tested.

## What Was Fixed

### 1. JSON Field Mappings (CRITICAL)
Initial code assumed field names from documentation. Actual API uses different names:

| Documented | Actual | Purpose |
|------------|--------|---------|
| `dtsd` | `dt` | Date (DD-MMM-YYYY) |
| `tim` | `tim` | Time (but with weird prefix) |
| `htm` | `tm1` | Home/Team 1 ID |
| `vtm` | `tm2` | Away/Team 2 ID |
| `hsc` | `sc1` | Home/Team 1 score |
| `vsc` | `sc2` | Away/Team 2 score |
| `fld` | `facn` | Facility name (location) |

### 2. Time Format Parsing
API returns: `"30-DEC-1899 12:00:00.0000"` (weird Excel serial date prefix)
Parser extracts: `"12:00"` using regex `(\d{1,2}):(\d{2})`

### 3. Team Name Resolution Strategy
- JSON has team IDs but **NOT team names**
- Use placeholder names: `DEMOSPHERE_TEAM_{teamId}`
- Set `homeId`/`awayId` for source_entity_map resolution
- Team names will be filled from standings scraper

### 4. Division Discovery
- The `index_E.html` page returns 404
- Use `event.divisions` array from staticEvents config instead
- Manual division discovery required per event

### 5. Property Name Format
CoreScraper expects **camelCase** (matchDate, homeTeamName)
Not **snake_case** (match_date, home_team_name)

### 6. Match Key Format
Changed from `demosphere-{orgId}-{matchId}` to `demosphere-{eventId}-{matchId}`
CoreScraper's generateMatchKey() doesn't support {orgId} placeholder

## Test Results

### Single Division Test (GU16 Division 3)
- Event: NCSL Travel Fall 2025 (80738-fall2025)
- Division: 115189283
- Matches found: **33**
- Matches staged: **33** ✅

### Sample Staged Data
```json
{
  "source_match_key": "demosphere-80738-fall2025-11363280",
  "match_date": "2025-09-06",
  "match_time": "16:00",
  "home_team_name": "DEMOSPHERE_TEAM_111206599",
  "away_team_name": "DEMOSPHERE_TEAM_92725281",
  "home_score": 2,
  "away_score": 3,
  "home_id": "111206599",
  "away_id": "92725281"
}
```

## Next Steps

### 1. Discover All NCSL Divisions
Need to find all division IDs for:
- Fall 2025 (current test event)
- Spring 2025

Manual process:
1. Browse https://elements.demosphere-secure.com/80738/schedules/index_E.html (if it loads)
2. Or inspect network traffic on NCSL website
3. Or try sequential division ID probing

### 2. Scrape Standings
Use the `scrapeStandings` function to get team names:
```bash
node scripts/universal/scrapeStandings.js --adapter demosphere
```

This will populate `staging_standings` with team names, which processStandings.cjs uses to:
- Resolve placeholder team names
- Register teams in source_entity_map
- Build canonical team entries

### 3. Process Through Pipeline
```bash
node scripts/universal/intakeValidator.js --clean-staging
node scripts/universal/dataQualityEngine.js --process-staging
# OR
node scripts/maintenance/fastProcessStaging.cjs --source demosphere
```

### 4. Add to Daily Pipeline
Once all divisions are configured, add to `.github/workflows/daily-data-sync.yml`:
```yaml
- name: Sync Demosphere (NCSL)
  run: node scripts/universal/coreScraper.js --adapter demosphere --active
```

## Files Modified

- `scripts/adapters/demosphere.js` - Complete rewrite of scrapeEvent function
- `scripts/_debug/test_demosphere_adapter.cjs` - API test script (created)
- `scripts/_debug/demosphere_adapter_summary.md` - This file (created)

## Technical Notes

### Why Placeholder Team Names?
Demosphere's schedule JSON endpoint does NOT include team names. Only team IDs.
Team names come from:
1. Standings XML endpoint (preferred - has full metadata)
2. Team roster pages (fallback - requires separate fetch per team)

The universal pipeline resolves placeholders via:
1. source_entity_map (Tier 1 - if team was seen before)
2. Standings data (processStandings.cjs matches by source_team_id)
3. Canonical team registry (fallback fuzzy matching)

### Rate Limiting
Configured for 800-1500ms delays between requests.
NCSL doesn't appear to have aggressive rate limiting, but good practice.

### Future Enhancements
- Auto-discover divisions via Puppeteer (if index_E.html is truly inaccessible)
- Fetch team names from individual team pages (parallel batches)
- Support multiple Demosphere organizations beyond NCSL

## Data Quality Verification

After pipeline processing, verify:
```sql
-- Count Demosphere matches
SELECT COUNT(*) FROM matches_v2
WHERE source_platform = 'demosphere';

-- Check team name resolution
SELECT COUNT(*) FROM teams_v2
WHERE display_name LIKE 'DEMOSPHERE_TEAM_%';
-- Should be 0 after standings processing

-- Verify source_entity_map coverage
SELECT COUNT(*) FROM source_entity_map
WHERE source_platform = 'demosphere'
AND entity_type = 'team';
```
