import express, { Request, Response, Router } from 'express';
import pool from '../config/database.js';

const router: Router = express.Router();

// Get status options
router.get('/options', async (req: Request, res: Response) => {
  res.json({
    statuses: [
      { value: 'pending', label: 'รอดำเนินการ', color: 'yellow' },
      { value: 'in_progress', label: 'กำลังดำเนินการ', color: 'blue' },
      { value: 'completed', label: 'เสร็จสิ้น', color: 'green' },
      { value: 'cancelled', label: 'ยกเลิก', color: 'red' },
      { value: 'on_hold', label: 'รอชิ้นส่วน', color: 'orange' },
    ],
    priorities: [
      { value: 'low', label: 'ต่ำ', color: 'gray' },
      { value: 'medium', label: 'ปานกลาง', color: 'blue' },
      { value: 'high', label: 'สูง', color: 'orange' },
      { value: 'critical', label: 'วิกฤต', color: 'red' },
    ],
    categories: [
      { value: 'mechanical', label: 'เครื่องกล' },
      { value: 'electrical', label: 'ไฟฟ้า' },
      { value: 'software', label: 'ซอฟต์แวร์' },
    ],
    maintenanceTypes: [
      { value: 'belt', label: 'สายพาน' },
      { value: 'bearing', label: 'แบริ่ง' },
      { value: 'motor', label: 'มอเตอร์' },
      { value: 'noise', label: 'เสียงผิดปกติ' },
      { value: 'vibration', label: 'การสั่นสะเทือน' },
      { value: 'oil', label: 'น้ำมัน/สารหล่อลื่น' },
      { value: 'routine', label: 'บำรุงรักษาตามรอบ' },
      { value: 'other', label: 'อื่นๆ' },
    ],
  });
});

// Get dashboard stats
router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    // Count by status
    const statusCount = await pool.query(`
      SELECT status, COUNT(*) as count 
      FROM maintenance_records 
      GROUP BY status
    `);

    // Count by priority  
    const priorityCount = await pool.query(`
      SELECT priority, COUNT(*) as count 
      FROM maintenance_records 
      WHERE status != 'completed'
      GROUP BY priority
    `);

    // Recent records
    const recentRecords = await pool.query(`
      SELECT mr.*, e.equipment_name, e.equipment_code
      FROM maintenance_records mr
      LEFT JOIN equipment e ON mr.equipment_id = e.id
      ORDER BY mr.created_at DESC
      LIMIT 5
    `);

    res.json({
      statusCounts: statusCount.rows,
      priorityCounts: priorityCount.rows,
      recentRecords: recentRecords.rows,
    });
  } catch (error) {
    console.error('Error fetching dashboard:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
