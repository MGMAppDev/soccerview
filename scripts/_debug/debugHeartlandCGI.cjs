/**
 * Debug Heartland CGI form submission
 * Diagnoses why 280 divisions returned 0 matches
 */
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const OUT_DIR = path.join(__dirname, "heartland_debug");
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

async function debug() {
  console.log("🔍 Heartland CGI Form Debug\n");

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();

  // Log all console messages from the page
  page.on("console", msg => console.log("  [PAGE]", msg.text()));

  // Capture network requests to CGI
  const cgiRequests = [];
  page.on("request", req => {
    const url = req.url();
    if (url.includes("cgi") || url.includes("results") || url.includes("subdiv")) {
      cgiRequests.push({ url, method: req.method(), type: req.resourceType() });
    }
  });
  page.on("response", res => {
    const url = res.url();
    if (url.includes("cgi") || url.includes("subdiv")) {
      console.log(`  [RESPONSE] ${res.status()} ${url.substring(0, 120)}`);
    }
  });

  console.log("1. Opening Score-Standings page...");
  await page.goto("https://www.heartlandsoccer.net/league/score-standings/", {
    waitUntil: "networkidle2",
    timeout: 60000,
  });
  console.log("   Page loaded");

  // Wait for Cloudflare
  await new Promise(r => setTimeout(r, 5000));

  // Screenshot initial state
  await page.screenshot({ path: path.join(OUT_DIR, "01_initial.png"), fullPage: true });
  console.log("   Screenshot: 01_initial.png");

  // Check what dropdowns exist
  console.log("\n2. Checking dropdowns...");
  const dropdowns = await page.evaluate(() => {
    const selects = document.querySelectorAll("select");
    return Array.from(selects).map(s => ({
      id: s.id,
      name: s.name,
      visible: s.offsetParent !== null,
      disabled: s.disabled,
      optionCount: s.options.length,
      options: Array.from(s.options).slice(0, 5).map(o => ({ value: o.value, text: o.text })),
    }));
  });
  console.log(`   Found ${dropdowns.length} dropdowns:`);
  dropdowns.forEach(d => {
    console.log(`   - #${d.id} (name=${d.name}): ${d.optionCount} options, visible=${d.visible}, disabled=${d.disabled}`);
    d.options.forEach(o => console.log(`     "${o.value}" = "${o.text}"`));
  });

  // Check forms
  console.log("\n3. Checking forms...");
  const forms = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("form")).map(f => ({
      action: f.action,
      method: f.method,
      target: f.target,
      id: f.id,
      classes: f.className,
      inputs: Array.from(f.querySelectorAll("input, select, button")).map(el => ({
        tag: el.tagName,
        type: el.type,
        name: el.name,
        id: el.id,
        value: el.value,
      })),
    }));
  });
  console.log(`   Found ${forms.length} forms:`);
  forms.forEach((f, i) => {
    console.log(`   Form ${i}: action=${f.action}, method=${f.method}, target="${f.target}", id=${f.id}`);
    f.inputs.forEach(inp => {
      console.log(`     ${inp.tag} type=${inp.type} name=${inp.name} id=${inp.id} value="${inp.value}"`);
    });
  });

  // Check iframes
  console.log("\n4. Checking iframes...");
  const iframes = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("iframe")).map(f => ({
      id: f.id,
      name: f.name,
      src: f.src,
      width: f.width,
      height: f.height,
    }));
  });
  console.log(`   Found ${iframes.length} iframes:`);
  iframes.forEach(f => console.log(`   - #${f.id} name="${f.name}" src=${f.src} ${f.width}x${f.height}`));

  // Try form submission for Boys U-11 Subdivision 1
  console.log("\n5. Attempting form submission: Boys U-11 Subdivision 1...");

  try {
    // Select values
    await page.select("#results-premier-b_g", "Boys");
    console.log("   ✅ Selected gender: Boys");
    await page.select("#results-premier-age", "U-11");
    console.log("   ✅ Selected age: U-11");
    await page.select("#results-premier-subdivison", "1");
    console.log("   ✅ Selected subdivision: 1");
  } catch (e) {
    console.log(`   ❌ Select failed: ${e.message}`);
  }

  await page.screenshot({ path: path.join(OUT_DIR, "02_form_filled.png"), fullPage: true });
  console.log("   Screenshot: 02_form_filled.png");

  // Find and click submit
  console.log("\n6. Clicking submit...");
  const submitted = await page.evaluate(() => {
    const forms = document.querySelectorAll("form");
    for (const form of forms) {
      if (form.action && form.action.includes("subdiv_results.cgi")) {
        const btn = form.querySelector('input[type="submit"], button[type="submit"]');
        if (btn) {
          console.log("Found button:", btn.outerHTML);
          btn.click();
          return { found: true, formAction: form.action, formTarget: form.target, btnText: btn.value || btn.innerText };
        }
        return { found: false, formAction: form.action, formTarget: form.target, error: "No submit button found" };
      }
    }
    return { found: false, error: "No form with subdiv_results.cgi found" };
  });
  console.log("   Submit result:", JSON.stringify(submitted));

  // Wait for iframe to load
  await new Promise(r => setTimeout(r, 5000));

  await page.screenshot({ path: path.join(OUT_DIR, "03_after_submit.png"), fullPage: true });
  console.log("   Screenshot: 03_after_submit.png");

  // Check iframe content
  console.log("\n7. Checking iframe content...");
  const iframeHandle = await page.$("#results-target");
  if (iframeHandle) {
    const frame = await iframeHandle.contentFrame();
    if (frame) {
      try {
        await frame.waitForSelector("table", { timeout: 10000 });
        console.log("   ✅ Table found in iframe!");
        const content = await frame.content();
        fs.writeFileSync(path.join(OUT_DIR, "iframe_content.html"), content);
        console.log(`   Saved iframe HTML (${content.length} bytes)`);

        // Check table structure
        const tableInfo = await frame.evaluate(() => {
          const tables = document.querySelectorAll("table");
          return Array.from(tables).map(t => ({
            rows: t.rows.length,
            firstRowCells: t.rows[0] ? Array.from(t.rows[0].cells).map(c => c.innerText.trim()) : [],
          }));
        });
        console.log("   Tables:", JSON.stringify(tableInfo));
      } catch (e) {
        console.log(`   ⏳ No table found (timeout): ${e.message}`);
        const content = await frame.content();
        fs.writeFileSync(path.join(OUT_DIR, "iframe_content_notable.html"), content);
        console.log(`   Saved iframe content for inspection (${content.length} bytes)`);
        console.log(`   First 500 chars: ${content.substring(0, 500)}`);
      }
    } else {
      console.log("   ❌ Could not get contentFrame()");
    }
  } else {
    console.log("   ❌ #results-target iframe not found");
  }

  // Try form.submit() directly instead of button click
  console.log("\n8. Trying form.submit() directly...");
  const submitResult = await page.evaluate(() => {
    const forms = document.querySelectorAll("form");
    for (const form of forms) {
      if (form.action && form.action.includes("subdiv_results.cgi")) {
        try {
          form.submit();
          return "submitted via form.submit()";
        } catch (e) {
          return "form.submit() failed: " + e.message;
        }
      }
    }
    return "no matching form found";
  });
  console.log("   Result:", submitResult);

  await new Promise(r => setTimeout(r, 5000));
  await page.screenshot({ path: path.join(OUT_DIR, "04_after_form_submit.png"), fullPage: true });

  // Check iframe again
  const iframeHandle2 = await page.$("#results-target");
  if (iframeHandle2) {
    const frame2 = await iframeHandle2.contentFrame();
    if (frame2) {
      const content2 = await frame2.content();
      fs.writeFileSync(path.join(OUT_DIR, "iframe_after_formsubmit.html"), content2);
      console.log(`   Iframe content after form.submit(): ${content2.length} bytes`);
      console.log(`   First 500 chars: ${content2.substring(0, 500)}`);
    }
  }

  // Log CGI network requests
  console.log("\n9. CGI-related network requests:");
  cgiRequests.forEach(r => console.log(`   ${r.method} ${r.type}: ${r.url}`));

  await browser.close();
  console.log("\n✅ Debug complete. Check", OUT_DIR);
}

debug().catch(e => {
  console.error("FATAL:", e);
  process.exit(1);
});
