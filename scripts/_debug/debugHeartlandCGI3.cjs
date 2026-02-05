/**
 * Debug Heartland CGI - Focus on what WORKS
 * 1. Standings CGI (returned 200!)
 * 2. hs-reports WordPress plugin
 * 3. team_results.cgi (different endpoint)
 */
const puppeteer = require("puppeteer");
const fs = require("fs");

const OUT_DIR = "scripts/_debug/heartland_debug";

async function debug() {
  console.log("=== Heartland Data Source Discovery ===\n");

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  // Test 1: Standings CGI - check actual content
  console.log("TEST 1: Standings CGI content (returned 200 earlier)");
  const page1 = await browser.newPage();
  try {
    const resp = await page1.goto(
      "https://heartlandsoccer.net/reports/cgi-jrb/subdiv_standings.cgi?level=Premier&b_g=Boys&age=U-11&subdivison=1",
      { waitUntil: "networkidle2", timeout: 30000 }
    );
    console.log(`  Status: ${resp.status()}`);
    const content = await page1.content();
    console.log(`  Content length: ${content.length}`);
    // Get raw text
    const text = await page1.evaluate(() => document.body ? document.body.innerText : "");
    console.log(`  Body text: "${text}"`);
    fs.writeFileSync(`${OUT_DIR}/standings_response.html`, content);
    console.log(`  Full HTML: ${content}`);
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }
  await page1.close();

  // Test 1b: Try different subdivision that we KNOW has data
  console.log("\nTEST 1b: Standings CGI - U-13 Boys Sub 1 (likely has data)");
  const page1b = await browser.newPage();
  try {
    const resp = await page1b.goto(
      "https://heartlandsoccer.net/reports/cgi-jrb/subdiv_standings.cgi?level=Premier&b_g=Boys&age=U-13&subdivison=1",
      { waitUntil: "networkidle2", timeout: 30000 }
    );
    console.log(`  Status: ${resp.status()}`);
    const content = await page1b.content();
    console.log(`  Content length: ${content.length}`);
    const text = await page1b.evaluate(() => document.body ? document.body.innerText : "");
    console.log(`  Body text (first 500): "${text.substring(0, 500)}"`);
    if (content.includes("<table")) console.log("  HAS TABLE!");
    fs.writeFileSync(`${OUT_DIR}/standings_u13_boys_1.html`, content);
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }
  await page1b.close();

  // Test 2: team_results.cgi (different CGI endpoint)
  console.log("\nTEST 2: team_results.cgi (team-specific results)");
  const page2 = await browser.newPage();
  page2.on("response", res => {
    if (res.url().includes("cgi") || res.url().includes("team_results")) {
      console.log(`  [${res.status()}] ${res.url().substring(0, 120)}`);
    }
  });
  try {
    // Try with a known team number from Jan 15 data (7912 = "Bk Academy FC 17B")
    const resp = await page2.goto(
      "https://heartlandsoccer.net/reports/cgi-jrb/team_results.cgi?team_number=7912",
      { waitUntil: "networkidle2", timeout: 30000 }
    );
    console.log(`  Status: ${resp.status()}`);
    const content = await page2.content();
    console.log(`  Content length: ${content.length}`);
    const text = await page2.evaluate(() => document.body ? document.body.innerText : "");
    console.log(`  Body text (first 500): "${text.substring(0, 500)}"`);
    if (content.includes("<table")) console.log("  HAS TABLE!");
    fs.writeFileSync(`${OUT_DIR}/team_results_7912.html`, content);
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }
  await page2.close();

  // Test 3: Investigate hs-reports WordPress plugin
  console.log("\nTEST 3: hs-reports plugin JavaScript");
  const page3 = await browser.newPage();
  try {
    const resp = await page3.goto(
      "https://www.heartlandsoccer.net/wp-content/plugins/hs-reports/dist/main.9814d276.js",
      { waitUntil: "networkidle2", timeout: 30000 }
    );
    console.log(`  Status: ${resp.status()}`);
    const jsContent = await page3.evaluate(() => document.body ? document.body.innerText : "");
    console.log(`  JS length: ${jsContent.length}`);
    fs.writeFileSync(`${OUT_DIR}/hs_reports_main.js`, jsContent);

    // Search for API endpoints in the JS
    const apiPatterns = ["api", "fetch", "ajax", "endpoint", "url", "cgi", "reports", "results", "standings"];
    for (const pattern of apiPatterns) {
      const idx = jsContent.toLowerCase().indexOf(pattern);
      if (idx > -1) {
        const context = jsContent.substring(Math.max(0, idx - 50), idx + 100);
        console.log(`  Found "${pattern}" at ${idx}: ...${context}...`);
      }
    }
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }
  await page3.close();

  // Test 3b: hs-reports runtime
  console.log("\nTEST 3b: hs-reports runtime JS");
  const page3b = await browser.newPage();
  try {
    const resp = await page3b.goto(
      "https://www.heartlandsoccer.net/wp-content/plugins/hs-reports/dist/runtime.6403442c.js",
      { waitUntil: "networkidle2", timeout: 30000 }
    );
    const jsContent = await page3b.evaluate(() => document.body ? document.body.innerText : "");
    console.log(`  Runtime JS length: ${jsContent.length}`);
    fs.writeFileSync(`${OUT_DIR}/hs_reports_runtime.js`, jsContent);
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }
  await page3b.close();

  // Test 4: Load Score-Standings page and watch ALL network requests
  console.log("\nTEST 4: Score-Standings page - ALL network traffic during form submit");
  const page4 = await browser.newPage();
  const allRequests = [];
  page4.on("request", req => {
    allRequests.push({ url: req.url(), method: req.method(), type: req.resourceType() });
  });
  page4.on("response", async res => {
    const url = res.url();
    // Watch for non-static responses
    if (!url.includes(".css") && !url.includes(".js") && !url.includes(".png") &&
        !url.includes(".jpg") && !url.includes("google") && !url.includes("analytics") &&
        !url.includes("cloudflare") && !url.includes("trovo") && !url.includes("outreach") &&
        !url.includes("bidr") && !url.includes("fontawesome") && !url.includes("recaptcha") &&
        !url.includes("font") && !url.includes("gtm")) {
      let body = "";
      try { body = await res.text(); } catch {}
      if (body.length > 0 && body.length < 5000) {
        console.log(`  [${res.status()}] ${url.substring(0, 100)} (${body.length} bytes)`);
      } else {
        console.log(`  [${res.status()}] ${url.substring(0, 100)} (${body.length} bytes)`);
      }
    }
  });

  try {
    await page4.goto("https://www.heartlandsoccer.net/league/score-standings/", {
      waitUntil: "networkidle2",
      timeout: 60000,
    });
    await new Promise(r => setTimeout(r, 5000));
    console.log("  Page loaded. Submitting Premier form...");

    // Select Premier form values
    await page4.select("#results-premier-b_g", "Boys");
    await page4.select("#results-premier-age", "U-13");
    await page4.select("#results-premier-subdivison", "1");

    // Intercept what happens when we click Go on the correct form
    // First, try submitting via the form's native submit action
    // But change the form action to stay on www domain
    const result = await page4.evaluate(() => {
      const forms = document.querySelectorAll("form");
      for (const form of forms) {
        if (!form.action || !form.action.includes("subdiv_results.cgi")) continue;
        const levelInput = form.querySelector('input[name="level"]');
        if (levelInput && levelInput.value === "Premier") {
          // Log form details
          const info = {
            action: form.action,
            target: form.target,
            method: form.method,
            level: levelInput.value,
          };

          // Try modifying the form action to use www
          form.action = "https://www.heartlandsoccer.net/reports/cgi-jrb/subdiv_results.cgi";

          // Now submit
          form.submit();
          return { ...info, newAction: form.action, submitted: true };
        }
      }
      return { error: "No Premier form found" };
    });
    console.log("  Submit with modified action:", JSON.stringify(result));

    await new Promise(r => setTimeout(r, 5000));

    // Check iframe
    const iframeHandle = await page4.$("#results-target");
    if (iframeHandle) {
      const frame = await iframeHandle.contentFrame();
      if (frame) {
        const fc = await frame.content();
        console.log(`  Iframe: ${fc.length} bytes`);
        if (fc.includes("<table")) console.log("  HAS TABLE!");
        if (fc.includes("404")) console.log("  HAS 404!");
        if (fc.includes("empty")) console.log("  EMPTY!");
        fs.writeFileSync(`${OUT_DIR}/test4_modified_action.html`, fc);
        console.log(`  First 500: ${fc.substring(0, 500)}`);
      }
    }
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }
  await page4.close();

  // Test 5: Try navigating iframe DIRECTLY to standings CGI (which works!)
  console.log("\nTEST 5: Navigate iframe to STANDINGS CGI (which returned 200)");
  const page5 = await browser.newPage();
  try {
    await page5.goto("https://www.heartlandsoccer.net/league/score-standings/", {
      waitUntil: "networkidle2",
      timeout: 60000,
    });
    await new Promise(r => setTimeout(r, 3000));

    const iframeHandle = await page5.$("#results-target");
    if (iframeHandle) {
      const frame = await iframeHandle.contentFrame();
      if (frame) {
        console.log("  Navigating iframe to standings CGI...");
        try {
          await frame.goto(
            "https://heartlandsoccer.net/reports/cgi-jrb/subdiv_standings.cgi?level=Premier&b_g=Boys&age=U-13&subdivison=1",
            { waitUntil: "networkidle2", timeout: 15000 }
          );
          const fc = await frame.content();
          console.log(`  Frame content: ${fc.length} bytes`);
          const text = await frame.evaluate(() => document.body ? document.body.innerText : "");
          console.log(`  Text: "${text.substring(0, 500)}"`);
          if (fc.includes("<table")) console.log("  HAS TABLE!");
          fs.writeFileSync(`${OUT_DIR}/test5_iframe_standings.html`, fc);
        } catch (e) {
          console.log(`  Frame nav error: ${e.message}`);
        }
      }
    }
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }
  await page5.close();

  // Test 6: Check the /reports/ directory
  console.log("\nTEST 6: Check /reports/ directory listing");
  const page6 = await browser.newPage();
  try {
    const resp = await page6.goto("https://heartlandsoccer.net/reports/", {
      waitUntil: "networkidle2",
      timeout: 30000,
    });
    console.log(`  Status: ${resp.status()}`);
    const content = await page6.content();
    console.log(`  Content length: ${content.length}`);
    // Check for directory listing
    const text = await page6.evaluate(() => document.body ? document.body.innerText : "");
    console.log(`  Text (first 500): "${text.substring(0, 500)}"`);
    if (content.includes("Index of")) console.log("  DIRECTORY LISTING!");
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }
  await page6.close();

  await browser.close();
  console.log("\n=== Done ===");
}

debug().catch(e => {
  console.error("FATAL:", e);
  process.exit(1);
});
