/**
 * Compare Heartland Source Data vs Our Database
 * ==============================================
 *
 * Fetches actual Heartland CGI data and compares with our database
 * to identify missing matches, incorrect data, and duplicates.
 */

import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const TEAM_CODE = '7115';  // SPORTING BV Pre-NAL 15
const TEAM_NAME = 'SPORTING BV Pre-NAL 15';

async function fetchHeartlandMatches() {
  console.log('=== FETCHING SOURCE DATA FROM HEARTLAND ===\n');

  const url = 'https://heartlandsoccer.net/reports/cgi-jrb/subdiv_results.cgi?level=Premier&b_g=Boys&age=U-11&subdivison=1';
  const response = await fetch(url);
  const html = await response.text();
  const $ = cheerio.load(html);

  // Parse all matches involving our team
  const sourceMatches = [];

  // Find all rows that contain our team code
  $('tr').each((_, row) => {
    const text = $(row).text();
    if (text.includes(TEAM_CODE)) {
      const tds = $(row).find('td');
      if (tds.length >= 7) {
        // Parse: game#, time, home_team, home_score, away_team, away_score
        const gameNum = $(tds[0]).text().trim();
        const time = $(tds[1]).text().trim();
        const homeTeam = $(tds[2]).text().trim().replace(/^\d+\s*/, ''); // Remove team code
        const homeScore = parseInt($(tds[3]).text().trim()) || null;
        const awayTeam = $(tds[4]).text().trim().replace(/^\d+\s*/, '');
        const awayScore = parseInt($(tds[5]).text().trim()) || null;

        if (homeTeam.includes(TEAM_NAME) || awayTeam.includes(TEAM_NAME)) {
          sourceMatches.push({
            gameNum,
            time,
            homeTeam,
            homeScore,
            awayTeam,
            awayScore
          });
        }
      }
    }
  });

  console.log(`Found ${sourceMatches.length} matches from Heartland source:\n`);
  sourceMatches.forEach((m, i) => {
    console.log(`  ${i + 1}. Game #${m.gameNum} | ${m.homeTeam} ${m.homeScore}-${m.awayScore} ${m.awayTeam}`);
  });

  return sourceMatches;
}

async function fetchDatabaseMatches() {
  console.log('\n=== FETCHING DATABASE MATCHES ===\n');

  const { data: matches } = await supabase
    .from('match_results')
    .select('*')
    .or(`home_team_name.ilike.%${TEAM_NAME}%,away_team_name.ilike.%${TEAM_NAME}%`)
    .order('match_date', { ascending: true });

  // Deduplicate by unique match signature
  const seen = new Set();
  const uniqueMatches = [];
  matches?.forEach(m => {
    const sig = `${m.home_team_name}|${m.away_team_name}|${m.home_score}-${m.away_score}`;
    if (!seen.has(sig)) {
      seen.add(sig);
      uniqueMatches.push(m);
    }
  });

  console.log(`Total DB records: ${matches?.length || 0}`);
  console.log(`Unique matches: ${uniqueMatches.length}\n`);

  uniqueMatches.forEach((m, i) => {
    console.log(`  ${i + 1}. ${m.match_date} | ${m.home_team_name} ${m.home_score}-${m.away_score} ${m.away_team_name}`);
  });

  return { allMatches: matches, uniqueMatches };
}

async function compareData() {
  const sourceMatches = await fetchHeartlandMatches();
  const { uniqueMatches: dbMatches, allMatches } = await fetchDatabaseMatches();

  console.log('\n' + '='.repeat(70));
  console.log('COMPARISON SUMMARY');
  console.log('='.repeat(70));

  console.log(`\nSource (Heartland): ${sourceMatches.length} matches`);
  console.log(`Database (unique): ${dbMatches.length} matches`);
  console.log(`Database (total records): ${allMatches?.length || 0} (includes duplicates)`);

  // Check for matches in source but not in DB
  console.log('\n--- Matches in SOURCE but NOT in DATABASE ---');
  let missingCount = 0;
  sourceMatches.forEach(src => {
    const found = dbMatches.some(db =>
      (db.home_team_name?.includes(src.homeTeam) || src.homeTeam?.includes(db.home_team_name?.replace(/^\d+\s*/, ''))) &&
      db.home_score === src.homeScore &&
      db.away_score === src.awayScore
    );
    if (!found) {
      missingCount++;
      console.log(`  MISSING: ${src.homeTeam} ${src.homeScore}-${src.awayScore} ${src.awayTeam}`);
    }
  });
  if (missingCount === 0) console.log('  None - all source matches are in DB');

  // Check for matches in DB but not in source
  console.log('\n--- Matches in DATABASE but NOT in SOURCE ---');
  let extraCount = 0;
  dbMatches.forEach(db => {
    const found = sourceMatches.some(src =>
      (db.home_team_name?.includes(src.homeTeam) || src.homeTeam?.includes(db.home_team_name?.replace(/^\d+\s*/, ''))) &&
      db.home_score === src.homeScore &&
      db.away_score === src.awayScore
    );
    if (!found && db.event_id?.includes('heartland')) {
      extraCount++;
      console.log(`  EXTRA: ${db.match_date} | ${db.home_team_name} ${db.home_score}-${db.away_score} ${db.away_team_name}`);
      console.log(`         Source: ${db.source_platform}, Event: ${db.event_id}`);
    }
  });
  if (extraCount === 0) console.log('  None');

  // Duplicate analysis
  console.log('\n--- Duplicate Records in DATABASE ---');
  const dupCount = (allMatches?.length || 0) - dbMatches.length;
  console.log(`  Duplicate records: ${dupCount}`);

  console.log('\n' + '='.repeat(70));
  console.log('INTEGRITY VERDICT');
  console.log('='.repeat(70));

  if (missingCount === 0 && extraCount === 0 && dupCount === 0) {
    console.log('✅ DATA INTEGRITY PASSED - Source and DB match perfectly');
  } else {
    console.log('❌ DATA INTEGRITY ISSUES:');
    if (missingCount > 0) console.log(`   - ${missingCount} matches missing from DB`);
    if (extraCount > 0) console.log(`   - ${extraCount} extra matches in DB not in source`);
    if (dupCount > 0) console.log(`   - ${dupCount} duplicate records in DB`);
  }
}

compareData();
