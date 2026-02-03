/**
 * Find Heartland Soccer Calendar API
 * Searches for the team and captures all network requests
 */

import puppeteer from "puppeteer";

async function findApis() {
  console.log("🔍 Searching for Heartland Soccer API endpoints...\n");

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();

  const apiCalls = [];

  // Capture ALL requests
  page.on("request", req => {
    const url = req.url();
    const type = req.resourceType();
    if (type === "xhr" || type === "fetch" ||
        url.includes("api") || url.includes("json") ||
        url.includes("search") || url.includes("team")) {
      apiCalls.push({ url, method: req.method(), type });
    }
  });

  // Go to the calendar team search
  console.log("1. Loading calendar.heartlandsoccer.net/team/...");
  await page.goto("https://calendar.heartlandsoccer.net/team/", {
    waitUntil: "networkidle2",
    timeout: 30000
  });
  await new Promise(r => setTimeout(r, 3000));

  // Get current page HTML
  const html = await page.content();

  // Look for form elements
  const formInfo = await page.evaluate(() => {
    const forms = document.querySelectorAll("form");
    const inputs = document.querySelectorAll("input");
    const buttons = document.querySelectorAll("button, [type='submit']");

    return {
      formCount: forms.length,
      forms: Array.from(forms).map(f => ({
        action: f.action,
        method: f.method,
        id: f.id
      })),
      inputCount: inputs.length,
      inputs: Array.from(inputs).map(i => ({
        name: i.name,
        type: i.type,
        id: i.id,
        placeholder: i.placeholder
      })),
      buttonCount: buttons.length
    };
  });

  console.log("\n📋 Form elements found:");
  console.log(JSON.stringify(formInfo, null, 2));

  // Try to find the search input
  console.log("\n2. Looking for search functionality...");

  // Check for common search input patterns
  const searchSelectors = [
    "input[name='team_search[name]']",
    "#team_search_name",
    "input[placeholder*='team']",
    "input[type='search']",
    "input[type='text']",
    "#search",
    ".search-input"
  ];

  let searchInput = null;
  for (const selector of searchSelectors) {
    try {
      searchInput = await page.$(selector);
      if (searchInput) {
        console.log(`   Found search input with: ${selector}`);
        break;
      }
    } catch (e) {}
  }

  if (searchInput) {
    console.log("\n3. Performing search for 'Sporting'...");
    await searchInput.click({ clickCount: 3 });
    await searchInput.type("Sporting");

    // Try Enter key
    await page.keyboard.press("Enter");
    await new Promise(r => setTimeout(r, 5000));

    console.log("   URL after search:", page.url());

    // Get page content after search
    const resultsHtml = await page.content();

    // Look for team links
    const teamLinks = resultsHtml.match(/\/team\/events\/[\w-]+/g);
    const uniqueLinks = [...new Set(teamLinks || [])];
    console.log("\n   Team event links found:", uniqueLinks.length);
    uniqueLinks.slice(0, 10).forEach(l => console.log("     ", l));

    // If we found teams, try to get one
    if (uniqueLinks.length > 0) {
      const firstTeamId = uniqueLinks[0].split("/").pop();
      console.log(`\n4. Trying to fetch team ${firstTeamId} events...`);

      await page.goto(`https://calendar.heartlandsoccer.net${uniqueLinks[0]}`, {
        waitUntil: "networkidle2",
        timeout: 30000
      });
      await new Promise(r => setTimeout(r, 3000));

      // Look for schedule data
      const scheduleHtml = await page.content();

      // Check for ICS/calendar links
      const icsLinks = scheduleHtml.match(/webcal:\/\/[^\s"'<>]+|\.ics[^\s"'<>]*/gi);
      console.log("   ICS/Calendar links:", icsLinks || "none");

      // Check for JSON data
      const jsonBlocks = scheduleHtml.match(/\{[^}]+events[^}]+\}/gi);
      console.log("   JSON data patterns:", jsonBlocks?.length || 0);
    }
  } else {
    console.log("   ❌ No search input found!");
  }

  // Print all API calls captured
  console.log("\n\n📡 Network requests captured:");
  apiCalls.forEach(c => {
    console.log(`   ${c.type.toUpperCase().padEnd(6)} ${c.method.padEnd(5)} ${c.url.substring(0, 120)}`);
  });

  // Look for interesting patterns in the page
  console.log("\n\n🔎 Looking for API patterns in page source...");
  const apiPatterns = html.match(/["']https?:\/\/[^"']*api[^"']*["']/gi);
  const fetchPatterns = html.match(/fetch\s*\(\s*["'][^"']+["']/gi);
  const xhrPatterns = html.match(/\.ajax\s*\(\s*\{[^}]*url[^}]+\}/gi);

  console.log("   API URL patterns:", apiPatterns?.slice(0, 5) || "none");
  console.log("   Fetch calls:", fetchPatterns?.slice(0, 5) || "none");

  await browser.close();
  console.log("\n✅ Done");
}

findApis().catch(e => {
  console.error("❌ Error:", e);
  process.exit(1);
});
