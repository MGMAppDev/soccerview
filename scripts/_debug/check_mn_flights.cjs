#!/usr/bin/env node
/**
 * Check MN Fall 2025 accepted_list to see ALL available flights
 */
const https = require('https');
const cheerio = require('cheerio');

const url = 'https://mnyouth.sportsaffinity.com/tour/public/info/accepted_list.asp?sessionguid=&tournamentguid=49165B3E-8218-4FDF-9F4F-7E726C932B5A';

https.get(url, {
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36' }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const $ = cheerio.load(data);

    // Count all links with flightguid
    const flightLinks = $('a[href*="flightguid"]');
    console.log('Total flight links found:', flightLinks.length);

    // Get unique flight GUIDs
    const guids = new Set();
    const flights = [];
    flightLinks.each((_, a) => {
      const href = $(a).attr('href') || '';
      const m = href.match(/flightguid=([A-F0-9-]+)/i);
      const age = href.match(/agecode=([A-Z]\d+)/i);
      if (m) {
        const guid = m[1].toUpperCase();
        if (!guids.has(guid)) {
          guids.add(guid);
          flights.push({
            guid: guid.substring(0,8),
            agecode: age ? age[1] : 'none',
            text: $(a).text().trim().substring(0,50)
          });
        }
      }
    });

    console.log('Unique flight GUIDs:', guids.size);
    for (const f of flights) {
      console.log('  ' + f.agecode + ': ' + f.text + ' (' + f.guid + ')');
    }

    // Check page title
    console.log('\nPage title:', $('title').text().trim());

    // Check for agecodes
    const agecodes = data.match(/agecode=[A-Z]\d+/gi);
    if (agecodes) {
      const unique = [...new Set(agecodes)];
      console.log('\nAll agecodes on page:', unique.join(', '));
    }

    // Check total page size
    console.log('\nPage size:', data.length, 'bytes');

    // Look for team names to gauge data volume
    const teamCells = $('td').filter((_, el) => {
      const text = $(el).text().trim();
      return text.length > 5 && text.length < 80 && !text.includes('http');
    });
    console.log('TD cells found:', teamCells.length);
  });
}).on('error', e => console.error(e.message));
