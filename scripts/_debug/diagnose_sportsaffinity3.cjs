/**
 * Explore the old ASP.NET SportsAffinity system for Georgia Soccer.
 * Find schedule/results pages (not just accepted_list).
 */
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

  // Fall 2025 tournament (most recent with data)
  const tournGuid = 'E7A6731D-D5FF-41B4-9C3C-300ECEE69150';
  const baseUrl = 'https://gs.sportsaffinity.com';

  // Step 1: Navigate to the accepted list page to establish session
  console.log('1. Opening Fall 2025 accepted list...');
  const acceptedUrl = `${baseUrl}/tour/public/info/accepted_list.asp?&dropsession=true&Tournamentguid=${tournGuid}`;
  await page.goto(acceptedUrl, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));

  const pageInfo = await page.evaluate(() => ({
    title: document.title,
    bodyText: document.body.innerText.substring(0, 500),
    links: Array.from(document.querySelectorAll('a')).map(a => ({
      href: a.getAttribute('href') || '',
      text: a.textContent.trim().substring(0, 40),
    })).filter(l => l.href && !l.href.startsWith('javascript') && !l.href.includes('javascript')),
  }));

  console.log('Title:', pageInfo.title);
  console.log('Body preview:', pageInfo.bodyText.substring(0, 300));
  console.log('\nAll navigation links:');
  pageInfo.links.forEach(l => {
    if (l.href.includes('schedule') || l.href.includes('result') || l.href.includes('score') ||
      l.href.includes('standing') || l.href.includes('bracket') || l.href.includes('division') ||
      l.href.includes('flight') || l.href.includes('games') || l.href.includes('match') ||
      l.href.includes('.asp')) {
      console.log(`  📋 ${l.text}: ${l.href}`);
    }
  });

  // Step 2: Try common SportsAffinity schedule URL patterns
  const urlPatterns = [
    `/tour/public/info/schedule.asp?Tournamentguid=${tournGuid}`,
    `/tour/public/info/schedule.asp?sessionguid=&Tournamentguid=${tournGuid}`,
    `/tour/public/info/results.asp?Tournamentguid=${tournGuid}`,
    `/tour/public/info/schedulemaster.asp?Tournamentguid=${tournGuid}`,
    `/tour/public/info/gamedetails.asp?Tournamentguid=${tournGuid}`,
    `/tour/public/info/brackets.asp?Tournamentguid=${tournGuid}`,
    `/tour/public/info/standings.asp?Tournamentguid=${tournGuid}`,
    `/tour/public/info/games.asp?Tournamentguid=${tournGuid}`,
  ];

  console.log('\n2. Testing URL patterns...');
  for (const urlPath of urlPatterns) {
    try {
      const resp = await page.goto(`${baseUrl}${urlPath}`, { waitUntil: 'networkidle2', timeout: 15000 });
      const status = resp.status();
      const bodyLen = await page.evaluate(() => document.body.innerHTML.length);
      const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 200));
      const hasData = bodyLen > 1000 && !bodyText.includes('Error') && !bodyText.includes('not found');
      console.log(`  ${hasData ? '✅' : '❌'} ${status} ${urlPath.substring(0, 60)} | ${bodyLen} chars | ${bodyText.substring(0, 80)}`);
    } catch (e) {
      console.log(`  ❌ ${urlPath.substring(0, 60)} | ${e.message.substring(0, 50)}`);
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  // Step 3: Look for schedule links from within the tournament navigation
  console.log('\n3. Navigating tournament pages for schedule links...');
  await page.goto(acceptedUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  // Find all navigation items
  const navInfo = await page.evaluate(() => {
    const allLinks = Array.from(document.querySelectorAll('a, [onclick]'));
    const results = [];
    allLinks.forEach(el => {
      const href = el.getAttribute('href') || '';
      const onclick = el.getAttribute('onclick') || '';
      const text = el.textContent.trim().substring(0, 40);
      if (href.includes('.asp') || onclick.includes('.asp') || onclick.includes('schedule') ||
        text.toLowerCase().includes('schedule') || text.toLowerCase().includes('result') ||
        text.toLowerCase().includes('standing') || text.toLowerCase().includes('bracket') ||
        text.toLowerCase().includes('game') || text.toLowerCase().includes('division')) {
        results.push({ text, href: href.substring(0, 100), onclick: onclick.substring(0, 100) });
      }
    });
    return results;
  });

  console.log('Found links/buttons:');
  navInfo.forEach(n => {
    console.log(`  "${n.text}" → href="${n.href}" onclick="${n.onclick}"`);
  });

  // Step 4: Also try the Spring 2025 season-specific subdomain
  console.log('\n4. Trying Spring 2025 season subdomain...');
  const spr25Guid = '6F94BCCC-EAAD-4369-8598-ECDF00068393';
  const spr25Base = 'https://gs-spr25acadathclrias.sportsaffinity.com';
  await page.goto(`${spr25Base}/tour/public/info/accepted_list.asp?sessionguid=&tournamentguid=${spr25Guid}`, {
    waitUntil: 'networkidle2', timeout: 30000,
  });
  await new Promise(r => setTimeout(r, 3000));

  const spr25Info = await page.evaluate(() => ({
    title: document.title,
    bodyText: document.body.innerText.substring(0, 300),
    links: Array.from(document.querySelectorAll('a')).map(a => ({
      href: a.getAttribute('href') || '',
      text: a.textContent.trim().substring(0, 40),
    })).filter(l => l.href.includes('.asp') || l.text.toLowerCase().includes('schedule') ||
      l.text.toLowerCase().includes('standing') || l.text.toLowerCase().includes('result')),
  }));

  console.log('Title:', spr25Info.title);
  console.log('Schedule links:');
  spr25Info.links.forEach(l => console.log(`  "${l.text}" → ${l.href}`));

  // Step 5: Try to find schedule directly
  const spr25SchedUrls = [
    `${spr25Base}/tour/public/info/schedule.asp?sessionguid=&tournamentguid=${spr25Guid}`,
    `${spr25Base}/tour/public/info/schedule_games.asp?sessionguid=&tournamentguid=${spr25Guid}`,
    `${spr25Base}/tour/public/info/brackets.asp?sessionguid=&tournamentguid=${spr25Guid}`,
  ];

  console.log('\n5. Testing Spring 2025 schedule URLs...');
  for (const url of spr25SchedUrls) {
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
      const bodyLen = await page.evaluate(() => document.body.innerHTML.length);
      const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 200));
      console.log(`  ${bodyLen > 1000 ? '✅' : '❌'} ${url.split('?')[0].split('/').pop()} | ${bodyLen} chars | ${bodyText.substring(0, 80)}`);
    } catch (e) {
      console.log(`  ❌ ${url.split('/').pop()}: ${e.message.substring(0, 50)}`);
    }
  }

  await browser.close();
  console.log('\nDone.');
})().catch(e => { console.error(e.message); process.exit(1); });
