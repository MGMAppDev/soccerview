/**
 * Test the team ID extraction regex
 * Current: /^(\d+)\s+/ - Only matches pure numeric IDs
 * Fixed:   /^([A-Za-z0-9]+)\s+/ - Matches alphanumeric IDs
 */

const testCases = [
  '7115 SPORTING BV Pre-NAL 15',
  '711A Union KC Jr Elite B15',
  '7110 2015 F.C Horizon Green',
  '12AB Test Team',
  '123 Normal Team',
  'ABC No Number Team'
];

console.log('REGEX TEST: Current vs Fixed');
console.log('='.repeat(60));

testCases.forEach(name => {
  // Current (broken) regex - only digits
  const currentMatch = name.match(/^(\d+)\s+/);
  const currentId = currentMatch ? currentMatch[1] : null;

  // Fixed regex - alphanumeric
  const fixedMatch = name.match(/^([A-Za-z0-9]+)\s+/);
  const fixedId = fixedMatch ? fixedMatch[1] : null;

  const status = currentId ? '✓' : (fixedId ? '⚠️ MISSED' : '✓');

  console.log(`Input: "${name}"`);
  console.log(`  Current regex (\\d+):        ${currentId || '❌ NULL (match skipped)'}`);
  console.log(`  Fixed regex ([A-Za-z0-9]+): ${fixedId || '❌ NULL'}`);
  console.log(`  Status: ${status}`);
  console.log('');
});

console.log('='.repeat(60));
console.log('CONCLUSION:');
console.log('The current regex FAILS on alphanumeric team IDs like "711A"');
console.log('This causes entire matches to be SKIPPED during scraping.');
console.log('');
console.log('Fix: Change /^(\\d+)\\s+/ to /^([A-Za-z0-9]+)\\s+/');
