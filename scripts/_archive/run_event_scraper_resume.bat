@echo off
echo ============================================
echo SoccerView Event Scraper - RESUME
echo ============================================
echo.
echo Resuming from last checkpoint...
echo.

cd /d C:\Users\MathieuMiles\Projects\soccerview
node scripts/runEventScraperBatch.js --count 300 --resume

echo.
echo ============================================
echo Scraper finished!
echo ============================================
pause
