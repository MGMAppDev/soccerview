require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const { data, count } = await supabase
    .from('staging_games')
    .select('id, processed, error_message', { count: 'exact' })
    .ilike('event_name', '%Sporting Classic%');

  console.log('Sporting Classic staging records:', count);

  if (data) {
    const processed = data.filter(d => d.processed).length;
    const unprocessed = data.filter(d => !d.processed).length;
    const errors = data.filter(d => d.error_message).length;

    console.log('  Processed:', processed);
    console.log('  Unprocessed:', unprocessed);
    console.log('  With errors:', errors);

    if (errors > 0) {
      data.filter(d => d.error_message).slice(0, 3).forEach(d =>
        console.log('  Error:', d.error_message)
      );
    }
  }

  // Check matches_v2 for any htg-13418 records
  const { data: matches, count: matchCount } = await supabase
    .from('matches_v2')
    .select('id, source_match_key, tournament_id', { count: 'exact' })
    .like('source_match_key', 'htg-13418%');

  console.log('\nMatches with htg-13418 key:', matchCount);

  // Get tournament ID for Sporting Classic
  const { data: tourn } = await supabase
    .from('tournaments')
    .select('id, name')
    .ilike('name', '%Sporting Classic 2025%')
    .single();

  if (tourn) {
    console.log('\nSporting Classic 2025 tournament ID:', tourn.id);

    // Check matches with this tournament ID
    const { count: linkedCount } = await supabase
      .from('matches_v2')
      .select('id', { count: 'exact', head: true })
      .eq('tournament_id', tourn.id);

    console.log('Matches linked to this tournament:', linkedCount);
  }
})();
