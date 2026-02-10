import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function get() {
    try {
        const res = await pool.query('SELECT equipment_id FROM equipment LIMIT 1');
        if (res.rows.length > 0) {
            console.log('EQUIPMENT_ID:', res.rows[0].equipment_id);
        } else {
            console.log('NO_EQUIPMENT_FOUND');
        }
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
get();
