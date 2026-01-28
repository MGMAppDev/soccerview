/**
 * Heartland Standings Page Diagnostic
 * ====================================
 *
 * Inspects the Score-Standings page to find the data source for results.
 *
 * Usage: node scripts/diagnoseHeartlandStandings.js
 */

import puppeteer from "puppeteer";
import fs from "fs";

const STANDINGS_URL = "https://www.heartlandsoccer.net/league/score-standings/";

async function main() {
  console.log("🔍 Heartland Standings Page Diagnostic");
  console.log("======================================");
  console.log(`URL: ${STANDINGS_URL}\n`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();

    // Intercept network requests to find API calls
    const apiCalls = [];
    page.on("request", (request) => {
      const url = request.url();
      if (
        url.includes("api") ||
        url.includes("json") ||
        url.includes("standings") ||
        url.includes("scores") ||
        url.includes("demosphere") ||
        url.includes("affinity") ||
        url.includes("bluesombrero") ||
        url.includes("gotsport") ||
        url.includes("stack")
      ) {
        apiCalls.push({
          url: url,
          method: request.method(),
          resourceType: request.resourceType(),
        });
      }
    });

    console.log("🌐 Loading standings page...");
    await page.goto(STANDINGS_URL, { waitUntil: "networkidle2", timeout: 60000 });
    await new Promise((r) => setTimeout(r, 5000)); // Wait for dynamic content

    // Get the full HTML
    const html = await page.content();
    fs.writeFileSync("scripts/heartland_standings_dump.html", html);
    console.log(`\n✅ HTML saved to: scripts/heartland_standings_dump.html (${html.length} bytes)`);

    // Log API calls
    console.log("\n📡 API/Data Calls Intercepted:", apiCalls.length);
    apiCalls.forEach((call, i) => {
      console.log(`  ${i + 1}. [${call.method}] ${call.resourceType}: ${call.url.substring(0, 150)}`);
    });

    // Analyze the page
    const analysis = await page.evaluate(() => {
      const result = {
        title: document.title,
        iframes: [],
        externalScripts: [],
        forms: [],
        buttons: [],
        links: [],
        selectDropdowns: [],
        tables: [],
        divContent: "",
      };

      // Find iframes (often used for embedded standings)
      document.querySelectorAll("iframe").forEach((iframe) => {
        result.iframes.push({
          src: iframe.src,
          id: iframe.id,
          name: iframe.name,
          classes: iframe.className,
        });
      });

      // Find external scripts
      document.querySelectorAll("script[src]").forEach((script) => {
        const src = script.src;
        if (
          src.includes("demosphere") ||
          src.includes("affinity") ||
          src.includes("bluesombrero") ||
          src.includes("stack") ||
          src.includes("gotsport") ||
          src.includes("standings") ||
          src.includes("league")
        ) {
          result.externalScripts.push(src);
        }
      });

      // Find forms
      document.querySelectorAll("form").forEach((form) => {
        result.forms.push({
          action: form.action,
          method: form.method,
          id: form.id,
        });
      });

      // Find dropdowns (often used for division/age selection)
      document.querySelectorAll("select").forEach((select) => {
        const options = Array.from(select.options).map((o) => ({
          value: o.value,
          text: o.text.trim(),
        }));
        result.selectDropdowns.push({
          id: select.id,
          name: select.name,
          classes: select.className,
          optionCount: options.length,
          sampleOptions: options.slice(0, 10),
        });
      });

      // Find tables (standings tables)
      document.querySelectorAll("table").forEach((table, i) => {
        const rows = table.querySelectorAll("tr");
        if (rows.length > 0) {
          const headers = Array.from(rows[0].querySelectorAll("th, td")).map(
            (c) => c.innerText.trim()
          );
          result.tables.push({
            index: i,
            classes: table.className,
            id: table.id,
            rowCount: rows.length,
            headers: headers.slice(0, 10),
          });
        }
      });

      // Find buttons
      document.querySelectorAll("button, input[type=button], input[type=submit]").forEach((btn) => {
        result.buttons.push({
          text: btn.innerText || btn.value,
          type: btn.type,
          id: btn.id,
          onclick: btn.getAttribute("onclick"),
        });
      });

      // Find links with keywords
      document.querySelectorAll("a").forEach((link) => {
        const href = link.href || "";
        const text = link.innerText.trim();
        if (
          href.includes("standings") ||
          href.includes("scores") ||
          href.includes("results") ||
          href.includes("division") ||
          href.includes("demosphere") ||
          href.includes("affinity") ||
          text.toLowerCase().includes("standings") ||
          text.toLowerCase().includes("scores")
        ) {
          result.links.push({
            href: href.substring(0, 200),
            text: text.substring(0, 100),
          });
        }
      });

      // Get main content area text
      const mainContent = document.querySelector(".et_pb_section") || document.querySelector("main") || document.body;
      result.divContent = mainContent ? mainContent.innerText.substring(0, 3000) : "";

      return result;
    });

    // Print analysis
    console.log("\n📦 Page Title:", analysis.title);

    console.log("\n🖼️ Iframes Found:", analysis.iframes.length);
    analysis.iframes.forEach((iframe, i) => {
      console.log(`  ${i + 1}. src: ${iframe.src}`);
      console.log(`     id: ${iframe.id}, name: ${iframe.name}, classes: ${iframe.classes}`);
    });

    console.log("\n📜 External Scripts (relevant):", analysis.externalScripts.length);
    analysis.externalScripts.forEach((src, i) => {
      console.log(`  ${i + 1}. ${src}`);
    });

    console.log("\n📝 Forms Found:", analysis.forms.length);
    analysis.forms.forEach((form, i) => {
      console.log(`  ${i + 1}. action: ${form.action}, method: ${form.method}, id: ${form.id}`);
    });

    console.log("\n🔽 Select Dropdowns:", analysis.selectDropdowns.length);
    analysis.selectDropdowns.forEach((select, i) => {
      console.log(`  ${i + 1}. id: ${select.id}, name: ${select.name}, options: ${select.optionCount}`);
      if (select.sampleOptions.length > 0) {
        console.log(`     Sample options: ${select.sampleOptions.map((o) => o.text).join(", ")}`);
      }
    });

    console.log("\n📊 Tables Found:", analysis.tables.length);
    analysis.tables.forEach((table, i) => {
      console.log(`  ${i + 1}. rows: ${table.rowCount}, id: ${table.id}, classes: ${table.classes}`);
      console.log(`     Headers: ${table.headers.join(" | ")}`);
    });

    console.log("\n🔗 Relevant Links:", analysis.links.length);
    analysis.links.slice(0, 20).forEach((link, i) => {
      console.log(`  ${i + 1}. "${link.text}" -> ${link.href}`);
    });

    console.log("\n📄 Main Content Preview:");
    console.log(analysis.divContent.substring(0, 1500));

    // Save analysis
    fs.writeFileSync(
      "scripts/heartland_standings_analysis.json",
      JSON.stringify(analysis, null, 2)
    );
    console.log("\n✅ Analysis saved to: scripts/heartland_standings_analysis.json");

    // Screenshot
    await page.screenshot({
      path: "scripts/heartland_standings_screenshot.png",
      fullPage: true,
    });
    console.log("✅ Screenshot saved to: scripts/heartland_standings_screenshot.png");

  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("❌ FATAL:", error.message);
  process.exit(1);
});
