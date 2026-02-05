/**
 * Debug Heartland CGI - Test different URL approaches
 */
const puppeteer = require("puppeteer");
const fs = require("fs");

async function debug() {
  console.log("=== Heartland CGI URL Testing ===\n");

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  // Test 1: Direct CGI URL (no www)
  console.log("TEST 1: Direct CGI URL (no www) - Results");
  const page1 = await browser.newPage();
  page1.on("response", res => {
    if (res.url().includes("cgi") || res.url().includes("subdiv")) {
      console.log(`  [${res.status()}] ${res.url().substring(0, 120)}`);
    }
  });
  try {
    const resp1 = await page1.goto(
      "https://heartlandsoccer.net/reports/cgi-jrb/subdiv_results.cgi?level=Premier&b_g=Boys&age=U-11&subdivison=1",
      { waitUntil: "networkidle2", timeout: 30000 }
    );
    console.log(`  Final status: ${resp1.status()}, URL: ${page1.url()}`);
    const title1 = await page1.title();
    console.log(`  Title: ${title1}`);
    const content1 = await page1.content();
    console.log(`  Content length: ${content1.length}`);
    if (content1.includes("table")) console.log("  HAS TABLE!");
    if (content1.includes("404")) console.log("  HAS 404!");
    fs.writeFileSync("scripts/_debug/heartland_debug/test1_results_nowww.html", content1);
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }
  await page1.close();

  // Test 2: Direct CGI URL (WITH www)
  console.log("\nTEST 2: Direct CGI URL (www) - Results");
  const page2 = await browser.newPage();
  try {
    const resp2 = await page2.goto(
      "https://www.heartlandsoccer.net/reports/cgi-jrb/subdiv_results.cgi?level=Premier&b_g=Boys&age=U-11&subdivison=1",
      { waitUntil: "networkidle2", timeout: 30000 }
    );
    console.log(`  Final status: ${resp2.status()}, URL: ${page2.url()}`);
    const title2 = await page2.title();
    console.log(`  Title: ${title2}`);
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }
  await page2.close();

  // Test 3: Direct STANDINGS CGI URL (the one that worked Jan 15)
  console.log("\nTEST 3: Direct CGI URL (no www) - Standings");
  const page3 = await browser.newPage();
  page3.on("response", res => {
    if (res.url().includes("cgi") || res.url().includes("subdiv")) {
      console.log(`  [${res.status()}] ${res.url().substring(0, 120)}`);
    }
  });
  try {
    const resp3 = await page3.goto(
      "https://heartlandsoccer.net/reports/cgi-jrb/subdiv_standings.cgi?level=Premier&b_g=Boys&age=U-11&subdivison=1",
      { waitUntil: "networkidle2", timeout: 30000 }
    );
    console.log(`  Final status: ${resp3.status()}, URL: ${page3.url()}`);
    const title3 = await page3.title();
    console.log(`  Title: ${title3}`);
    const content3 = await page3.content();
    console.log(`  Content length: ${content3.length}`);
    if (content3.includes("<table")) console.log("  HAS TABLE!");
    if (content3.includes("404")) console.log("  HAS 404!");
    fs.writeFileSync("scripts/_debug/heartland_debug/test3_standings_nowww.html", content3);
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }
  await page3.close();

  // Test 4: Try navigating iframe within the Score-Standings page
  console.log("\nTEST 4: Navigate iframe directly within Score-Standings page");
  const page4 = await browser.newPage();
  try {
    await page4.goto("https://www.heartlandsoccer.net/league/score-standings/", {
      waitUntil: "networkidle2",
      timeout: 60000,
    });
    await new Promise(r => setTimeout(r, 3000));

    // Get the iframe
    const iframeHandle = await page4.$("#results-target");
    if (iframeHandle) {
      const frame = await iframeHandle.contentFrame();
      if (frame) {
        // Try navigating the frame directly to CGI URL
        console.log("  Navigating iframe to CGI URL...");
        try {
          await frame.goto(
            "https://heartlandsoccer.net/reports/cgi-jrb/subdiv_results.cgi?level=Premier&b_g=Boys&age=U-11&subdivison=1",
            { waitUntil: "networkidle2", timeout: 15000 }
          );
          const frameContent = await frame.content();
          console.log(`  Frame content length: ${frameContent.length}`);
          if (frameContent.includes("<table")) console.log("  HAS TABLE!");
          if (frameContent.includes("404")) console.log("  HAS 404!");
          fs.writeFileSync("scripts/_debug/heartland_debug/test4_iframe_direct.html", frameContent);
          console.log(`  First 300 chars: ${frameContent.substring(0, 300)}`);
        } catch (e) {
          console.log(`  Frame navigation error: ${e.message}`);
        }
      }
    }
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }
  await page4.close();

  // Test 5: Try the Premier form specifically (Form index 2)
  console.log("\nTEST 5: Submit PREMIER form (Form 2 specifically)");
  const page5 = await browser.newPage();
  page5.on("response", res => {
    const url = res.url();
    if (url.includes("cgi") || url.includes("subdiv") || url.includes("results")) {
      console.log(`  [${res.status()}] ${url.substring(0, 150)}`);
    }
  });
  try {
    await page5.goto("https://www.heartlandsoccer.net/league/score-standings/", {
      waitUntil: "networkidle2",
      timeout: 60000,
    });
    await new Promise(r => setTimeout(r, 5000));

    // Set Premier form dropdowns
    await page5.select("#results-premier-b_g", "Boys");
    await page5.select("#results-premier-age", "U-11");
    await page5.select("#results-premier-subdivison", "1");

    // Find the PREMIER results form specifically (Form 2 - has hidden level=Premier)
    const submitResult = await page5.evaluate(() => {
      const forms = document.querySelectorAll("form");
      for (const form of forms) {
        if (!form.action || !form.action.includes("subdiv_results.cgi")) continue;
        // Check if this is the Premier form by looking for hidden level input
        const levelInput = form.querySelector('input[name="level"]');
        if (levelInput && levelInput.value === "Premier") {
          // Found the Premier form!
          const btn = form.querySelector('button[type="submit"]');
          if (btn) {
            btn.click();
            return { success: true, level: levelInput.value, action: form.action };
          }
          return { success: false, level: levelInput.value, error: "No button" };
        }
      }
      return { success: false, error: "No Premier form found" };
    });
    console.log("  Submit result:", JSON.stringify(submitResult));

    await new Promise(r => setTimeout(r, 5000));

    // Check iframe
    const iframeHandle5 = await page5.$("#results-target");
    if (iframeHandle5) {
      const frame5 = await iframeHandle5.contentFrame();
      if (frame5) {
        const fc = await frame5.content();
        console.log(`  Iframe content: ${fc.length} bytes`);
        if (fc.includes("<table")) console.log("  HAS TABLE!");
        if (fc.includes("404")) console.log("  HAS 404!");
        if (fc.includes("empty.html")) console.log("  STILL EMPTY!");
        fs.writeFileSync("scripts/_debug/heartland_debug/test5_premier_submit.html", fc);
        console.log(`  First 500 chars: ${fc.substring(0, 500)}`);
      }
    }
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }
  await page5.close();

  // Test 6: Try HTTP (not HTTPS) for CGI
  console.log("\nTEST 6: HTTP (not HTTPS) CGI URL");
  const page6 = await browser.newPage();
  page6.on("response", res => {
    console.log(`  [${res.status()}] ${res.url().substring(0, 120)}`);
  });
  try {
    const resp6 = await page6.goto(
      "http://heartlandsoccer.net/reports/cgi-jrb/subdiv_results.cgi?level=Premier&b_g=Boys&age=U-11&subdivison=1",
      { waitUntil: "networkidle2", timeout: 30000 }
    );
    console.log(`  Final URL: ${page6.url()}`);
    const title6 = await page6.title();
    console.log(`  Title: ${title6}`);
    const content6 = await page6.content();
    if (content6.includes("<table")) console.log("  HAS TABLE!");
    if (content6.includes("404")) console.log("  HAS 404!");
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
