import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const alterSystemSQL = `
-- Update equipment table schema
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS location VARCHAR(255);
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS running_hours INTEGER DEFAULT 0;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS last_maintenance_date TIMESTAMP;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active';

-- Create maintenance_users
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

-- maintenance_records (references equipment_id)
CREATE TABLE IF NOT EXISTS maintenance_records (
  id SERIAL PRIMARY KEY,
  work_order VARCHAR(50) UNIQUE,
  equipment_id INTEGER REFERENCES equipment(equipment_id) ON DELETE CASCADE,
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

-- maintenance_images
CREATE TABLE IF NOT EXISTS maintenance_images (
  id SERIAL PRIMARY KEY,
  maintenance_id INTEGER REFERENCES maintenance_records(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  image_type VARCHAR(20) DEFAULT 'before',
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- maintenance_timeline
CREATE TABLE IF NOT EXISTS maintenance_timeline (
  id SERIAL PRIMARY KEY,
  maintenance_id INTEGER REFERENCES maintenance_records(id) ON DELETE CASCADE,
  status VARCHAR(50) NOT NULL,
  changed_by INTEGER REFERENCES maintenance_users(id),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- spare_parts
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

-- maintenance_parts_used
CREATE TABLE IF NOT EXISTS maintenance_parts_used (
  id SERIAL PRIMARY KEY,
  maintenance_id INTEGER REFERENCES maintenance_records(id) ON DELETE CASCADE,
  spare_part_id INTEGER REFERENCES spare_parts(id),
  quantity INTEGER NOT NULL,
  unit_price DECIMAL(10, 2),
  total_price DECIMAL(10, 2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- maintenance_comments
CREATE TABLE IF NOT EXISTS maintenance_comments (
  id SERIAL PRIMARY KEY,
  maintenance_id INTEGER REFERENCES maintenance_records(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES maintenance_users(id),
  comment TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexing
CREATE INDEX IF NOT EXISTS idx_users_line_user_id ON maintenance_users(line_user_id);
CREATE INDEX IF NOT EXISTS idx_equipment_code ON equipment(equipment_code);
CREATE INDEX IF NOT EXISTS idx_maintenance_work_order ON maintenance_records(work_order);
CREATE INDEX IF NOT EXISTS idx_maintenance_equipment ON maintenance_records(equipment_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_created_by ON maintenance_records(created_by);

-- Updated_at function (might exist)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_users_updated_at') THEN
    CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON maintenance_users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_maintenance_updated_at') THEN
    CREATE TRIGGER update_maintenance_updated_at BEFORE UPDATE ON maintenance_records
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
`;

async function run() {
  console.log('Running Quick Setup (with ALTERS)...');
  await pool.query(alterSystemSQL);
  console.log('Database updated successfully!');
  await pool.end();
}

run().catch(e => {
  console.error('Setup failed:', e);
  process.exit(1);
});
