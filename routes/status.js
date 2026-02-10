import express from 'express';
import pool from '../config/database.js';

const router = express.Router();

// อัพเดทสถานะ maintenance record
router.post('/records/:id/status', async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { id } = req.params;
    const { status, userId, notes, rootCause, actionTaken, cancelledReason, onHoldReason } = req.body;

    if (!status || !userId) {
      return res.status(400).json({ error: 'Status and userId are required' });
    }

    const validStatuses = ['pending', 'in_progress', 'completed', 'cancelled', 'on_hold', 'reopened'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    await client.query('BEGIN');

    // ตรวจสอบว่า record มีอยู่จริง
    const recordCheck = await client.query(
      'SELECT * FROM maintenance_records WHERE id = $1',
      [id]
    );

    if (recordCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Maintenance record not found' });
    }

    const currentRecord = recordCheck.rows[0];

    // Validation rules
    if (status === 'completed') {
      if (!rootCause || !actionTaken) {
        await client.query('ROLLBACK');
        return res.status(400).json({ 
          error: 'Root cause and action taken are required to complete the record' 
        });
      }
    }

    if (status === 'cancelled' && !cancelledReason) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        error: 'Cancellation reason is required' 
      });
    }

    if (status === 'on_hold' && !onHoldReason) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        error: 'On hold reason is required' 
      });
    }

    // สร้าง update query dynamically
    let updateFields = ['status = $1', 'updated_at = CURRENT_TIMESTAMP'];
    let updateValues = [status];
    let paramCounter = 2;

    // อัพเดทเวลาตาม status
    if (status === 'in_progress' && !currentRecord.started_at) {
      updateFields.push(`started_at = CURRENT_TIMESTAMP`);
    }

    if (status === 'completed') {
      updateFields.push(`completed_at = CURRENT_TIMESTAMP`);
      
      // คำนวณ downtime ถ้ามี started_at
      if (currentRecord.started_at) {
        updateFields.push(`downtime_minutes = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - started_at)) / 60`);
      }
      
      if (rootCause) {
        updateFields.push(`root_cause = $${paramCounter}`);
        updateValues.push(rootCause);
        paramCounter++;
      }
      
      if (actionTaken) {
        updateFields.push(`action_taken = $${paramCounter}`);
        updateValues.push(actionTaken);
        paramCounter++;
      }
    }

    if (status === 'cancelled' && cancelledReason) {
      updateFields.push(`cancelled_reason = $${paramCounter}`);
      updateValues.push(cancelledReason);
      paramCounter++;
    }

    if (status === 'on_hold' && onHoldReason) {
      updateFields.push(`on_hold_reason = $${paramCounter}`);
      updateValues.push(onHoldReason);
      paramCounter++;
    }

    if (notes) {
      updateFields.push(`notes = $${paramCounter}`);
      updateValues.push(notes);
      paramCounter++;
    }

    // อัพเดท record
    updateValues.push(id);
    const updateQuery = `
      UPDATE maintenance_records 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramCounter}
      RETURNING *
    `;

    const result = await client.query(updateQuery, updateValues);

    // บันทึกลง timeline
    await client.query(
      `INSERT INTO maintenance_timeline (maintenance_id, status, changed_by, notes)
       VALUES ($1, $2, $3, $4)`,
      [id, status, userId, notes || `สถานะเปลี่ยนเป็น ${status}`]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      record: result.rows[0]
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating status:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// อัพเดทความสำคัญ (Priority)
router.post('/records/:id/priority', async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { id } = req.params;
    const { priority, userId } = req.body;

    if (!priority || !userId) {
      return res.status(400).json({ error: 'Priority and userId are required' });
    }

    const validPriorities = ['low', 'medium', 'high', 'critical'];
    if (!validPriorities.includes(priority)) {
      return res.status(400).json({ error: 'Invalid priority' });
    }

    await client.query('BEGIN');

    const result = await client.query(
      `UPDATE maintenance_records 
       SET priority = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING *`,
      [priority, id]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Maintenance record not found' });
    }

    // บันทึกลง timeline
    await client.query(
      `INSERT INTO maintenance_timeline (maintenance_id, status, changed_by, notes)
       VALUES ($1, $2, $3, $4)`,
      [id, result.rows[0].status, userId, `เปลี่ยนระดับความสำคัญเป็น ${priority}`]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      record: result.rows[0]
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating priority:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// เปลี่ยนผู้รับผิดชอบ (Reassign)
router.post('/records/:id/assign', async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { id } = req.params;
    const { assignedTo, userId } = req.body;

    if (!assignedTo || !userId) {
      return res.status(400).json({ error: 'assignedTo and userId are required' });
    }

    await client.query('BEGIN');

    // ตรวจสอบว่า user ที่จะ assign มีอยู่จริง
    const userCheck = await client.query(
      'SELECT id, display_name FROM users WHERE id = $1',
      [assignedTo]
    );

    if (userCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Assigned user not found' });
    }

    const result = await client.query(
      `UPDATE maintenance_records 
       SET assigned_to = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING *`,
      [assignedTo, id]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Maintenance record not found' });
    }

    // บันทึกลง timeline
    await client.query(
      `INSERT INTO maintenance_timeline (maintenance_id, status, changed_by, notes)
       VALUES ($1, $2, $3, $4)`,
      [id, result.rows[0].status, userId, `มอบหมายงานให้ ${userCheck.rows[0].display_name}`]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      record: result.rows[0]
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error reassigning:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

export default router;
