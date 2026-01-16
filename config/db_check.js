import pg from 'pg';
const { Pool } = pg;

// Override pool error handler to avoid crashing
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function check() {
  try {
    console.log('Checking database tables...');
    const result = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    console.log('Tables found:', result.rows.map(r => r.table_name));
    
    // Check maintenance_users specifically
    const userTable = await pool.query("SELECT to_regclass('public.maintenance_users') as exists");
    console.log('maintenance_users table exists:', userTable.rows[0].exists);
    
    // Check users table
    const oldTable = await pool.query("SELECT to_regclass('public.users') as exists");
    console.log('users table exists:', oldTable.rows[0].exists);

  } catch (err) {
    console.error('Check failed:', err);
  } finally {
    await pool.end();
  }
}

check();
