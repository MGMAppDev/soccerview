const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function runQueries() {
  try {
    // Query 1: Specific teams from screenshots
    console.log('=== QUERY 1: Specific teams from screenshots ===');
    const { data: q1 } = await supabase
      .from('teams_v2')
      .select('display_name, age_group, birth_year')
      .or('display_name.ilike.%Sporting Blue Valley%,display_name.ilike.%Hammers Academy Elite%,display_name.ilike.%Kansas Rush Pre-ECNL%');
    
    console.log(q1);

    // Query 2: Teams with "2013" in name but U11
    console.log('\n=== QUERY 2: Teams with 2013 in name but U11 age_group ===');
    const { data: q2 } = await supabase
      .from('teams_v2')
      .select('display_name, age_group, birth_year')
      .ilike('display_name', '%2013%')
      .eq('age_group', 'U11')
      .limit(10);
    
    console.log(q2);

    // Query 3: Sample of teams to check age matching
    console.log('\n=== QUERY 3: Sample of teams with age in name ===');
    const { data: q3 } = await supabase
      .from('teams_v2')
      .select('display_name, age_group, birth_year')
      .ilike('display_name', '%(U%')
      .limit(20);
    
    q3.forEach(t => {
      const match = t.display_name.match(/\(U(\d+)/);
      const ageInName = match ? match[1] : null;
      const stored = t.age_group;
      console.log(`${t.display_name} | stored: ${stored} | in_name: U${ageInName}`);
    });

  } catch (err) {
    console.error('Error:', err.message);
  }
}

runQueries();
