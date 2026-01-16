import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function addUser() {
  const lineUserId = 'U90133dcbc213bb439cd4ebbfb510401d';
  const displayName = 'Developer'; // Default name
  const role = 'admin';

  try {
    console.log(`Adding user ${lineUserId}...`);
    
    // Check if exists first
    const check = await pool.query('SELECT * FROM maintenance_users WHERE line_user_id = $1', [lineUserId]);
    
    if (check.rows.length > 0) {
        console.log('User already exists. Updating role to admin...');
        await pool.query('UPDATE maintenance_users SET role = $1 WHERE line_user_id = $2', [role, lineUserId]);
    } else {
        await pool.query(
          `INSERT INTO maintenance_users (line_user_id, display_name, role) 
           VALUES ($1, $2, $3)`,
          [lineUserId, displayName, role]
        );
        console.log('User added successfully.');
    }
    
  } catch (error) {
    console.error('Error adding user:', error);
  } finally {
    await pool.end();
  }
}

addUser();
