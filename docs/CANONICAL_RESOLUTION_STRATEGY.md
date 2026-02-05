# Universal Canonical Resolution Strategy
## SoccerView Entity Resolution Methodology v2.0

> **Updated: Session 89 - February 5, 2026**
>
> This document defines the UNIFIED methodology for resolving entities
> to a single SoccerView ID. All deduplication scripts MUST follow this
> exact priority order.
>
> **Session 89 UPDATE:** The `source_entity_map` table now provides Tier 1
> deterministic resolution. The canonical_* tables remain as Tier 2 fallback.
> See the Three-Tier Architecture section below.

---

## Core Principle

**Every entity (Team, Match, League, Tournament) MUST resolve to exactly ONE SoccerView ID.**

### Three-Tier Architecture (Session 89 - CURRENT)

The resolution process uses deterministic source ID lookup as the primary method:

```
THREE-TIER ENTITY RESOLUTION (Session 89)
==========================================
TIER 1: SOURCE ENTITY MAP     → O(1) deterministic lookup via source_entity_map
TIER 2: CANONICAL NAME MATCH  → NULL-tolerant metadata matching
TIER 3: CREATE NEW + REGISTER → Create entity + register source ID for future Tier 1
```

**Implementation:** `dataQualityEngine.js` (`findOrCreateTeam`, `findOrCreateEvent`) and `fastProcessStaging.cjs` both follow this pattern.

**Key table:** `source_entity_map` — maps `(entity_type, source_platform, source_entity_id)` → SoccerView UUID

### Legacy 6-Step Approach (Session 86 - SUPERSEDED)

The original approach below is retained for reference. Steps 3-4 (canonical registry + fuzzy match) are now Tier 2 fallbacks, used only when Tier 1 source ID lookup has no match.

```
LEGACY RESOLUTION PRIORITY ORDER (now Tier 2 fallback)
======================================================
1. EXACT ID MATCH      → Check if ID already exists
2. SEMANTIC KEY MATCH  → Check by unique semantic attributes
3. CANONICAL REGISTRY  → Check aliases in canonical_* tables
4. FUZZY MATCH         → pg_trgm similarity with thresholds
5. CREATE NEW          → Only if all above fail
6. SELF-LEARNING       → Update registries after any action
```

---

## Resolution Checklist by Entity Type

### TEAMS (teams_v2)

| Step | Check | Threshold | Action |
|------|-------|-----------|--------|
| 1 | `WHERE id = :input_id` | Exact | Return existing |
| 2 | `WHERE (canonical_name, birth_year, gender) = :values` | Exact | Return existing |
| 3 | `WHERE :name = ANY(canonical_teams.aliases)` | Exact | Return canonical.team_v2_id |
| 4 | `similarity(canonical_name, :name) >= 0.95` + same birth_year + same gender | 0.95 | Auto-merge |
| 4b | `similarity(canonical_name, :name) >= 0.85` + same birth_year + same gender | 0.85-0.94 | Flag for review |
| 5 | No match found | - | Create new, add to canonical_teams |
| 6 | After any action | - | Update canonical_teams.aliases |

**Semantic Key:** `(canonical_name, birth_year, gender)`

### MATCHES (matches_v2)

| Step | Check | Threshold | Action |
|------|-------|-----------|--------|
| 1 | `WHERE id = :input_id` | Exact | Return existing |
| 2 | `WHERE (match_date, home_team_id, away_team_id) = :values` | Exact | Return existing (ON CONFLICT UPDATE) |
| 3 | N/A - no canonical_matches table | - | - |
| 4 | Same date + one team matches + opponent similarity >= 0.90 | 0.90 | Review for team merge |
| 5 | No match found | - | Create new |
| 6 | After any action | - | N/A |

**Semantic Key:** `(match_date, home_team_id, away_team_id)`

### LEAGUES (leagues)

| Step | Check | Threshold | Action |
|------|-------|-----------|--------|
| 1 | `WHERE id = :input_id` | Exact | Return existing |
| 2 | `WHERE (source_event_id, source_platform) = :values` | Exact | Return existing |
| 3 | `WHERE :name = ANY(canonical_events.aliases) AND type = 'league'` | Exact | Return canonical.league_id |
| 4 | `similarity(name, :name) >= 0.90` + same type | 0.90 | Auto-merge |
| 5 | No match found | - | Create new, add to canonical_events |
| 6 | After any action | - | Update canonical_events.aliases |

**Semantic Key:** `(source_event_id, source_platform)` OR `(canonical_name, type)`

### TOURNAMENTS (tournaments)

| Step | Check | Threshold | Action |
|------|-------|-----------|--------|
| 1 | `WHERE id = :input_id` | Exact | Return existing |
| 2 | `WHERE (source_event_id, source_platform) = :values` | Exact | Return existing |
| 3 | `WHERE :name = ANY(canonical_events.aliases) AND type = 'tournament'` | Exact | Return canonical.tournament_id |
| 4 | `similarity(name, :name) >= 0.90` + same type | 0.90 | Auto-merge |
| 5 | No match found | - | Create new, add to canonical_events |
| 6 | After any action | - | Update canonical_events.aliases |

**Semantic Key:** `(source_event_id, source_platform)` OR `(canonical_name, type)`

### SCHEDULES (future matches)

| Step | Check | Threshold | Action |
|------|-------|-----------|--------|
| 1 | `WHERE id = :input_id` | Exact | Return existing |
| 2 | `WHERE (match_date, home_team_id, away_team_id) = :values` | Exact | Return existing |
| 3-6 | Same as MATCHES | - | - |

**Semantic Key:** `(match_date, home_team_id, away_team_id)`

---

## Unified Resolution Function

All deduplication scripts MUST call this resolution pattern:

```javascript
/**
 * Universal resolution function
 * @param {string} entityType - 'team' | 'match' | 'league' | 'tournament'
 * @param {object} data - Entity data with identifying attributes
 * @returns {string} - SoccerView ID (existing or new)
 */
async function resolveToSoccerViewId(client, entityType, data) {
  const resolver = RESOLVERS[entityType];

  // Step 1: Exact ID match
  if (data.id) {
    const existing = await resolver.findById(client, data.id);
    if (existing) return { action: 'found', id: existing.id };
  }

  // Step 2: Semantic key match
  const semantic = await resolver.findBySemanticKey(client, data);
  if (semantic) return { action: 'found', id: semantic.id };

  // Step 3: Canonical registry match
  const canonical = await resolver.findInCanonical(client, data);
  if (canonical) return { action: 'found', id: canonical.id };

  // Step 4: Fuzzy match
  const fuzzy = await resolver.findByFuzzyMatch(client, data);
  if (fuzzy.confidence >= 0.95) {
    await resolver.merge(client, fuzzy.existing.id, data);
    return { action: 'merged', id: fuzzy.existing.id };
  }
  if (fuzzy.confidence >= 0.85) {
    return { action: 'review', candidate: fuzzy.existing, confidence: fuzzy.confidence };
  }

  // Step 5: Create new
  const newId = await resolver.create(client, data);

  // Step 6: Self-learning
  await resolver.registerCanonical(client, newId, data);

  return { action: 'created', id: newId };
}
```

---

## Implementation Status

| Entity | Resolution Script | Three-Tier (Session 89) | Status |
|--------|------------------|------------------------|--------|
| Teams | `dataQualityEngine.js` → `findOrCreateTeam()` | ✅ Tier 1/2/3 | ✅ Production |
| Teams | `fastProcessStaging.cjs` | ✅ Tier 1/2/3 (bulk) | ✅ Production |
| Leagues | `dataQualityEngine.js` → `findOrCreateEvent()` | ✅ Tier 1/2/3 | ✅ Production |
| Tournaments | `dataQualityEngine.js` → `findOrCreateEvent()` | ✅ Tier 1/2/3 | ✅ Production |
| Teams (dedup) | `scripts/universal/deduplication/teamDedup.js` | Legacy (Tier 2) | ✅ Implemented |
| Matches (dedup) | `scripts/universal/deduplication/matchDedup.js` | N/A | ✅ Implemented |
| Events (dedup) | `scripts/universal/deduplication/eventDedup.js` | Legacy (Tier 2) | ✅ Implemented |

**Note:** The Unified Resolver TODO from Session 86 is now effectively implemented via the three-tier pattern in DQE and fastProcessStaging.

---

## Thresholds Reference

| Similarity Score | Action |
|------------------|--------|
| 1.0 | Exact match - return existing |
| 0.95 - 0.99 | Auto-merge with audit log |
| 0.85 - 0.94 | Flag for human review |
| < 0.85 | Not a match - create new |

---

## Self-Learning Requirements

**Every resolution action MUST update the canonical registry:**

1. **On Merge:** Add merged entity's name to `aliases` array
2. **On Create:** Add new entity to canonical_* table
3. **On Found via Alias:** Increment `match_confidence` counter

**This ensures the system gets smarter over time and prevents repeat duplicates.**

---

## Violation Detection

Run this query to find entities that bypassed canonical resolution:

```sql
-- Teams not in canonical registry
SELECT t.id, t.display_name
FROM teams_v2 t
LEFT JOIN canonical_teams ct ON ct.team_v2_id = t.id
WHERE ct.id IS NULL AND t.matches_played > 0;

-- Matches with unresolved teams
SELECT m.id, m.match_date
FROM matches_v2 m
LEFT JOIN teams_v2 ht ON m.home_team_id = ht.id
LEFT JOIN teams_v2 at ON m.away_team_id = at.id
WHERE ht.id IS NULL OR at.id IS NULL;
```

---

## Next Steps

1. [x] ~~Create unified `canonicalResolver.js`~~ → Implemented as three-tier pattern in DQE + fastProcessStaging (Session 89)
2. [x] ~~Update all dedup scripts~~ → DQE and fastProcessStaging use Tier 1/2/3 (Session 89)
3. [x] ~~Add resolution step to `dataQualityEngine.js` intake~~ → `findOrCreateTeam()` + `findOrCreateEvent()` (Session 89)
4. [ ] Create monitoring dashboard for source_entity_map coverage
