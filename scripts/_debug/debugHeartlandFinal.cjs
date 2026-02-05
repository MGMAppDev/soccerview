/**
 * Final Heartland Debug - Check remaining endpoints
 */
const puppeteer = require("puppeteer");
const fs = require("fs");

async function debug() {
  console.log("=== Final Heartland Endpoint Check ===\n");

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  // Test 1: Calendar site
  console.log("TEST 1: Calendar site (calendar.heartlandsoccer.net)");
  const page1 = await browser.newPage();
  try {
    const resp = await page1.goto("https://calendar.heartlandsoccer.net/team/", {
      waitUntil: "networkidle2",
      timeout: 30000,
    });
    console.log(`  Status: ${resp.status()}, URL: ${page1.url()}`);
    const title = await page1.title();
    console.log(`  Title: ${title}`);
    const content = await page1.content();
    const text = await page1.evaluate(() => document.body ? document.body.innerText : "");
    console.log(`  Text (first 500): ${text.substring(0, 500)}`);
    const hasForm = content.includes("<form");
    const hasInput = content.includes("<input");
    console.log(`  Has form: ${hasForm}, Has input: ${hasInput}`);
    if (hasForm || hasInput) {
      // Try searching for a team
      const inputs = await page1.evaluate(() => {
        return Array.from(document.querySelectorAll("input, select, button")).map(el => ({
          tag: el.tagName,
          type: el.type,
          name: el.name,
          id: el.id,
          placeholder: el.placeholder,
        }));
      });
      console.log("  Form elements:", JSON.stringify(inputs));
    }
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }
  await page1.close();

  // Test 2: Old standings page
  console.log("\nTEST 2: Old standings page");
  const page2 = await browser.newPage();
  try {
    const resp = await page2.goto("http://heartlandsoccer.net/4menu_season_info/standings.html", {
      waitUntil: "networkidle2",
      timeout: 30000,
    });
    console.log(`  Status: ${resp.status()}, URL: ${page2.url()}`);
    const title = await page2.title();
    console.log(`  Title: ${title}`);
    const text = await page2.evaluate(() => document.body ? document.body.innerText.substring(0, 500) : "");
    console.log(`  Text: ${text}`);
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }
  await page2.close();

  // Test 3: Try the actual Score-Standings page with headful browser and full interaction
  // Simulate exactly what a real user does
  console.log("\nTEST 3: Real user simulation on Score-Standings page");
  const page3 = await browser.newPage();
  // Watch for all frame navigations
  page3.on("framenavigated", frame => {
    if (frame.url() !== "about:blank" && !frame.url().includes("empty.html")) {
      console.log(`  [FRAME NAV] ${frame.url().substring(0, 120)}`);
    }
  });
  try {
    await page3.goto("https://www.heartlandsoccer.net/league/score-standings/", {
      waitUntil: "networkidle2",
      timeout: 60000,
    });
    await new Promise(r => setTimeout(r, 5000));

    // Use the hs-reports plugin's own mechanism
    // The plugin intercepts form submit and uses jQuery AJAX
    // Let's trigger it properly by dispatching the form submit event
    console.log("  Triggering form submit via hs-reports mechanism...");

    const result = await page3.evaluate(() => {
      // Find the Premier results form
      const forms = document.querySelectorAll("form.ajax-submit, form");
      let premierForm = null;
      for (const form of forms) {
        if (!form.action || !form.action.includes("subdiv_results.cgi")) continue;
        const levelInput = form.querySelector('input[name="level"]');
        if (levelInput && levelInput.value === "Premier") {
          premierForm = form;
          break;
        }
      }
      if (!premierForm) return { error: "No Premier form found" };

      // Check if form has ajax-submit class
      const hasAjaxClass = premierForm.classList.contains("ajax-submit");
      const parentComponent = premierForm.closest("hs-reports");

      // Set values
      const bg = premierForm.querySelector('select[name="b_g"]');
      const age = premierForm.querySelector('select[name="age"]');
      const subdiv = premierForm.querySelector('select[name="subdivison"]');
      if (bg) bg.value = "Boys";
      if (age) age.value = "U-13";
      if (subdiv) subdiv.value = "1";

      return {
        hasAjaxClass,
        hasHsReportsParent: !!parentComponent,
        formAction: premierForm.action,
        formTarget: premierForm.target,
        formMethod: premierForm.method,
        hasGender: !!bg,
        hasAge: !!age,
        hasSubdiv: !!subdiv,
        formClasses: premierForm.className,
        formParentTag: premierForm.parentElement ? premierForm.parentElement.tagName : "none",
      };
    });
    console.log("  Form analysis:", JSON.stringify(result, null, 2));

    // Now try triggering the submit event (which hs-reports intercepts)
    if (!result.error) {
      console.log("  Dispatching submit event...");
      const submitOk = await page3.evaluate(() => {
        const forms = document.querySelectorAll("form");
        for (const form of forms) {
          if (!form.action || !form.action.includes("subdiv_results.cgi")) continue;
          const levelInput = form.querySelector('input[name="level"]');
          if (levelInput && levelInput.value === "Premier") {
            // Set values
            const bg = form.querySelector('select[name="b_g"]');
            const age = form.querySelector('select[name="age"]');
            const subdiv = form.querySelector('select[name="subdivison"]');
            if (bg) bg.value = "Boys";
            if (age) age.value = "U-13";
            if (subdiv) subdiv.value = "1";

            // Dispatch submit event (which hs-reports intercepts)
            const event = new Event("submit", { cancelable: true, bubbles: true });
            const prevented = !form.dispatchEvent(event);
            return { dispatched: true, prevented, formAction: form.action };
          }
        }
        return { error: "form not found" };
      });
      console.log("  Submit dispatch result:", JSON.stringify(submitOk));

      await new Promise(r => setTimeout(r, 5000));

      // Check iframe
      const iframeHandle = await page3.$("#results-target");
      if (iframeHandle) {
        const frame = await iframeHandle.contentFrame();
        if (frame) {
          const fc = await frame.content();
          const text = await frame.evaluate(() => document.body ? document.body.innerText : "");
          console.log(`  Iframe: ${fc.length} bytes`);
          console.log(`  Iframe text: "${text.substring(0, 300)}"`);
          if (fc.includes("<table")) console.log("  HAS TABLE!");
          if (fc.includes("404")) console.log("  HAS 404!");
          if (fc.includes("empty")) console.log("  STILL EMPTY!");
          fs.writeFileSync("scripts/_debug/heartland_debug/final_iframe.html", fc);
        }
      }
    }

    // Also try the STANDINGS form (which CGI works!)
    console.log("\n  Trying STANDINGS form...");
    const standingsResult = await page3.evaluate(async () => {
      // Find the Premier standings form
      const forms = document.querySelectorAll("form");
      for (const form of forms) {
        if (!form.action || !form.action.includes("subdiv_standings.cgi")) continue;
        const levelInput = form.querySelector('input[name="level"]');
        if (levelInput && levelInput.value === "Premier") {
          const bg = form.querySelector('select[name="b_g"]');
          const age = form.querySelector('select[name="age"]');
          const subdiv = form.querySelector('select[name="subdivison"]');
          if (bg) bg.value = "Boys";
          if (age) age.value = "U-13";
          if (subdiv) subdiv.value = "1";

          // Make the AJAX call directly (like hs-reports does)
          const url = form.action + "?" + new URLSearchParams(new FormData(form)).toString();
          try {
            const resp = await fetch(url);
            const text = await resp.text();
            return {
              url,
              status: resp.status,
              length: text.length,
              hasTable: text.includes("<table"),
              preview: text.substring(0, 500),
            };
          } catch (e) {
            return { url, error: e.message };
          }
        }
      }
      return { error: "No Premier standings form" };
    });
    console.log("  Standings AJAX result:", JSON.stringify(standingsResult, null, 2));

  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }
  await page3.close();

  // Test 4: Check Season Archives page
  console.log("\nTEST 4: Season Archives page");
  const page4 = await browser.newPage();
  try {
    const resp = await page4.goto("https://www.heartlandsoccer.net/league/season-archives/", {
      waitUntil: "networkidle2",
      timeout: 30000,
    });
    console.log(`  Status: ${resp.status()}`);
    const text = await page4.evaluate(() => {
      const main = document.querySelector(".entry-content, main, article");
      return main ? main.innerText.substring(0, 2000) : document.body.innerText.substring(0, 2000);
    });
    console.log(`  Content: ${text.substring(0, 1000)}`);

    // Get links
    const links = await page4.evaluate(() => {
      return Array.from(document.querySelectorAll("a"))
        .filter(a => a.href && (a.href.includes("archive") || a.href.includes("season") || a.href.includes("reports") || a.href.includes("cgi")))
        .map(a => ({ text: a.innerText.trim(), href: a.href }))
        .slice(0, 20);
    });
    console.log("  Relevant links:");
    links.forEach(l => console.log(`    "${l.text}" -> ${l.href}`));
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }
  await page4.close();

  await browser.close();
  console.log("\n=== Done ===");
}

debug().catch(e => {
  console.error("FATAL:", e);
  process.exit(1);
});
