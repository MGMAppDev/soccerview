# SOCCERVIEW CRITICAL RULES — Post-Compaction Recovery
# Injected automatically after context compression. These are ABSOLUTE constraints.

## STOP BEFORE ACTING — Pre-Action Checklist
1. Does this touch .tsx files? → GET USER APPROVAL FIRST. Never modify UI without explicit ask.
2. Does this bypass V2 architecture (staging → DQE → production)? → STOP. Use the pipeline.
3. Am I fixing ONE team or ALL affected? → Must be UNIVERSAL. Quantify scope first.
4. Am I writing directly to teams_v2 or matches_v2? → STOP. Use staging tables.
5. Does my fix ignore birth_year or gender? → STOP. These are merge constraints.

## DATA INTEGRITY — Most Violated Rules
- NULL scores = scheduled matches. NEVER use ?? 0, || 0, or COALESCE(score, 0).
- Soft delete ONLY for matches: UPDATE SET deleted_at = NOW(), never DELETE FROM matches_v2.
- ALL match queries MUST include WHERE deleted_at IS NULL or .is("deleted_at", null).
- Match uniqueness = semantic key: (match_date, home_team_id, away_team_id). NOT source_match_key.
- LEAST for ranks (lower=better), GREATEST for points/ELO (higher=better). NEVER COALESCE for ranks.
- Checkpoint logic: mark events processed ONLY when matches.length > 0.
- Orphans (GS rank, 0 matches) are COVERAGE GAPS, not duplicates. Do NOT merge blindly.

## V2 PIPELINE — Single Path, No Exceptions
Scrapers → staging_games → intakeValidator → dataQualityEngine → production
- dataQualityEngine.js is THE ONLY staging-to-production path.
- fastProcessStaging.cjs for bulk (uses same normalizers).
- processStandings.cjs for standings (lightweight resolver, NO fuzzy matching).
- ALL team creation MUST call removeDuplicatePrefix from cleanTeamName.cjs.
- ALL adapters must emit source_entity_id in raw_data.
- source_entity_map lookup (Tier 0) BEFORE name-based resolution.
- Pipeline write auth: call authorizePipelineWrite() before writes to teams_v2/matches_v2.

## TEAM RESOLUTION — Three-Tier Deterministic
Tier 1: source_entity_map lookup (instant, 100% accurate)
Tier 2: Canonical name + birth_year + gender exact match
Tier 3: Create new + register in source_entity_map for future Tier 1
- Fuzzy matching REQUIRES exact match on: birth_year AND gender.
- pg_trgm thresholds: >=0.95 auto-merge, 0.85-0.94 flag, <0.85 create new.
- Different birth_year = DIFFERENT TEAM. Never merge across age groups.

## STANDINGS — Lightweight Absorption (Principle 36)
- Standings use lightweight resolver — NO pg_trgm fuzzy matching on authoritative data.
- Standings displayed AS-IS from source. W-L-D-PTS are NOT recalculated by SoccerView.
- processStandings.cjs must inherit league state metadata (not hardcode 'unknown').
- Hybrid view: scraped standings UNION computed from matches as fallback.
- app_league_standings has NO unique index → CANNOT use REFRESH CONCURRENTLY (Principle 37).
- When resolved team has NULL birth_year/gender, fill from authoritative standings data.

## EVENT HANDLING
- Generic names ("Event 12093", bare numbers) → return NULL, skip creation.
- Use isGeneric() from resolveEventName.cjs to validate.
- LEAGUE_KEYWORDS: ['league', 'season', 'conference', 'division', 'premier'].
- Event classification: check name for league keywords, default to tournament.
- Dual source_entity_map registration when scrapers use different ID formats.
- "Events" is BANNED terminology. Use "leagues" or "tournaments" only.

## CODE PATTERNS — Universal
- Division regex: /U-?\d{1,2}\b|20[01]\d/i (dash is OPTIONAL).
- Team ID extraction: /^([A-Za-z0-9]+)\s+/ (alphanumeric, not just numeric).
- Bulk SQL with pg Pool for >100 records. NEVER row-by-row loops.
- NEVER Supabase client for bulk writes. Use pg Pool with DATABASE_URL.
- CJS files require(). ESM files import. cleanTeamName.cjs is CJS (all paths can access).
- Build for N sources, not current sources. No if (source === 'gotsport') anywhere.

## UI PROTECTION
- .tsx files are PROTECTED. Never touch without explicit user approval.
- One UI change at a time, verify, next change. Never batch.
- If UI shows wrong data, fix the DATA SOURCE, not the UI.
- Views must output the EXACT column names the UI expects.
- Team names NEVER truncate. Cards expand to fit.
- V2 views only: app_rankings, app_matches_feed, app_league_standings, app_team_profile, app_upcoming_schedule.
- V1 tables (team_elo, match_results, rank_history) are DELETED. Never reference them.

## APP STRUCTURE — 5 Tabs
- Home (index.tsx) | Rankings (rankings.tsx) | Teams (teams.tsx) | Leagues (leagues.tsx) | Matches (matches.tsx)
- Team Detail: app/team/[id].tsx | League Detail: app/league/[eventId].tsx

## DATA POLICY
- Premier/competitive only. No recreational data.
- Fix universally, not specifically. The reported team is ONE symptom.
- Every fix: quantify BEFORE, fix ALL, verify ALL, prevent recurrence.
- Three-layer verification: L1 (Intake) → L2 (Processing) → L3 (Presentation).
- Post-Expansion QC Protocol mandatory for every new state (Principle 41).

## GIT HYGIENE
- Commit after each task. Never end session with uncommitted work.
- Never commit .env or secrets. Check git status at session start.
- 10+ uncommitted files → warn user immediately.

## KEY SCRIPTS
- dataQualityEngine.js — THE staging-to-production processor
- fastProcessStaging.cjs — Bulk processor (240x faster)
- processStandings.cjs — Standings (lightweight resolver)
- cleanTeamName.cjs — Single source for removeDuplicatePrefix
- intakeValidator.js — Pre-staging validation gate
- resolveEventName.cjs — Event name resolver (NULL not generic)
- verifyDataIntegrity.js — Post-processing checks
- recalculate_elo_v2.js — ELO calculation (division-seeded)
- divisionSeedElo.cjs — Division seed mapping
- restoreGotSportRanks.cjs — GotSport rankings refresh (LEAST/GREATEST safe)

## SELF-MAINTENANCE
This file is re-injected after every context compaction. It must stay current.
- When adding new principles to CLAUDE.md → add 1-2 line summary here if the rule is likely to be violated after compression.
- Hard cap: 150 lines. If growing, remove least-violated rules.
- When ending a session → check if this file needs updating (in GUARDRAILS end-of-session checklist).
- The pre-edit hook will remind you when editing CLAUDE.md or GUARDRAILS.

## AFTER READING THIS
Context compaction just occurred. If working on database schema, new adapters,
team merging, or UI modifications — re-read CLAUDE.md and docs/1.1-GUARDRAILS_v2.md
for full context before proceeding.
