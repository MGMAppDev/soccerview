/**
 * HTGSports DOM Diagnostic Script
 * ================================
 *
 * Captures the actual DOM structure from HTGSports to debug the parser.
 * Saves both the full HTML and a structured analysis of the page content.
 *
 * Usage: node scripts/diagnoseHTGSports.js
 */

import puppeteer from "puppeteer";
import fs from "fs";

const EVENT_ID = 12093; // 2024 Heartland Invitational - Boys (known to have data)
const URL = `https://events.htgsports.net/?eventid=${EVENT_ID}#/scheduleresults`;

async function main() {
  console.log("🔍 HTGSports DOM Diagnostic");
  console.log("===========================");
  console.log(`Event ID: ${EVENT_ID}`);
  console.log(`URL: ${URL}\n`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();

    // Enable console logging from the page
    page.on("console", msg => console.log("PAGE LOG:", msg.text()));

    console.log("🌐 Loading page...");
    await page.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });

    // Wait extra time for SPA to fully render
    console.log("⏳ Waiting for SPA content to render (10 seconds)...");
    await new Promise(r => setTimeout(r, 10000));

    // Get the full HTML
    const html = await page.content();
    fs.writeFileSync("scripts/htgsports_dom_dump.html", html);
    console.log(`\n✅ Full HTML saved to: scripts/htgsports_dom_dump.html (${html.length} bytes)`);

    // Analyze the DOM structure
    console.log("\n📊 DOM STRUCTURE ANALYSIS:");
    console.log("=".repeat(60));

    const analysis = await page.evaluate(() => {
      const result = {
        title: document.title,
        bodyClasses: document.body.className,
        mainContainers: [],
        tables: [],
        divPatterns: [],
        allTextWithScores: [],
        potentialMatchElements: [],
      };

      // Find main content containers
      const containers = document.querySelectorAll("[class*='container'], [class*='content'], [class*='main'], [id*='app']");
      containers.forEach(c => {
        result.mainContainers.push({
          tag: c.tagName,
          id: c.id || "(no id)",
          class: c.className || "(no class)",
          childCount: c.children.length,
        });
      });

      // Analyze all tables
      const tables = document.querySelectorAll("table");
      tables.forEach((table, i) => {
        const rows = table.querySelectorAll("tr");
        const headerRow = rows.length > 0 ? rows[0].innerText.substring(0, 200) : "";
        result.tables.push({
          index: i,
          className: table.className || "(no class)",
          rowCount: rows.length,
          headerPreview: headerRow,
        });
      });

      // Find all divs with schedule-related classes
      const scheduleRelated = document.querySelectorAll("[class*='schedule'], [class*='game'], [class*='match'], [class*='result'], [class*='fixture'], [class*='score']");
      scheduleRelated.forEach((el, i) => {
        if (i < 20) { // Limit output
          result.divPatterns.push({
            tag: el.tagName,
            className: el.className,
            preview: el.innerText.substring(0, 300).replace(/\n/g, " | "),
          });
        }
      });

      // Find ANY element containing score patterns (X - X)
      const allElements = document.querySelectorAll("*");
      allElements.forEach(el => {
        const text = el.innerText || "";
        // Look for score patterns
        if (/\d+\s*[-–]\s*\d+/.test(text) && text.length < 500) {
          // Check if this element has children with the same text
          const childrenWithSameText = Array.from(el.children).some(
            child => child.innerText === text
          );
          if (!childrenWithSameText) {
            result.allTextWithScores.push({
              tag: el.tagName,
              className: el.className || "(no class)",
              text: text.substring(0, 400),
            });
          }
        }
      });

      // Look for specific Angular/React component patterns
      const ngComponents = document.querySelectorAll("[ng-repeat], [ng-if]");
      const reactComponents = document.querySelectorAll("[data-reactroot], [data-reactid]");

      result.frameworkInfo = {
        angularElements: ngComponents.length,
        reactElements: reactComponents.length,
      };

      // Find elements with data-* attributes that might indicate match data
      const dataElements = document.querySelectorAll("[data-game], [data-match], [data-team], [data-score]");
      dataElements.forEach((el, i) => {
        if (i < 10) {
          const attrs = {};
          for (const attr of el.attributes) {
            if (attr.name.startsWith("data-")) {
              attrs[attr.name] = attr.value;
            }
          }
          result.potentialMatchElements.push({
            tag: el.tagName,
            dataAttrs: attrs,
            preview: el.innerText.substring(0, 200),
          });
        }
      });

      // Check for vue.js
      try {
        result.frameworkInfo.vueElements = document.querySelectorAll("[v-if], [v-for]").length;
      } catch {
        result.frameworkInfo.vueElements = 0;
      }

      // Look at the root app structure
      const appRoot = document.querySelector("#app, #root, [ng-app], [ng-view]");
      if (appRoot) {
        result.appRoot = {
          id: appRoot.id,
          className: appRoot.className,
          childCount: appRoot.children.length,
          firstLevelChildren: Array.from(appRoot.children).slice(0, 5).map(c => ({
            tag: c.tagName,
            id: c.id,
            className: c.className,
          })),
        };
      }

      return result;
    });

    // Print analysis
    console.log("\n📦 Page Title:", analysis.title);
    console.log("📦 Body Classes:", analysis.bodyClasses);

    console.log("\n🏠 Main Containers Found:");
    analysis.mainContainers.slice(0, 10).forEach((c, i) => {
      console.log(`  ${i + 1}. <${c.tag}> id="${c.id}" class="${c.class}" children=${c.childCount}`);
    });

    console.log("\n📊 Tables Found:", analysis.tables.length);
    analysis.tables.forEach((t, i) => {
      console.log(`  ${i + 1}. class="${t.className}" rows=${t.rowCount}`);
      console.log(`     Header: ${t.headerPreview.substring(0, 100)}...`);
    });

    console.log("\n🎯 Schedule-Related Elements Found:", analysis.divPatterns.length);
    analysis.divPatterns.slice(0, 10).forEach((d, i) => {
      console.log(`  ${i + 1}. <${d.tag}> class="${d.className}"`);
      console.log(`     Preview: ${d.preview.substring(0, 150)}...`);
    });

    console.log("\n⚽ Elements Containing Score Patterns:", analysis.allTextWithScores.length);
    analysis.allTextWithScores.slice(0, 15).forEach((s, i) => {
      console.log(`  ${i + 1}. <${s.tag}> class="${s.className}"`);
      console.log(`     Text: ${s.text.substring(0, 200)}...`);
    });

    console.log("\n🔧 Framework Detection:");
    console.log(`  Angular elements: ${analysis.frameworkInfo.angularElements}`);
    console.log(`  React elements: ${analysis.frameworkInfo.reactElements}`);
    console.log(`  Vue elements: ${analysis.frameworkInfo.vueElements}`);

    if (analysis.appRoot) {
      console.log("\n🌳 App Root Structure:");
      console.log(`  ID: ${analysis.appRoot.id}`);
      console.log(`  Class: ${analysis.appRoot.className}`);
      console.log(`  Children: ${analysis.appRoot.childCount}`);
      console.log("  First-level children:");
      analysis.appRoot.firstLevelChildren.forEach((c, i) => {
        console.log(`    ${i + 1}. <${c.tag}> id="${c.id}" class="${c.className}"`);
      });
    }

    if (analysis.potentialMatchElements.length > 0) {
      console.log("\n📌 Elements with Data Attributes:");
      analysis.potentialMatchElements.forEach((e, i) => {
        console.log(`  ${i + 1}. <${e.tag}> attrs=${JSON.stringify(e.dataAttrs)}`);
        console.log(`     Preview: ${e.preview}`);
      });
    }

    // Save full analysis as JSON
    fs.writeFileSync("scripts/htgsports_analysis.json", JSON.stringify(analysis, null, 2));
    console.log("\n✅ Full analysis saved to: scripts/htgsports_analysis.json");

    // Take a screenshot
    await page.screenshot({ path: "scripts/htgsports_screenshot.png", fullPage: true });
    console.log("✅ Screenshot saved to: scripts/htgsports_screenshot.png");

  } finally {
    await browser.close();
  }

  console.log("\n" + "=".repeat(60));
  console.log("📋 NEXT STEPS:");
  console.log("=".repeat(60));
  console.log("1. Open scripts/htgsports_dom_dump.html in browser");
  console.log("2. Use DevTools to inspect the match/schedule elements");
  console.log("3. Identify correct selectors based on the structure");
  console.log("4. Update scrapeHTGSports.js with proper parsing logic");
}

main().catch(error => {
  console.error("❌ FATAL:", error.message);
  process.exit(1);
});
