/**
 * Heartland Team Events Page Diagnostic
 * ======================================
 *
 * Inspects the /team/events/{id} page to understand the schedule structure.
 *
 * Usage: node scripts/diagnoseHeartlandTeamEvents.js
 */

import puppeteer from "puppeteer";
import fs from "fs";

const TEAM_EVENTS_URL = "https://calendar.heartlandsoccer.net/team/events/7927";

async function main() {
  console.log("🔍 Heartland Team Events Page Diagnostic");
  console.log("=========================================");
  console.log(`URL: ${TEAM_EVENTS_URL}\n`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();

    console.log("🌐 Loading team events page...");
    await page.goto(TEAM_EVENTS_URL, { waitUntil: "networkidle2", timeout: 60000 });
    await new Promise(r => setTimeout(r, 3000));

    // Get the full HTML
    const html = await page.content();
    fs.writeFileSync("scripts/heartland_team_events_dump.html", html);
    console.log(`\n✅ HTML saved to: scripts/heartland_team_events_dump.html (${html.length} bytes)`);

    // Analyze the page
    const analysis = await page.evaluate(() => {
      const result = {
        title: document.title,
        bodyText: document.body.innerText.substring(0, 3000),
        tables: [],
        lists: [],
        calendarLinks: [],
        eventCards: [],
      };

      // Find tables
      document.querySelectorAll("table").forEach((table, i) => {
        const rows = table.querySelectorAll("tr");
        const rowData = [];
        rows.forEach((row, ri) => {
          if (ri < 10) {
            const cells = Array.from(row.querySelectorAll("td, th"));
            rowData.push(cells.map(c => c.innerText.trim().substring(0, 100)));
          }
        });
        result.tables.push({
          index: i,
          classes: table.className,
          rowCount: rows.length,
          sampleRows: rowData,
        });
      });

      // Find list structures
      document.querySelectorAll("ul, ol").forEach((list, i) => {
        if (i < 5) {
          const items = Array.from(list.querySelectorAll("li")).slice(0, 10);
          result.lists.push({
            type: list.tagName.toLowerCase(),
            classes: list.className,
            items: items.map(item => item.innerText.trim().substring(0, 200)),
          });
        }
      });

      // Find calendar/ics links
      document.querySelectorAll("a").forEach(link => {
        const href = link.getAttribute("href") || "";
        if (href.includes("calendar") || href.includes("ics") || href.includes("webcal")) {
          result.calendarLinks.push({
            href: href,
            text: link.innerText.trim(),
          });
        }
      });

      // Find divs that might contain event data
      document.querySelectorAll("div.card, div.event, [class*='match'], [class*='game']").forEach((card, i) => {
        if (i < 10) {
          result.eventCards.push({
            classes: card.className,
            text: card.innerText.trim().substring(0, 300),
          });
        }
      });

      return result;
    });

    // Print analysis
    console.log("\n📦 Page Title:", analysis.title);

    console.log("\n📄 Body Text Preview:");
    console.log(analysis.bodyText);

    console.log("\n📊 Tables Found:", analysis.tables.length);
    analysis.tables.forEach((t, i) => {
      console.log(`\n  Table ${i + 1} (${t.rowCount} rows, class="${t.classes}"):`);
      t.sampleRows.forEach((row, ri) => {
        console.log(`    Row ${ri}: ${JSON.stringify(row)}`);
      });
    });

    console.log("\n📋 Lists Found:", analysis.lists.length);
    analysis.lists.forEach((l, i) => {
      console.log(`\n  List ${i + 1} (${l.type}, class="${l.classes}"):`);
      l.items.forEach((item, ii) => {
        console.log(`    ${ii + 1}. ${item.substring(0, 100)}`);
      });
    });

    console.log("\n📅 Calendar Links Found:", analysis.calendarLinks.length);
    analysis.calendarLinks.forEach((link, i) => {
      console.log(`  ${i + 1}. "${link.text}" -> ${link.href.substring(0, 100)}`);
    });

    console.log("\n🃏 Event Cards Found:", analysis.eventCards.length);
    analysis.eventCards.forEach((card, i) => {
      console.log(`  ${i + 1}. classes="${card.classes}"`);
      console.log(`     text: ${card.text.substring(0, 150)}...`);
    });

    // Save analysis
    fs.writeFileSync("scripts/heartland_team_events_analysis.json", JSON.stringify(analysis, null, 2));
    console.log("\n✅ Analysis saved to: scripts/heartland_team_events_analysis.json");

    // Screenshot
    await page.screenshot({ path: "scripts/heartland_team_events_screenshot.png", fullPage: true });
    console.log("✅ Screenshot saved to: scripts/heartland_team_events_screenshot.png");

  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error("❌ FATAL:", error.message);
  process.exit(1);
});
