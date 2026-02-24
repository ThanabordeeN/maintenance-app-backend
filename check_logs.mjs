import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
    try {
        const client = await pool.connect();

        console.log("--- ct_sensor_data ---");
        const res = await client.query("SELECT DATE(time AT TIME ZONE 'Asia/Bangkok') as date, COUNT(*) FROM ct_sensor_data WHERE time >= '2026-02-18' GROUP BY DATE(time AT TIME ZONE 'Asia/Bangkok') ORDER BY date");
        console.table(res.rows);

        client.release();
    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}

run();
