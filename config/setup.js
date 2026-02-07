import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// SQL สำหรับสร้าง tables
const createTablesSQL = `
-- ตารางผู้ใช้ที่มีสิทธิ์เข้าถึงระบบ
CREATE TABLE IF NOT EXISTS maintenance_users (
  id SERIAL PRIMARY KEY,
  line_user_id VARCHAR(255) UNIQUE NOT NULL,
  display_name VARCHAR(255),
  picture_url TEXT,
  email VARCHAR(255),
  role VARCHAR(50) DEFAULT 'technician',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ตารางอุปกรณ์
CREATE TABLE IF NOT EXISTS equipment (
  id SERIAL PRIMARY KEY,
  equipment_name VARCHAR(255) NOT NULL,
  equipment_code VARCHAR(100) UNIQUE NOT NULL,
  location VARCHAR(255),
  description TEXT,
  running_hours INTEGER DEFAULT 0,
  last_maintenance_date TIMESTAMP,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ตารางบันทึกการ Maintenance
CREATE TABLE IF NOT EXISTS maintenance_records (
  id SERIAL PRIMARY KEY,
  work_order VARCHAR(50) UNIQUE,
  equipment_id INTEGER REFERENCES equipment(id) ON DELETE CASCADE,
  created_by INTEGER REFERENCES maintenance_users(id),
  assigned_to INTEGER REFERENCES maintenance_users(id),
  maintenance_type VARCHAR(100) NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  priority VARCHAR(20) DEFAULT 'low',
  description TEXT,
  notes TEXT,
  root_cause TEXT,
  action_taken TEXT,
  cancelled_reason TEXT,
  on_hold_reason TEXT,
  scheduled_date TIMESTAMP,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  downtime_minutes INTEGER,
  labor_cost DECIMAL(10, 2),
  parts_cost DECIMAL(10, 2),
  total_cost DECIMAL(10, 2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ตารางรูปภาพแนบ
CREATE TABLE IF NOT EXISTS maintenance_images (
  id SERIAL PRIMARY KEY,
  maintenance_id INTEGER REFERENCES maintenance_records(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  image_type VARCHAR(20) DEFAULT 'before',
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ตารางประวัติการเปลี่ยนสถานะ
CREATE TABLE IF NOT EXISTS maintenance_timeline (
  id SERIAL PRIMARY KEY,
  maintenance_id INTEGER REFERENCES maintenance_records(id) ON DELETE CASCADE,
  status VARCHAR(50) NOT NULL,
  changed_by INTEGER REFERENCES maintenance_users(id),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ตารางอะไหล่
CREATE TABLE IF NOT EXISTS spare_parts (
  id SERIAL PRIMARY KEY,
  part_name VARCHAR(255) NOT NULL,
  part_code VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  unit_price DECIMAL(10, 2),
  quantity_in_stock INTEGER DEFAULT 0,
  min_stock_level INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ตารางอะไหล่ที่ใช้ในการซ่อม
CREATE TABLE IF NOT EXISTS maintenance_parts_used (
  id SERIAL PRIMARY KEY,
  maintenance_id INTEGER REFERENCES maintenance_records(id) ON DELETE CASCADE,
  spare_part_id INTEGER REFERENCES spare_parts(id),
  quantity INTEGER NOT NULL,
  unit_price DECIMAL(10, 2),
  total_price DECIMAL(10, 2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ตาราง Comments
CREATE TABLE IF NOT EXISTS maintenance_comments (
  id SERIAL PRIMARY KEY,
  maintenance_id INTEGER REFERENCES maintenance_records(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES maintenance_users(id),
  comment TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- สร้าง Index เพื่อเพิ่มประสิทธิภาพ
CREATE INDEX IF NOT EXISTS idx_users_line_user_id ON maintenance_users(line_user_id);
CREATE INDEX IF NOT EXISTS idx_equipment_code ON equipment(equipment_code);
CREATE INDEX IF NOT EXISTS idx_equipment_status ON equipment(status);
CREATE INDEX IF NOT EXISTS idx_maintenance_work_order ON maintenance_records(work_order);
CREATE INDEX IF NOT EXISTS idx_maintenance_equipment ON maintenance_records(equipment_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_created_by ON maintenance_records(created_by);
CREATE INDEX IF NOT EXISTS idx_maintenance_assigned_to ON maintenance_records(assigned_to);
CREATE INDEX IF NOT EXISTS idx_maintenance_status ON maintenance_records(status);
CREATE INDEX IF NOT EXISTS idx_maintenance_priority ON maintenance_records(priority);
CREATE INDEX IF NOT EXISTS idx_timeline_maintenance ON maintenance_timeline(maintenance_id);
CREATE INDEX IF NOT EXISTS idx_parts_used_maintenance ON maintenance_parts_used(maintenance_id);
CREATE INDEX IF NOT EXISTS idx_comments_maintenance ON maintenance_comments(maintenance_id);

-- Function สำหรับอัพเดท updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger สำหรับ updated_at
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_users_updated_at') THEN
    CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON maintenance_users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_equipment_updated_at') THEN
    CREATE TRIGGER update_equipment_updated_at BEFORE UPDATE ON equipment
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_maintenance_updated_at') THEN
    CREATE TRIGGER update_maintenance_updated_at BEFORE UPDATE ON maintenance_records
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
`;

// Migration: Add maintenance tracking columns and schedules table
const maintenanceTrackingMigrationSQL = `
-- Migration: Add maintenance unit tracking to equipment
DO $$
BEGIN
  -- Add equipment_type column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='equipment' AND column_name='equipment_type') THEN
    ALTER TABLE equipment ADD COLUMN equipment_type VARCHAR(100);
  END IF;

  -- Add columns to equipment table if they don't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='equipment' AND column_name='maintenance_unit') THEN
    ALTER TABLE equipment ADD COLUMN maintenance_unit VARCHAR(50);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='equipment' AND column_name='initial_usage') THEN
    ALTER TABLE equipment ADD COLUMN initial_usage DECIMAL(10,2) DEFAULT 0;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='equipment' AND column_name='current_usage') THEN
    ALTER TABLE equipment ADD COLUMN current_usage DECIMAL(10,2) DEFAULT 0;
  END IF;

  -- Add is_active column with default TRUE (equipment is active by default)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='equipment' AND column_name='is_active') THEN
    ALTER TABLE equipment ADD COLUMN is_active BOOLEAN DEFAULT TRUE;
  END IF;
END $$;

-- Create equipment_maintenance_schedules table
CREATE TABLE IF NOT EXISTS equipment_maintenance_schedules (
  id SERIAL PRIMARY KEY,
  equipment_id INTEGER REFERENCES equipment(id) ON DELETE CASCADE,
  interval_value INTEGER NOT NULL,
  start_from_usage DECIMAL(10,2) DEFAULT 0,
  description TEXT,
  last_completed_at_usage DECIMAL(12,2) DEFAULT 0,
  current_ticket_id INTEGER REFERENCES maintenance_records(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add new columns to existing table if needed
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='equipment_maintenance_schedules' AND column_name='last_completed_at_usage') THEN
    ALTER TABLE equipment_maintenance_schedules ADD COLUMN last_completed_at_usage DECIMAL(12,2) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='equipment_maintenance_schedules' AND column_name='current_ticket_id') THEN
    ALTER TABLE equipment_maintenance_schedules ADD COLUMN current_ticket_id INTEGER REFERENCES maintenance_records(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_maintenance_schedules_equipment 
ON equipment_maintenance_schedules(equipment_id);

-- Add trigger for updated_at on maintenance_schedules
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_maintenance_schedules_updated_at') THEN
    CREATE TRIGGER update_maintenance_schedules_updated_at 
    BEFORE UPDATE ON equipment_maintenance_schedules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- Create equipment_usage_logs table for tracking daily usage
CREATE TABLE IF NOT EXISTS equipment_usage_logs (
  id SERIAL PRIMARY KEY,
  equipment_id INTEGER REFERENCES equipment(id) ON DELETE CASCADE,
  usage_value DECIMAL(12,2) NOT NULL,
  log_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  recorded_by INTEGER REFERENCES maintenance_users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for usage logs
CREATE INDEX IF NOT EXISTS idx_usage_logs_equipment 
ON equipment_usage_logs(equipment_id);

CREATE INDEX IF NOT EXISTS idx_usage_logs_date 
ON equipment_usage_logs(log_date DESC);

-- Add trigger for updated_at on usage_logs
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_usage_logs_updated_at') THEN
    CREATE TRIGGER update_usage_logs_updated_at 
    BEFORE UPDATE ON equipment_usage_logs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- Add noti_list column to maintenance_users for fast notification polling
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='maintenance_users' AND column_name='noti_list') THEN
    ALTER TABLE maintenance_users ADD COLUMN noti_list JSONB DEFAULT '{}'::jsonb;
  END IF;
END $$;

-- Create maintenance_notifications table if not exists
CREATE TABLE IF NOT EXISTS maintenance_notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES maintenance_users(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  message TEXT,
  type VARCHAR(50) DEFAULT 'info',
  category VARCHAR(100),
  reference_type VARCHAR(100),
  reference_id INTEGER,
  is_read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON maintenance_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON maintenance_notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON maintenance_notifications(created_at DESC);
`;

// Phase 5 Migrations: Purchase & Stock System
async function runPhase5Migrations(pool) {
  const client = await pool.connect();
  try {
    // Helper function to add column if not exists
    const addColumnIfNotExists = async (table, column, definition) => {
      const check = await client.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_name = $1 AND column_name = $2
      `, [table, column]);
      if (check.rows.length === 0) {
        await client.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        console.log(`   Added column ${table}.${column}`);
      }
    };

    // Add missing columns to spare_parts
    await addColumnIfNotExists('spare_parts', 'category', 'VARCHAR(100)');
    await addColumnIfNotExists('spare_parts', 'unit', "VARCHAR(50) DEFAULT 'ชิ้น'");
    await addColumnIfNotExists('spare_parts', 'current_stock', 'INTEGER DEFAULT 0');
    await addColumnIfNotExists('spare_parts', 'max_stock_level', 'INTEGER DEFAULT 100');
    await addColumnIfNotExists('spare_parts', 'location', 'VARCHAR(255)');
    await addColumnIfNotExists('spare_parts', 'supplier', 'VARCHAR(255)');
    await addColumnIfNotExists('spare_parts', 'is_active', 'BOOLEAN DEFAULT true');
    await addColumnIfNotExists('spare_parts', 'updated_at', 'TIMESTAMP DEFAULT NOW()');
    await addColumnIfNotExists('spare_parts', 'vendor_id', 'INTEGER');

    // Sync current_stock with quantity_in_stock if current_stock is 0
    await client.query(`
      UPDATE spare_parts SET current_stock = quantity_in_stock 
      WHERE current_stock = 0 AND quantity_in_stock > 0
    `);

    // Vendors table
    await client.query(`
      CREATE TABLE IF NOT EXISTS vendors (
        id SERIAL PRIMARY KEY,
        vendor_code VARCHAR(50) UNIQUE,
        vendor_name VARCHAR(255) NOT NULL,
        vendor_type VARCHAR(100),
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

    // Purchase Requisitions
    await client.query(`
      CREATE TABLE IF NOT EXISTS purchase_requisitions (
        id SERIAL PRIMARY KEY,
        pr_number VARCHAR(50) UNIQUE NOT NULL,
        maintenance_record_id INTEGER REFERENCES maintenance_records(id) ON DELETE SET NULL,
        requested_by INTEGER REFERENCES maintenance_users(id),
        status VARCHAR(50) DEFAULT 'pending',
        priority VARCHAR(20) DEFAULT 'normal',
        total_amount DECIMAL(12,2) DEFAULT 0,
        notes TEXT,
        rejection_reason TEXT,
        approved_by INTEGER REFERENCES maintenance_users(id),
        approved_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Purchase Orders
    await client.query(`
      CREATE TABLE IF NOT EXISTS purchase_orders (
        id SERIAL PRIMARY KEY,
        po_number VARCHAR(50) UNIQUE NOT NULL,
        pr_id INTEGER REFERENCES purchase_requisitions(id) ON DELETE SET NULL,
        vendor_id INTEGER REFERENCES vendors(id),
        status VARCHAR(50) DEFAULT 'draft',
        total_amount DECIMAL(12,2) DEFAULT 0,
        tax_rate DECIMAL(5,2) DEFAULT 7,
        tax_amount DECIMAL(12,2) DEFAULT 0,
        grand_total DECIMAL(12,2) DEFAULT 0,
        payment_terms VARCHAR(255),
        delivery_date DATE,
        delivery_address TEXT,
        notes TEXT,
        created_by INTEGER REFERENCES maintenance_users(id),
        approved_by INTEGER REFERENCES maintenance_users(id),
        approved_at TIMESTAMP,
        sent_at TIMESTAMP,
        received_at TIMESTAMP,
        ordered_by INTEGER REFERENCES maintenance_users(id),
        ordered_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Purchase Requisition Items
    await client.query(`
      CREATE TABLE IF NOT EXISTS purchase_requisition_items (
        id SERIAL PRIMARY KEY,
        pr_id INTEGER REFERENCES purchase_requisitions(id) ON DELETE CASCADE,
        spare_part_id INTEGER REFERENCES spare_parts(id) ON DELETE SET NULL,
        custom_item_name VARCHAR(255),
        custom_item_unit VARCHAR(50) DEFAULT 'ชิ้น',
        quantity INTEGER NOT NULL DEFAULT 1,
        unit_price DECIMAL(12,2) DEFAULT 0,
        total_price DECIMAL(12,2) DEFAULT 0,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Purchase Order Items
    await client.query(`
      CREATE TABLE IF NOT EXISTS purchase_order_items (
        id SERIAL PRIMARY KEY,
        po_id INTEGER REFERENCES purchase_orders(id) ON DELETE CASCADE,
        pr_item_id INTEGER REFERENCES purchase_requisition_items(id) ON DELETE SET NULL,
        spare_part_id INTEGER REFERENCES spare_parts(id) ON DELETE SET NULL,
        custom_item_name VARCHAR(255),
        custom_item_unit VARCHAR(50) DEFAULT 'ชิ้น',
        quantity INTEGER NOT NULL DEFAULT 1,
        unit_price DECIMAL(12,2) DEFAULT 0,
        total_price DECIMAL(12,2) DEFAULT 0,
        received_quantity INTEGER DEFAULT 0,
        actual_unit_price DECIMAL(12,2),
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Spare Parts Transactions
    await client.query(`
      CREATE TABLE IF NOT EXISTS spare_parts_transactions (
        id SERIAL PRIMARY KEY,
        spare_part_id INTEGER REFERENCES spare_parts(id) ON DELETE CASCADE,
        transaction_type VARCHAR(20) NOT NULL,
        quantity INTEGER NOT NULL,
        reference_type VARCHAR(50),
        reference_id INTEGER,
        notes TEXT,
        created_by INTEGER REFERENCES maintenance_users(id),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Parts Returns
    await client.query(`
      CREATE TABLE IF NOT EXISTS parts_returns (
        id SERIAL PRIMARY KEY,
        return_number VARCHAR(50) UNIQUE NOT NULL,
        maintenance_record_id INTEGER REFERENCES maintenance_records(id) ON DELETE SET NULL,
        maintenance_part_used_id INTEGER,
        spare_part_id INTEGER REFERENCES spare_parts(id) ON DELETE SET NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        reason VARCHAR(50) NOT NULL,
        notes TEXT,
        returned_by INTEGER REFERENCES maintenance_users(id),
        status VARCHAR(50) DEFAULT 'pending',
        approved_by INTEGER REFERENCES maintenance_users(id),
        approved_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Add columns to maintenance_records
    await addColumnIfNotExists('maintenance_records', 'waiting_for_parts', 'BOOLEAN DEFAULT false');
    await addColumnIfNotExists('maintenance_records', 'checklist_id', 'INTEGER');

    // Add columns to maintenance_parts_used
    await addColumnIfNotExists('maintenance_parts_used', 'custom_item_name', 'VARCHAR(255)');
    await addColumnIfNotExists('maintenance_parts_used', 'is_custom', 'BOOLEAN DEFAULT false');
    await addColumnIfNotExists('maintenance_parts_used', 'pr_item_id', 'INTEGER');
    await addColumnIfNotExists('maintenance_parts_used', 'status', "VARCHAR(50) DEFAULT 'pending'");

    // Add columns to equipment
    await addColumnIfNotExists('equipment', 'purchase_date', 'DATE');
    await addColumnIfNotExists('equipment', 'installation_date', 'DATE');
    await addColumnIfNotExists('equipment', 'manufacturer', 'VARCHAR(255)');
    await addColumnIfNotExists('equipment', 'model', 'VARCHAR(255)');
    await addColumnIfNotExists('equipment', 'serial_number', 'VARCHAR(255)');
    await addColumnIfNotExists('equipment', 'vendor_id', 'INTEGER');
    await addColumnIfNotExists('equipment', 'downtime_started_at', 'TIMESTAMP');

    // Create indexes
    await client.query('CREATE INDEX IF NOT EXISTS idx_pr_maintenance ON purchase_requisitions(maintenance_record_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_po_pr ON purchase_orders(pr_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_transactions_part ON spare_parts_transactions(spare_part_id)');

  } finally {
    client.release();
  }
}

// SQL สำหรับสร้างข้อมูลตัวอย่าง
const seedDataSQL = `
-- ตรวจสอบว่ามีข้อมูลหรือยัง
DO $$
BEGIN
  -- เพิ่มข้อมูลตัวอย่างอุปกรณ์ ถ้ายังไม่มี
  IF NOT EXISTS (SELECT 1 FROM equipment LIMIT 1) THEN
    INSERT INTO equipment (equipment_name, equipment_code, location, description, running_hours, status) VALUES 
    ('Air Compressor A1', 'AC-001', 'Production Line A', 'เครื่องอัดอากาศสำหรับระบบลม', 5000, 'active'),
    ('Conveyor Belt #3', 'CB-003', 'Production Line A', 'สายพานลำเลียงผลิตภัณฑ์', 8000, 'active'),
    ('Generator G1', 'GEN-001', 'Building B - Basement', 'เครื่องกำเนิดไฟฟ้าสำรอง', 3000, 'active'),
    ('Cooling Tower CT-01', 'CT-001', 'Rooftop Building A', 'หอผึ่งน้ำระบบปรับอากาศ', 12000, 'active'),
    ('Forklift FK-01', 'FK-001', 'Warehouse', 'รถโฟล์คลิฟท์ 2.5 ตัน', 6500, 'active');
  END IF;
  
  -- เพิ่มข้อมูลอะไหล่ตัวอย่าง ถ้ายังไม่มี
  IF NOT EXISTS (SELECT 1 FROM spare_parts LIMIT 1) THEN
    INSERT INTO spare_parts (part_name, part_code, unit_price, quantity_in_stock, min_stock_level) VALUES
    ('V-Belt Type A', 'BELT-A-001', 350.00, 10, 3),
    ('Bearing 6205', 'BEAR-6205', 250.00, 15, 5),
    ('Motor Oil 5L', 'OIL-5L', 450.00, 8, 2),
    ('Air Filter', 'FILT-001', 180.00, 12, 4),
    ('Hydraulic Oil 20L', 'OIL-HYD-20', 1200.00, 5, 2);
  END IF;
END $$;
`;

export async function setupDatabase() {
  let adminPool;
  let appPool;

  try {
    // Parse DATABASE_URL
    const dbUrl = new URL(process.env.DATABASE_URL);
    const dbName = dbUrl.pathname.slice(1); // ตัด / ออก

    // เชื่อมต่อกับ postgres database (default database)
    const adminDbUrl = new URL(process.env.DATABASE_URL);
    adminDbUrl.pathname = '/postgres';

    adminPool = new Pool({
      connectionString: adminDbUrl.toString(),
    });

    console.log('🔍 Checking if database exists...');

    // ตรวจสอบว่า database มีอยู่หรือไม่
    const checkDbResult = await adminPool.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName]
    );

    if (checkDbResult.rows.length === 0) {
      // สร้าง database ใหม่
      console.log(`📦 Creating database '${dbName}'...`);
      await adminPool.query(`CREATE DATABASE ${dbName}`);
      console.log(`✅ Database '${dbName}' created successfully`);
    } else {
      console.log(`✅ Database '${dbName}' already exists`);
    }

    await adminPool.end();

    // เชื่อมต่อกับ database ของเรา
    appPool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });

    console.log('🔨 Creating tables...');

    // สร้าง tables
    await appPool.query(createTablesSQL);
    console.log('✅ Tables created successfully');

    // Run migrations
    console.log('🔄 Running migrations...');
    await appPool.query(maintenanceTrackingMigrationSQL);
    console.log('✅ Migrations completed successfully');

    // Run Phase 5 migrations (PR/PO system)
    console.log('🔄 Running Phase 5 migrations (Purchase/Stock system)...');
    await runPhase5Migrations(appPool);
    console.log('✅ Phase 5 migrations completed successfully');

    // เพิ่มข้อมูลตัวอย่าง
    console.log('🌱 Seeding initial data...');
    await appPool.query(seedDataSQL);
    console.log('✅ Initial data seeded successfully');

    await appPool.end();

    console.log('🎉 Database setup completed!\n');

  } catch (error) {
    console.error('❌ Database setup error:', error.message);

    if (adminPool) await adminPool.end().catch(() => { });
    if (appPool) await appPool.end().catch(() => { });

    throw error;
  }
}
