import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function fetchAllRows(table, selectFields) {
    // Get total count first
    const { count } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true });

    console.log(`  Fetching ${count} rows from ${table}...`);

    const allRows = [];
    const pageSize = 1000;
    let offset = 0;

    while (offset < count) {
        const { data, error } = await supabase
            .from(table)
            .select(selectFields)
            .range(offset, offset + pageSize - 1);

        if (error) throw error;
        allRows.push(...data);
        offset += pageSize;
    }

    return allRows;
}

async function main() {
    console.log('\n' + '='.repeat(60));
    console.log('Query 1: ELO/Stats Consistency Check');
    console.log('='.repeat(60));

    const teams = await fetchAllRows('teams_v2', 'wins, losses, draws, matches_played');

    let stat_mismatch = 0;
    let null_matches = 0;

    for (const t of teams) {
        if (t.matches_played === null) {
            null_matches++;
        }
        const sum = (t.wins || 0) + (t.losses || 0) + (t.draws || 0);
        if (sum !== t.matches_played) {
            stat_mismatch++;
        }
    }

    console.log({
        total_teams: teams.length,
        stat_mismatch,
        null_matches
    });

    // Query 2: Birth Year vs Age Group Check
    console.log('\n' + '='.repeat(60));
    console.log('Query 2: Birth Year vs Age Group Check');
    console.log('='.repeat(60));

    const teams2 = teams.filter(t => true); // reuse same data but need birth_year, age_group
    const { data: teamsWithAge, error: err2 } = await supabase
        .from('teams_v2')
        .select('birth_year, age_group')
        .not('birth_year', 'is', null);

    // Need to paginate this too
    const { count: ageCount } = await supabase
        .from('teams_v2')
        .select('*', { count: 'exact', head: true })
        .not('birth_year', 'is', null);

    console.log(`  Fetching ${ageCount} rows with birth_year...`);

    const allTeamsWithAge = [];
    let offset2 = 0;
    while (offset2 < ageCount) {
        const { data } = await supabase
            .from('teams_v2')
            .select('birth_year, age_group')
            .not('birth_year', 'is', null)
            .range(offset2, offset2 + 999);
        allTeamsWithAge.push(...data);
        offset2 += 1000;
    }

    let age_mismatch = 0;
    let null_age_group = 0;

    for (const t of allTeamsWithAge) {
        if (t.age_group === null) {
            null_age_group++;
        }
        const expected = 'U' + (2026 - t.birth_year);
        if (t.age_group !== expected) {
            age_mismatch++;
        }
    }

    console.log({
        total_with_birth_year: allTeamsWithAge.length,
        age_mismatch,
        null_age_group
    });

    // Query 3: Ranking Fields Check
    console.log('\n' + '='.repeat(60));
    console.log('Query 3: Ranking Fields Check');
    console.log('='.repeat(60));

    const teams3 = await fetchAllRows('teams_v2', 'national_rank, state_rank, elo_national_rank, elo_state_rank');

    let has_national_rank = 0;
    let has_state_rank = 0;
    let has_elo_national_rank = 0;
    let has_elo_state_rank = 0;

    for (const t of teams3) {
        if (t.national_rank !== null) has_national_rank++;
        if (t.state_rank !== null) has_state_rank++;
        if (t.elo_national_rank !== null) has_elo_national_rank++;
        if (t.elo_state_rank !== null) has_elo_state_rank++;
    }

    console.log({
        total_teams: teams3.length,
        has_national_rank,
        has_state_rank,
        has_elo_national_rank,
        has_elo_state_rank
    });

    // Query 4: Verify Match Counts
    console.log('\n' + '='.repeat(60));
    console.log('Query 4: Verify Match Counts (sampling 100 teams)');
    console.log('='.repeat(60));

    const { data: sampleTeams } = await supabase
        .from('teams_v2')
        .select('id, matches_played')
        .not('matches_played', 'is', null)
        .gt('matches_played', 0)
        .limit(100);

    let matchCount = 0;
    let mismatchCount = 0;

    for (const team of sampleTeams) {
        const { count: homeCount } = await supabase
            .from('matches_v2')
            .select('*', { count: 'exact', head: true })
            .eq('home_team_id', team.id);

        const { count: awayCount } = await supabase
            .from('matches_v2')
            .select('*', { count: 'exact', head: true })
            .eq('away_team_id', team.id);

        const actualCount = (homeCount || 0) + (awayCount || 0);

        if (actualCount !== team.matches_played) {
            mismatchCount++;
        } else {
            matchCount++;
        }
    }

    console.log({
        teams_checked: sampleTeams.length,
        matching_count: matchCount,
        mismatch_count: mismatchCount
    });

    // Query 5: Check rank_history_v2 table
    console.log('\n' + '='.repeat(60));
    console.log('Query 5: Check rank_history_v2 table');
    console.log('='.repeat(60));

    const { count: historyCount, error: err5 } = await supabase
        .from('rank_history_v2')
        .select('*', { count: 'exact', head: true });

    if (err5) {
        console.log('Table may not exist or error:', err5.message);
    } else {
        const { data: uniqueTeams } = await supabase
            .from('rank_history_v2')
            .select('team_id')
            .limit(10000);

        const uniqueCount = uniqueTeams ? new Set(uniqueTeams.map(t => t.team_id)).size : 0;

        console.log({
            total_records: historyCount,
            unique_teams: uniqueCount
        });
    }

    // Query 6: Sample of teams with potential issues
    console.log('\n' + '='.repeat(60));
    console.log('Query 6: Sample of teams with potential issues');
    console.log('='.repeat(60));

    const { data: problemTeams } = await supabase
        .from('teams_v2')
        .select('display_name, birth_year, age_group, matches_played, wins, losses, draws')
        .not('birth_year', 'is', null)
        .limit(500);

    const issues = [];
    for (const t of problemTeams) {
        const expectedAge = 'U' + (2026 - t.birth_year);
        const sumWLD = (t.wins || 0) + (t.losses || 0) + (t.draws || 0);

        if (t.age_group !== expectedAge || sumWLD !== t.matches_played) {
            issues.push({
                display_name: t.display_name?.substring(0, 40),
                birth_year: t.birth_year,
                age_group: t.age_group,
                expected_age_group: expectedAge,
                matches_played: t.matches_played,
                wins: t.wins,
                losses: t.losses,
                draws: t.draws,
                sum_wld: sumWLD
            });
            if (issues.length >= 5) break;
        }
    }

    console.log('Sample issues found:', issues.length);
    if (issues.length > 0) {
        console.table(issues);
    } else {
        console.log('No issues found in sample of 500 teams');
    }

    // Query 7: Check app_rankings view columns
    console.log('\n' + '='.repeat(60));
    console.log('Query 7: Check app_rankings view columns');
    console.log('='.repeat(60));

    const { data: rankingsData, error: err7 } = await supabase
        .from('app_rankings')
        .select('*')
        .limit(1);

    if (err7) {
        console.log('Error:', err7.message);
    } else if (rankingsData && rankingsData.length > 0) {
        const cols = Object.keys(rankingsData[0]);
        console.log(`Total columns: ${cols.length}`);
        console.log('Columns:', cols.join(', '));
    }

    // Query 8: Check app_team_profile view columns
    console.log('\n' + '='.repeat(60));
    console.log('Query 8: Check app_team_profile view columns');
    console.log('='.repeat(60));

    const { data: profileData, error: err8 } = await supabase
        .from('app_team_profile')
        .select('*')
        .limit(1);

    if (err8) {
        console.log('Error:', err8.message);
    } else if (profileData && profileData.length > 0) {
        const cols = Object.keys(profileData[0]);
        console.log(`Total columns: ${cols.length}`);
        console.log('Columns:', cols.join(', '));
    }

    console.log('\n' + '='.repeat(60));
    console.log('AUDIT COMPLETE');
    console.log('='.repeat(60));
}

main().catch(console.error);
