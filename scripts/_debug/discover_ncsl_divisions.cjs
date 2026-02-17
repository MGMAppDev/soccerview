/**
 * Discover ALL NCSL division IDs by probing the .js endpoint range.
 * Demosphere division IDs are sequential within a season.
 * Known Fall 2025 ID: 115189283 (GU16 Division 3)
 * Strategy: Probe a wide range around the known ID to find all divisions.
 */

require('dotenv').config();

const ORG_ID = '80738';
const BASE = 'https://elements.demosphere-secure.com';
const CONCURRENCY = 10;

async function probe(seasonName, startId, endId) {
  const found = [];
  const totalProbes = endId - startId + 1;
  let checked = 0;

  // Batch probe with concurrency limit
  for (let batchStart = startId; batchStart <= endId; batchStart += CONCURRENCY) {
    const promises = [];
    for (let id = batchStart; id < batchStart + CONCURRENCY && id <= endId; id++) {
      const url = `${BASE}/${ORG_ID}/schedules/${seasonName}/${id}.js`;
      promises.push(
        fetch(url, { method: 'HEAD', headers: { 'User-Agent': 'Mozilla/5.0' } })
          .then(r => {
            if (r.ok) found.push(id);
            return r.ok;
          })
          .catch(() => false)
      );
    }
    await Promise.all(promises);
    checked += promises.length;
    if (checked % 100 === 0) {
      process.stdout.write(`\r  Probed ${checked}/${totalProbes} (found ${found.length})`);
    }
  }
  console.log(`\r  Probed ${totalProbes}/${totalProbes} (found ${found.length})`);
  return found.sort((a, b) => a - b);
}

async function getMatchCount(seasonName, divId) {
  try {
    const url = `${BASE}/${ORG_ID}/schedules/${seasonName}/${divId}.js`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) return 0;
    const text = await r.text();
    const data = JSON.parse(text);
    return Object.keys(data).length;
  } catch { return 0; }
}

async function main() {
  console.log('NCSL Division Discovery');
  console.log('=======================\n');

  // Fall 2025: Known ID 115189283 → probe range 115189100 - 115189500
  console.log('FALL 2025:');
  const fall2025 = await probe('Fall2025', 115189100, 115189500);
  console.log(`  Division IDs: [${fall2025.join(', ')}]`);

  // Get match counts for each
  console.log('\n  Match counts:');
  let totalMatches = 0;
  for (const divId of fall2025) {
    const count = await getMatchCount('Fall2025', divId);
    totalMatches += count;
    console.log(`    ${divId}: ${count} matches`);
  }
  console.log(`  TOTAL Fall 2025: ${totalMatches} matches across ${fall2025.length} divisions`);

  // Spring 2025: Known from search result 114346119 → probe range 114346000 - 114346400
  console.log('\nSPRING 2025:');
  const spring2025 = await probe('Spring2025', 114346000, 114346400);
  console.log(`  Division IDs: [${spring2025.join(', ')}]`);

  let springTotal = 0;
  if (spring2025.length > 0) {
    console.log('\n  Match counts:');
    for (const divId of spring2025) {
      const count = await getMatchCount('Spring2025', divId);
      springTotal += count;
      console.log(`    ${divId}: ${count} matches`);
    }
    console.log(`  TOTAL Spring 2025: ${springTotal} matches across ${spring2025.length} divisions`);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`GRAND TOTAL: ${totalMatches + springTotal} matches`);
  console.log(`Fall 2025 divisions: ${fall2025.length}`);
  console.log(`Spring 2025 divisions: ${spring2025.length}`);
  console.log(`\nDivision arrays for adapter config:`);
  console.log(`Fall2025: [${fall2025.map(d => `"${d}"`).join(', ')}]`);
  console.log(`Spring2025: [${spring2025.map(d => `"${d}"`).join(', ')}]`);
}

main().catch(console.error);
