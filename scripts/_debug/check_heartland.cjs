const fetch = require('node-fetch');
const cheerio = require('cheerio');

async function test() {
  const url = 'https://heartlandsoccer.net/reports/';
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const html = await response.text();
  const $ = cheerio.load(html);

  console.log('=== All links on reports page ===');
  const links = [];
  $('a').each(function() {
    const href = $(this).attr('href') || '';
    const text = $(this).text().trim().substring(0, 80);
    if (href.includes('cgi') || href.includes('result') || href.includes('standing') || href.includes('schedule')) {
      links.push({ href, text });
    }
  });

  links.forEach(l => console.log(l.href, '-', l.text));

  // Also search for any form or iframe
  console.log('\n=== Forms ===');
  $('form').each(function() {
    console.log('Form action:', $(this).attr('action'));
  });

  console.log('\n=== Iframes ===');
  $('iframe').each(function() {
    console.log('Iframe src:', $(this).attr('src'));
  });
}

test().catch(e => console.error('Error:', e.message));
