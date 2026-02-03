const fs = require('fs');

const html = fs.readFileSync('gotsport_debug.html','utf8');
const lower = html.toLowerCase();

const needles = [
  'matches_export',
  'match_export',
  'export',
  'matches export'
];

console.log('len=', html.length);

for (const n of needles) {
  const idx = lower.indexOf(n);
  console.log('\nneedle=', n, 'idx=', idx);
  if (idx >= 0) {
    const snippet = html.slice(Math.max(0, idx - 400), idx + 800).replace(/\s+/g,' ');
    console.log(snippet);
  }
}

// also dump all hrefs that contain 'export'
const hrefs = [...html.matchAll(/href=['"]([^'"]+)['"]/gi)].map(m=>m[1]);
const exportHrefs = hrefs.filter(h => /export/i.test(h));
console.log('\n--- export hrefs ---');
console.log(exportHrefs.join('\n') || '(none)');
console.log('count=', exportHrefs.length);
