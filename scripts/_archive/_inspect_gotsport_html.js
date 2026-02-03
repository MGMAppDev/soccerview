const fs = require('fs');

const html = fs.readFileSync('gotsport_debug.html','utf8');

// 1) script src tags
const scriptSrcs = [...html.matchAll(/<script[^>]+src=['"]([^'"]+)['"]/gi)].map(m=>m[1]);
console.log('--- SCRIPT SRCS ---');
console.log(scriptSrcs.join('\n') || '(none)');
console.log('count=', scriptSrcs.length);

// 2) endpoint-ish strings, including escaped
const hits = new Set();
const patterns = [
  /\\\/[^"'<> ]+/g,                            // escaped paths like \/api\/...
  /\/(api|graphql|schedules|schedule|org_event|events|matches)[^"'<> ]+/gi,
  /https?:\/\/[^"'<> ]+/gi
];

for (const re of patterns) {
  let m;
  while ((m = re.exec(html))) {
    const s = m[0].replace(/\\\//g,'/');
    if (/api|graphql|schedules|schedule|org_event|match/i.test(s)) hits.add(s);
  }
}

console.log('\n--- API/ENDPOINT HITS ---');
console.log([...hits].slice(0,200).join('\n') || '(none)');
console.log('count=', hits.size);
