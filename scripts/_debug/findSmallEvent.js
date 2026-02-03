// Find a small event for quick comparison testing
import * as cheerio from "cheerio";
import "dotenv/config";

const BASE_URL = "https://system.gotsport.com";
const TEST_EVENTS = [
  { id: "40183", name: "Spring Kickoff Classic 2025" },
  { id: "45118", name: "TFA Fall Ball Classic" },
  { id: "45792", name: "Fiesta Cup" },
];

async function countGroups(eventId) {
  const url = `${BASE_URL}/org_event/events/${eventId}`;
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  const html = await response.text();
  const $ = cheerio.load(html);

  const groups = new Set();
  $('a[href*="schedules?group="]').each((_, el) => {
    const href = $(el).attr("href");
    const match = href?.match(/group=(\d+)/);
    if (match) groups.add(match[1]);
  });

  return groups.size;
}

async function main() {
  console.log("Finding small events for testing...\n");

  for (const event of TEST_EVENTS) {
    const count = await countGroups(event.id);
    console.log(`${event.name} (${event.id}): ${count} groups`);
    await new Promise(r => setTimeout(r, 2000));
  }
}

main();
