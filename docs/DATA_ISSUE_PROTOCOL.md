# Data Issue Protocol

> **Version 1.2** | Created: Session 79 | February 3, 2026
>
> Standard protocol for reporting and fixing data issues in SoccerView.

---

## 🚨 MANDATORY START: Add This to EVERY New Session

```
Read GUARDRAILS.md first. This is non-negotiable.
```

---

## ⚠️ CRITICAL: FIX UNIVERSALLY, NOT SPECIFICALLY

**The reported team is just a SYMPTOM. The fix must address the DISEASE across ALL data.**

```
STOP. Before writing ANY fix:

1. The example team I gave you is ONE instance of a SYSTEMIC problem
2. Do NOT create a fix that only addresses my specific team
3. FIRST: Quantify the problem - How many teams/matches have this issue?
4. THEN: Create a UNIVERSAL fix that solves for ALL affected records
5. FINALLY: Verify the fix worked for ALL records, not just my example

WRONG: "Fixed Sporting BV team" (1 record)
RIGHT: "Fixed 2,847 teams with same root cause" (universal)

Think big. Fix big. No band-aids.
```

**Anti-pattern to REJECT:**
```javascript
// ❌ WRONG - Fixes only the reported team
UPDATE teams_v2 SET birth_year = 2015 WHERE display_name = 'Sporting BV Pre-NAL 15';

// ✅ RIGHT - Fixes ALL teams with same pattern
UPDATE teams_v2 SET birth_year = EXTRACT(...)
WHERE birth_year IS NULL AND display_name ~ '\\d{2}[BG]?\\s*\\(U\\d+';
```

**Before closing ANY data fix, answer these questions:**
- [ ] How many total records had this issue? (not just 1)
- [ ] Did my fix address ALL of them?
- [ ] Will this fix PREVENT the same issue for future data?
- [ ] Is this fix universal across all data sources?

---

## Quick Start: Copy This Prompt

When you find a data issue, copy and paste this template to Claude Code:

```
## Data Issue Report

**FIRST:** Read docs/DATA_ISSUE_PROTOCOL.md and docs/1.1-GUARDRAILS_v2.md before doing ANY work.

**Problem:** [One sentence describing what's wrong]

**Team/Match Affected:** [Team name, match details, or screenshot]

**What I Expected:** [What should appear]

**What I See:** [What actually appears - include numbers, dates, etc.]

---

**Instructions for Claude Code:**

⚠️ STOP. Before doing anything:
1. Read docs/DATA_ISSUE_PROTOCOL.md (contains rules you MUST follow)
2. Read docs/1.1-GUARDRAILS_v2.md (non-negotiable constraints)

⚠️ CRITICAL: The team above is ONE EXAMPLE. Fix must be UNIVERSAL.

1. First, QUANTIFY the problem (not just my example):
   ```bash
   # How many records have this issue?
   node scripts/maintenance/diagnoseDataIssue.cjs --health-check
   # Then investigate my specific team as ONE example:
   node scripts/maintenance/diagnoseDataIssue.cjs --team "TEAM_NAME_HERE"
   ```
   STOP and tell me: "Found X records with this issue, not just 1."

2. Follow V2 Architecture compliance:
   - Read GUARDRAILS: docs/1.1-GUARDRAILS_v2.md
   - Use ONLY V2-compliant tools listed below
   - NEVER bypass canonical_teams registry
   - NEVER use fuzzy matching that ignores birth_year

3. Diagnose the root cause category:
   - [ ] Duplicate teams (same canonical_name + birth_year + gender)
   - [ ] NULL metadata (missing birth_year or gender)
   - [ ] Stats mismatch (W-L-D doesn't match actual matches)
   - [ ] Orphan team (GS rank but no matches - coverage gap)
   - [ ] Stale view (needs refresh_app_views())
   - [ ] Missing from canonical registry
   - [ ] Other: _______________

4. Fix using ONLY these V2-compliant scripts:
   | Issue | Script |
   |-------|--------|
   | Duplicate teams | `mergeCanonicalDuplicates.cjs --dry-run` then `--execute` |
   | NULL metadata | `fixNullMetadataAndMerge.cjs` |
   | Stats mismatch | `fixDataDisconnect.cjs` |
   | Stale canonical | `cleanupStaleCanonical.cjs --execute` |
   | Manual team merge | `mergeTeams.js --keep UUID --merge UUID --execute` |
   | Refresh views | `psql $DATABASE_URL -c "SELECT refresh_app_views();"` |

5. Performance Requirements:
   - Use direct SQL with pg Pool - NOT Supabase client for bulk ops
   - Process thousands per minute - NOT dozens
   - Use bulk INSERT/UPDATE - NOT row-by-row loops
   - If 10K+ records takes more than a few minutes, you're doing it wrong

6. Universal, Not Specific:
   - Fix must work for ANY data source across ALL THREE LAYERS:
     Layer 1 (Intake) → Layer 2 (Processing) → Layer 3 (Presentation)
   - No hardcoding. No source-specific logic. No shortcuts.
   - Test: Will this work when we add MLS Next tomorrow?

7. Data Lifecycle Check (before closing):
   - [ ] Does Layer 1 (Scrapers/Adapters) capture it correctly?
   - [ ] Does Layer 2 (Validation/Normalizers) clean it correctly?
   - [ ] Does Layer 3 (Views/App) display it correctly?

8. If uncertain about approach - STOP and RESEARCH FIRST:
   - Do NOT guess or trial-and-error
   - Use web_search for authoritative sources
   - Present findings with confidence level (High/Medium/Low)
   - Wait for approval before implementing

9. After fix, verify UNIVERSAL impact:
   ```bash
   node scripts/daily/verifyDataIntegrity.js
   ```
   REQUIRED: Report back with:
   - "Fixed X of Y affected records" (not just "Fixed the team")
   - "Issue now affects 0 records" (verify problem is gone)
   - "Fix will prevent future occurrences because..." (systemic, not band-aid)
```

---

## Detailed Protocol

### Step 1: Gather Information

Before reporting, collect:

| Info | Example |
|------|---------|
| Team name (exact) | "Sporting BV Pre-NAL 15 (U11 Boys)" |
| What's wrong | "Shows 0W-0L-0D but has matches" |
| Screenshot | App screenshot showing the issue |
| Expected behavior | "Should show 5W-2L-1D" |

### Step 2: Run Diagnostics First

Always start with the diagnostic tool:

```bash
# For a specific team
node scripts/maintenance/diagnoseDataIssue.cjs --team "Sporting BV"

# For a specific team UUID
node scripts/maintenance/diagnoseDataIssue.cjs --team-id "434db547-xxxx"

# For overall health check
node scripts/maintenance/diagnoseDataIssue.cjs --health-check

# For staging status
node scripts/maintenance/diagnoseDataIssue.cjs --staging-status
```

The diagnostic tool will:
- Search for the team in teams_v2
- Check canonical_teams registry
- Verify match counts
- Calculate actual W-L-D from matches_v2
- Check for duplicates
- Recommend specific fixes

### Step 3: Understand Root Cause Categories

| Category | Symptoms | Root Cause | Fix |
|----------|----------|------------|-----|
| **Duplicate** | Two entries for same team | Same canonical_name + birth_year + gender | `mergeCanonicalDuplicates.cjs` |
| **NULL Metadata** | Team not in age group filter | Missing birth_year or gender | `fixNullMetadataAndMerge.cjs` |
| **Stats Mismatch** | W-L-D wrong | Pre-computed stats stale | `fixDataDisconnect.cjs` |
| **Orphan** | GS rank but 0 matches | Coverage gap (not a dupe) | Scrape more leagues |
| **Stale View** | App shows old data | Materialized view not refreshed | `refresh_app_views()` |
| **Stale Canonical** | Duplicate groups persist | Orphan canonical entries | `cleanupStaleCanonical.cjs` |

### Step 4: V2 Architecture Compliance

**MANDATORY: Read [GUARDRAILS](1.1-GUARDRAILS_v2.md) before any fix.**

Key rules:
1. **NEVER bypass normalizers** with ad-hoc fuzzy matching (GUARDRAILS line 38)
2. **ALWAYS use canonical_teams** for deduplication (GUARDRAILS line 43)
3. **NEVER ignore birth_year differences** when merging (Principle 24)
4. **ALL writes must use authorized pipeline** or call `authorize_pipeline_write()`

### Step 5: V2-Compliant Fix Scripts

| Script | Purpose | Usage |
|--------|---------|-------|
| `diagnoseDataIssue.cjs` | Diagnose any issue | `--team "Name"` or `--health-check` |
| `mergeCanonicalDuplicates.cjs` | Merge canonical duplicates | `--dry-run` then `--execute` |
| `fixNullMetadataAndMerge.cjs` | Fix NULL birth_year/gender | Direct run |
| `fixDataDisconnect.cjs` | Recalculate stats | `--dry-run` then execute |
| `cleanupStaleCanonical.cjs` | Clean orphan canonical entries | `--dry-run` then `--execute` |
| `mergeTeams.js` | Manual team merge | `--find "name"` then `--keep --merge --execute` |
| `verifyDataIntegrity.js` | Post-fix verification | Direct run |

### Step 6: Post-Fix Verification (UNIVERSAL, not specific)

**CRITICAL: Verify the fix worked for ALL affected records, not just the example team.**

```bash
# 1. Quantify BEFORE fix
# "Found 2,847 teams with NULL birth_year"

# 2. Apply UNIVERSAL fix
# (not a single UPDATE for one team)

# 3. Quantify AFTER fix
# "Now 0 teams with NULL birth_year" ← This proves universal fix

# 4. Run integrity check
node scripts/daily/verifyDataIntegrity.js

# 5. Refresh views if needed
psql $DATABASE_URL -c "SELECT refresh_app_views();"

# 6. Verify example team (as ONE confirmation)
node scripts/maintenance/diagnoseDataIssue.cjs --team "TEAM_NAME"
```

**Report Format (REQUIRED):**
```
Fix Summary:
- Issue: NULL birth_year
- Affected BEFORE: 2,847 teams
- Affected AFTER: 0 teams ✅
- Example team (Sporting BV): Fixed ✅
- Prevention: Pipeline now extracts birth_year from names
```

---

## Common Issue Examples

### Example 1: Team Shows 0W-0L-0D

**Report:**
```
## Data Issue Report

**Problem:** Team shows 0W-0L-0D but has matches in history

**Team/Match Affected:** "Sporting Wichita 2015 Academy (U11 Girls)"

**What I Expected:** 5-0-2 record based on match history

**What I See:** 0W-0L-0D in Season Stats

---
[Instructions section...]
```

**Likely Cause:** Orphan team (GS rank imported, no match data) OR stats mismatch

**Fix Path:**
1. Run `diagnoseDataIssue.cjs --team "Sporting Wichita"`
2. If orphan → coverage gap, not fixable by merging
3. If stats mismatch → run `fixDataDisconnect.cjs`

### Example 2: Duplicate Teams in Search

**Report:**
```
## Data Issue Report

**Problem:** Two entries for same team in search results

**Team/Match Affected:**
- "KC Fire 2014B (U12 Boys)"
- "KC Fire 2014 Boys (U12 Boys)"

**What I Expected:** One team entry

**What I See:** Two separate teams with split match history

---
[Instructions section...]
```

**Likely Cause:** Different source names not normalized to same canonical

**Fix Path:**
1. Run `diagnoseDataIssue.cjs --team "KC Fire 2014"`
2. Verify both have same birth_year + gender
3. Run `mergeCanonicalDuplicates.cjs --dry-run`
4. If not caught, use `mergeTeams.js --find "KC Fire 2014"`

### Example 3: Team Missing from Age Group Filter

**Report:**
```
## Data Issue Report

**Problem:** Team doesn't appear when filtering by U11

**Team/Match Affected:** "Southwest FC Lightning 15"

**What I Expected:** Team appears in U11 Boys filter

**What I See:** Team not visible in filtered results

---
[Instructions section...]
```

**Likely Cause:** NULL birth_year in teams_v2

**Fix Path:**
1. Run `diagnoseDataIssue.cjs --team "Southwest FC Lightning"`
2. Check if birth_year is NULL
3. Run `fixNullMetadataAndMerge.cjs`

---

## What NOT to Do

| Don't | Why | Instead |
|-------|-----|---------|
| Write custom fuzzy matching | Violates GUARDRAILS line 38 | Use canonical_teams registry |
| Merge teams with different birth_year | They're different teams! | Check birth_year first |
| Delete teams permanently | Loses audit trail | Use soft delete (status='merged') |
| Bypass staging_games | Breaks pipeline | All data through staging |
| Ignore the diagnostic tool | Miss root cause | Always run diagnoseDataIssue.cjs first |
| Use row-by-row loops | Too slow for bulk ops | Use bulk SQL with CASE statements |
| Use Supabase client for bulk | Performance issues | Use pg Pool with direct SQL |
| Guess at solutions | Creates more problems | Research first, present findings |
| Skip GUARDRAILS check | Miss mandatory rules | Read GUARDRAILS.md EVERY session |
| Skip lifecycle check | Fix doesn't propagate | Verify all 3 layers before closing |
| Hardcode source-specific logic | Won't scale | Make fix universal for all sources |

---

## Quick Reference Card

```
┌─────────────────────────────────────────────────────────────┐
│                  DATA ISSUE QUICK FIX                       │
├─────────────────────────────────────────────────────────────┤
│ 0. READ GUARDRAILS: docs/1.1-GUARDRAILS_v2.md               │
│                                                             │
│ ⚠️  THINK BIG: Example team = 1 symptom. Fix ALL affected.  │
│                                                             │
│ 1. QUANTIFY (before fixing):                                │
│    "Found X records with this issue, not just 1"            │
│                                                             │
│ 2. DIAGNOSE:                                                │
│    node scripts/maintenance/diagnoseDataIssue.cjs           │
│         --health-check  (systemic)                          │
│         --team "NAME"   (example)                           │
│                                                             │
│ 3. FIX UNIVERSALLY (V2-compliant only):                     │
│    mergeCanonicalDuplicates.cjs  → Duplicate teams          │
│    fixNullMetadataAndMerge.cjs   → NULL birth_year/gender   │
│    fixDataDisconnect.cjs         → Stats mismatch           │
│    cleanupStaleCanonical.cjs     → Stale canonical entries  │
│    refresh_app_views()           → Stale views              │
│                                                             │
│ 4. LIFECYCLE CHECK:                                         │
│    □ Layer 1 (Intake) correct?                              │
│    □ Layer 2 (Processing) correct?                          │
│    □ Layer 3 (Presentation) correct?                        │
│                                                             │
│ 5. VERIFY UNIVERSAL FIX:                                    │
│    "Fixed X of Y. Issue now affects 0 records."             │
│    node scripts/daily/verifyDataIntegrity.js                │
│                                                             │
│ ❌ WRONG: "Fixed Sporting BV" (1 record)                    │
│ ✅ RIGHT: "Fixed 2,847 teams" (universal)                   │
└─────────────────────────────────────────────────────────────┘
```

---

---

## Session Start Reminders (Copy for Any Session)

Use these prompts to keep Claude Code on track for ANY work, not just data issues:

### Mandatory Start
```
Read GUARDRAILS.md first. This is non-negotiable.
```

### Think Big, Fix Big (CRITICAL)
```
The example I give you is ONE instance of a SYSTEMIC problem.
Do NOT create a fix that only addresses my specific team/match.

BEFORE writing any fix:
1. Quantify: How many records have this issue?
2. Fix ALL: Create universal fix for ALL affected records
3. Verify ALL: Confirm issue is gone for ALL, not just my example
4. Prevent: Ensure pipeline prevents this issue for future data

WRONG: "Fixed Sporting BV team" (1 record)
RIGHT: "Fixed 2,847 teams with same root cause" (universal)
```

### Performance Reminder
```
Optimize for speed and accuracy.
- Use direct SQL and bulk operations - not row-by-row loops
- Use pg Pool connections - not Supabase client for large operations
- Process thousands per minute - not dozens
- If it takes more than a few minutes for 10K+ records, you're doing it wrong
```

### Universal Pattern Reminder
```
Universal, not specific.
This fix must work for ANY data source across ALL THREE LAYERS:
Layer 1 (Intake) → Layer 2 (Processing) → Layer 3 (Presentation)
Not just the one with the current problem, both now and in the future.
No hardcoding. No source-specific logic. No shortcuts.
```

### Lifecycle Check Reminder
```
SoccerView Data Lifecycle Check
Before closing any major fix, verify the change propagates through ALL THREE LAYERS:
Layer 1 (Intake) → Layer 2 (Processing) → Layer 3 (Presentation)
Scrapers/Adapters → Validation/Normalizers → Views/App

Ask yourself:
- Does Layer 1 capture it correctly?
- Does Layer 2 clean/transform it correctly?
- Does Layer 3 display it correctly?
```

### Research First Reminder (for complex/uncertain fixes)
```
STOP. Do NOT modify any code yet.
You are guessing. I need you to:

1. RESEARCH FIRST - Use web_search to find 3-5 authoritative sources
2. PRESENT FINDINGS - Show me what you found with URLs and key findings
3. STATE CONFIDENCE - Tell me High/Medium/Low confidence and why
4. WAIT FOR APPROVAL - Do not write any code until I say proceed

No trial-and-error. No "let me try this." Research → Present → Approve → Implement.
```

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.2 | 2026-02-03 | **CRITICAL**: Added "Think Big, Fix Big" - universal fixes required |
| 1.1 | 2026-02-03 | Added session reminders, performance requirements, 3-layer check |
| 1.0 | 2026-02-02 | Initial protocol created (Session 79) |
