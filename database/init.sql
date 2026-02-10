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
  category VARCHAR(100),
  title VARCHAR(255),
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

-- Add condition and image_url to equipment_usage_logs
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='equipment_usage_logs' AND column_name='condition') THEN
    ALTER TABLE equipment_usage_logs ADD COLUMN condition VARCHAR(50) DEFAULT 'normal';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='equipment_usage_logs' AND column_name='image_url') THEN
    ALTER TABLE equipment_usage_logs ADD COLUMN image_url TEXT;
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

