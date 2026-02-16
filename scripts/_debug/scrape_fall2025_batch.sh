#!/bin/bash
# Batch scrape all Fall 2025 SportsAffinity events
# Run from project root: bash scripts/_debug/scrape_fall2025_batch.sh

cd "$(dirname "$0")/../.."

EVENTS=(
  mn-fall2025-metro
  mn-summer2025
  ut-fall2025-premier
  ut-fall2025-suirl
  ut-fall2025-uvcl
  ut-fall2025-ydl
  ut-fall2025-platform
  ut-fall2025-challenger
  or-fall2025-league
  or-fall2025-dev
  or-fall2025-founders
  or-fall2025-valley
  or-fall2025-soccer5
  or-fall2025-pysa
  ne-fall2025-premier
  ne-fall2025-dev
  ne-fall2025-cysl
  ne-fall2025-cornhusker
  paw-fall2025-glc
  paw-fall2025-classic
  paw-fall2025-frontier
  paw-fall2025-div4
  paw-fall2025-d1-east
  paw-fall2025-d2-north
  paw-fall2025-d3-west
  paw-fall2025-d4-south
  paw-fall2025-d5-mountain
  paw-fall2025-d7-lake
)

echo "=== BATCH SCRAPE: ${#EVENTS[@]} Fall 2025 Events ==="
echo "Started: $(date)"

TOTAL_MATCHES=0
for i in "${!EVENTS[@]}"; do
  EVENT="${EVENTS[$i]}"
  echo ""
  echo "=== [$((i+1))/${#EVENTS[@]}] $EVENT ==="

  OUTPUT=$(node scripts/universal/coreScraper.js --adapter sportsaffinity --event "$EVENT" 2>&1)

  # Extract match count from output
  MATCHES=$(echo "$OUTPUT" | grep "Matches found:" | head -1 | sed 's/.*Matches found: //')
  STAGED=$(echo "$OUTPUT" | grep "Matches staged:" | head -1 | sed 's/.*Matches staged: //')

  echo "  Matches found: ${MATCHES:-0} | Staged: ${STAGED:-0}"

  if [ -n "$MATCHES" ] && [ "$MATCHES" -gt 0 ] 2>/dev/null; then
    TOTAL_MATCHES=$((TOTAL_MATCHES + MATCHES))
  fi

  # Brief pause between events
  sleep 2
done

echo ""
echo "=== BATCH COMPLETE ==="
echo "Total matches found: $TOTAL_MATCHES"
echo "Completed: $(date)"
