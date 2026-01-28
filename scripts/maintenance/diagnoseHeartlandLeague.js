/**
 * Heartland League Calendar DOM Diagnostic Script
 * ================================================
 *
 * Captures the actual DOM structure from calendar.heartlandsoccer.net
 * to debug the team search and schedule scraper.
 *
 * Usage: node scripts/diagnoseHeartlandLeague.js
 */

import puppeteer from "puppeteer";
import fs from "fs";

const TEAM_LOOKUP_URL = "https://calendar.heartlandsoccer.net/team/";

async function main() {
  console.log("🔍 Heartland League Calendar DOM Diagnostic");
  console.log("============================================");
  console.log(`URL: ${TEAM_LOOKUP_URL}\n`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();

    // Enable console logging from the page
    page.on("console", msg => console.log("PAGE LOG:", msg.text()));

    console.log("🌐 Loading team lookup page...");
    await page.goto(TEAM_LOOKUP_URL, { waitUntil: "networkidle2", timeout: 60000 });

    // Wait extra time for content to render
    console.log("⏳ Waiting for content to render (5 seconds)...");
    await new Promise(r => setTimeout(r, 5000));

    // Get the full HTML
    const html = await page.content();
    fs.writeFileSync("scripts/heartland_league_dom_dump.html", html);
    console.log(`\n✅ Full HTML saved to: scripts/heartland_league_dom_dump.html (${html.length} bytes)`);

    // Analyze the DOM structure
    console.log("\n📊 DOM STRUCTURE ANALYSIS:");
    console.log("=".repeat(60));

    const analysis = await page.evaluate(() => {
      const result = {
        title: document.title,
        url: window.location.href,
        bodyClasses: document.body.className,
        forms: [],
        inputs: [],
        buttons: [],
        links: [],
        tables: [],
        iframes: [],
      };

      // Find all forms
      document.querySelectorAll("form").forEach((form, i) => {
        result.forms.push({
          index: i,
          id: form.id || "(no id)",
          action: form.action || "(no action)",
          method: form.method || "GET",
          classes: form.className || "(no class)",
        });
      });

      // Find all inputs
      document.querySelectorAll("input, select, textarea").forEach((input, i) => {
        if (i < 20) {
          result.inputs.push({
            tag: input.tagName.toLowerCase(),
            type: input.type || "text",
            name: input.name || "(no name)",
            id: input.id || "(no id)",
            placeholder: input.placeholder || "",
            classes: input.className || "(no class)",
          });
        }
      });

      // Find all buttons
      document.querySelectorAll("button, input[type='submit'], input[type='button'], [role='button']").forEach((btn, i) => {
        if (i < 10) {
          result.buttons.push({
            tag: btn.tagName.toLowerCase(),
            type: btn.type || "",
            text: btn.innerText.trim().substring(0, 50),
            classes: btn.className || "(no class)",
          });
        }
      });

      // Find links with "team" or "id=" in href
      document.querySelectorAll("a").forEach(link => {
        const href = link.getAttribute("href") || "";
        if (href.includes("team") || href.includes("id=") || href.includes("schedule")) {
          result.links.push({
            href: href.substring(0, 200),
            text: link.innerText.trim().substring(0, 100),
          });
        }
      });

      // Find all tables
      document.querySelectorAll("table").forEach((table, i) => {
        const rows = table.querySelectorAll("tr");
        result.tables.push({
          index: i,
          classes: table.className || "(no class)",
          rowCount: rows.length,
          headerPreview: rows[0]?.innerText.substring(0, 200) || "(empty)",
        });
      });

      // Find iframes (calendar might be in an iframe)
      document.querySelectorAll("iframe").forEach((iframe, i) => {
        result.iframes.push({
          index: i,
          src: iframe.src || "(no src)",
          name: iframe.name || "(no name)",
        });
      });

      return result;
    });

    // Print analysis
    console.log("\n📦 Page Title:", analysis.title);
    console.log("📦 Current URL:", analysis.url);
    console.log("📦 Body Classes:", analysis.bodyClasses || "(none)");

    console.log("\n📝 Forms Found:", analysis.forms.length);
    analysis.forms.forEach((f, i) => {
      console.log(`  ${i + 1}. id="${f.id}" action="${f.action}" method="${f.method}"`);
      console.log(`     classes="${f.classes}"`);
    });

    console.log("\n📝 Input Elements Found:", analysis.inputs.length);
    analysis.inputs.forEach((inp, i) => {
      console.log(`  ${i + 1}. <${inp.tag}> type="${inp.type}" name="${inp.name}" id="${inp.id}"`);
      console.log(`     placeholder="${inp.placeholder}" classes="${inp.classes}"`);
    });

    console.log("\n🔘 Buttons Found:", analysis.buttons.length);
    analysis.buttons.forEach((btn, i) => {
      console.log(`  ${i + 1}. <${btn.tag}> type="${btn.type}" text="${btn.text}"`);
      console.log(`     classes="${btn.classes}"`);
    });

    console.log("\n🔗 Team/Schedule Related Links Found:", analysis.links.length);
    analysis.links.slice(0, 20).forEach((link, i) => {
      console.log(`  ${i + 1}. href="${link.href}"`);
      console.log(`     text="${link.text}"`);
    });

    console.log("\n📊 Tables Found:", analysis.tables.length);
    analysis.tables.forEach((t, i) => {
      console.log(`  ${i + 1}. classes="${t.classes}" rows=${t.rowCount}`);
      console.log(`     Header: ${t.headerPreview}`);
    });

    console.log("\n🖼️ Iframes Found:", analysis.iframes.length);
    analysis.iframes.forEach((iframe, i) => {
      console.log(`  ${i + 1}. src="${iframe.src}" name="${iframe.name}"`);
    });

    // Try to type in a search and see what happens
    console.log("\n🔍 Testing search functionality...");

    // Find any text input
    const inputSelector = await page.evaluate(() => {
      const inputs = document.querySelectorAll("input[type='text'], input[type='search'], input:not([type])");
      if (inputs.length > 0) {
        // Return a selector for the first usable input
        const input = inputs[0];
        if (input.id) return `#${input.id}`;
        if (input.name) return `input[name="${input.name}"]`;
        if (input.className) return `input.${input.className.split(" ")[0]}`;
        return "input";
      }
      return null;
    });

    if (inputSelector) {
      console.log(`   Found input selector: ${inputSelector}`);

      // Try searching
      await page.type(inputSelector, "Sporting");
      await new Promise(r => setTimeout(r, 1000));

      // Press Enter
      await page.keyboard.press("Enter");
      await new Promise(r => setTimeout(r, 3000));

      // Check what changed
      const afterSearch = await page.evaluate(() => {
        const links = [];
        document.querySelectorAll("a").forEach(link => {
          const href = link.getAttribute("href") || "";
          const text = link.innerText.trim();
          if (text && text.length > 3 && text.length < 100) {
            links.push({ href, text });
          }
        });
        return {
          links: links.slice(0, 30),
          bodyText: document.body.innerText.substring(0, 2000),
        };
      });

      console.log("\n📋 After search - Links found:", afterSearch.links.length);
      afterSearch.links.slice(0, 15).forEach((link, i) => {
        console.log(`   ${i + 1}. "${link.text}" -> ${link.href.substring(0, 80)}`);
      });

      console.log("\n📄 Body text preview:");
      console.log(afterSearch.bodyText.substring(0, 1000));

      // Save after-search state
      const afterHtml = await page.content();
      fs.writeFileSync("scripts/heartland_league_after_search.html", afterHtml);
      console.log("\n✅ After-search HTML saved to: scripts/heartland_league_after_search.html");
    } else {
      console.log("   ❌ No text input found!");
    }

    // Save full analysis as JSON
    fs.writeFileSync("scripts/heartland_league_analysis.json", JSON.stringify(analysis, null, 2));
    console.log("✅ Full analysis saved to: scripts/heartland_league_analysis.json");

    // Take a screenshot
    await page.screenshot({ path: "scripts/heartland_league_screenshot.png", fullPage: true });
    console.log("✅ Screenshot saved to: scripts/heartland_league_screenshot.png");

  } finally {
    await browser.close();
  }

  console.log("\n" + "=".repeat(60));
  console.log("📋 NEXT STEPS:");
  console.log("=".repeat(60));
  console.log("1. Review scripts/heartland_league_dom_dump.html");
  console.log("2. Check scripts/heartland_league_analysis.json");
  console.log("3. Update scrapeHeartlandLeague.js with correct selectors");
}

main().catch(error => {
  console.error("❌ FATAL:", error.message);
  process.exit(1);
});
