/**
 * Find Winter League schedule data on Heartland Soccer website
 */

import puppeteer from "puppeteer";

async function findWinterLeague() {
  console.log("🔍 Finding Heartland Winter League schedule data...\n");

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
  const page = await browser.newPage();

  // Capture all XHR/fetch requests
  const apiCalls = [];
  page.on("request", req => {
    const url = req.url();
    if (req.resourceType() === "xhr" || req.resourceType() === "fetch" ||
        url.includes("api") || url.includes("schedule") || url.includes("team")) {
      apiCalls.push({ url, method: req.method() });
    }
  });

  // Check Winter League page
  console.log("1. Checking Winter League page...");
  await page.goto("https://www.heartlandsoccer.net/league/winter-league/", {
    waitUntil: "networkidle2",
    timeout: 30000
  });
  await new Promise(r => setTimeout(r, 3000));

  // Get all text content
  const winterContent = await page.evaluate(() => {
    const main = document.querySelector("main, #main-content, .main-content, article, .entry-content");
    return main ? main.innerText : document.body.innerText.substring(0, 5000);
  });
  console.log("\nWinter League page content:");
  console.log(winterContent.substring(0, 2000));

  // Get all links
  const winterLinks = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("a[href]"))
      .map(a => ({ text: a.innerText.trim(), href: a.href }))
      .filter(l => l.text.length > 0 && l.text.length < 100);
  });
  console.log("\nLinks found:");
  winterLinks.filter(l =>
    l.href.includes("schedule") || l.href.includes("team") ||
    l.href.includes("calendar") || l.href.includes("registration") ||
    l.href.includes("affinity") || l.href.includes("bluesombrero") ||
    l.href.includes("gotsport") || l.text.toLowerCase().includes("schedule")
  ).forEach(l => console.log(`  "${l.text}" -> ${l.href}`));

  // Check League Schedules page
  console.log("\n\n2. Checking League Schedules page...");
  await page.goto("https://www.heartlandsoccer.net/league/league-schedules/", {
    waitUntil: "networkidle2",
    timeout: 30000
  });
  await new Promise(r => setTimeout(r, 3000));

  const scheduleContent = await page.evaluate(() => {
    const main = document.querySelector("main, #main-content, .main-content, article, .entry-content");
    return main ? main.innerText : document.body.innerText.substring(0, 5000);
  });
  console.log("\nLeague Schedules page content:");
  console.log(scheduleContent.substring(0, 2000));

  // Get all iframes (often schedule systems embed via iframes)
  const iframes = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("iframe")).map(f => f.src);
  });
  console.log("\nIframes found:", iframes);

  // Look for schedule links
  const scheduleLinks = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("a[href]"))
      .map(a => ({ text: a.innerText.trim(), href: a.href }))
      .filter(l =>
        l.href.includes("schedule") || l.href.includes("team") ||
        l.href.includes("calendar") || l.href.includes("affinity") ||
        l.href.includes("bluesombrero") || l.href.includes("gotsport") ||
        l.href.includes("stack") || l.href.includes("demosphere") ||
        l.text.toLowerCase().includes("schedule") ||
        l.text.toLowerCase().includes("team")
      );
  });
  console.log("\nSchedule-related links:");
  scheduleLinks.forEach(l => console.log(`  "${l.text}" -> ${l.href}`));

  // Check Score & Standings page
  console.log("\n\n3. Checking Score & Standings page...");
  await page.goto("https://www.heartlandsoccer.net/league/score-standings/", {
    waitUntil: "networkidle2",
    timeout: 30000
  });
  await new Promise(r => setTimeout(r, 3000));

  const scoreContent = await page.evaluate(() => {
    const main = document.querySelector("main, #main-content, .main-content, article, .entry-content");
    return main ? main.innerText : document.body.innerText.substring(0, 5000);
  });
  console.log("\nScore & Standings page content:");
  console.log(scoreContent.substring(0, 2000));

  // Print all API calls
  console.log("\n\n📡 API/Data calls captured:");
  apiCalls.forEach(c => console.log(`  ${c.method} ${c.url}`));

  await browser.close();
  console.log("\n✅ Done");
}

findWinterLeague().catch(e => {
  console.error("Error:", e);
  process.exit(1);
});
