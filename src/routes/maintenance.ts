import express, { Request, Response, Router } from 'express';
// mapStatus helper removed as we pass raw status
import pool from '../config/database.js';

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
    const query = includeInactive === 'true' 
      ? 'SELECT * FROM equipment ORDER BY equipment_name'
      : 'SELECT * FROM equipment WHERE is_active = true ORDER BY equipment_name';
    const result = await pool.query(query);
    res.json({ equipment: result.rows });
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
      'SELECT * FROM equipment WHERE equipment_id = $1',
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
  try {
    const { equipment_code, equipment_type, equipment_name, description, location } = req.body;
    
    if (!equipment_code || !equipment_type) {
      return res.status(400).json({ error: 'equipment_code and equipment_type are required' });
    }

    const result = await pool.query(
      `INSERT INTO equipment (equipment_code, equipment_type, equipment_name, description, location, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, true, NOW(), NOW())
       RETURNING *`,
      [equipment_code, equipment_type, equipment_name, description, location]
    );
    
    res.status(201).json({ equipment: result.rows[0] });
  } catch (error: any) {
    console.error('Error creating equipment:', error);
    if (error.code === '23505') { // unique violation
      return res.status(400).json({ error: 'Equipment code already exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update equipment
router.put('/equipment/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { equipment_code, equipment_type, equipment_name, description, location, is_active } = req.body;

    const result = await pool.query(
      `UPDATE equipment 
       SET equipment_code = COALESCE($1, equipment_code),
           equipment_type = COALESCE($2, equipment_type),
           equipment_name = COALESCE($3, equipment_name),
           description = COALESCE($4, description),
           location = COALESCE($5, location),
           is_active = COALESCE($6, is_active),
           updated_at = NOW()
       WHERE equipment_id = $7
       RETURNING *`,
      [equipment_code, equipment_type, equipment_name, description, location, is_active, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Equipment not found' });
    }
    
    res.json({ equipment: result.rows[0] });
  } catch (error: any) {
    console.error('Error updating equipment:', error);
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Equipment code already exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
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

      await pool.query('DELETE FROM equipment WHERE equipment_id = $1', [id]);
    } else {
      // Soft delete
      const result = await pool.query(
        'UPDATE equipment SET is_active = false, updated_at = NOW() WHERE equipment_id = $1 RETURNING *',
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Equipment not found' });
      }
    }
    
    res.json({ success: true, message: 'Equipment deleted successfully' });
  } catch (error) {
    console.error('Error deleting equipment:', error);
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
      LEFT JOIN equipment e ON mr.equipment_id = e.equipment_id
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
      LEFT JOIN equipment e ON mr.equipment_id = e.equipment_id
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
      scheduledDate 
    } = req.body as CreateRecordBody;

    if (!maintenanceType) {
      return res.status(400).json({ 
        error: 'Maintenance Type is required' 
      });
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

export default router;
