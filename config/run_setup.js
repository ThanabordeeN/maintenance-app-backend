import pg from 'pg';
import { setupDatabase } from './setup.js';

const { Pool } = pg;

async function migrate() {
    console.log('Starting migration check...');
    if (!process.env.DATABASE_URL) {
        console.error('DATABASE_URL is missing in environment.');
        return;
    }

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
    });
    
    try {
        // Check if users table exists and maintenance_users does NOT
        const usersExists = await pool.query("SELECT to_regclass('public.users')");
        const mainUsersExists = await pool.query("SELECT to_regclass('public.maintenance_users')");
        
        if (usersExists.rows[0].to_regclass && !mainUsersExists.rows[0].to_regclass) {
            console.log('Renaming users to maintenance_users...');
            await pool.query('ALTER TABLE users RENAME TO maintenance_users');
            console.log('Table renamed successfully.');
        } else {
            console.log('Skipping rename (users table missing or maintenance_users already exists).');
        }
    } catch (e) {
        console.log('Migration step warning:', e.message);
    } finally {
        await pool.end();
    }
}

console.log('Running Setup Script...');
migrate().then(() => {
    console.log('Calling setupDatabase()...');
    return setupDatabase();
}).then(() => {
    console.log('Setup Script Completed Successfully.');
    process.exit(0);
}).catch(err => {
    console.error('Setup Script Failed:', err);
    process.exit(1);
});
