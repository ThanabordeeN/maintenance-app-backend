import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function backfill() {
    const targetDates = [
        '2026-02-21',
        '2026-02-22',
        '2026-02-23',
        '2026-02-24'
    ];

    console.log('🔄 Starting backfill of equipment_daily_summary for missed days');

    for (const date of targetDates) {
        console.log(`\nProcessing date: ${date}`);
        try {
            const result = await pool.query('SELECT compute_daily_summary($1::DATE) AS upserted', [date]);
            console.log(`✅ Completed ${date}: Upserted ${result.rows[0].upserted} rows.`);
        } catch (error) {
            console.error(`❌ Error computing summary for ${date}:`, error);
        }
    }

    await pool.end();
}

backfill();
