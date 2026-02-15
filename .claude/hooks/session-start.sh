#!/bin/bash
# Layer 3: Session start context injection
# Fires on new session or resume via SessionStart "startup|resume" matcher
# stdout is injected as context Claude can see

REMINDER_FILE="$CLAUDE_PROJECT_DIR/.claude/hooks/session-start.txt"

if [ -f "$REMINDER_FILE" ]; then
  cat "$REMINDER_FILE"
fi

echo ""
echo "## Current Git Status"
cd "$CLAUDE_PROJECT_DIR" && git status --short 2>/dev/null || echo "(git status unavailable)"

echo ""
UNCOMMITTED=$(cd "$CLAUDE_PROJECT_DIR" && git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
echo "Uncommitted files: $UNCOMMITTED"

if [ "$UNCOMMITTED" -gt 10 ] 2>/dev/null; then
  echo "WARNING: More than 10 uncommitted files. Address before starting new work."
fi

exit 0
