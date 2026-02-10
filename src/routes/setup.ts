import express, { Request, Response, Router } from 'express';
import pool from '../config/database.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const router: Router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Run database migrations
router.post('/migrate', async (req: Request, res: Response) => {
  try {
    // Path to the migration SQL file
    const migrationPath = path.join(__dirname, '../../../../../../database/prisma/migrations/20260210135855_add_maintenance_system_complete/migration.sql');
    
    if (!fs.existsSync(migrationPath)) {
      console.error('Migration file not found at:', migrationPath);
      return res.status(500).json({ error: 'Migration file not found' });
    }

    const sql = fs.readFileSync(migrationPath, 'utf8');

    // Execute migration
    await pool.query(sql);

    // Get current tables to verify
    const tables = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);

    res.json({
      success: true,
      message: 'Migration executed successfully',
      tables: tables.rows.map(r => r.table_name)
    });
  } catch (error: any) {
    console.error('Migration failed:', error);
    res.status(500).json({ 
      error: 'Migration failed', 
      details: error.message 
    });
  }
});

// Check database status
router.get('/status', async (req: Request, res: Response) => {
  try {
    const tables = await pool.query(`
      SELECT table_name, 
             (SELECT count(*) FROM "public"."table_name") as count -- This is pseudo-code for demo, will need individual queries
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);

    // Real table counts
    const tableNames = ['equipment', 'maintenance_records', 'equipment_usage_logs', 'maintenance_users'];
    const counts = [];

    for (const table of tableNames) {
      try {
        const result = await pool.query(`SELECT COUNT(*) FROM "${table}"`);
        counts.push({ name: table, count: parseInt(result.rows[0].count) });
      } catch (e) {
        counts.push({ name: table, count: -1, error: 'Table not found' });
      }
    }

    res.json({ tables: counts });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
