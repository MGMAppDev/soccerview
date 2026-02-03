/**
 * Fix mislinked Sporting BV Pre-NAL 15 matches
 *
 * Problem: 3 Heartland Invitational matches linked to wrong team entry
 *
 * Wrong team: "SPORTING BV Pre-NAL 15" (id: c877fe63-3af8-48dd-9399-a053fa8fafd8) - birth_year: NULL
 * Correct team: "Sporting Blue Valley SPORTING BV Pre-NAL 15 (U11 Boys)" (id: cc329f08-1f57-4a7b-923a-768b2138fa92) - birth_year: 2015
 *
 * Usage:
 *   node scripts/maintenance/fixSportingBVMatches.cjs --dry-run
 *   node scripts/maintenance/fixSportingBVMatches.cjs --execute
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const WRONG_TEAM_ID = 'c877fe63-3af8-48dd-9399-a053fa8fafd8';
const CORRECT_TEAM_ID = 'cc329f08-1f57-4a7b-923a-768b2138fa92';

async function fixMatches(dryRun = true) {
  console.log('=== FIX SPORTING BV PRE-NAL 15 MISLINKED MATCHES ===\n');
  console.log('Mode:', dryRun ? 'DRY RUN' : 'EXECUTE');
  console.log('');

  // 1. Find all matches linked to wrong team
  console.log('1. Finding matches linked to wrong team...\n');

  const { data: homeMatches, error: homeErr } = await supabase
    .from('matches_v2')
    .select('id, match_date, home_score, away_score, source_match_key, tournament_id, away_team_id')
    .eq('home_team_id', WRONG_TEAM_ID);

  const { data: awayMatches, error: awayErr } = await supabase
    .from('matches_v2')
    .select('id, match_date, home_score, away_score, source_match_key, tournament_id, home_team_id')
    .eq('away_team_id', WRONG_TEAM_ID);

  if (homeErr || awayErr) {
    console.error('Error fetching matches:', homeErr || awayErr);
    return;
  }

  console.log('   Matches as HOME team:', homeMatches.length);
  console.log('   Matches as AWAY team:', awayMatches.length);
  console.log('   Total to fix:', homeMatches.length + awayMatches.length);

  // 2. Show what will be fixed
  console.log('\n2. Matches to be fixed:\n');

  // Get team names for display
  const teamIds = new Set();
  homeMatches.forEach(m => teamIds.add(m.away_team_id));
  awayMatches.forEach(m => teamIds.add(m.home_team_id));

  const { data: teams } = await supabase
    .from('teams_v2')
    .select('id, display_name')
    .in('id', Array.from(teamIds));

  const teamMap = {};
  teams?.forEach(t => { teamMap[t.id] = t.display_name; });

  for (const m of homeMatches) {
    const opponent = teamMap[m.away_team_id] || 'Unknown';
    console.log('   ' + m.match_date + ': [HOME] vs ' + opponent.substring(0, 40) + ' | ' + m.home_score + '-' + m.away_score);
    console.log('      -> Will update home_team_id to CORRECT team');
  }

  for (const m of awayMatches) {
    const opponent = teamMap[m.home_team_id] || 'Unknown';
    console.log('   ' + m.match_date + ': ' + opponent.substring(0, 40) + ' vs [AWAY] | ' + m.home_score + '-' + m.away_score);
    console.log('      -> Will update away_team_id to CORRECT team');
  }

  if (dryRun) {
    console.log('\n[DRY RUN] No changes made. Run with --execute to apply fixes.\n');
    return;
  }

  // 3. Execute fixes
  console.log('\n3. Executing fixes...\n');

  // Fix home matches
  if (homeMatches.length > 0) {
    const homeIds = homeMatches.map(m => m.id);
    const { error: updateHomeErr } = await supabase
      .from('matches_v2')
      .update({ home_team_id: CORRECT_TEAM_ID })
      .in('id', homeIds);

    if (updateHomeErr) {
      console.error('   Error updating home matches:', updateHomeErr);
    } else {
      console.log('   ✅ Updated ' + homeMatches.length + ' home matches');
    }
  }

  // Fix away matches
  if (awayMatches.length > 0) {
    const awayIds = awayMatches.map(m => m.id);
    const { error: updateAwayErr } = await supabase
      .from('matches_v2')
      .update({ away_team_id: CORRECT_TEAM_ID })
      .in('id', awayIds);

    if (updateAwayErr) {
      console.error('   Error updating away matches:', updateAwayErr);
    } else {
      console.log('   ✅ Updated ' + awayMatches.length + ' away matches');
    }
  }

  // 4. Update matches_played count on correct team
  console.log('\n4. Updating team stats...\n');

  const totalFixed = homeMatches.length + awayMatches.length;

  // Get current matches_played
  const { data: correctTeam } = await supabase
    .from('teams_v2')
    .select('matches_played')
    .eq('id', CORRECT_TEAM_ID)
    .single();

  // Actually recalculate from matches
  const { count: actualMatches } = await supabase
    .from('matches_v2')
    .select('id', { count: 'exact', head: true })
    .or('home_team_id.eq.' + CORRECT_TEAM_ID + ',away_team_id.eq.' + CORRECT_TEAM_ID);

  // Update matches_played to actual count
  await supabase
    .from('teams_v2')
    .update({ matches_played: actualMatches })
    .eq('id', CORRECT_TEAM_ID);

  console.log('   ✅ Updated matches_played: ' + correctTeam?.matches_played + ' -> ' + actualMatches);

  // 5. Delete the wrong team entry (if no more matches linked)
  console.log('\n5. Checking if wrong team can be deleted...\n');

  const { count: remainingMatches } = await supabase
    .from('matches_v2')
    .select('id', { count: 'exact', head: true })
    .or('home_team_id.eq.' + WRONG_TEAM_ID + ',away_team_id.eq.' + WRONG_TEAM_ID);

  if (remainingMatches === 0) {
    const { error: deleteErr } = await supabase
      .from('teams_v2')
      .delete()
      .eq('id', WRONG_TEAM_ID);

    if (deleteErr) {
      console.error('   Error deleting wrong team:', deleteErr);
    } else {
      console.log('   ✅ Deleted wrong team entry (no remaining matches)');
    }
  } else {
    console.log('   ⚠️ Wrong team still has ' + remainingMatches + ' matches - not deleting');
  }

  // 6. Refresh views
  console.log('\n6. Note: Run view refresh to update app data\n');
  console.log('   psql $DATABASE_URL -c "SELECT refresh_app_views();"');

  console.log('\n=== COMPLETE ===\n');
}

// Parse args
const args = process.argv.slice(2);
const dryRun = !args.includes('--execute');

fixMatches(dryRun).catch(console.error);
