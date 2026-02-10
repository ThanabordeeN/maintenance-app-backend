import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function list() {
    try {
        console.log('Listing top 10 maintenance records...');
        const res = await pool.query('SELECT id, work_order, status, maintenance_type, created_at FROM maintenance_records ORDER BY created_at DESC LIMIT 10');
        console.table(res.rows);
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
list();
