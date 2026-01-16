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

    // เพิ่มข้อมูลตัวอย่าง
    console.log('🌱 Seeding initial data...');
    await appPool.query(seedDataSQL);
    console.log('✅ Initial data seeded successfully');

    await appPool.end();

    console.log('🎉 Database setup completed!\n');

  } catch (error) {
    console.error('❌ Database setup error:', error.message);
    
    if (adminPool) await adminPool.end().catch(() => {});
    if (appPool) await appPool.end().catch(() => {});
    
    throw error;
  }
}
