#!/bin/bash
# Bonus: Pre-compaction diagnostics logger
# Fires before context compaction via PreCompact "auto|manual" matcher
# Cannot prevent compaction — logs frequency for monitoring

TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")
LOG_DIR="$CLAUDE_PROJECT_DIR/.claude/hooks/logs"
mkdir -p "$LOG_DIR" 2>/dev/null

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | grep -o '"session_id":"[^"]*"' | head -1 | cut -d'"' -f4)
TRIGGER=$(echo "$INPUT" | grep -o '"trigger":"[^"]*"' | head -1 | cut -d'"' -f4)

echo "[$TIMESTAMP] Compaction triggered ($TRIGGER) session=$SESSION_ID" >> "$LOG_DIR/compaction.log"

exit 0
