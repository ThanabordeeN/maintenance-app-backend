import express, { Request, Response, Router } from 'express';
import pool from '../config/database.js';
import upload from '../config/upload.js';

const router: Router = express.Router();

// Get usage logs by equipment
router.get('/equipment/:id/usage-logs', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    const countResult = await pool.query(
      'SELECT COUNT(*) FROM equipment_usage_logs WHERE equipment_id = $1',
      [id]
    );

    const logsResult = await pool.query(
      `SELECT ul.*, u.display_name as recorder_name 
       FROM equipment_usage_logs ul
       LEFT JOIN maintenance_users u ON ul.recorded_by = u.id
       WHERE ul.equipment_id = $1
       ORDER BY ul.log_date DESC, ul.created_at DESC
       LIMIT $2 OFFSET $3`,
      [id, limit, offset]
    );

    const total = parseInt(countResult.rows[0].count);

    res.json({
      logs: logsResult.rows,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Error fetching usage logs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create usage log
router.post('/equipment/:id/usage-logs', upload.single('image'), async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { usage_value, notes, recorded_by, condition } = req.body;
    const imageUrl = req.file ? `/uploads/images/${req.file.filename}` : null;

    if (!usage_value) {
      return res.status(400).json({ error: 'usage_value is required' });
    }

    await client.query('BEGIN');

    // 1. Insert usage log
    const logResult = await client.query(
      `INSERT INTO equipment_usage_logs 
       (equipment_id, usage_value, log_date, notes, condition, image_url, recorded_by, created_at, updated_at)
       VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, $6, NOW(), NOW())
       RETURNING *`,
      [id, usage_value, notes || null, condition || 'normal', imageUrl, recorded_by || null]
    );

    // 2. Update current_usage in equipment table
    await client.query(
      'UPDATE equipment SET current_usage = $1, updated_at = NOW() WHERE equipment_id = $2',
      [usage_value, id]
    );

    await client.query('COMMIT');

    res.status(201).json({
      log: logResult.rows[0],
      message: 'Usage log created and equipment updated'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating usage log:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Update usage log (only latest/notes)
router.put('/usage-logs/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { usage_value, notes, condition } = req.body;

    const result = await pool.query(
      `UPDATE equipment_usage_logs 
       SET usage_value = COALESCE($1, usage_value),
           notes = COALESCE($2, notes),
           condition = COALESCE($3, condition),
           updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [usage_value, notes, condition, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usage log not found' });
    }

    res.json({
      log: result.rows[0],
      message: 'Usage log updated'
    });
  } catch (error) {
    console.error('Error updating usage log:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
