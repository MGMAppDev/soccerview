#!/bin/bash
# Active monitoring script for parallel processes

RECONCILE_BATCH1="/c/Users/mathi/AppData/Local/Temp/claude/c--Users-MathieuMiles-Projects-soccerview/tasks/bebf4e5.output"
RECONCILE_BATCH2="/c/Users/mathi/AppData/Local/Temp/claude/c--Users-MathieuMiles-Projects-soccerview/tasks/bc6ab7d.output"
LINKING_BATCH1="/c/Users/mathi/AppData/Local/Temp/claude/c--Users-MathieuMiles-Projects-soccerview/tasks/bc6bb99.output"
LINKING_BATCH2="/c/Users/mathi/AppData/Local/Temp/claude/c--Users-MathieuMiles-Projects-soccerview/tasks/b8c28d1.output"
LINKING_BATCH3="/c/Users/mathi/AppData/Local/Temp/claude/c--Users-MathieuMiles-Projects-soccerview/tasks/b3b3de8.output"
LINKING_BATCH4="/c/Users/mathi/AppData/Local/Temp/claude/c--Users-MathieuMiles-Projects-soccerview/tasks/b7cce45.output"

while true; do
    clear
    echo "==================================================================="
    echo "ACTIVE MONITORING - $(date)"
    echo "==================================================================="

    echo -e "\n🔄 RECONCILIATION (2 batches, ~12K teams each):"
    echo "Batch 1:" $(grep "Processed" "$RECONCILE_BATCH1" 2>/dev/null | tail -1 || echo "Starting...")
    echo "Batch 2:" $(grep "Processed" "$RECONCILE_BATCH2" 2>/dev/null | tail -1 || echo "Starting...")

    # Check for errors
    if grep -q "error\|ERROR\|timeout" "$RECONCILE_BATCH1" "$RECONCILE_BATCH2" 2>/dev/null; then
        echo "⚠️  ERROR DETECTED IN RECONCILIATION!"
        grep -h "error\|ERROR\|timeout" "$RECONCILE_BATCH1" "$RECONCILE_BATCH2" 2>/dev/null | tail -2
    fi

    echo -e "\n🔗 LINKING (4 batches, ~10K names each):"
    echo "Batch 1:" $(grep "processed" "$LINKING_BATCH1" 2>/dev/null | tail -1 || echo "Processing...")
    echo "Batch 2:" $(grep "processed" "$LINKING_BATCH2" 2>/dev/null | tail -1 || echo "Processing...")
    echo "Batch 3:" $(grep "processed" "$LINKING_BATCH3" 2>/dev/null | tail -1 || echo "Processing...")
    echo "Batch 4:" $(grep "processed" "$LINKING_BATCH4" 2>/dev/null | tail -1 || echo "Processing...")

    # Check for completion
    if grep -q "COMPLETE" "$RECONCILE_BATCH1" "$RECONCILE_BATCH2" 2>/dev/null; then
        echo -e "\n✅ RECONCILIATION BATCHES COMPLETE!"
    fi

    if grep -q "Done!" "$LINKING_BATCH1" "$LINKING_BATCH2" "$LINKING_BATCH3" "$LINKING_BATCH4" 2>/dev/null; then
        echo -e "\n✅ LINKING BATCHES COMPLETE!"
    fi

    echo -e "\n==================================================================="
    echo "Next check in 5 minutes... (Ctrl+C to stop monitoring)"

    sleep 300  # 5 minutes
done
