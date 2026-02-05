/**
 * resolveEventName.cjs - Centralized event name resolver
 *
 * Universal resolver — ALL code paths MUST use this instead of fallback patterns.
 * Returns NULL instead of a generic name. Caller must handle NULL appropriately
 * (skip tournament creation, leave tournament_id = NULL on match).
 *
 * Resolution Priority:
 *   1. Provided rawName (if non-generic)
 *   2. staging_games.event_name (most recent non-generic for this event_id)
 *   3. canonical_events.canonical_name (via tournament_id/league_id FK)
 *   4. GotSport web page embedded JSON (if source is gotsport/htgsports)
 *   5. NULL (never return a generic name)
 *
 * Usage:
 *   const { resolveEventName } = require('../universal/resolveEventName.cjs');
 *   const name = await resolveEventName(client, { sourceEventId, sourcePlatform, rawName });
 *   if (!name) { /* skip tournament creation * / }
 */

// Generic name patterns — must reject these
const GENERIC_RE = /^(HTGSports |GotSport |Heartland )?Event \d+$/;
const BARE_NUMBER_RE = /^\d+$/;
const BARE_PLATFORM_RE = /^(GotSport|HTGSports|Heartland)$/;

function isGeneric(name) {
  if (!name || name.trim() === '') return true;
  const trimmed = name.trim();
  return GENERIC_RE.test(trimmed) || BARE_NUMBER_RE.test(trimmed) || BARE_PLATFORM_RE.test(trimmed);
}

/**
 * Resolve a real event name from available sources.
 *
 * @param {object} client - pg Client (dedicated, with pipeline auth)
 * @param {object} opts
 * @param {string} opts.sourceEventId - Source platform's event ID
 * @param {string} opts.sourcePlatform - 'gotsport', 'htgsports', 'heartland'
 * @param {string|null} opts.rawName - Name from the caller (may be generic)
 * @param {boolean} [opts.skipWeb=false] - Skip web fetch (for speed-critical paths)
 * @returns {string|null} - Real name or NULL (never generic)
 */
async function resolveEventName(client, { sourceEventId, sourcePlatform, rawName, skipWeb = false }) {
  // 1. Provided rawName (if non-generic)
  if (rawName && !isGeneric(rawName)) {
    return rawName.trim();
  }

  if (!sourceEventId) return null;

  // 2. staging_games.event_name
  try {
    const { rows } = await client.query(`
      SELECT event_name FROM staging_games
      WHERE event_id = $1
        AND event_name IS NOT NULL AND event_name != ''
      ORDER BY scraped_at DESC LIMIT 1
    `, [sourceEventId]);

    if (rows.length > 0 && !isGeneric(rows[0].event_name)) {
      return rows[0].event_name.trim();
    }
  } catch { /* continue to next source */ }

  // 3. canonical_events.canonical_name (via source_entity_map → tournament/league)
  try {
    const { rows } = await client.query(`
      SELECT ce.canonical_name
      FROM source_entity_map sem
      JOIN canonical_events ce ON (
        (sem.entity_type = 'tournament' AND ce.tournament_id = sem.sv_id)
        OR (sem.entity_type = 'league' AND ce.league_id = sem.sv_id)
      )
      WHERE sem.source_platform = $1 AND sem.source_entity_id = $2
        AND ce.canonical_name IS NOT NULL AND ce.canonical_name != ''
      LIMIT 1
    `, [sourcePlatform, sourceEventId]);

    if (rows.length > 0 && !isGeneric(rows[0].canonical_name)) {
      return rows[0].canonical_name.trim();
    }
  } catch { /* continue to next source */ }

  // 4. GotSport web page (for gotsport/htgsports sources)
  if (!skipWeb && (sourcePlatform === 'gotsport' || sourcePlatform === 'htgsports')) {
    try {
      const resp = await fetch(`https://system.gotsport.com/org_event/events/${sourceEventId}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      });
      if (resp.ok) {
        const html = await resp.text();
        const decoded = html.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
        const match = decoded.match(/"([^"]{5,200})","start_date":"\d{4}-\d{2}-\d{2}","end_date":"\d{4}-\d{2}-\d{2}","created_at"/);
        if (match) {
          const name = match[1]
            .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
            .trim();
          if (!isGeneric(name)) return name;
        }
      }
    } catch { /* continue */ }
  }

  // 5. NULL — never return a generic name
  return null;
}

module.exports = { resolveEventName, isGeneric };
