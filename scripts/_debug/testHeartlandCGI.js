/**
 * Test Heartland CGI endpoints to find scheduled matches
 */

import puppeteer from "puppeteer";

async function testCGI() {
  console.log("🔍 Testing Heartland CGI endpoints for schedule data...\n");

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
  const page = await browser.newPage();

  // Test the CGI endpoint for U-11 Boys (the target team's age group)
  const testCases = [
    { age: "U-11", gender: "Boys", subdiv: "1", level: "Premier" },
    { age: "U-11", gender: "Boys", subdiv: "2", level: "Premier" },
    { age: "U-11", gender: "Boys", subdiv: "3", level: "Premier" },
    { age: "U-11", gender: "Boys", subdiv: "4", level: "Premier" },
    { age: "U-11", gender: "Boys", subdiv: "5", level: "Premier" },
  ];

  let totalMatches = 0;
  let futureMatches = [];

  for (const test of testCases) {
    const url = `https://heartlandsoccer.net/reports/cgi-jrb/subdiv_results.cgi?level=${test.level}&b_g=${test.gender}&age=${test.age}&subdivison=${test.subdiv}`;

    console.log(`\nTesting: ${test.level} ${test.gender} ${test.age} subdiv ${test.subdiv}`);

    try {
      await page.goto(url, { waitUntil: "networkidle2", timeout: 20000 });

      // Check for table data
      const data = await page.evaluate(() => {
        const rows = document.querySelectorAll("table tr");
        const results = [];

        rows.forEach((row, idx) => {
          const cells = row.querySelectorAll("td");
          if (cells.length >= 7) {
            const dateStr = cells[0].textContent.trim();
            const homeTeam = cells[3].textContent.trim();
            const homeScore = cells[4].textContent.trim();
            const awayTeam = cells[5].textContent.trim();
            const awayScore = cells[6].textContent.trim();

            if (homeTeam && homeTeam !== "Home") {
              results.push({
                date: dateStr,
                homeTeam,
                homeScore,
                awayTeam,
                awayScore
              });
            }
          }
        });

        return results;
      });

      console.log(`  Matches found: ${data.length}`);
      totalMatches += data.length;

      // Check for matches without scores (scheduled)
      const scheduled = data.filter(m => m.homeScore === "" || m.awayScore === "" || isNaN(parseInt(m.homeScore)));
      if (scheduled.length > 0) {
        console.log(`  SCHEDULED (no scores): ${scheduled.length}`);
        scheduled.forEach(m => {
          console.log(`    ${m.date}: ${m.homeTeam} vs ${m.awayTeam}`);
          futureMatches.push(m);
        });
      }

      // Show last few matches with dates
      if (data.length > 0) {
        console.log(`  Recent dates: ${data.slice(-3).map(m => m.date).join(", ")}`);
      }

    } catch (e) {
      console.log(`  Error: ${e.message}`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log(`Total matches scanned: ${totalMatches}`);
  console.log(`Future/Scheduled matches found: ${futureMatches.length}`);

  if (futureMatches.length > 0) {
    console.log("\nScheduled matches:");
    futureMatches.forEach(m => {
      console.log(`  ${m.date}: ${m.homeTeam} vs ${m.awayTeam}`);
    });
  }

  await browser.close();
}

testCGI().catch(e => {
  console.error("Error:", e);
  process.exit(1);
});
