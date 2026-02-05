/**
 * Debug Heartland CGI - Test team_results and AJAX approach
 */
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const OUT_DIR = "scripts/_debug/heartland_debug";

async function debug() {
  console.log("=== Heartland Working Endpoints ===\n");

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  // Test 1: team_results.cgi with various team numbers from Jan 15 data
  console.log("TEST 1: team_results.cgi with various team numbers");
  const teamNumbers = ["7115", "7912", "3010", "4000", "5000", "100", "200", "711A", "1", "50"];
  for (const num of teamNumbers) {
    const page = await browser.newPage();
    try {
      const resp = await page.goto(
        `https://heartlandsoccer.net/reports/cgi-jrb/team_results.cgi?team_number=${num}`,
        { waitUntil: "networkidle2", timeout: 15000 }
      );
      const text = await page.evaluate(() => document.body ? document.body.innerText.substring(0, 200) : "");
      const content = await page.content();
      const hasTable = content.includes("<table");
      console.log(`  ${num}: ${resp.status()} - ${hasTable ? "HAS TABLE" : text.substring(0, 80)}`);
      if (hasTable) {
        fs.writeFileSync(`${OUT_DIR}/team_results_${num}.html`, content);
        console.log(`    Saved (${content.length} bytes)`);
      }
    } catch (e) {
      console.log(`  ${num}: ERROR - ${e.message}`);
    }
    await page.close();
  }

  // Test 2: Use page.evaluate to make AJAX call FROM the Score-Standings page (same origin)
  console.log("\nTEST 2: AJAX from within Score-Standings page");
  const page2 = await browser.newPage();
  try {
    await page2.goto("https://www.heartlandsoccer.net/league/score-standings/", {
      waitUntil: "networkidle2",
      timeout: 60000,
    });
    await new Promise(r => setTimeout(r, 5000));

    // Test AJAX from within the page context
    const ajaxResult = await page2.evaluate(async () => {
      const results = {};

      // Try subdiv_results.cgi
      try {
        const resp1 = await fetch("https://heartlandsoccer.net/reports/cgi-jrb/subdiv_results.cgi?level=Premier&b_g=Boys&age=U-13&subdivison=1");
        results.results_status = resp1.status;
        results.results_url = resp1.url;
        const text1 = await resp1.text();
        results.results_length = text1.length;
        results.results_has_table = text1.includes("<table");
        results.results_preview = text1.substring(0, 200);
      } catch (e) {
        results.results_error = e.message;
      }

      // Try subdiv_standings.cgi
      try {
        const resp2 = await fetch("https://heartlandsoccer.net/reports/cgi-jrb/subdiv_standings.cgi?level=Premier&b_g=Boys&age=U-13&subdivison=1");
        results.standings_status = resp2.status;
        results.standings_url = resp2.url;
        const text2 = await resp2.text();
        results.standings_length = text2.length;
        results.standings_has_table = text2.includes("<table");
        results.standings_preview = text2.substring(0, 200);
      } catch (e) {
        results.standings_error = e.message;
      }

      // Try team_results.cgi
      try {
        const resp3 = await fetch("https://heartlandsoccer.net/reports/cgi-jrb/team_results.cgi?team_number=100");
        results.team_status = resp3.status;
        results.team_url = resp3.url;
        const text3 = await resp3.text();
        results.team_length = text3.length;
        results.team_has_table = text3.includes("<table");
        results.team_preview = text3.substring(0, 200);
      } catch (e) {
        results.team_error = e.message;
      }

      // Try jQuery.get (like the hs-reports plugin does)
      try {
        const jqResult = await new Promise((resolve, reject) => {
          jQuery.get("https://heartlandsoccer.net/reports/cgi-jrb/subdiv_standings.cgi?level=Premier&b_g=Boys&age=U-13&subdivison=1")
            .done(data => resolve({ success: true, length: data.length, preview: data.substring(0, 200), hasTable: data.includes("<table") }))
            .fail((jqXHR, textStatus, error) => resolve({ success: false, status: jqXHR.status, textStatus, error: error.toString() }));
        });
        results.jquery_standings = jqResult;
      } catch (e) {
        results.jquery_error = e.message;
      }

      return results;
    });

    console.log("  AJAX Results:", JSON.stringify(ajaxResult, null, 2));
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }
  await page2.close();

  // Test 3: Explore the /reports/ page links
  console.log("\nTEST 3: Explore /reports/ page for working links");
  const page3 = await browser.newPage();
  try {
    await page3.goto("https://heartlandsoccer.net/reports/", {
      waitUntil: "networkidle2",
      timeout: 30000,
    });
    const links = await page3.evaluate(() => {
      return Array.from(document.querySelectorAll("a"))
        .map(a => ({ text: a.innerText.trim(), href: a.href }))
        .filter(l => l.text.length > 0 && l.text.length < 100);
    });
    console.log(`  Found ${links.length} links:`);
    links.forEach(l => console.log(`    "${l.text}" -> ${l.href}`));

    // Save the full HTML
    const content = await page3.content();
    fs.writeFileSync(`${OUT_DIR}/reports_page.html`, content);
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }
  await page3.close();

  // Test 4: Try the League Standings link from /reports/
  console.log("\nTEST 4: Try League Standings from /reports/ page");
  const page4 = await browser.newPage();
  try {
    // Common patterns for Heartland reports
    const urls = [
      "https://heartlandsoccer.net/reports/standings/",
      "https://heartlandsoccer.net/reports/league-standings/",
      "https://heartlandsoccer.net/reports/schedules/",
    ];
    for (const url of urls) {
      const resp = await page4.goto(url, { waitUntil: "networkidle2", timeout: 15000 });
      const finalUrl = page4.url();
      const title = await page4.title();
      console.log(`  ${url}`);
      console.log(`    Status: ${resp.status()}, Final: ${finalUrl}, Title: ${title}`);
    }
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }
  await page4.close();

  // Test 5: Use non-headless browser for Cloudflare challenge
  console.log("\nTEST 5: Try fetching CGI with different headers (mimic real browser)");
  const page5 = await browser.newPage();
  await page5.setExtraHTTPHeaders({
    "Referer": "https://www.heartlandsoccer.net/league/score-standings/",
    "Origin": "https://www.heartlandsoccer.net",
  });
  try {
    const resp = await page5.goto(
      "https://heartlandsoccer.net/reports/cgi-jrb/subdiv_standings.cgi?level=Premier&b_g=Boys&age=U-13&subdivison=1",
      { waitUntil: "networkidle2", timeout: 15000 }
    );
    console.log(`  Status: ${resp.status()}`);
    const content = await page5.content();
    const text = await page5.evaluate(() => document.body ? document.body.innerText : "");
    console.log(`  Content: ${content.length} bytes, Text: "${text.substring(0, 200)}"`);
    if (content.includes("<table")) console.log("  HAS TABLE!");
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }
  await page5.close();

  await browser.close();
  console.log("\n=== Done ===");
}

debug().catch(e => {
  console.error("FATAL:", e);
  process.exit(1);
});
