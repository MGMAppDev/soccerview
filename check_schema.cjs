require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkSchema() {
  // Get one row to see columns
  const { data: sample, error } = await supabase
    .from('teams_v2')
    .select('*')
    .limit(1);
    
  if (error) {
    console.error('Error:', error);
    return;
  }
  
  console.log('teams_v2 columns:', Object.keys(sample[0] || {}));
  console.log('\nSample row:', JSON.stringify(sample[0], null, 2));
}

checkSchema().catch(console.error);
