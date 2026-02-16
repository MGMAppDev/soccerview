/**
 * Diagnostic 2: Dump raw HTML from PA-W GLC to understand page structure.
 */
require("dotenv").config();
const cheerio = require("cheerio");

const TOURNAMENT_GUID = "A960EA85-CC2A-4797-B56B-A489591B0CD4";
const SUBDOMAIN = "pawest";
const BASE_URL = `https://${SUBDOMAIN}.sportsaffinity.com/tour/public/info`;

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });
  console.log(`HTTP ${res.status} ${res.statusText}`);
  console.log(`Content-Type: ${res.headers.get("content-type")}`);
  console.log(`URL after redirect: ${res.url}`);
  return res.text();
}

async function main() {
  console.log("=== PA-W GLC Raw HTML Dump ===\n");

  const acceptedUrl = `${BASE_URL}/accepted_list.asp?sessionguid=&tournamentguid=${TOURNAMENT_GUID}`;
  console.log(`Fetching: ${acceptedUrl}\n`);

  const html = await fetchPage(acceptedUrl);

  // Print first 3000 chars
  console.log("\n=== First 3000 chars ===");
  console.log(html.substring(0, 3000));

  // Check for common patterns
  console.log("\n=== Pattern search ===");
  const patterns = [
    { name: "flightguid", regex: /flightguid/gi },
    { name: "sessionguid", regex: /sessionguid/gi },
    { name: "schedule", regex: /schedule/gi },
    { name: "accepted", regex: /accepted/gi },
    { name: "login", regex: /login/gi },
    { name: "password", regex: /password/gi },
    { name: "redirect", regex: /redirect/gi },
    { name: "iframe", regex: /<iframe/gi },
    { name: "angular", regex: /angular|ng-app|ng-/gi },
    { name: "react", regex: /react|__NEXT|_app/gi },
    { name: "GLC", regex: /GLC/gi },
    { name: "NAL", regex: /NAL/gi },
    { name: "flight", regex: /flight/gi },
    { name: "division", regex: /division/gi },
    { name: "age", regex: /\bage\b/gi },
    { name: "U-number (U12 etc)", regex: /U-?\d{1,2}\b/gi },
    { name: "team", regex: /\bteam\b/gi },
    { name: "tournamentguid in content", regex: /tournamentguid/gi },
    { name: "select/option", regex: /<select|<option/gi },
    { name: "JavaScript embed", regex: /<script/gi },
  ];
  for (const pat of patterns) {
    const matches = html.match(pat.regex);
    console.log(`  ${pat.name}: ${matches ? matches.length : 0} occurrences`);
  }

  // Look for all links
  const $ = cheerio.load(html);
  console.log("\n=== All <a> tags ===");
  const allAs = [];
  $("a").each((_, a) => {
    const href = $(a).attr("href") || "";
    const text = $(a).text().trim();
    if (href && href !== "#") allAs.push({ href: href.substring(0, 120), text: text.substring(0, 80) });
  });
  console.log(`  Total links: ${allAs.length}`);
  allAs.slice(0, 30).forEach((l, i) => {
    console.log(`    ${i}: "${l.text}" → ${l.href}`);
  });

  // Look for all select/option elements
  console.log("\n=== Select/Option elements ===");
  $("select").each((i, sel) => {
    const name = $(sel).attr("name") || $(sel).attr("id") || "";
    const options = [];
    $(sel).find("option").each((_, opt) => {
      options.push({ value: $(opt).attr("value") || "", text: $(opt).text().trim() });
    });
    console.log(`  Select "${name}": ${options.length} options`);
    options.slice(0, 10).forEach(o => console.log(`    value="${o.value}" text="${o.text}"`));
  });

  // Look for form elements
  console.log("\n=== Forms ===");
  $("form").each((i, form) => {
    console.log(`  Form ${i}: action="${$(form).attr("action")}" method="${$(form).attr("method")}"`);
  });

  // Print any script tags that might contain data
  console.log("\n=== Script tags (first 500 chars each) ===");
  $("script").each((i, scr) => {
    const src = $(scr).attr("src") || "";
    const content = $(scr).text().trim();
    if (src) {
      console.log(`  Script ${i}: src="${src}"`);
    } else if (content) {
      console.log(`  Script ${i} (inline, ${content.length} chars):`);
      console.log(`    ${content.substring(0, 500)}`);
    }
  });

  // Check for iframes
  console.log("\n=== Iframes ===");
  $("iframe").each((i, frame) => {
    console.log(`  Iframe ${i}: src="${$(frame).attr("src")}"`);
  });
}

main().catch(console.error);
