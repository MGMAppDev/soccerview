/**
 * Check Kansas U11 Boys orphans and find duplicates
 * Session 78 - February 2, 2026
 */

require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function checkKansas() {
  // Get top Kansas U11 Boys teams
  const topKS = await pool.query(`
    SELECT id, display_name, gotsport_rank, gotsport_points,
           matches_played, wins, losses, draws, elo_rating, elo_national_rank
    FROM teams_v2
    WHERE state = 'KS' AND birth_year = 2015 AND gender = 'M'
    ORDER BY gotsport_rank NULLS LAST
    LIMIT 10
  `);

  console.log('=== KANSAS U11 BOYS - TOP 10 BY GS RANK ===\n');
  topKS.rows.forEach((t, i) => {
    const status = t.matches_played > 0 ? '✅' : '❌ ORPHAN';
    console.log(`#${i+1} GS Rank: #${t.gotsport_rank || 'N/A'}`);
    console.log(`   ${t.display_name}`);
    console.log(`   GS pts: ${t.gotsport_points}, MP: ${t.matches_played}, W-L-D: ${t.wins}-${t.losses}-${t.draws} ${status}`);
    console.log(`   ELO: ${t.elo_rating}, ELO Rank: #${t.elo_national_rank || 'N/A'}`);
    console.log('');
  });

  // Find potential matches for orphans
  const orphans = topKS.rows.filter(t => t.matches_played === 0);
  console.log('=== FINDING DUPLICATES FOR ORPHANS ===\n');

  for (const orphan of orphans.slice(0, 5)) {
    const name = orphan.display_name;
    console.log(`Orphan: ${name}`);
    console.log(`  ID: ${orphan.id}`);

    // Try to find matches with similar names
    const words = name.split(/\s+/).filter(w => w.length > 2);

    // Try different combinations
    const patterns = [];

    // Pattern 1: First 3 significant words
    if (words.length >= 3) {
      patterns.push('%' + words.slice(0, 3).join('%') + '%');
    }

    // Pattern 2: Club name only (first 2 words)
    if (words.length >= 2) {
      patterns.push('%' + words.slice(0, 2).join('%') + '%');
    }

    // Pattern 3: Last identifier (often team designation like "15E", "Elite", etc.)
    const lastWord = words[words.length - 1];
    if (lastWord && !lastWord.match(/^\(.*\)$/)) {
      patterns.push('%' + words[0] + '%' + lastWord + '%');
    }

    let found = false;
    for (const pattern of patterns) {
      const matches = await pool.query(`
        SELECT id, display_name, matches_played, wins, losses, draws
        FROM teams_v2
        WHERE display_name ILIKE $1
          AND birth_year = 2015 AND gender = 'M'
          AND matches_played > 0
          AND id != $2
        LIMIT 3
      `, [pattern, orphan.id]);

      if (matches.rows.length > 0) {
        console.log(`  FOUND with pattern '${pattern}':`);
        matches.rows.forEach(m => {
          console.log(`    - ${m.display_name}`);
          console.log(`      ID: ${m.id}, MP: ${m.matches_played}, W-L-D: ${m.wins}-${m.losses}-${m.draws}`);
        });
        found = true;
        break;
      }
    }

    if (!found) {
      console.log('  NO duplicates found with standard patterns');

      // Try more aggressive search - just club name
      const clubName = words[0];
      const aggressive = await pool.query(`
        SELECT id, display_name, matches_played, wins, losses, draws
        FROM teams_v2
        WHERE display_name ILIKE $1
          AND birth_year = 2015 AND gender = 'M'
          AND matches_played > 0
        LIMIT 5
      `, ['%' + clubName + '%']);

      if (aggressive.rows.length > 0) {
        console.log(`  AGGRESSIVE (club name '${clubName}' only):`);
        aggressive.rows.forEach(m => {
          console.log(`    - ${m.display_name}`);
          console.log(`      ID: ${m.id}, MP: ${m.matches_played}, W-L-D: ${m.wins}-${m.losses}-${m.draws}`);
        });
      }
    }
    console.log('');
  }

  pool.end();
}

checkKansas().catch(console.error);
