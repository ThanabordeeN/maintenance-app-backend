import express, { Request, Response, Router } from 'express';
import pool from '../config/database.js';

const router: Router = express.Router();

// Run all migrations to create missing tables
router.post('/migrate', async (req: Request, res: Response) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // ===========================================
    // PHASE 1: Foundation Tables
    // ===========================================

    // 1. Spare Parts table (if not exists)
    await client.query(`
      CREATE TABLE IF NOT EXISTS spare_parts (
        id SERIAL PRIMARY KEY,
        part_code VARCHAR(50) UNIQUE NOT NULL,
        part_name VARCHAR(255) NOT NULL,
        description TEXT,
        category VARCHAR(100),
        unit VARCHAR(50) DEFAULT 'ชิ้น',
        unit_price DECIMAL(12,2) DEFAULT 0,
        current_stock INTEGER DEFAULT 0,
        min_stock_level INTEGER DEFAULT 0,
        max_stock_level INTEGER DEFAULT 100,
        location VARCHAR(255),
        supplier VARCHAR(255),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // 2. Parts used in maintenance
    await client.query(`
      CREATE TABLE IF NOT EXISTS maintenance_parts_used (
        id SERIAL PRIMARY KEY,
        maintenance_record_id INTEGER REFERENCES maintenance_records(id) ON DELETE CASCADE,
        spare_part_id INTEGER REFERENCES spare_parts(id),
        quantity INTEGER NOT NULL DEFAULT 1,
        unit_price DECIMAL(12,2) DEFAULT 0,
        total_price DECIMAL(12,2) DEFAULT 0,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // 3. Stock transactions (in/out history)
    await client.query(`
      CREATE TABLE IF NOT EXISTS spare_parts_transactions (
        id SERIAL PRIMARY KEY,
        spare_part_id INTEGER REFERENCES spare_parts(id) ON DELETE CASCADE,
        transaction_type VARCHAR(20) NOT NULL, -- 'in', 'out', 'adjust'
        quantity INTEGER NOT NULL,
        reference_type VARCHAR(50), -- 'maintenance', 'purchase', 'adjustment'
        reference_id INTEGER,
        notes TEXT,
        created_by INTEGER REFERENCES maintenance_users(id),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // ===========================================
    // PHASE 2: Reporting & KPI Tables
    // ===========================================

    // 4. KPI Snapshots for historical data
    await client.query(`
      CREATE TABLE IF NOT EXISTS kpi_snapshots (
        id SERIAL PRIMARY KEY,
        snapshot_date DATE NOT NULL,
        equipment_id INTEGER REFERENCES equipment(id) ON DELETE CASCADE,
        mtbf_hours DECIMAL(12,2),
        mttr_hours DECIMAL(12,2),
        availability_percent DECIMAL(5,2),
        total_downtime_hours DECIMAL(12,2),
        total_maintenance_count INTEGER DEFAULT 0,
        total_cost DECIMAL(12,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(snapshot_date, equipment_id)
      )
    `);

    // ===========================================
    // PHASE 3: Notifications Tables
    // ===========================================

    // 5. Notifications table
    await client.query(`
      CREATE TABLE IF NOT EXISTS maintenance_notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES maintenance_users(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        message TEXT,
        type VARCHAR(50) DEFAULT 'info', -- 'info', 'warning', 'error', 'success'
        category VARCHAR(50), -- 'maintenance', 'parts', 'schedule', 'system'
        reference_type VARCHAR(50),
        reference_id INTEGER,
        is_read BOOLEAN DEFAULT false,
        is_sent BOOLEAN DEFAULT false,
        sent_via VARCHAR(50), -- 'line', 'email', 'push'
        created_at TIMESTAMP DEFAULT NOW(),
        read_at TIMESTAMP
      )
    `);

    // 6. Notification preferences
    await client.query(`
      CREATE TABLE IF NOT EXISTS notification_preferences (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES maintenance_users(id) ON DELETE CASCADE UNIQUE,
        enable_line_push BOOLEAN DEFAULT true,
        enable_email BOOLEAN DEFAULT false,
        enable_in_app BOOLEAN DEFAULT true,
        notify_new_ticket BOOLEAN DEFAULT true,
        notify_assigned BOOLEAN DEFAULT true,
        notify_status_change BOOLEAN DEFAULT true,
        notify_overdue BOOLEAN DEFAULT true,
        notify_low_stock BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // ===========================================
    // PHASE 4: Checklists & Documents Tables
    // ===========================================

    // 7. Checklist templates
    await client.query(`
      CREATE TABLE IF NOT EXISTS checklist_templates (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        category VARCHAR(100),
        equipment_type VARCHAR(100),
        is_active BOOLEAN DEFAULT true,
        created_by INTEGER REFERENCES maintenance_users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // 8. Checklist template items
    await client.query(`
      CREATE TABLE IF NOT EXISTS checklist_template_items (
        id SERIAL PRIMARY KEY,
        template_id INTEGER REFERENCES checklist_templates(id) ON DELETE CASCADE,
        item_order INTEGER DEFAULT 0,
        item_text VARCHAR(500) NOT NULL,
        item_type VARCHAR(50) DEFAULT 'checkbox', -- 'checkbox', 'text', 'number', 'select'
        options JSONB, -- for select type
        is_required BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // 9. Completed checklists
    await client.query(`
      CREATE TABLE IF NOT EXISTS checklist_responses (
        id SERIAL PRIMARY KEY,
        template_id INTEGER REFERENCES checklist_templates(id),
        maintenance_record_id INTEGER REFERENCES maintenance_records(id) ON DELETE CASCADE,
        equipment_id INTEGER REFERENCES equipment(id),
        completed_by INTEGER REFERENCES maintenance_users(id),
        completed_at TIMESTAMP DEFAULT NOW(),
        notes TEXT
      )
    `);

    // 10. Checklist response items
    await client.query(`
      CREATE TABLE IF NOT EXISTS checklist_response_items (
        id SERIAL PRIMARY KEY,
        response_id INTEGER REFERENCES checklist_responses(id) ON DELETE CASCADE,
        template_item_id INTEGER REFERENCES checklist_template_items(id),
        item_text VARCHAR(500),
        response_value TEXT,
        is_passed BOOLEAN,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // 11. Equipment documents
    await client.query(`
      CREATE TABLE IF NOT EXISTS equipment_documents (
        id SERIAL PRIMARY KEY,
        equipment_id INTEGER REFERENCES equipment(id) ON DELETE CASCADE,
        document_type VARCHAR(100), -- 'manual', 'schematic', 'warranty', 'certificate', 'other'
        title VARCHAR(255) NOT NULL,
        description TEXT,
        file_path VARCHAR(500),
        file_name VARCHAR(255),
        file_size INTEGER,
        mime_type VARCHAR(100),
        uploaded_by INTEGER REFERENCES maintenance_users(id),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // 12. Equipment warranties
    await client.query(`
      CREATE TABLE IF NOT EXISTS equipment_warranties (
        id SERIAL PRIMARY KEY,
        equipment_id INTEGER REFERENCES equipment(id) ON DELETE CASCADE,
        warranty_type VARCHAR(100), -- 'manufacturer', 'extended', 'parts'
        provider VARCHAR(255),
        start_date DATE,
        end_date DATE,
        coverage_details TEXT,
        contact_info TEXT,
        document_path VARCHAR(500),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // 13. Vendors table
    await client.query(`
      CREATE TABLE IF NOT EXISTS vendors (
        id SERIAL PRIMARY KEY,
        vendor_code VARCHAR(50) UNIQUE,
        vendor_name VARCHAR(255) NOT NULL,
        vendor_type VARCHAR(100), -- 'supplier', 'contractor', 'manufacturer'
        contact_person VARCHAR(255),
        phone VARCHAR(50),
        email VARCHAR(255),
        address TEXT,
        tax_id VARCHAR(50),
        payment_terms VARCHAR(100),
        notes TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // 14. Add missing columns to maintenance_records if not exist
    const addColumnIfNotExists = async (table: string, column: string, definition: string) => {
      const check = await client.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_name = $1 AND column_name = $2
      `, [table, column]);
      
      if (check.rows.length === 0) {
        await client.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      }
    };

    await addColumnIfNotExists('maintenance_records', 'labor_cost', 'DECIMAL(12,2) DEFAULT 0');
    await addColumnIfNotExists('maintenance_records', 'parts_cost', 'DECIMAL(12,2) DEFAULT 0');
    await addColumnIfNotExists('maintenance_records', 'total_cost', 'DECIMAL(12,2) DEFAULT 0');
    await addColumnIfNotExists('maintenance_records', 'downtime_start', 'TIMESTAMP');
    await addColumnIfNotExists('maintenance_records', 'downtime_end', 'TIMESTAMP');
    await addColumnIfNotExists('maintenance_records', 'downtime_hours', 'DECIMAL(10,2)');
    await addColumnIfNotExists('maintenance_records', 'root_cause', 'TEXT');
    await addColumnIfNotExists('maintenance_records', 'action_taken', 'TEXT');
    await addColumnIfNotExists('maintenance_records', 'checklist_id', 'INTEGER REFERENCES checklist_responses(id)');

    await addColumnIfNotExists('equipment', 'purchase_date', 'DATE');
    await addColumnIfNotExists('equipment', 'installation_date', 'DATE');
    await addColumnIfNotExists('equipment', 'manufacturer', 'VARCHAR(255)');
    await addColumnIfNotExists('equipment', 'model', 'VARCHAR(255)');
    await addColumnIfNotExists('equipment', 'serial_number', 'VARCHAR(255)');
    await addColumnIfNotExists('equipment', 'vendor_id', 'INTEGER REFERENCES vendors(id)');

    await addColumnIfNotExists('spare_parts', 'vendor_id', 'INTEGER REFERENCES vendors(id)');

    await client.query('COMMIT');

    res.json({ 
      success: true, 
      message: 'All migrations completed successfully',
      tables_created: [
        'spare_parts',
        'maintenance_parts_used',
        'spare_parts_transactions',
        'kpi_snapshots',
        'maintenance_notifications',
        'notification_preferences',
        'checklist_templates',
        'checklist_template_items',
        'checklist_responses',
        'checklist_response_items',
        'equipment_documents',
        'equipment_warranties',
        'vendors'
      ]
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Migration error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// Check database status
router.get('/status', async (req: Request, res: Response) => {
  try {
    const tables = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);

    const tableStatus = await Promise.all(
      tables.rows.map(async (t: any) => {
        const count = await pool.query(`SELECT COUNT(*) FROM ${t.table_name}`);
        return {
          name: t.table_name,
          count: parseInt(count.rows[0].count)
        };
      })
    );

    res.json({ tables: tableStatus });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
