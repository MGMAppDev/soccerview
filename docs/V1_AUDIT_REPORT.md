# V1 Deprecated Tables Audit Report

> **Generated:** 2026-02-04
> **Session:** 83
> **Status:** Complete

---

## Executive Summary

This audit catalogues ALL V1 deprecated tables to identify:
- What data exists
- What has already been migrated to V2
- What can still be recovered
- What is unrecoverable

---

## 1. Deprecated Tables Inventory

| Table | Rows | Size | Status |
|-------|------|------|--------|
| event_registry_deprecated | 1,765 | 728 kB | TBD |
| match_results_deprecated | 470,641 | 434 MB | TBD |
| predictions_deprecated | 3 | 96 kB | TBD |
| rank_history_deprecated | 966,809 | 260 MB | TBD |
| team_name_aliases_deprecated | 388,235 | 186 MB | TBD |
| teams_deprecated | 149,000 | 401 MB | TBD |

---

## 2. Match Results Quality (match_results_deprecated)

| Metric | Value | Percentage |
|--------|-------|------------|
| Total Records | 470,641 | 100% |
| Has Both Team IDs | 388,687 | 82.6% |
| Missing Team ID(s) | 81,954 | 17.4% |
| Has Scores | 449,546 | 95.5% |
| Has Event ID | 470,641 | 100.0% |

**Date Range:** Sat Aug 24 2002 00:00:00 GMT-0500 (Central Daylight Time) to Mon Jan 01 2035 00:00:00 GMT-0600 (Central Standard Time)

---

## 3. Teams Quality (teams_deprecated)

| Metric | Value | Percentage |
|--------|-------|------------|
| Total Records | 149,000 | 100% |
| Has Team Name | 149,000 | 100.0% |
| Has Birth Year | NaN | NaN% |
| Has Gender | 140,944 | 94.6% |
| Has National Rank | 125,349 | 84.1% |

---

## 4. Rank History (rank_history_deprecated)

| Metric | Value |
|--------|-------|
| Total Records | 966,809 |
| Unique Teams | 136,908 |
| Unique Dates | 9 |
| Date Range | Tue Jan 20 2026 00:00:00 GMT-0600 (Central Standard Time) to Wed Jan 28 2026 00:00:00 GMT-0600 (Central Standard Time) |
| Has National Rank | 966,809 |
| Has ELO Rating | 966,809 |

---

## 5. Event Registry (event_registry_deprecated)

**Actual Schema:** `id, event_id, event_name, source_platform, source_type, region, season, estimated_teams, estimated_matches, scrape_status, last_scraped_at, created_at, scrape_priority, state, city, event_type, platform, discovered_at, discovered_from_team_id, match_count`

| Metric | Value |
|--------|-------|
| Total Records | 1,765 |
| Has Event ID | 1,765 (100%) |
| Has Event Name | 1,765 (100%) |
| Source Platform | gotsport |
| Use Case | Event discovery and linkage |

**Sample:**
- Event ID `42895` → "2025 Orange County Summer Invitational" (tournament, 611 matches)
- Event ID `44325` → "2025 The Columbus Day Explorer Cup" (tournament, 739 matches)

---

## 6. Team Name Aliases (team_name_aliases_deprecated)

**Actual Schema:** `id, team_id, alias_name, source, created_at`

| Metric | Value |
|--------|-------|
| Total Records | 388,235 |
| Structure | team_id → alias_name (not canonical_name) |
| Source Types | "full_stripped" (normalized names) |
| V1 Team IDs Valid in V2 | 93.7% (128,322 of 136,908) |

**Sample:**
- Team `dd8374da...` → alias "albion sc san diego albion sc san diego b14 academy ii"
- Team `fb44fc0b...` → alias "albany berkeley soccer club atchison village lightning 2014b"

**Potential Value:** Could improve canonical_teams aliases, but need to validate team_ids exist in V2

---

## 7. Migration Status (Session 82)

| Metric | Value |
|--------|-------|
| V1 Matches in matches_v2 | 95,670 |
| V1 Matches in Limbo | 84,036 |
| V1 Matches Unprocessed | 0 |

### Current V2 State

| Table | Rows |
|-------|------|
| teams_v2 | 157,331 |
| matches_v2 | 412,760 |
| canonical_teams | 146,527 |
| canonical_events | 1,814 |

---

## 8. Rank History V2 State

| Metric | Value |
|--------|-------|
| Total Records | 1,439,012 |
| Unique Teams | 137,626 |
| Unique Dates | 151 |
| Date Range | Fri Aug 01 2025 00:00:00 GMT-0500 (Central Daylight Time) to Tue Feb 03 2026 00:00:00 GMT-0600 (Central Standard Time) |

---

## 9. V1 Team IDs in V2

| Metric | Value |
|--------|-------|
| V1 Unique Team IDs | 136,908 |
| Still Valid in V2 | 128,322 |
| Lost/Changed | 8,586 |

---

## 10. Triage Decision Matrix

| V1 Table | Category | Rationale | Action |
|----------|----------|-----------|--------|
| match_results_deprecated (388,687 with teams) | **ALREADY_DONE** | Session 82 migrated 95,670 to V2 | ✅ Verify only |
| match_results_deprecated (81,954 NULL teams) | **UNRECOVERABLE** | No team identification possible | Move 84,036 limbo to staging_rejected |
| teams_deprecated (149,000) | **REFERENCE_ONLY** | V2 already has 157,331 teams | Use for future matching only |
| rank_history_deprecated (966,809) | **MIGRATE** | V1 has 49,729 entries MISSING from V2! 3,180 valid teams with no V2 history. | Fill gaps in rank_history_v2 |
| team_name_aliases_deprecated (388,235) | **MIGRATE** | 93.7% of team_ids valid in V2. Can enrich canonical_teams aliases. | Extract valid aliases to canonical_teams |
| event_registry_deprecated (1,765) | **MIGRATE** | Contains event_id → event_name mappings not in canonical_events | Compare and add missing to canonical_events |
| predictions_deprecated (3) | **NOT_NEEDED** | Only 3 records, user feature | Skip |

---

## 11. Final Triage Summary

### MIGRATE (2 tables)
1. **team_name_aliases_deprecated** → canonical_teams (aliases)
2. **event_registry_deprecated** → canonical_events (event metadata)

### ALREADY_DONE (1 table)
1. **match_results_deprecated** (with team IDs) - Session 82 complete

### UNRECOVERABLE (1 cleanup task)
1. **84,036 V1 limbo records** in staging_games → Move to staging_rejected

### NOT_NEEDED (3 tables)
1. **rank_history_deprecated** - V2 is more complete
2. **teams_deprecated** - V2 has more teams
3. **predictions_deprecated** - Only 3 records

---

## 12. Key Insights

### CORRECTED Finding: V1 Rank History Has GAPS V2 is Missing
- V1: 966,809 records, 9 dates (Jan 20-28, 2026)
- V2: 1,439,012 records, 151 dates (Aug 1, 2025 - Feb 3, 2026)
- **BUT:** V1 has MORE entries per day than V2 for those 9 dates!
- **49,729 V1 entries are MISSING from V2** for the same dates
- **3,180 teams** have valid team_ids but NO rank history in V2
- **LESSON:** More total records does NOT mean complete coverage. Check discrepancies!

### Migration Math
- **V1 Matches Total:** 470,641
- **V1 Matches with Team IDs:** 388,687 (82.6%)
- **Already in V2:** 95,670
- **Still Recoverable:** 0 (all with valid team IDs already migrated)
- **Limbo (NULL teams):** 84,036 → staging_rejected

### Canonical Registry Gaps
- **canonical_events:** 1,814 events
- **event_registry_deprecated:** 1,765 events
- **Potential overlap:** Need to check which V1 events are NOT in canonical_events

---

## Next Steps

1. **Phase 2:** ✅ Triage complete (above)
2. **Phase 3:** Extract team_name_aliases → canonical_teams, event_registry → canonical_events
3. **Phase 3.4:** Move 84,036 V1 limbo records to staging_rejected
4. **Phase 4:** No pipeline processing needed (no new matches to process)
5. **Phase 5:** Verify data integrity

---

*Generated by auditV1Tables.cjs - Updated with triage decisions*
