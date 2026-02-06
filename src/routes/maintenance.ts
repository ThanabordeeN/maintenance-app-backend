import express, { Request, Response, Router } from 'express';
// mapStatus helper removed as we pass raw status
import pool from '../config/database.js';
import { 
  notifyGroup, 
  sendLineNotify, 
  formatNewTicketMessage, 
  formatAssignedMessage,
  formatStatusChangeMessage 
} from '../services/lineNotify.js';
import { 
  notifyNewMaintenanceTicket, 
  notifyStatusChange 
} from '../services/lineMessaging.js';
import { createNotification } from './notifications.js';

const router: Router = express.Router();

// Types
interface MaintenanceRecord {
  id: number;
  work_order: string;
  equipment_id: number;
  created_by: number;
  assigned_to: number | null;
  maintenance_type: string;
  status: string;
  priority: string;
  description: string | null;
  notes: string | null;
  scheduled_date: Date | null;
  completed_at: Date | null;
  created_at: Date;
}

interface CreateRecordBody {
  equipmentId: number;
  userId: number;
  assignedTo?: number;
  maintenanceType: string;
  priority?: string;
  status?: string;
  category?: string;
  title?: string;
  description?: string;
  notes?: string;
  scheduledDate?: string;
}

interface UpdateRecordBody {
  status?: string;
  assignedTo?: number;
  priority?: string;
  description?: string;
  notes?: string;
  rootCause?: string;
  actionTaken?: string;
  cancelledReason?: string;
  onHoldReason?: string;
  laborCost?: number;
  partsCost?: number;
  userId?: number;
}

// Get all equipment
router.get('/equipment', async (req: Request, res: Response) => {
  try {
    const { includeInactive } = req.query;
    
    // Check if is_active column exists
    const columnCheck = await pool.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'equipment' AND column_name = 'is_active'
    `);
    const hasIsActiveColumn = columnCheck.rows.length > 0;
    
    let query = 'SELECT * FROM equipment ORDER BY equipment_name';
    if (!includeInactive && hasIsActiveColumn) {
      query = 'SELECT * FROM equipment WHERE is_active = true ORDER BY equipment_name';
    }
    
    const result = await pool.query(query);

    // Fetch maintenance schedules for each equipment
    const equipmentWithSchedules = await Promise.all(
      result.rows.map(async (eq: any) => {
        const schedulesResult = await pool.query(
          'SELECT * FROM equipment_maintenance_schedules WHERE equipment_id = $1 ORDER BY interval_value',
          [eq.id]
        );
        return {
          ...eq,
          maintenance_schedules: schedulesResult.rows
        };
      })
    );

    res.json({ equipment: equipmentWithSchedules });
  } catch (error) {
    console.error('Error fetching equipment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get equipment by ID
router.get('/equipment/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT * FROM equipment WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Equipment not found' });
    }

    res.json({ equipment: result.rows[0] });
  } catch (error) {
    console.error('Error fetching equipment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new equipment
router.post('/equipment', async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { equipment_code, equipment_type, equipment_name, description, location, maintenance_unit, initial_usage, current_usage, maintenance_schedules } = req.body;

    if (!equipment_code || !equipment_type) {
      return res.status(400).json({ error: 'equipment_code and equipment_type are required' });
    }

    // Validate maintenance_unit
    const validUnits = ['kilometers', 'hours', 'cycles', 'days', null];
    if (maintenance_unit && !validUnits.includes(maintenance_unit)) {
      return res.status(400).json({ error: 'Invalid maintenance_unit. Must be one of: kilometers, hours, cycles, days' });
    }

    const result = await client.query(
      `INSERT INTO equipment (equipment_code, equipment_type, equipment_name, description, location, maintenance_unit, initial_usage, current_usage, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
       RETURNING *`,
      [equipment_code, equipment_type, equipment_name, description, location, maintenance_unit || null, initial_usage || 0, current_usage || 0]
    );

    const equipment = result.rows[0];

    // Add maintenance schedules if provided
    if (maintenance_schedules && Array.isArray(maintenance_schedules)) {
      for (const schedule of maintenance_schedules) {
        await client.query(
          `INSERT INTO equipment_maintenance_schedules (equipment_id, interval_value, start_from_usage, description)
           VALUES ($1, $2, $3, $4)`,
          [equipment.id, schedule.interval_value, schedule.start_from_usage || 0, schedule.description || null]
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ equipment });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error creating equipment:', error);
    if (error.code === '23505') { // unique violation
      return res.status(400).json({ error: 'Equipment code already exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Update equipment
router.put('/equipment/:id', async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { id } = req.params;
    const { equipment_code, equipment_type, equipment_name, description, location, maintenance_unit, initial_usage, current_usage, maintenance_schedules } = req.body;

    // Validate maintenance_unit
    const validUnits = ['kilometers', 'hours', 'cycles', 'days', null];
    if (maintenance_unit !== undefined && !validUnits.includes(maintenance_unit)) {
      return res.status(400).json({ error: 'Invalid maintenance_unit. Must be one of: kilometers, hours, cycles, days' });
    }

    const result = await client.query(
      `UPDATE equipment 
       SET equipment_code = COALESCE($1, equipment_code),
           equipment_type = COALESCE($2, equipment_type),
           equipment_name = COALESCE($3, equipment_name),
           description = COALESCE($4, description),
           location = COALESCE($5, location),
           maintenance_unit = COALESCE($6, maintenance_unit),
           initial_usage = COALESCE($7, initial_usage),
           current_usage = COALESCE($8, current_usage),
           updated_at = NOW()
       WHERE id = $9
       RETURNING *`,
      [equipment_code, equipment_type, equipment_name, description, location, maintenance_unit, initial_usage, current_usage, id]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Equipment not found' });
    }

    // Update maintenance schedules if provided
    if (maintenance_schedules !== undefined && Array.isArray(maintenance_schedules)) {
      // Delete existing schedules
      await client.query('DELETE FROM equipment_maintenance_schedules WHERE equipment_id = $1', [id]);

      // Add new schedules
      for (const schedule of maintenance_schedules) {
        await client.query(
          `INSERT INTO equipment_maintenance_schedules (equipment_id, interval_value, start_from_usage, description)
           VALUES ($1, $2, $3, $4)`,
          [id, schedule.interval_value, schedule.start_from_usage || 0, schedule.description || null]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ equipment: result.rows[0] });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error updating equipment:', error);
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Equipment code already exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Delete equipment (soft delete)
router.delete('/equipment/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { permanent } = req.query;

    if (permanent === 'true') {
      // Hard delete - check for maintenance records first
      const checkResult = await pool.query(
        'SELECT COUNT(*) FROM maintenance_records WHERE equipment_id = $1',
        [id]
      );

      if (parseInt(checkResult.rows[0].count) > 0) {
        return res.status(400).json({
          error: 'Cannot delete equipment with maintenance records. Use soft delete instead.'
        });
      }

      await pool.query('DELETE FROM equipment WHERE id = $1', [id]);
    } else {
      // Check if is_active column exists for soft delete
      const columnCheck = await pool.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_name = 'equipment' AND column_name = 'is_active'
      `);
      
      if (columnCheck.rows.length === 0) {
        // Fall back to hard delete if soft delete not available
        await pool.query('DELETE FROM equipment WHERE id = $1', [id]);
      } else {
        // Soft delete
        const result = await pool.query(
          'UPDATE equipment SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING *',
          [id]
        );

        if (result.rows.length === 0) {
          return res.status(404).json({ error: 'Equipment not found' });
        }
      }
    }

    res.json({ success: true, message: 'Equipment deleted successfully' });
  } catch (error) {
    console.error('Error deleting equipment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Toggle equipment active status
router.patch('/equipment/:id/toggle', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Check if is_active column exists
    const columnCheck = await pool.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'equipment' AND column_name = 'is_active'
    `);
    
    if (columnCheck.rows.length === 0) {
      return res.status(400).json({ 
        error: 'Toggle feature not available. Please restart the backend to run migrations.' 
      });
    }

    // Get current status
    const currentResult = await pool.query(
      'SELECT is_active FROM equipment WHERE id = $1',
      [id]
    );

    if (currentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Equipment not found' });
    }

    const newStatus = !(currentResult.rows[0].is_active ?? true);

    const result = await pool.query(
      'UPDATE equipment SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [newStatus, id]
    );

    res.json({
      success: true,
      equipment: result.rows[0],
      message: newStatus ? 'เปิดใช้งานเครื่องจักรแล้ว' : 'ปิดใช้งานเครื่องจักรแล้ว'
    });
  } catch (error) {
    console.error('Error toggling equipment status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all maintenance records (compatible with main dashboard format)
router.get('/records', async (req: Request, res: Response) => {
  try {
    const { status, priority, category } = req.query;

    let query = `
      SELECT mr.*, 
             u.display_name as created_by_name,
             a.display_name as assigned_to_name,
             e.equipment_name, e.equipment_code, e.location
      FROM maintenance_records mr
      LEFT JOIN maintenance_users u ON mr.created_by = u.id
      LEFT JOIN maintenance_users a ON mr.assigned_to = a.id
      LEFT JOIN equipment e ON mr.equipment_id = e.id
    `;

    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let paramCount = 1;

    if (status && typeof status === 'string') {
      conditions.push(`mr.status = $${paramCount++}`);
      params.push(status);
    }

    if (priority && typeof priority === 'string') {
      conditions.push(`mr.priority = $${paramCount++}`);
      params.push(priority);
    }

    if (category && typeof category === 'string') {
      conditions.push(`mr.category = $${paramCount++}`);
      params.push(category);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY mr.created_at DESC';

    const result = await pool.query(query, params);

    // Format response to match main dashboard expected format
    const records = result.rows.map((r: any) => ({
      id: String(r.id),
      workOrder: r.work_order,
      work_order: r.work_order,
      equipment_name: r.equipment_name,
      equipment_code: r.equipment_code,
      created_at: r.created_at,
      date: r.created_at ? new Date(r.created_at).toISOString().split('T')[0] : '',
      time: r.created_at ? new Date(r.created_at).toTimeString().substring(0, 5) : '',
      source: r.created_by ? 'Technician' : 'System',
      machine: r.equipment_name || r.equipment_code || 'Unknown',
      message: r.maintenance_type,
      status: r.status,
      priority: r.priority || 'normal',
      category: r.category || 'mechanical',
      assignedTo: r.assigned_to_name,
      maintenance_type: r.maintenance_type,
      title: r.title || '',
      description: r.description || '',
      notes: r.notes || '',
    }));

    res.json(records);
  } catch (error) {
    console.error('Error fetching maintenance records:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get summary stats (for dashboard)
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const statusCount = await pool.query(`
      SELECT status, COUNT(*) as count 
      FROM maintenance_records 
      GROUP BY status
    `);

    const criticalCount = await pool.query(`
      SELECT COUNT(*) as count 
      FROM maintenance_records 
      WHERE priority = 'critical' AND status != 'completed'
    `);

    const avgTime = await pool.query(`
      SELECT AVG(downtime_minutes) as avg 
      FROM maintenance_records 
      WHERE downtime_minutes IS NOT NULL
    `);

    const countMap: Record<string, number> = {};
    statusCount.rows.forEach((row: any) => {
      countMap[row.status] = parseInt(row.count);
    });

    res.json({
      pending: countMap['pending'] || 0,
      inProgress: countMap['in_progress'] || 0,
      fixed: countMap['completed'] || 0,
      critical: parseInt(criticalCount.rows[0]?.count) || 0,
      avgResponseTime: Math.round(parseFloat(avgTime.rows[0]?.avg) || 0),
    });
  } catch (error) {
    console.error('Error fetching summary:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get maintenance record by ID
router.get('/records/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Get record detail
    const recordResult = await pool.query(`
      SELECT mr.*, 
             u.display_name as created_by_name, u.picture_url as created_by_picture,
             a.display_name as assigned_to_name, a.picture_url as assigned_to_picture,
             e.equipment_name, e.equipment_code, e.location
      FROM maintenance_records mr
      LEFT JOIN maintenance_users u ON mr.created_by = u.id
      LEFT JOIN maintenance_users a ON mr.assigned_to = a.id
      LEFT JOIN equipment e ON mr.equipment_id = e.id
      WHERE mr.id = $1
    `, [id]);

    if (recordResult.rows.length === 0) {
      return res.status(404).json({ error: 'Record not found' });
    }

    // Get timeline/comments
    const timelineResult = await pool.query(`
      SELECT mt.*, u.display_name as changed_by_name, u.picture_url as changed_by_picture
      FROM maintenance_timeline mt
      LEFT JOIN maintenance_users u ON mt.changed_by = u.id
      WHERE mt.maintenance_id = $1
      ORDER BY mt.created_at ASC
    `, [id]);

    // Get images
    const imagesResult = await pool.query(`
      SELECT * FROM maintenance_images
      WHERE maintenance_id = $1
      ORDER BY uploaded_at ASC
    `, [id]);

    res.json({
      record: recordResult.rows[0],
      timeline: timelineResult.rows,
      images: imagesResult.rows
    });
  } catch (error) {
    console.error('Error fetching record:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new maintenance record
router.post('/records', upload.array('images', 5), async (req: Request, res: Response) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const {
      equipmentId,
      userId,
      assignedTo,
      maintenanceType,
      priority = 'low',
      status = 'pending',
      category = 'mechanical',
      title,
      description,
      notes,
      scheduledDate,
      setEquipmentInactive
    } = req.body as CreateRecordBody;

    if (!maintenanceType) {
      return res.status(400).json({
        error: 'Maintenance Type is required'
      });
    }

    // If setEquipmentInactive is true, set equipment to inactive and record downtime start
    if (setEquipmentInactive === 'true' || setEquipmentInactive === true) {
      await client.query(
        `UPDATE equipment SET is_active = false, downtime_started_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [equipmentId]
      );
    }

    // Generate work order number
    const year = new Date().getFullYear();
    const countResult = await client.query(`
      SELECT COUNT(*) FROM maintenance_records 
      WHERE EXTRACT(YEAR FROM created_at) = $1
    `, [year]);
    const count = parseInt(countResult.rows[0].count) + 1;
    const workOrder = `WO-${year}-${String(count).padStart(6, '0')}`;

    // Debug logging
    console.log('Creating maintenance record with data:', {
      workOrder,
      equipmentId,
      userId,
      assignedTo: assignedTo || userId,
      maintenanceType,
      priority,
      status,
      category,
      title,
      description,
      notes,
      scheduledDate
    });

    // Create record
    const recordResult = await client.query(
      `INSERT INTO maintenance_records 
       (work_order, equipment_id, created_by, assigned_to, maintenance_type, priority, status, category, title, description, notes, scheduled_date, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
       RETURNING *`,
      [workOrder, equipmentId || null, userId || null, assignedTo || userId || null, maintenanceType, priority, status, category, title || null, description || null, notes || null, scheduledDate || null]
    );

    const record = recordResult.rows[0];

    // Create timeline entry
    await client.query(
      `INSERT INTO maintenance_timeline (maintenance_id, status, changed_by, notes)
       VALUES ($1, $2, $3, $4)`,
      [record.id, status, userId, 'Record created']
    );

    // Initial images upload
    const files = req.files as Express.Multer.File[];
    if (files && files.length > 0) {
      for (const file of files) {
        const imageUrl = `/uploads/images/${file.filename}`;
        await client.query(
          `INSERT INTO maintenance_images (maintenance_id, image_url, image_type)
           VALUES ($1, $2, $3)`,
          [record.id, imageUrl, 'before']
        );
      }
    }

    await client.query('COMMIT');

    // ========================================
    // NOTIFICATIONS - ส่งแจ้งเตือนหลังสร้างใบแจ้งซ่อม
    // ========================================
    try {
      // Get equipment and user info for notifications
      let equipmentName = '';
      let createdByName = '';
      let assignedToName = '';
      
      if (equipmentId) {
        const eqRes = await pool.query('SELECT equipment_name FROM equipment WHERE id = $1', [equipmentId]);
        equipmentName = eqRes.rows[0]?.equipment_name || '';
      }
      
      if (userId) {
        const userRes = await pool.query('SELECT display_name FROM maintenance_users WHERE id = $1', [userId]);
        createdByName = userRes.rows[0]?.display_name || '';
      }
      
      const assignedUserId = assignedTo || userId;
      if (assignedUserId) {
        const assigneeRes = await pool.query(
          'SELECT display_name FROM maintenance_users WHERE id = $1', 
          [assignedUserId]
        );
        assignedToName = assigneeRes.rows[0]?.display_name || '';
      }
      
      // 1. In-app notification สำหรับผู้รับมอบหมาย
      if (assignedUserId) {
        await createNotification({
          user_id: assignedUserId,
          title: `📋 งานใหม่: ${workOrder}`,
          message: `คุณได้รับมอบหมายงาน${maintenanceType} ${equipmentName ? `- ${equipmentName}` : ''}`,
          type: priority === 'critical' ? 'warning' : 'info',
          category: 'maintenance',
          reference_type: 'maintenance_record',
          reference_id: record.id,
        });
      }
      
      // 2. LINE Push Message ไปยังผู้รับมอบหมาย (ผ่าน LINE OA)
      if (assignedUserId) {
        await notifyNewMaintenanceTicket({
          assignedToUserId: assignedUserId,
          workOrder,
          equipmentName,
          maintenanceType,
          priority,
          description: description || '',
          createdByName,
        });
      }
      
      console.log('Notifications sent for new maintenance record:', workOrder);
    } catch (notifyError) {
      // ไม่ให้ notification error กระทบ main flow
      console.error('Error sending notifications:', notifyError);
    }

    res.status(201).json({
      id: String(record.id),
      workOrder: record.work_order,
      status: 'created',
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating maintenance record:', error);
    // @ts-ignore
    if (error.code) console.error('Error code:', error.code);
    // @ts-ignore
    if (error.detail) console.error('Error detail:', error.detail);
    res.status(500).json({ error: 'Internal server error', details: String(error) });
  } finally {
    client.release();
  }
});

// Update maintenance record (Status change with multiple images)
router.patch('/records/:id', upload.array('images', 5), async (req: Request, res: Response) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { id } = req.params;
    const {
      status,
      notes,
      userId,
      rootCause,
      actionTaken,
      cancelledReason,
      onHoldReason
    } = req.body as UpdateRecordBody;

    const updates: string[] = [];
    const values: (string | number)[] = [];
    let paramCount = 1;

    if (status) {
      const dbStatus = reverseMapStatus(status);
      updates.push(`status = $${paramCount++}`);
      values.push(dbStatus);

      // Fetch current record to calculate downtime
      const currentRecord = await client.query('SELECT started_at, downtime_minutes FROM maintenance_records WHERE id = $1', [id]);
      const { started_at, downtime_minutes } = currentRecord.rows[0];

      if (dbStatus === 'in_progress') {
        // Start or Resume
        updates.push(`started_at = CURRENT_TIMESTAMP`);
      } else if (dbStatus === 'on_hold' || dbStatus === 'completed' || dbStatus === 'cancelled') {
        // Pause or Finish - calculate and add segment downtime
        if (started_at) {
          const diffMinutes = Math.floor((new Date().getTime() - new Date(started_at).getTime()) / 60000);
          const newTotalDowntime = (downtime_minutes || 0) + diffMinutes;
          updates.push(`downtime_minutes = $${paramCount++}`);
          values.push(newTotalDowntime);
          updates.push(`started_at = NULL`); // Reset started_at until resumed
        }

        if (dbStatus === 'completed') {
          updates.push(`completed_at = CURRENT_TIMESTAMP`);
        }
      }
    }

    if (notes !== undefined) {
      updates.push(`notes = $${paramCount++}`);
      values.push(notes);
    }

    if (rootCause !== undefined) {
      updates.push(`root_cause = $${paramCount++}`);
      values.push(rootCause);
    }

    if (actionTaken !== undefined) {
      updates.push(`action_taken = $${paramCount++}`);
      values.push(actionTaken);
    }

    if (cancelledReason !== undefined) {
      updates.push(`cancelled_reason = $${paramCount++}`);
      values.push(cancelledReason);
    }

    if (onHoldReason !== undefined) {
      updates.push(`on_hold_reason = $${paramCount++}`);
      values.push(onHoldReason);
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(parseInt(id));

    const query = `
      UPDATE maintenance_records 
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    const result = await client.query(query, values);

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Maintenance record not found' });
    }

    // Add timeline entry
    if (status && userId) {
      const timelineNotes = notes ||
        (cancelledReason ? `ยกเลิก: ${cancelledReason}` :
          (onHoldReason ? `พักงาน: ${onHoldReason}` :
            `Status changed to ${status}`));

      await client.query(
        `INSERT INTO maintenance_timeline (maintenance_id, status, changed_by, notes)
         VALUES ($1, $2, $3, $4)`,
        [id, reverseMapStatus(status), userId, timelineNotes]
      );

      // Multiple images for status change
      const files = req.files as Express.Multer.File[];
      if (files && files.length > 0) {
        for (const file of files) {
          const imageUrl = `/uploads/images/${file.filename}`;
          await client.query(
            `INSERT INTO maintenance_images (maintenance_id, image_url, image_type)
             VALUES ($1, $2, $3)`,
            [id, imageUrl, status === 'completed' ? 'after' : 'status_change']
          );
        }
      }
    }

    // ถ้า status เป็น completed → อัปเดต maintenance schedule
    if (status && reverseMapStatus(status) === 'completed') {
      // หา schedule ที่มี current_ticket_id = record id นี้
      console.log(`🔍 Looking for schedule with current_ticket_id = ${id}`);
      const scheduleResult = await client.query(
        `SELECT ems.*, e.current_usage 
         FROM equipment_maintenance_schedules ems
         JOIN equipment e ON ems.equipment_id = e.id
         WHERE ems.current_ticket_id = $1`,
        [id]
      );
      
      console.log(`📋 Found ${scheduleResult.rows.length} schedules linked to ticket ${id}`);
      
      if (scheduleResult.rows.length > 0) {
        const schedule = scheduleResult.rows[0];
        console.log(`✅ Resetting schedule ${schedule.id}: last_completed_at_usage = ${schedule.current_usage}`);
        // อัปเดต last_completed_at_usage และเคลียร์ current_ticket_id
        await client.query(
          `UPDATE equipment_maintenance_schedules 
           SET last_completed_at_usage = $1, 
               current_ticket_id = NULL, 
               updated_at = NOW() 
           WHERE id = $2`,
          [schedule.current_usage, schedule.id]
        );
        console.log(`✅ Schedule ${schedule.id} reset successfully`);
      } else {
        console.log(`⚠️ No schedule found linked to ticket ${id}`);
      }
    }

    // ถ้า status เป็น cancelled → เคลียร์ ticket และเริ่มนับรอบใหม่ (เหมือน completed)
    if (status && reverseMapStatus(status) === 'cancelled') {
      // หา schedule ที่มี current_ticket_id = record id นี้
      const scheduleResult = await client.query(
        `SELECT ems.*, e.current_usage 
         FROM equipment_maintenance_schedules ems
         JOIN equipment e ON ems.equipment_id = e.id
         WHERE ems.current_ticket_id = $1`,
        [id]
      );
      
      if (scheduleResult.rows.length > 0) {
        const schedule = scheduleResult.rows[0];
        // อัปเดต last_completed_at_usage และเคลียร์ current_ticket_id (เริ่มนับรอบใหม่)
        await client.query(
          `UPDATE equipment_maintenance_schedules 
           SET last_completed_at_usage = $1, 
               current_ticket_id = NULL, 
               updated_at = NOW() 
           WHERE id = $2`,
          [schedule.current_usage, schedule.id]
        );
        console.log(`PM Schedule ${schedule.id} reset: cancelled ticket ${id}, new cycle starts from usage ${schedule.current_usage}`);
      }
    }

    await client.query('COMMIT');

    res.json({
      id: String(result.rows[0].id),
      status: status || 'updated',
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating maintenance record:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Helper functions
function mapStatus(status: string): 'Pending' | 'In Progress' | 'Fixed' {
  switch (status) {
    case 'completed':
      return 'Fixed';
    case 'in_progress':
      return 'In Progress';
    default:
      return 'Pending';
  }
}

function reverseMapStatus(status: string): string {
  switch (status) {
    case 'Fixed':
    case 'completed':
      return 'completed';
    case 'In Progress':
    case 'in_progress':
      return 'in_progress';
    case 'on_hold':
      return 'on_hold';
    case 'cancelled':
      return 'cancelled';
    case 'reopened':
      return 'pending'; // Reopened goes back to pending
    default:
      return status; // Pass through unknown status as-is
  }
}

import upload from '../config/upload.js';

// Upload images for maintenance record
router.post('/records/:id/images', upload.array('images', 5), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { type = 'before' } = req.body;

    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No image files uploaded' });
    }

    const savedImages = [];
    for (const file of files) {
      const imageUrl = `/uploads/images/${file.filename}`;
      const result = await pool.query(
        `INSERT INTO maintenance_images (maintenance_id, image_url, image_type)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [id, imageUrl, type]
      );
      savedImages.push(result.rows[0]);
    }

    res.status(201).json({
      success: true,
      images: savedImages
    });

  } catch (error) {
    console.error('Error uploading image:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get images for a record
router.get('/records/:id/images', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'SELECT * FROM maintenance_images WHERE maintenance_id = $1 ORDER BY uploaded_at DESC',
      [id]
    );

    res.json({ images: result.rows });

  } catch (error) {
    console.error('Error fetching images:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add progress update (notes + multiple images)
router.post('/records/:id/update', upload.array('images', 5), async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const { notes, userId } = req.body;

    const files = req.files as Express.Multer.File[];
    if (!notes && (!files || files.length === 0)) {
      return res.status(400).json({ error: 'Notes or images are required' });
    }

    // 1. Add to timeline
    await client.query(
      `INSERT INTO maintenance_timeline (maintenance_id, status, changed_by, notes)
       VALUES ($1, $2, $3, $4)`,
      [id, 'progress_update', userId, notes || 'อัปเดตความคืบหน้า']
    );

    // 2. Add images if they exist
    const imageUrls = [];
    if (files && files.length > 0) {
      for (const file of files) {
        const imageUrl = `/uploads/images/${file.filename}`;
        await client.query(
          `INSERT INTO maintenance_images (maintenance_id, image_url, image_type)
           VALUES ($1, $2, $3)`,
          [id, imageUrl, 'progress']
        );
        imageUrls.push(imageUrl);
      }
    }

    // 3. Update record updated_at
    await client.query(
      'UPDATE maintenance_records SET updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [id]
    );

    await client.query('COMMIT');
    res.json({ success: true, imageUrls });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    console.error('Error adding progress update:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// =====================================================
// USAGE LOG ROUTES
// =====================================================

// Get usage logs by equipment
router.get('/equipment/:id/usage-logs', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { limit = 20 } = req.query;

    const result = await pool.query(
      `SELECT ul.*, mu.display_name as recorded_by_name
       FROM equipment_usage_logs ul
       LEFT JOIN maintenance_users mu ON ul.recorded_by = mu.id
       WHERE ul.equipment_id = $1
       ORDER BY ul.log_date DESC, ul.created_at DESC
       LIMIT $2`,
      [id, limit]
    );

    res.json({ logs: result.rows });
  } catch (error: any) {
    // Table might not exist yet
    if (error.code === '42P01') {
      res.json({ logs: [] });
    } else {
      console.error('Error fetching usage logs:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Create usage log
router.post('/equipment/:id/usage-logs', async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const { id } = req.params;
    const { usage_value, log_date, notes, recorded_by } = req.body;

    if (!usage_value) {
      return res.status(400).json({ error: 'usage_value is required' });
    }

    // Insert usage log
    const logResult = await client.query(
      `INSERT INTO equipment_usage_logs (equipment_id, usage_value, log_date, notes, recorded_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, usage_value, log_date || new Date().toISOString().split('T')[0], notes, recorded_by]
    );

    // Update equipment current_usage
    await client.query(
      `UPDATE equipment SET current_usage = $1, updated_at = NOW() WHERE id = $2`,
      [usage_value, id]
    );

    // Check if any maintenance schedule threshold is reached
    const schedulesResult = await client.query(
      `SELECT * FROM equipment_maintenance_schedules WHERE equipment_id = $1`,
      [id]
    );

    const equipmentResult = await client.query(
      `SELECT * FROM equipment WHERE id = $1`,
      [id]
    );
    const equipment = equipmentResult.rows[0];

    // Check each schedule for maintenance due
    const alerts: any[] = [];
    const ticketsCreated: any[] = [];
    
    for (const schedule of schedulesResult.rows) {
      const interval = parseFloat(schedule.interval_value);
      const startFrom = parseFloat(schedule.start_from_usage) || 0;
      const lastCompleted = parseFloat(schedule.last_completed_at_usage) || startFrom;
      const currentUsage = parseFloat(usage_value);
      const hasOpenTicket = !!schedule.current_ticket_id;
      
      // Calculate next maintenance point from last completed
      const nextAt = lastCompleted + interval;
      const remaining = nextAt - currentUsage;
      
      // ถึงกำหนดแล้ว (remaining <= 0) และยังไม่มี ticket เปิดอยู่
      if (remaining <= 0 && !hasOpenTicket) {
        // สร้าง ticket ใหม่
        const workOrder = `WO-SCHED-${Date.now()}`;
        const ticketTitle = `บำรุงรักษาตามรอบ - ${equipment.equipment_name}`;
        const ticketDescription = `${schedule.description || `ทุก ${interval} ${equipment.maintenance_unit}`}\n\nถึงกำหนดที่: ${nextAt.toLocaleString()} ${equipment.maintenance_unit}\nการใช้งานปัจจุบัน: ${currentUsage.toLocaleString()} ${equipment.maintenance_unit}`;
        
        const ticketResult = await client.query(
          `INSERT INTO maintenance_records 
           (work_order, equipment_id, created_by, maintenance_type, status, priority, description)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [
            workOrder,
            id,
            recorded_by || 1,
            'ตามรอบการบำรุงรักษา',
            'pending',
            'normal',
            `${ticketTitle}\n\n${ticketDescription}`
          ]
        );
        
        // อัปเดต current_ticket_id ใน schedule
        await client.query(
          `UPDATE equipment_maintenance_schedules 
           SET current_ticket_id = $1, updated_at = NOW() 
           WHERE id = $2`,
          [ticketResult.rows[0].id, schedule.id]
        );
        
        ticketsCreated.push({
          schedule_id: schedule.id,
          ticket_id: ticketResult.rows[0].id,
          work_order: workOrder,
          description: schedule.description || `ทุก ${interval} ${equipment.maintenance_unit}`
        });
        
        alerts.push({
          schedule_id: schedule.id,
          description: schedule.description || `ทุก ${interval} ${equipment.maintenance_unit}`,
          remaining: 0,
          nextAt,
          ticketCreated: true,
          ticketId: ticketResult.rows[0].id
        });
        
        // ส่ง notification ไปทุก user ที่เป็น technician/admin
        const users = await client.query(
          "SELECT id FROM maintenance_users WHERE role IN ('admin', 'moderator', 'technician')"
        );
        for (const user of users.rows) {
          await createNotification({
            user_id: user.id,
            title: `🔧 สร้าง PM Ticket: ${workOrder}`,
            message: `สร้างใบสั่งงาน PM อัตโนมัติสำหรับ ${equipment.equipment_name} - ${schedule.description || 'บำรุงรักษาตามกำหนด'}`,
            type: 'warning',
            category: 'schedule',
            reference_type: 'maintenance_record',
            reference_id: ticketResult.rows[0].id,
          });
        }
        
      } else if (remaining > 0 && remaining <= 50 && !hasOpenTicket) {
        // ใกล้ถึงกำหนด (น้อยกว่า 50 ชม.)
        alerts.push({
          schedule_id: schedule.id,
          description: schedule.description || `ทุก ${interval} ${equipment.maintenance_unit}`,
          remaining,
          nextAt,
          isWarning: true
        });
        
        // ตรวจสอบว่าแจ้งไปแล้วหรือยังใน 24 ชม.
        const existingNotif = await client.query(`
          SELECT id FROM maintenance_notifications 
          WHERE reference_type = 'equipment_maintenance_schedule' 
            AND reference_id = $1 
            AND created_at > NOW() - INTERVAL '24 hours'
          LIMIT 1
        `, [schedule.id]);
        
        // ถ้ายังไม่เคยแจ้ง ให้แจ้งเตือน
        if (existingNotif.rows.length === 0) {
          const users = await client.query(
            "SELECT id FROM maintenance_users WHERE role IN ('admin', 'moderator', 'technician')"
          );
          for (const user of users.rows) {
            await createNotification({
              user_id: user.id,
              title: `🟡 PM ใกล้ถึง: ${equipment.equipment_name}`,
              message: `${schedule.description || 'บำรุงรักษาตามกำหนด'} - เหลืออีก ${Math.round(remaining)} ${equipment.maintenance_unit}`,
              type: 'info',
              category: 'schedule',
              reference_type: 'equipment_maintenance_schedule',
              reference_id: schedule.id,
            });
          }
        }
        
      } else if (remaining <= 0 && hasOpenTicket) {
        // เกินกำหนดแล้วแต่ยังไม่ปิด ticket
        alerts.push({
          schedule_id: schedule.id,
          description: schedule.description || `ทุก ${interval} ${equipment.maintenance_unit}`,
          remaining: 0,
          nextAt,
          isOverdue: true,
          ticketId: schedule.current_ticket_id
        });
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ 
      log: logResult.rows[0], 
      alerts: alerts.length > 0 ? alerts : undefined,
      ticketsCreated: ticketsCreated.length > 0 ? ticketsCreated : undefined,
      message: ticketsCreated.length > 0 
        ? `บันทึกการใช้งานสำเร็จ และสร้างใบแจ้งซ่อม ${ticketsCreated.length} รายการ`
        : 'บันทึกการใช้งานสำเร็จ'
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    // Table might not exist - run migration
    if (error.code === '42P01') {
      res.status(400).json({ 
        error: 'Usage log table not found. Please restart the backend to run migrations.' 
      });
    } else {
      console.error('Error creating usage log:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  } finally {
    client.release();
  }
});

// Get all usage logs with equipment info
router.get('/usage-logs', async (req: Request, res: Response) => {
  try {
    const { limit = 50, equipment_id } = req.query;

    let query = `
      SELECT ul.*, 
             e.equipment_name, e.equipment_code, e.maintenance_unit,
             mu.display_name as recorded_by_name
      FROM equipment_usage_logs ul
      LEFT JOIN equipment e ON ul.equipment_id = e.id
      LEFT JOIN maintenance_users mu ON ul.recorded_by = mu.id
    `;
    
    const params: any[] = [];
    if (equipment_id) {
      query += ` WHERE ul.equipment_id = $1`;
      params.push(equipment_id);
    }
    
    query += ` ORDER BY ul.log_date DESC, ul.created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await pool.query(query, params);
    res.json({ logs: result.rows });
  } catch (error: any) {
    if (error.code === '42P01') {
      res.json({ logs: [] });
    } else {
      console.error('Error fetching all usage logs:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Update usage log (only latest can be updated)
router.put('/usage-logs/:logId', async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const { logId } = req.params;
    const { usage_value, notes, equipment_id } = req.body;

    if (!usage_value || !equipment_id) {
      return res.status(400).json({ error: 'usage_value and equipment_id are required' });
    }

    // Check if this is the latest log for this equipment
    const latestResult = await client.query(
      `SELECT id FROM equipment_usage_logs 
       WHERE equipment_id = $1 
       ORDER BY log_date DESC, created_at DESC 
       LIMIT 1`,
      [equipment_id]
    );

    if (latestResult.rows.length === 0 || latestResult.rows[0].id !== parseInt(logId)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'สามารถแก้ไขได้เฉพาะรายการล่าสุดเท่านั้น' });
    }

    // Update the usage log
    const updateResult = await client.query(
      `UPDATE equipment_usage_logs 
       SET usage_value = $1, notes = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [usage_value, notes, logId]
    );

    if (updateResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Usage log not found' });
    }

    // Update equipment current_usage to match
    await client.query(
      `UPDATE equipment SET current_usage = $1, updated_at = NOW() WHERE id = $2`,
      [usage_value, equipment_id]
    );

    await client.query('COMMIT');
    res.json({ 
      log: updateResult.rows[0], 
      message: 'แก้ไขการบันทึกสำเร็จ'
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error updating usage log:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

export default router;
