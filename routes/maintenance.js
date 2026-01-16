import express from 'express';
import pool from '../config/database.js';

const router = express.Router();

// ดึงรายการอุปกรณ์ทั้งหมด
router.get('/equipment', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM equipment ORDER BY equipment_name'
    );
    res.json({ equipment: result.rows });
  } catch (error) {
    console.error('Error fetching equipment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ดึงข้อมูลอุปกรณ์ตาม ID
router.get('/equipment/:id', async (req, res) => {
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

// ดึงประวัติ Maintenance ของอุปกรณ์
router.get('/equipment/:id/records', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT mr.*, u.display_name as user_name, e.equipment_name
       FROM maintenance_records mr
       LEFT JOIN users u ON mr.user_id = u.id
       LEFT JOIN equipment e ON mr.equipment_id = e.id
       WHERE mr.equipment_id = $1
       ORDER BY mr.created_at DESC`,
      [id]
    );
    
    res.json({ records: result.rows });
  } catch (error) {
    console.error('Error fetching maintenance records:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ดึงรายการ Maintenance ทั้งหมด
router.get('/records', async (req, res) => {
  try {
    const { status } = req.query;
    
    let query = `
      SELECT mr.*, 
             u.display_name as created_by_name,
             a.display_name as assigned_to_name,
             e.equipment_name, e.equipment_code, e.location
      FROM maintenance_records mr
      LEFT JOIN users u ON mr.created_by = u.id
      LEFT JOIN users a ON mr.assigned_to = a.id
      LEFT JOIN equipment e ON mr.equipment_id = e.id
    `;
    
    const params = [];
    
    if (status) {
      query += ' WHERE mr.status = $1';
      params.push(status);
    }
    
    query += ' ORDER BY mr.created_at DESC';
    
    const result = await pool.query(query, params);
    res.json({ records: result.rows });
  } catch (error) {
    console.error('Error fetching maintenance records:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ดึงรายละเอียด Maintenance แบบเต็ม (สำหรับ detail view)
router.get('/records/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // ดึงข้อมูลหลัก
    const recordResult = await pool.query(
      `SELECT mr.*, 
              cb.display_name as created_by_name, cb.picture_url as created_by_picture,
              ab.display_name as assigned_to_name, ab.picture_url as assigned_to_picture,
              e.equipment_name, e.equipment_code, e.location, e.running_hours, e.last_maintenance_date
       FROM maintenance_records mr
       LEFT JOIN users cb ON mr.created_by = cb.id
       LEFT JOIN users ab ON mr.assigned_to = ab.id
       LEFT JOIN equipment e ON mr.equipment_id = e.id
       WHERE mr.id = $1`,
      [id]
    );
    
    if (recordResult.rows.length === 0) {
      return res.status(404).json({ error: 'Maintenance record not found' });
    }
    
    const record = recordResult.rows[0];
    
    // ดึง timeline
    const timelineResult = await pool.query(
      `SELECT mt.*, u.display_name as changed_by_name
       FROM maintenance_timeline mt
       LEFT JOIN users u ON mt.changed_by = u.id
       WHERE mt.maintenance_id = $1
       ORDER BY mt.created_at ASC`,
      [id]
    );
    
    // ดึงรูปภาพ
    const imagesResult = await pool.query(
      'SELECT * FROM maintenance_images WHERE maintenance_id = $1 ORDER BY uploaded_at',
      [id]
    );
    
    // ดึงอะไหล่ที่ใช้
    const partsResult = await pool.query(
      `SELECT mpu.*, sp.part_name, sp.part_code
       FROM maintenance_parts_used mpu
       LEFT JOIN spare_parts sp ON mpu.spare_part_id = sp.id
       WHERE mpu.maintenance_id = $1`,
      [id]
    );
    
    // ดึง comments
    const commentsResult = await pool.query(
      `SELECT mc.*, u.display_name, u.picture_url
       FROM maintenance_comments mc
       LEFT JOIN users u ON mc.user_id = u.id
       WHERE mc.maintenance_id = $1
       ORDER BY mc.created_at ASC`,
      [id]
    );
    
    res.json({
      record: record,
      timeline: timelineResult.rows,
      images: imagesResult.rows,
      parts_used: partsResult.rows,
      comments: commentsResult.rows
    });
    
  } catch (error) {
    console.error('Error fetching maintenance record detail:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// สร้างบันทึก Maintenance ใหม่
router.post('/records', async (req, res) => {
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
      description, 
      notes,
      scheduledDate 
    } = req.body;

    if (!equipmentId || !userId || !maintenanceType) {
      return res.status(400).json({ 
        error: 'Equipment ID, User ID, and Maintenance Type are required' 
      });
    }

    // สร้าง record
    const recordResult = await client.query(
      `INSERT INTO maintenance_records 
       (equipment_id, created_by, assigned_to, maintenance_type, priority, status, description, notes, scheduled_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [equipmentId, userId, assignedTo || userId, maintenanceType, priority, status, description, notes, scheduledDate]
    );
    
    const record = recordResult.rows[0];
    
    // สร้าง timeline entry แรก
    await client.query(
      `INSERT INTO maintenance_timeline (maintenance_id, status, changed_by, notes)
       VALUES ($1, $2, $3, $4)`,
      [record.id, status, userId, 'สร้างรายการ']
    );
    
    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      record: record
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating maintenance record:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// อัพเดทสถานะและข้อมูล Maintenance
router.put('/records/:id', async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { id } = req.params;
    const { 
      status, 
      assignedTo,
      priority,
      description, 
      notes,
      rootCause,
      actionTaken,
      laborCost,
      partsCost,
      userId // ผู้อัพเดท
    } = req.body;

    const updates = [];
    const values = [];
    let paramCount = 1;

    if (status) {
      updates.push(`status = $${paramCount++}`);
      values.push(status);
      
      // อัพเดท timestamp ตาม status
      if (status === 'in_progress' && !updates.includes('started_at')) {
        updates.push(`started_at = CURRENT_TIMESTAMP`);
      } else if (status === 'completed' && !updates.includes('completed_at')) {
        updates.push(`completed_at = CURRENT_TIMESTAMP`);
      }
    }
    
    if (assignedTo) {
      updates.push(`assigned_to = $${paramCount++}`);
      values.push(assignedTo);
    }
    
    if (priority) {
      updates.push(`priority = $${paramCount++}`);
      values.push(priority);
    }
    
    if (description !== undefined) {
      updates.push(`description = $${paramCount++}`);
      values.push(description);
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
    
    if (laborCost !== undefined) {
      updates.push(`labor_cost = $${paramCount++}`);
      values.push(laborCost);
    }
    
    if (partsCost !== undefined) {
      updates.push(`parts_cost = $${paramCount++}`);
      values.push(partsCost);
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);

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
    
    // เพิ่ม timeline ถ้ามีการเปลี่ยน status
    if (status && userId) {
      await client.query(
        `INSERT INTO maintenance_timeline (maintenance_id, status, changed_by, notes)
         VALUES ($1, $2, $3, $4)`,
        [id, status, userId, notes || `เปลี่ยนสถานะเป็น ${status}`]
      );
    }
    
    await client.query('COMMIT');

    res.json({
      success: true,
      record: result.rows[0]
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating maintenance record:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// เพิ่ม comment
router.post('/records/:id/comments', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, comment } = req.body;
    
    if (!userId || !comment) {
      return res.status(400).json({ error: 'User ID and comment are required' });
    }
    
    const result = await pool.query(
      `INSERT INTO maintenance_comments (maintenance_id, user_id, comment)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [id, userId, comment]
    );
    
    res.status(201).json({
      success: true,
      comment: result.rows[0]
    });
    
  } catch (error) {
    console.error('Error adding comment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// เพิ่มอะไหล่ที่ใช้
router.post('/records/:id/parts', async (req, res) => {
  try {
    const { id } = req.params;
    const { sparePartId, quantity, unitPrice } = req.body;
    
    const totalPrice = quantity * unitPrice;
    
    const result = await pool.query(
      `INSERT INTO maintenance_parts_used (maintenance_id, spare_part_id, quantity, unit_price, total_price)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, sparePartId, quantity, unitPrice, totalPrice]
    );
    
    res.status(201).json({
      success: true,
      part: result.rows[0]
    });
    
  } catch (error) {
    console.error('Error adding spare part:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ลบบันทึก Maintenance
router.delete('/records/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM maintenance_records WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Maintenance record not found' });
    }

    res.json({
      success: true,
      message: 'Maintenance record deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting maintenance record:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
