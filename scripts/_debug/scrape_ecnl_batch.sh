#!/bin/bash
# Batch scrape ECNL/ECRL events from TotalGlobalSports
# Usage: bash scripts/_debug/scrape_ecnl_batch.sh [start_id] [end_id]
# Default: scrape ECNL tier 1 Boys+Girls (3880-3890, 3925-3934)

cd "$(dirname "$0")/../.."

START=${1:-3880}
END=${2:-3934}
LOG_FILE="scripts/_debug/ecnl_scrape_$(date +%Y%m%d_%H%M%S).log"

echo "=== ECNL Batch Scrape ===" | tee "$LOG_FILE"
echo "Range: $START - $END" | tee -a "$LOG_FILE"
echo "Log: $LOG_FILE" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

TOTAL=0
SUCCESS=0
FAILED=0

# Skip non-ECNL ID 3924 and no-schedule IDs 3914, 3917, 3956
SKIP_IDS="3914 3917 3924 3956"

for id in $(seq $START $END); do
  if echo "$SKIP_IDS" | grep -qw "$id"; then
    echo "[$id] SKIPPED (no schedules / not ECNL)" | tee -a "$LOG_FILE"
    continue
  fi

  TOTAL=$((TOTAL + 1))
  echo "[$id] Scraping... (event $TOTAL)" | tee -a "$LOG_FILE"

  if node scripts/universal/coreScraper.js --adapter totalglobalsports --event "$id" 2>&1 | tee -a "$LOG_FILE"; then
    SUCCESS=$((SUCCESS + 1))
    echo "[$id] DONE" | tee -a "$LOG_FILE"
  else
    FAILED=$((FAILED + 1))
    echo "[$id] FAILED" | tee -a "$LOG_FILE"
  fi

  echo "" | tee -a "$LOG_FILE"
done

echo "=== BATCH COMPLETE ===" | tee -a "$LOG_FILE"
echo "Total: $TOTAL | Success: $SUCCESS | Failed: $FAILED" | tee -a "$LOG_FILE"
