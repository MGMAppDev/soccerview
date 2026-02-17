/**
 * Probe GotSport event page to find group names for standings divisions
 */
const https = require('https');

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    };
    https.get(url, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchPage(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  // 1. Check the event page for NAL 45671
  console.log('=== EVENT PAGE (45671) ===');
  const eventHtml = await fetchPage('https://system.gotsport.com/org_event/events/45671');

  // Look for tab/navigation with group names
  // GotSport uses tabs for "Standings", "Schedule", "Results"
  // Groups might be in a sidebar or dropdown
  const linkRegex = /<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  const groupLinks = [];
  while ((m = linkRegex.exec(eventHtml)) !== null) {
    const href = m[1];
    const text = m[2].replace(/<[^>]*>/g, '').trim();
    if (href.includes('group=') && text && text !== 'Schedule') {
      groupLinks.push({ href, text });
    }
  }
  console.log('Group links with non-Schedule text:', groupLinks.length);
  groupLinks.slice(0, 10).forEach(g => console.log('  ' + g.href + ' => ' + g.text));

  // Look for all links with group= that have descriptive text
  const allGroupLinks = [];
  const linkRegex2 = /<a[^>]*href="[^"]*group=(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  while ((m = linkRegex2.exec(eventHtml)) !== null) {
    const text = m[2].replace(/<[^>]*>/g, '').trim();
    allGroupLinks.push({ groupId: m[1], text });
  }
  console.log('\nAll group= links:', allGroupLinks.length);
  // Show unique texts
  const uniqueTexts = [...new Set(allGroupLinks.map(g => g.text))];
  console.log('Unique link texts:', uniqueTexts);

  // 2. Check a state league event (NISL NPL 44630) which might have better division names
  console.log('\n=== EVENT PAGE (NISL NPL 44630) ===');
  const nislHtml = await fetchPage('https://system.gotsport.com/org_event/events/44630');

  const nislGroupLinks = [];
  const linkRegex3 = /<a[^>]*href="[^"]*group=(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  while ((m = linkRegex3.exec(nislHtml)) !== null) {
    const text = m[2].replace(/<[^>]*>/g, '').trim();
    nislGroupLinks.push({ groupId: m[1], text });
  }
  console.log('All group= links:', nislGroupLinks.length);
  const nislUniqueTexts = [...new Set(nislGroupLinks.map(g => g.text))];
  console.log('Unique link texts:', nislUniqueTexts);

  // 3. Check the results page for NISL NPL to see bracket names
  console.log('\n=== RESULTS PAGE (NISL NPL 44630, first group) ===');
  if (nislGroupLinks.length > 0) {
    const firstGroupId = nislGroupLinks[0].groupId;
    const resultsHtml = await fetchPage(`https://system.gotsport.com/org_event/events/44630/results?group=${firstGroupId}`);

    // Find bracket/collapse headers
    const bracketRegex = /href="#collapse-\d+"[^>]*>([\s\S]*?)<\/a>/g;
    while ((m = bracketRegex.exec(resultsHtml)) !== null) {
      console.log('Bracket header:', m[1].replace(/<[^>]*>/g, '').trim());
    }

    // Find h3/h4 headings
    const headingRegex = /<h[1-5][^>]*>([\s\S]*?)<\/h[1-5]>/g;
    while ((m = headingRegex.exec(resultsHtml)) !== null) {
      const text = m[1].replace(/<[^>]*>/g, '').trim();
      if (text) console.log('Heading:', text.substring(0, 100));
    }

    // Find the area around the group name
    const groupNameIdx = resultsHtml.indexOf('panel-heading');
    if (groupNameIdx > -1) {
      console.log('Panel heading area:', resultsHtml.substring(groupNameIdx, groupNameIdx + 300).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
    }

    // Look for the group name in a heading or title
    const titleMatch = resultsHtml.match(/<title>(.*?)<\/title>/);
    if (titleMatch) console.log('Page title:', titleMatch[1].trim());

    // Check for division name between panels/cards
    const divNameRegex = /class=['"].*?panel-title['"]\s*>([\s\S]*?)<\//g;
    while ((m = divNameRegex.exec(resultsHtml)) !== null) {
      console.log('Panel title:', m[1].replace(/<[^>]*>/g, '').trim());
    }
  }

  // 4. Try the schedules page for group 399780 (NAL) to get the division name
  console.log('\n=== SCHEDULE PAGE (NAL 45671 group 399780) ===');
  const schedHtml = await fetchPage('https://system.gotsport.com/org_event/events/45671/schedules?group=399780');
  const titleMatch = schedHtml.match(/<title>(.*?)<\/title>/);
  if (titleMatch) console.log('Page title:', titleMatch[1].trim());

  // Check for group/division name in headings
  const headingRegex2 = /<h[1-5][^>]*>([\s\S]*?)<\/h[1-5]>/g;
  while ((m = headingRegex2.exec(schedHtml)) !== null) {
    const text = m[1].replace(/<[^>]*>/g, '').trim();
    if (text) console.log('Heading:', text.substring(0, 150));
  }

  // Look for group name near the top of content
  const contentStart = schedHtml.indexOf('class="container"');
  if (contentStart > -1) {
    const snippet = schedHtml.substring(contentStart, contentStart + 500).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    console.log('Content start:', snippet.substring(0, 300));
  }
}

main().catch(e => console.error(e));
