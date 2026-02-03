require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  // Find Sporting BV Pre-NAL 15
  const { data: team } = await supabase
    .from('teams_v2')
    .select('id, display_name')
    .ilike('display_name', '%Sporting BV Pre-NAL 15%')
    .limit(1)
    .single();

  console.log('Team:', team?.display_name, team?.id);

  if (!team) {
    console.log('Team not found');
    return;
  }

  // Get rank history
  const { data: history } = await supabase
    .from('rank_history_v2')
    .select('snapshot_date, elo_national_rank, elo_state_rank, national_rank, state_rank, elo_rating')
    .eq('team_id', team.id)
    .gte('snapshot_date', '2025-08-01')
    .order('snapshot_date', { ascending: true });

  console.log('\nRank history entries:', history?.length);
  console.log('\nFirst 10 entries:');
  history?.slice(0, 10).forEach(h => {
    console.log(h.snapshot_date, '| SV_nat:', h.elo_national_rank, '| SV_st:', h.elo_state_rank, '| GS_nat:', h.national_rank, '| GS_st:', h.state_rank, '| ELO:', h.elo_rating);
  });
  console.log('\nLast 5 entries:');
  history?.slice(-5).forEach(h => {
    console.log(h.snapshot_date, '| SV_nat:', h.elo_national_rank, '| SV_st:', h.elo_state_rank, '| GS_nat:', h.national_rank, '| GS_st:', h.state_rank, '| ELO:', h.elo_rating);
  });

  // Check for nulls and low ranks
  const withSVNat = history?.filter(h => h.elo_national_rank !== null) || [];
  const withSVSt = history?.filter(h => h.elo_state_rank !== null) || [];
  console.log('\nEntries with SV national rank:', withSVNat.length);
  console.log('Entries with SV state rank:', withSVSt.length);

  // Find min/max SV ranks
  if (withSVNat.length > 0) {
    const svNatRanks = withSVNat.map(h => h.elo_national_rank);
    console.log('SV National min:', Math.min(...svNatRanks), 'max:', Math.max(...svNatRanks));
  }
  if (withSVSt.length > 0) {
    const svStRanks = withSVSt.map(h => h.elo_state_rank);
    console.log('SV State min:', Math.min(...svStRanks), 'max:', Math.max(...svStRanks));
  }
}

check().catch(console.error);
