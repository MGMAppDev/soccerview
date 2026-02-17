/**
 * Session 104: Probe Squadi API to verify endpoints work.
 * Quick test before full scrape.
 */

const AR_ORG_KEY = '3ec85864-ce92-4838-b407-1009438aafb0';
const BASE_URL = 'https://api.us.squadi.com/livescores';

async function main() {
  console.log('=== Squadi API Probe ===\n');

  // 1. Test competitions endpoint
  console.log('1. Fetching competitions...');
  const compResponse = await fetch(
    `${BASE_URL}/competitions/list?organisationUniqueKey=${AR_ORG_KEY}`,
    { headers: { 'Accept': 'application/json' } }
  );

  if (!compResponse.ok) {
    console.error(`   FAILED: HTTP ${compResponse.status}`);
    return;
  }

  const competitions = await compResponse.json();
  console.log(`   Found ${competitions.length} competitions:`);
  for (const c of competitions) {
    const status = c.statusRefId === 2 ? 'ACTIVE' : c.statusRefId === 3 ? 'COMPLETED' : `status=${c.statusRefId}`;
    console.log(`   - [${c.id}] ${c.name} (${status}) key=${c.uniqueKey}`);
  }

  // 2. Test divisions for ACSL Fall 2025 (id: 143)
  console.log('\n2. Fetching ACSL Fall 2025 divisions (competitionId=143)...');
  const divResponse = await fetch(
    `${BASE_URL}/division?competitionId=143`,
    { headers: { 'Accept': 'application/json' } }
  );

  if (!divResponse.ok) {
    console.error(`   FAILED: HTTP ${divResponse.status}`);
    return;
  }

  const divisions = await divResponse.json();
  console.log(`   Found ${divisions.length} divisions:`);
  for (const d of divisions) {
    console.log(`   - [${d.id}] ${d.name || d.divisionName}`);
  }

  // 3. Test matches for first division
  if (divisions.length > 0) {
    const firstDiv = divisions[0];
    const divId = firstDiv.id;
    const divName = firstDiv.name || firstDiv.divisionName;
    console.log(`\n3. Fetching matches for first division: ${divName} (ID: ${divId})...`);

    const matchResponse = await fetch(
      `${BASE_URL}/round/matches?competitionId=143&divisionId=${divId}`,
      { headers: { 'Accept': 'application/json' } }
    );

    if (!matchResponse.ok) {
      console.error(`   FAILED: HTTP ${matchResponse.status}`);
      return;
    }

    const matchData = await matchResponse.json();
    const rounds = matchData.rounds || [];
    let totalMatches = 0;

    for (const round of rounds) {
      const matches = round.matches || [];
      totalMatches += matches.length;

      // Show first match as sample
      if (matches.length > 0 && totalMatches === matches.length) {
        const m = matches[0];
        console.log(`\n   Sample match:`);
        console.log(`   ID: ${m.id}`);
        console.log(`   ${m.team1?.name} vs ${m.team2?.name}`);
        console.log(`   Score: ${m.team1Score} - ${m.team2Score}`);
        console.log(`   Date: ${m.startTime}`);
        console.log(`   Status: ${m.matchStatus}`);
        console.log(`   Venue: ${m.venueCourt?.venue?.name || m.venueCourt?.name || 'N/A'}`);
        console.log(`   Team1 ID: ${m.team1Id}, Team2 ID: ${m.team2Id}`);
      }
    }

    console.log(`\n   Total matches in division: ${totalMatches} across ${rounds.length} rounds`);
  }

  // 4. Quick count for all competitions
  console.log('\n4. Quick match count across key competitions...');
  const targetComps = [
    { id: 143, name: 'ACSL Fall 2025' },
    { id: 228, name: 'ACSL Spring 2026' },
    { id: 163, name: 'NWAL Fall 2025' },
    { id: 229, name: 'NWAL Spring 2026' },
    { id: 240, name: 'CAL Spring 2026' },
    { id: 203, name: 'AR State Champs Fall 2025' },
  ];

  let grandTotal = 0;
  for (const comp of targetComps) {
    const divResp = await fetch(`${BASE_URL}/division?competitionId=${comp.id}`);
    const divs = await divResp.json();
    let compTotal = 0;

    for (const d of divs) {
      const mResp = await fetch(`${BASE_URL}/round/matches?competitionId=${comp.id}&divisionId=${d.id}`);
      const mData = await mResp.json();
      for (const r of (mData.rounds || [])) {
        compTotal += (r.matches || []).length;
      }
    }

    console.log(`   ${comp.name}: ${divs.length} divisions, ${compTotal} matches`);
    grandTotal += compTotal;
  }

  console.log(`\n   GRAND TOTAL: ${grandTotal} matches across ${targetComps.length} competitions`);
}

main().catch(err => { console.error(err); process.exit(1); });
