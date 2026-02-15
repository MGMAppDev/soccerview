#!/bin/bash
# Layer 2: Pre-edit safety check
# Fires before every Edit/Write tool call via PreToolUse "Edit|Write" matcher
# Returns additionalContext via JSON stdout

INPUT=$(cat)

# Layer A: Detect CLAUDE.md or GUARDRAILS edits → remind to sync CRITICAL_RULES.md
if echo "$INPUT" | grep -q 'CLAUDE\.md\|GUARDRAILS'; then
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"SYNC REMINDER: You are editing CLAUDE.md or GUARDRAILS. If adding/modifying principles, also update .claude/hooks/CRITICAL_RULES.md so the new rules survive context compaction. Keep CRITICAL_RULES.md under 150 lines -- only add rules likely to be violated after compression."}}'
# Check if the target file is a .tsx UI file
elif echo "$INPUT" | grep -q '\.tsx'; then
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"PRE-EDIT SAFETY: This is a .tsx UI file. STOP -- do you have explicit user approval to modify UI? Never batch UI changes. Fix data source instead if showing wrong data. One change, verify, next change."}}'
else
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"PRE-EDIT: deleted_at IS NULL in match queries? NULL scores preserved (not ?? 0)? Universal fix (not team-specific)? cleanTeamName.cjs for team names? LEAST for ranks, GREATEST for points? Pipeline auth for teams_v2/matches_v2 writes?"}}'
fi

exit 0
