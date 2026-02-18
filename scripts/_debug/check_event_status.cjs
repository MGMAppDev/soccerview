require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const events = [
  { id: '43009', name: 'FL FSPL' },
  { id: '45008', name: 'FL WFPL' },
  { id: '45052', name: 'FL SEFPL' },
  { id: '44132', name: 'MO SLYSA' },
  { id: '49628', name: 'IN ISL Spring' },
  { id: '44745', name: 'TX GCL' },
  { id: '45379', name: 'TX EDPL South' },
];

(async () => {
  for (const evt of events) {
    const l = await pool.query('SELECT id, name FROM leagues WHERE source_event_id = $1', [evt.id]);
    const t = await pool.query('SELECT id, name FROM tournaments WHERE source_event_id = $1', [evt.id]);
    const s = await pool.query('SELECT COUNT(*) as cnt FROM staging_games WHERE event_id = $1', [evt.id]);
    const m = await pool.query(
      `SELECT COUNT(*) as cnt FROM matches_v2
       WHERE (league_id IN (SELECT id FROM leagues WHERE source_event_id = $1)
           OR tournament_id IN (SELECT id FROM tournaments WHERE source_event_id = $1))
         AND deleted_at IS NULL`, [evt.id]
    );
    const entity = l.rows[0] || t.rows[0];
    console.log(`${evt.id} (${evt.name}): ${entity ? entity.name : 'NOT IN DB'} | staging: ${s.rows[0].cnt} | matches: ${m.rows[0].cnt}`);
  }
  await pool.end();
})();
