import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function migrate() {
  try {
    console.log('Adding category column to maintenance_records...');
    await pool.query(`
      ALTER TABLE maintenance_records 
      ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'mechanical'
    `);
    console.log('Column added successfully.');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await pool.end();
  }
}

migrate();
