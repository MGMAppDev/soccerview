/**
 * Verify the team pairs to merge are actually duplicates (same birth_year, gender)
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const TEAM_PAIRS = [
  ['53da77f9-44db-41d7-a4c4-9587c35a0951', 'cf589dcd-510e-4304-9407-243a7ff411b4', 'Sporting City MLSN-East'],
  ['4a849821-e1be-4098-a635-643d97afc750', 'eac39902-c74e-4107-bece-2f1b0f8dcb3d', 'OP Academy'],
  ['0bebbd94-64b8-48d4-9139-191ab4c19971', 'c728c5c2-bfec-46db-8c9a-d88b1112ad75', 'KC Fusion'],
  ['6344dce7-88d1-439e-8057-25175ed9d09d', '70ec772c-ce90-4059-8a4f-422ad6507937', 'Sporting City West/East'],
  ['785f3682-066b-42af-8982-7e4c4964afc8', '8d70002a-afce-48d4-aebf-7064a63ceb53', 'Toca FC'],
  ['1b7fab07-a7f5-4bb2-a97d-95e2870e66ad', 'ee8e8561-e71a-433d-9342-0baea815a500', 'Sporting City MLS NEXT'],
  ['171e556c-f4fc-424a-993c-4abb2caac514', '5bfbba9d-6fcc-4235-bfb3-4b4a19b94a18', 'Supra United'],
  ['d0f7823b-0b50-4573-b4c1-6f18afc188f2', 'ef1c0bd7-c74b-4cc3-bcb1-724c5782520a', 'RFA'],
];

async function verify() {
  console.log('=== VERIFYING TEAM PAIRS FOR MERGE ===\n');

  for (const [id1, id2, label] of TEAM_PAIRS) {
    const teams = await pool.query(`
      SELECT id, display_name, birth_year, gender, matches_played
      FROM teams_v2
      WHERE id IN ($1, $2)
      ORDER BY matches_played DESC
    `, [id1, id2]);

    console.log(`${label}:`);
    if (teams.rows.length !== 2) {
      console.log('  ⚠️ Not all teams found!');
      continue;
    }

    const [t1, t2] = teams.rows;
    const sameBirth = t1.birth_year === t2.birth_year;
    const sameGender = t1.gender === t2.gender;
    const canMerge = sameBirth && sameGender;

    console.log(`  Team 1: ${t1.display_name}`);
    console.log(`          Birth: ${t1.birth_year} | Gender: ${t1.gender} | Matches: ${t1.matches_played}`);
    console.log(`  Team 2: ${t2.display_name}`);
    console.log(`          Birth: ${t2.birth_year} | Gender: ${t2.gender} | Matches: ${t2.matches_played}`);
    console.log(`  ${canMerge ? '✅ CAN MERGE' : '❌ CANNOT MERGE (birth_year/gender mismatch)'}`);
    console.log('');
  }

  await pool.end();
}

verify().catch(console.error);
