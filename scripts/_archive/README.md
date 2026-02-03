# Archived Scripts (V1 Architecture)

> **Archived:** January 28, 2026 (Session 50)
> **Reason:** Replaced by V2 Three-Layer Database Architecture

These scripts were used with the V1 database architecture (teams, match_results tables).
They are preserved for historical reference but are **NOT USED** in production.

## V2 Architecture Replacement

The validation pipeline (`scripts/validationPipeline.js`) now handles:
- Team creation and linking
- Match validation and insertion
- Event registration
- View refresh

## Archived Script Categories

### 1. Linking Scripts (Replaced by validationPipeline.js)

| Script | Purpose | V2 Replacement |
|--------|---------|----------------|
| `fastLink.js` | Basic fuzzy matching | validationPipeline.js |
| `fastLinkV2.js` | Improved fuzzy matching | validationPipeline.js |
| `fastLinkV3.js` | Production linking script | validationPipeline.js |
| `fastLinkV3_resume.js` | Resume interrupted runs | validationPipeline.js |
| `fastLinkV3Parallel.js` | Parallel processing | validationPipeline.js |
| `linkTeams.js` | Main team linking | validationPipeline.js |
| `linkTeamsV2.js` | Version 2 linker | validationPipeline.js |
| `linkTeamsV5.js` | Version 5 linker | validationPipeline.js |
| `bulkLinkTeams.js` | Bulk operations | validationPipeline.js |
| `batchFuzzyLink.js` | Batch fuzzy matching | validationPipeline.js |
| `indexedFuzzyLink.js` | Index-based linking | validationPipeline.js |
| `fastNormalizedLink.js` | Normalized matching | validationPipeline.js |
| `chunkedLink.js` | Chunked processing | validationPipeline.js |
| `fixedLinkTeams.js` | Fixed linking logic | validationPipeline.js |
| `linkMatchesComprehensive.js` | Full match linking | validationPipeline.js |
| `linkMatchesFast.js` | Fast linking variant | validationPipeline.js |
| `linkMatchesBatched.js` | Batched linking | validationPipeline.js |
| `linkViaAliases.js` | Alias-based linking | validationPipeline.js |
| `linkHeartlandMatches.js` | Heartland-specific | validationPipeline.js |
| `linkHeartlandMatchesV2.js` | Heartland V2 | validationPipeline.js |

### 2. Reconciliation Scripts (Replaced by validationPipeline.js)

| Script | Purpose | V2 Replacement |
|--------|---------|----------------|
| `reconcileRankedTeams.js` | Match teams to rankings | validationPipeline.js |
| `reconcileRankedTeamsParallel.js` | Parallel reconciliation | validationPipeline.js |
| `reconcileFast.js` | Fast reconciliation | validationPipeline.js |
| `reconcilePureSQL.js` | SQL-based reconciliation | validationPipeline.js |

### 3. Alias Management Scripts (Obsolete with V2)

| Script | Purpose | V2 Replacement |
|--------|---------|----------------|
| `populateAliases.js` | Create alias records | Not needed in V2 |
| `createAliasIndex.js` | Index aliases | Not needed in V2 |
| `addColorRemovedAliases.js` | Special alias handling | Not needed in V2 |
| `setupLinkingInfrastructure.js` | Setup linking tables | Not needed in V2 |
| `cleanupYearMismatchAliases.js` | Fix bad aliases | Not needed in V2 |

### 4. Integration Scripts (Replaced)

| Script | Purpose | V2 Replacement |
|--------|---------|----------------|
| `integrateHeartlandTeams.js` | Create Heartland teams | validationPipeline.js |
| `runIntegrationPipeline.js` | Full integration | validationPipeline.js |

### 5. Fix Scripts (Obsolete)

| Script | Purpose | V2 Replacement |
|--------|---------|----------------|
| `fixMislinkedTeams.js` | Fix bad links | Not needed in V2 |
| `fixDuplicateTeamNames.js` | Fix duplicate names | Not needed in V2 |
| `fixDuplicateTeamNamesV2.js` | V2 duplicate fix | Not needed in V2 |
| `fixMislinkedMatches.js` | Fix bad match links | Not needed in V2 |
| `findMislinkedMatches.js` | Find bad links | Not needed in V2 |
| `unlinkYearMismatches.js` | Remove bad year matches | Not needed in V2 |

### 6. Diagnostic Scripts (Obsolete)

| Script | Purpose | V2 Replacement |
|--------|---------|----------------|
| `checkLinkingStatus.js` | Check V1 link status | Not needed in V2 |
| `checkReconcileStatus.js` | Check reconciliation | Not needed in V2 |

### 7. Legacy ELO Script

| Script | Purpose | V2 Replacement |
|--------|---------|----------------|
| `recalculate_elo.js` | V1 ELO calculation | recalculate_elo_v2.js |

## DO NOT USE

These scripts will not work correctly with the V2 database schema:
- They reference old tables (teams, match_results) which are now *_deprecated
- They use old linking strategies that don't apply to V2
- Running them could cause data integrity issues

## If You Need Historical Reference

The archived tables are available:
- `teams_deprecated` - Old team data
- `match_results_deprecated` - Old match data
- `event_registry_deprecated` - Old event catalog
- `team_name_aliases_deprecated` - Old alias mappings

Query example:
```sql
SELECT * FROM teams_deprecated WHERE team_name LIKE '%Sporting%';
```
