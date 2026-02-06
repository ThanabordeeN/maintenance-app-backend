-- Migration: Add maintenance unit tracking to equipment
-- Date: 2026-02-06

-- Add columns to equipment table
ALTER TABLE equipment 
ADD COLUMN IF NOT EXISTS maintenance_unit VARCHAR(50),
ADD COLUMN IF NOT EXISTS initial_usage DECIMAL(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS current_usage DECIMAL(10,2) DEFAULT 0;

-- Create equipment_maintenance_schedules table
CREATE TABLE IF NOT EXISTS equipment_maintenance_schedules (
  id SERIAL PRIMARY KEY,
  equipment_id INTEGER REFERENCES equipment(id) ON DELETE CASCADE,
  interval_value INTEGER NOT NULL,
  start_from_usage DECIMAL(10,2) DEFAULT 0,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_maintenance_schedules_equipment 
ON equipment_maintenance_schedules(equipment_id);

-- Add trigger for updated_at
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_maintenance_schedules_updated_at') THEN
    CREATE TRIGGER update_maintenance_schedules_updated_at 
    BEFORE UPDATE ON equipment_maintenance_schedules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
