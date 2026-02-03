@echo off
echo ============================================
echo SoccerView Event Scraper - Batch 300
echo ============================================
echo.
echo Starting scraper with 300 events...
echo Estimated runtime: ~5 hours
echo.
echo Press Ctrl+C to stop (checkpoint will be saved)
echo.

cd /d C:\Users\MathieuMiles\Projects\soccerview
node scripts/runEventScraperBatch.js --count 300

echo.
echo ============================================
echo Scraper finished!
echo ============================================
pause
