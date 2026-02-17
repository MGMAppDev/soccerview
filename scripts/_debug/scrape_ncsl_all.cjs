/**
 * NCSL Full Scraper - Session 103
 * ================================
 * Scrapes ALL 608 divisions (286 Fall + 322 Spring) and stages to DB.
 * Uses direct DB writes, parallel division fetching with concurrency control.
 */

require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const ORG_ID = '80738';
const BASE = 'https://elements.demosphere-secure.com';
const SOURCE_PLATFORM = 'demosphere';
const CONCURRENCY = 5; // Concurrent fetches
const BATCH_SIZE = 500; // DB insert batch size

const MONTH_MAP = {
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12'
};

function parseDate(ds) {
  if (!ds) return null;
  const m = ds.match(/(\d+)-([A-Z]{3})-(\d{4})/i);
  if (!m) return null;
  const mo = MONTH_MAP[m[2].toUpperCase()];
  return mo ? `${m[3]}-${mo}-${m[1].padStart(2, '0')}` : null;
}

function parseTime(ts) {
  if (!ts) return null;
  const m = ts.match(/(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

function parseScore(sc) {
  if (sc === null || sc === undefined || sc === '') return null;
  const n = parseInt(sc);
  return isNaN(n) ? null : n;
}

// Division IDs discovered via range probing
const FALL_2025_DIVISIONS = [115189100,115189110,115189119,115189120,115189121,115189122,115189123,115189124,115189125,115189126,115189127,115189128,115189130,115189139,115189140,115189149,115189159,115189160,115189169,115189170,115189179,115189188,115189189,115189191,115189192,115189193,115189194,115189195,115189196,115189197,115189198,115189199,115189200,115189201,115189202,115189203,115189204,115189205,115189206,115189207,115189208,115189209,115189210,115189211,115189212,115189213,115189214,115189215,115189216,115189217,115189218,115189219,115189220,115189221,115189222,115189223,115189224,115189225,115189226,115189227,115189228,115189229,115189230,115189231,115189232,115189233,115189234,115189235,115189236,115189237,115189238,115189239,115189240,115189241,115189242,115189243,115189245,115189246,115189247,115189248,115189249,115189250,115189251,115189252,115189253,115189254,115189255,115189256,115189257,115189258,115189259,115189260,115189261,115189262,115189263,115189264,115189265,115189266,115189267,115189268,115189269,115189270,115189271,115189272,115189273,115189274,115189275,115189276,115189277,115189278,115189280,115189281,115189282,115189283,115189284,115189285,115189286,115189287,115189288,115189290,115189291,115189292,115189293,115189294,115189295,115189296,115189300,115189301,115189302,115189303,115189304,115189305,115189306,115189307,115189308,115189309,115189310,115189311,115189312,115189313,115189314,115189315,115189316,115189317,115189318,115189319,115189320,115189321,115189322,115189323,115189324,115189325,115189326,115189327,115189328,115189329,115189330,115189331,115189332,115189333,115189334,115189335,115189336,115189337,115189338,115189339,115189340,115189341,115189343,115189344,115189356,115189360,115189362,115189364,115189365,115189366,115189367,115189368,115189369,115189370,115189371,115189372,115189373,115189374,115189375,115189376,115189377,115189378,115189381,115189382,115189383,115189384,115189385,115189386,115189387,115189389,115189391,115189392,115189393,115189394,115189395,115189396,115189397,115189398,115189399,115189400,115189401,115189402,115189403,115189404,115189405,115189406,115189407,115189408,115189409,115189410,115189411,115189412,115189413,115189414,115189415,115189416,115189417,115189418,115189419,115189420,115189421,115189422,115189423,115189424,115189425,115189426,115189427,115189428,115189429,115189430,115189431,115189432,115189433,115189434,115189435,115189436,115189437,115189438,115189439,115189440,115189441,115189443,115189444,115189456,115189460,115189462,115189464,115189465,115189466,115189467,115189468,115189469,115189470,115189471,115189472,115189473,115189474,115189475,115189476,115189477,115189478,115189481,115189482,115189483,115189484,115189485,115189486,115189487,115189488,115189489,115189491,115189492,115189493,115189494,115189495,115189496,115189497,115189498,115189499,115189500];

const SPRING_2025_DIVISIONS = [114346008,114346009,114346010,114346011,114346012,114346013,114346014,114346015,114346016,114346017,114346018,114346028,114346029,114346038,114346039,114346048,114346049,114346059,114346068,114346069,114346078,114346079,114346080,114346082,114346083,114346084,114346086,114346087,114346089,114346090,114346091,114346092,114346093,114346094,114346095,114346096,114346097,114346098,114346099,114346100,114346101,114346102,114346103,114346104,114346105,114346106,114346107,114346108,114346109,114346110,114346111,114346112,114346113,114346114,114346115,114346116,114346117,114346118,114346119,114346120,114346121,114346122,114346123,114346124,114346125,114346126,114346127,114346128,114346129,114346130,114346131,114346132,114346133,114346134,114346135,114346136,114346137,114346138,114346139,114346140,114346141,114346142,114346143,114346144,114346145,114346146,114346147,114346148,114346149,114346150,114346151,114346152,114346153,114346154,114346155,114346156,114346157,114346158,114346159,114346160,114346161,114346162,114346163,114346164,114346165,114346166,114346167,114346168,114346169,114346170,114346171,114346172,114346173,114346174,114346175,114346176,114346177,114346179,114346180,114346181,114346182,114346183,114346184,114346185,114346186,114346190,114346191,114346192,114346193,114346194,114346195,114346196,114346197,114346200,114346201,114346202,114346203,114346204,114346205,114346206,114346207,114346208,114346209,114346210,114346211,114346212,114346213,114346214,114346215,114346216,114346217,114346218,114346219,114346220,114346221,114346222,114346223,114346224,114346225,114346226,114346227,114346228,114346229,114346230,114346231,114346232,114346233,114346234,114346235,114346236,114346237,114346238,114346239,114346240,114346241,114346242,114346243,114346244,114346245,114346246,114346247,114346248,114346249,114346250,114346251,114346252,114346253,114346254,114346255,114346256,114346257,114346258,114346259,114346260,114346261,114346262,114346263,114346264,114346265,114346266,114346267,114346268,114346269,114346270,114346271,114346272,114346273,114346274,114346275,114346276,114346277,114346282,114346283,114346284,114346286,114346287,114346289,114346290,114346291,114346292,114346293,114346294,114346295,114346296,114346297,114346298,114346299,114346300,114346301,114346302,114346303,114346304,114346305,114346306,114346307,114346308,114346309,114346310,114346311,114346312,114346313,114346314,114346315,114346316,114346317,114346318,114346319,114346320,114346321,114346322,114346323,114346324,114346325,114346326,114346327,114346328,114346329,114346330,114346331,114346332,114346333,114346334,114346335,114346336,114346337,114346338,114346339,114346340,114346341,114346342,114346343,114346344,114346345,114346346,114346347,114346348,114346349,114346350,114346351,114346352,114346353,114346354,114346355,114346356,114346357,114346358,114346359,114346360,114346361,114346362,114346363,114346364,114346365,114346366,114346367,114346368,114346369,114346370,114346371,114346372,114346373,114346374,114346375,114346376,114346377,114346382,114346383,114346384,114346386,114346387,114346389,114346390,114346391,114346392,114346393,114346394,114346395,114346396,114346397,114346398,114346399,114346400];

const SEASONS = [
  { name: 'Fall2025', label: 'NCSL Travel Fall 2025', eventId: '80738-fall2025', divisions: FALL_2025_DIVISIONS },
  { name: 'Spring2025', label: 'NCSL Travel Spring 2025', eventId: '80738-spring2025', divisions: SPRING_2025_DIVISIONS },
];

async function fetchDivision(seasonName, divId) {
  const url = `${BASE}/${ORG_ID}/schedules/${seasonName}/${divId}.js`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) return [];
    const data = JSON.parse(await r.text());
    return Object.entries(data).map(([matchId, md]) => ({
      matchId, dt: md.dt, tim: md.tim,
      tm1: md.tm1, tm2: md.tm2,
      sc1: md.sc1, sc2: md.sc2,
      facn: md.facn, code: md.code,
      divId,
    }));
  } catch { return []; }
}

async function stageBatch(rows) {
  if (rows.length === 0) return 0;

  const cols = [
    'match_date', 'match_time', 'home_team_name', 'away_team_name',
    'home_score', 'away_score', 'event_name', 'event_id',
    'venue_name', 'division', 'source_platform', 'source_match_key',
    'raw_data', 'processed'
  ];

  const values = [];
  const placeholders = rows.map((r, idx) => {
    const base = idx * cols.length;
    values.push(
      r.match_date, r.match_time, r.home_team_name, r.away_team_name,
      r.home_score, r.away_score, r.event_name, r.event_id,
      r.venue_name, r.division, r.source_platform, r.source_match_key,
      r.raw_data, false
    );
    return `(${cols.map((_, j) => `$${base + j + 1}`).join(', ')})`;
  });

  const sql = `
    INSERT INTO staging_games (${cols.join(', ')})
    VALUES ${placeholders.join(', ')}
    ON CONFLICT (source_match_key) DO NOTHING
  `;

  const result = await pool.query(sql, values);
  return result.rowCount;
}

async function scrapeSeason(season) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`SCRAPING: ${season.label} — ${season.divisions.length} divisions`);
  console.log(`${'='.repeat(60)}`);

  let totalFound = 0;
  let totalStaged = 0;
  let allRows = [];

  // Process divisions with concurrency control
  for (let i = 0; i < season.divisions.length; i += CONCURRENCY) {
    const batch = season.divisions.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(divId => fetchDivision(season.name, divId))
    );

    for (const matches of results) {
      for (const md of matches) {
        const matchDate = parseDate(md.dt);
        if (!matchDate) continue;
        if (!md.tm1 || !md.tm2 || md.tm1 === md.tm2) continue;

        totalFound++;
        allRows.push({
          match_date: matchDate,
          match_time: parseTime(md.tim),
          home_team_name: `DEMOSPHERE_TEAM_${md.tm1}`,
          away_team_name: `DEMOSPHERE_TEAM_${md.tm2}`,
          home_score: parseScore(md.sc1),
          away_score: parseScore(md.sc2),
          event_name: season.label,
          event_id: season.eventId,
          venue_name: md.facn || null,
          division: md.divId.toString(),
          source_platform: SOURCE_PLATFORM,
          source_match_key: `demosphere-${ORG_ID}-${season.name}-${md.matchId}`,
          raw_data: JSON.stringify({
            source_home_team_id: md.tm1,
            source_away_team_id: md.tm2,
            demosphere_match_id: md.matchId,
            demosphere_game_code: md.code,
            division_id: md.divId.toString(),
            org_id: ORG_ID,
          }),
        });

        // Stage in batches
        if (allRows.length >= BATCH_SIZE) {
          const staged = await stageBatch(allRows);
          totalStaged += staged;
          allRows = [];
        }
      }
    }

    if ((i + CONCURRENCY) % 50 < CONCURRENCY) {
      console.log(`  Progress: ${Math.min(i + CONCURRENCY, season.divisions.length)}/${season.divisions.length} divs, ${totalFound} found, ${totalStaged} staged`);
    }
  }

  // Stage remaining
  if (allRows.length > 0) {
    const staged = await stageBatch(allRows);
    totalStaged += staged;
  }

  console.log(`\n--- ${season.label} COMPLETE ---`);
  console.log(`  Matches found: ${totalFound}`);
  console.log(`  Matches staged: ${totalStaged}`);
  return { found: totalFound, staged: totalStaged };
}

async function main() {
  console.log('NCSL Full Scraper - Session 103');
  console.log('================================\n');

  const { rows: [before] } = await pool.query(
    "SELECT COUNT(*) as cnt FROM staging_games WHERE source_platform = 'demosphere'"
  );
  console.log(`Existing demosphere staging: ${before.cnt}`);

  let grandFound = 0, grandStaged = 0;
  for (const season of SEASONS) {
    const r = await scrapeSeason(season);
    grandFound += r.found;
    grandStaged += r.staged;
  }

  const { rows: [after] } = await pool.query(
    "SELECT COUNT(*) as cnt FROM staging_games WHERE source_platform = 'demosphere'"
  );

  console.log(`\n${'='.repeat(60)}`);
  console.log('NCSL FULL SCRAPE COMPLETE');
  console.log(`${'='.repeat(60)}`);
  console.log(`Total found: ${grandFound}`);
  console.log(`Total staged: ${grandStaged}`);
  console.log(`Staging: ${before.cnt} → ${after.cnt} (+${after.cnt - before.cnt})`);

  await pool.end();
}

main().catch(e => { console.error('FATAL:', e); pool.end(); process.exit(1); });
