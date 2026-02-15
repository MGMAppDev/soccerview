#!/bin/bash
# Layer 1: Post-compaction context reinforcement
# Fires after every context compaction event via SessionStart "compact" matcher
# stdout is injected as context Claude can see

RULES_FILE="$CLAUDE_PROJECT_DIR/.claude/hooks/CRITICAL_RULES.md"

if [ -f "$RULES_FILE" ]; then
  cat "$RULES_FILE"
else
  echo "WARNING: CRITICAL_RULES.md not found at $RULES_FILE"
  echo "Re-read docs/1.1-GUARDRAILS_v2.md and CLAUDE.md before proceeding."
fi

exit 0
