/**
 * NCSL Team Name Resolution - Session 103
 * ========================================
 * Fetches team names from Demosphere standings XML endpoints and updates
 * staging_games records that have DEMOSPHERE_TEAM_{id} placeholders.
 *
 * Standings XML format:
 *   <teams>
 *     <teamgroup key="115189283" name="GU16 Division 3">
 *       <team key="111234700" name="FC Virginia 16G Division 3">
 *         <td>22</td><td>9</td>...
 *       </team>
 *     </teamgroup>
 *   </teams>
 */

require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const ORG_ID = '80738';
const BASE = 'https://elements.demosphere-secure.com';
const CONCURRENCY = 5;

// All division IDs (same as scrape_ncsl_all.cjs)
const SEASONS = [
  {
    name: 'Fall2025',
    seasonKey: '115189101',
    divisions: [115189100,115189110,115189119,115189120,115189121,115189122,115189123,115189124,115189125,115189126,115189127,115189128,115189130,115189139,115189140,115189149,115189159,115189160,115189169,115189170,115189179,115189188,115189189,115189191,115189192,115189193,115189194,115189195,115189196,115189197,115189198,115189199,115189200,115189201,115189202,115189203,115189204,115189205,115189206,115189207,115189208,115189209,115189210,115189211,115189212,115189213,115189214,115189215,115189216,115189217,115189218,115189219,115189220,115189221,115189222,115189223,115189224,115189225,115189226,115189227,115189228,115189229,115189230,115189231,115189232,115189233,115189234,115189235,115189236,115189237,115189238,115189239,115189240,115189241,115189242,115189243,115189245,115189246,115189247,115189248,115189249,115189250,115189251,115189252,115189253,115189254,115189255,115189256,115189257,115189258,115189259,115189260,115189261,115189262,115189263,115189264,115189265,115189266,115189267,115189268,115189269,115189270,115189271,115189272,115189273,115189274,115189275,115189276,115189277,115189278,115189280,115189281,115189282,115189283,115189284,115189285,115189286,115189287,115189288,115189290,115189291,115189292,115189293,115189294,115189295,115189296,115189300,115189301,115189302,115189303,115189304,115189305,115189306,115189307,115189308,115189309,115189310,115189311,115189312,115189313,115189314,115189315,115189316,115189317,115189318,115189319,115189320,115189321,115189322,115189323,115189324,115189325,115189326,115189327,115189328,115189329,115189330,115189331,115189332,115189333,115189334,115189335,115189336,115189337,115189338,115189339,115189340,115189341,115189343,115189344,115189356,115189360,115189362,115189364,115189365,115189366,115189367,115189368,115189369,115189370,115189371,115189372,115189373,115189374,115189375,115189376,115189377,115189378,115189381,115189382,115189383,115189384,115189385,115189386,115189387,115189389,115189391,115189392,115189393,115189394,115189395,115189396,115189397,115189398,115189399,115189400,115189401,115189402,115189403,115189404,115189405,115189406,115189407,115189408,115189409,115189410,115189411,115189412,115189413,115189414,115189415,115189416,115189417,115189418,115189419,115189420,115189421,115189422,115189423,115189424,115189425,115189426,115189427,115189428,115189429,115189430,115189431,115189432,115189433,115189434,115189435,115189436,115189437,115189438,115189439,115189440,115189441,115189443,115189444,115189456,115189460,115189462,115189464,115189465,115189466,115189467,115189468,115189469,115189470,115189471,115189472,115189473,115189474,115189475,115189476,115189477,115189478,115189481,115189482,115189483,115189484,115189485,115189486,115189487,115189488,115189489,115189491,115189492,115189493,115189494,115189495,115189496,115189497,115189498,115189499,115189500],
  },
  {
    name: 'Spring2025',
    seasonKey: '114346054',
    divisions: [114346008,114346009,114346010,114346011,114346012,114346013,114346014,114346015,114346016,114346017,114346018,114346028,114346029,114346038,114346039,114346048,114346049,114346059,114346068,114346069,114346078,114346079,114346080,114346082,114346083,114346084,114346086,114346087,114346089,114346090,114346091,114346092,114346093,114346094,114346095,114346096,114346097,114346098,114346099,114346100,114346101,114346102,114346103,114346104,114346105,114346106,114346107,114346108,114346109,114346110,114346111,114346112,114346113,114346114,114346115,114346116,114346117,114346118,114346119,114346120,114346121,114346122,114346123,114346124,114346125,114346126,114346127,114346128,114346129,114346130,114346131,114346132,114346133,114346134,114346135,114346136,114346137,114346138,114346139,114346140,114346141,114346142,114346143,114346144,114346145,114346146,114346147,114346148,114346149,114346150,114346151,114346152,114346153,114346154,114346155,114346156,114346157,114346158,114346159,114346160,114346161,114346162,114346163,114346164,114346165,114346166,114346167,114346168,114346169,114346170,114346171,114346172,114346173,114346174,114346175,114346176,114346177,114346179,114346180,114346181,114346182,114346183,114346184,114346185,114346186,114346190,114346191,114346192,114346193,114346194,114346195,114346196,114346197,114346200,114346201,114346202,114346203,114346204,114346205,114346206,114346207,114346208,114346209,114346210,114346211,114346212,114346213,114346214,114346215,114346216,114346217,114346218,114346219,114346220,114346221,114346222,114346223,114346224,114346225,114346226,114346227,114346228,114346229,114346230,114346231,114346232,114346233,114346234,114346235,114346236,114346237,114346238,114346239,114346240,114346241,114346242,114346243,114346244,114346245,114346246,114346247,114346248,114346249,114346250,114346251,114346252,114346253,114346254,114346255,114346256,114346257,114346258,114346259,114346260,114346261,114346262,114346263,114346264,114346265,114346266,114346267,114346268,114346269,114346270,114346271,114346272,114346273,114346274,114346275,114346276,114346277,114346282,114346283,114346284,114346286,114346287,114346289,114346290,114346291,114346292,114346293,114346294,114346295,114346296,114346297,114346298,114346299,114346300,114346301,114346302,114346303,114346304,114346305,114346306,114346307,114346308,114346309,114346310,114346311,114346312,114346313,114346314,114346315,114346316,114346317,114346318,114346319,114346320,114346321,114346322,114346323,114346324,114346325,114346326,114346327,114346328,114346329,114346330,114346331,114346332,114346333,114346334,114346335,114346336,114346337,114346338,114346339,114346340,114346341,114346342,114346343,114346344,114346345,114346346,114346347,114346348,114346349,114346350,114346351,114346352,114346353,114346354,114346355,114346356,114346357,114346358,114346359,114346360,114346361,114346362,114346363,114346364,114346365,114346366,114346367,114346368,114346369,114346370,114346371,114346372,114346373,114346374,114346375,114346376,114346377,114346382,114346383,114346384,114346386,114346387,114346389,114346390,114346391,114346392,114346393,114346394,114346395,114346396,114346397,114346398,114346399,114346400],
  },
];

async function fetchStandingsXml(seasonKey, divId) {
  const url = `${BASE}/${ORG_ID}/standings/${seasonKey}/${divId}.xml`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; }
}

function parseTeamsFromXml(xml) {
  // Parse team keys and names from standings XML
  // Actual format: <team key="111177872" code="NG1176" name="CCS Chaos" rank="1" ...>
  // Note: 'code' attribute sits between 'key' and 'name'
  const teams = new Map();
  const teamPattern = /<team\s+key="(\d+)"[^>]*?\s+name="([^"]+)"/g;
  let match;
  while ((match = teamPattern.exec(xml)) !== null) {
    // Decode XML entities like &apos; → '
    const name = match[2].replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"');
    teams.set(match[1], name);
  }
  return teams;
}

function parseDivisionFromXml(xml) {
  // Parse division name from teamgroup
  // Format: <teamgroup key="115189283" name="GU16 Division 3" ...>
  const match = xml.match(/<teamgroup\s+key="\d+"[^>]*?\s+name="([^"]+)"/);
  return match ? match[1] : null;
}

async function main() {
  console.log('NCSL Team Name Resolution - Session 103');
  console.log('========================================\n');

  const teamNameMap = new Map(); // demosphere team ID → real name
  const divisionNameMap = new Map(); // division ID → division name

  for (const season of SEASONS) {
    console.log(`\nResolving team names for ${season.name} (${season.divisions.length} divisions)...`);

    let divsWithData = 0;
    for (let i = 0; i < season.divisions.length; i += CONCURRENCY) {
      const batch = season.divisions.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (divId) => {
          const xml = await fetchStandingsXml(season.seasonKey, divId);
          if (!xml) return null;
          return { divId, xml };
        })
      );

      for (const result of results) {
        if (!result) continue;
        const teams = parseTeamsFromXml(result.xml);
        const divName = parseDivisionFromXml(result.xml);

        if (teams.size > 0) {
          divsWithData++;
          for (const [teamId, teamName] of teams) {
            teamNameMap.set(teamId, teamName);
          }
        }
        if (divName) {
          divisionNameMap.set(String(result.divId), divName);
        }
      }

      if ((i + CONCURRENCY) % 100 < CONCURRENCY) {
        console.log(`  Progress: ${Math.min(i + CONCURRENCY, season.divisions.length)}/${season.divisions.length} divs, ${teamNameMap.size} teams resolved`);
      }
    }

    console.log(`  ${season.name}: ${divsWithData} divisions with standings, ${teamNameMap.size} total teams`);
  }

  console.log(`\nTotal unique team names resolved: ${teamNameMap.size}`);
  console.log(`Total division names resolved: ${divisionNameMap.size}`);

  // Now update staging_games records
  console.log(`\nUpdating staging_games with real team names...`);

  // Get all unprocessed demosphere staging records
  const { rows: stagingRecords } = await pool.query(`
    SELECT id, home_team_name, away_team_name, division, raw_data
    FROM staging_games
    WHERE source_platform = 'demosphere' AND NOT processed
  `);

  console.log(`Found ${stagingRecords.length} unprocessed demosphere records`);

  let updated = 0;
  let missingHome = 0;
  let missingAway = 0;

  // Update using individual parameterized queries (staging IDs are UUIDs)
  for (let i = 0; i < stagingRecords.length; i++) {
    const row = stagingRecords[i];

    const homeMatch = row.home_team_name.match(/DEMOSPHERE_TEAM_(\d+)/);
    const awayMatch = row.away_team_name.match(/DEMOSPHERE_TEAM_(\d+)/);

    const homeId = homeMatch ? homeMatch[1] : null;
    const awayId = awayMatch ? awayMatch[1] : null;

    const homeName = homeId ? teamNameMap.get(homeId) : null;
    const awayName = awayId ? teamNameMap.get(awayId) : null;

    if (!homeName) missingHome++;
    if (!awayName) missingAway++;

    const divName = divisionNameMap.get(row.division);

    if (homeName || awayName || divName) {
      await pool.query(
        `UPDATE staging_games SET home_team_name = $1, away_team_name = $2, division = $3 WHERE id = $4`,
        [homeName || row.home_team_name, awayName || row.away_team_name, divName || row.division, row.id]
      );
      updated++;
    }

    if ((i + 1) % 2000 === 0) {
      console.log(`  Progress: ${i + 1}/${stagingRecords.length} checked, ${updated} updated`);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('TEAM NAME RESOLUTION COMPLETE');
  console.log(`${'='.repeat(60)}`);
  console.log(`Total staging records: ${stagingRecords.length}`);
  console.log(`Records updated: ${updated}`);
  console.log(`Missing home team names: ${missingHome}`);
  console.log(`Missing away team names: ${missingAway}`);

  // Sample of resolved names
  const { rows: sample } = await pool.query(`
    SELECT home_team_name, away_team_name, division
    FROM staging_games
    WHERE source_platform = 'demosphere' AND NOT processed
    AND home_team_name NOT LIKE 'DEMOSPHERE_TEAM_%'
    LIMIT 10
  `);

  if (sample.length > 0) {
    console.log('\nSample resolved names:');
    sample.forEach(r => console.log(`  ${r.home_team_name} vs ${r.away_team_name} (${r.division})`));
  }

  await pool.end();
}

main().catch(e => { console.error('FATAL:', e); pool.end(); process.exit(1); });
