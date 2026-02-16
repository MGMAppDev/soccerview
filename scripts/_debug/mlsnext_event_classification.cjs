require('dotenv').config();

// Simulate the event name processing
const eventName = "MLS NEXT 2025-26";
const LEAGUE_KEYWORDS = ['league', 'season', 'conference', 'division', 'premier', 'recreational'];
const TOURNAMENT_KEYWORDS = ['cup', 'classic', 'showcase', 'tournament', 'shootout', 'invitational', 'challenge', 'festival'];

const lowerName = eventName.toLowerCase();

console.log('Event Name:', eventName);
console.log('Lowercase:', lowerName);
console.log('\nLEAGUE_KEYWORDS check:');
for (const keyword of LEAGUE_KEYWORDS) {
  const match = lowerName.includes(keyword);
  console.log('  ' + keyword + ':', match);
}

console.log('\nTOURNAMENT_KEYWORDS check:');
for (const keyword of TOURNAMENT_KEYWORDS) {
  const match = lowerName.includes(keyword);
  console.log('  ' + keyword + ':', match);
}

// Date range check (from staging_games)
const startDate = new Date('2025-08-01');
const endDate = new Date('2026-07-31');
const daysDiff = (endDate - startDate) / (1000 * 60 * 60 * 24);

console.log('\nDate range check:');
console.log('  Start:', startDate.toISOString());
console.log('  End:', endDate.toISOString());
console.log('  Days diff:', daysDiff);
console.log('  <= 4 days (tournament)?', daysDiff <= 4);
console.log('  > 30 days (league)?', daysDiff > 30);

console.log('\nClassification result:');
let result;
for (const keyword of LEAGUE_KEYWORDS) {
  if (lowerName.includes(keyword)) {
    result = 'league';
    break;
  }
}
if (!result) {
  for (const keyword of TOURNAMENT_KEYWORDS) {
    if (lowerName.includes(keyword)) {
      result = 'tournament';
      break;
    }
  }
}
if (!result && daysDiff <= 4) result = 'tournament';
if (!result && daysDiff > 30) result = 'league';
if (!result) result = 'tournament';

console.log('  Final type:', result);
console.log('  Should be:', 'league (from adapter declaration)');
