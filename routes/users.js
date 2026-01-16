import express from 'express';
import pool from '../config/database.js';

const router = express.Router();

// Middleware ตรวจสอบว่าเป็น moderator
const checkModerator = async (req, res, next) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(401).json({ error: 'User ID is required' });
    }

    const result = await pool.query(
      'SELECT role FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (result.rows[0].role !== 'moderator') {
      return res.status(403).json({ error: 'Access denied. Moderator role required.' });
    }

    next();
  } catch (error) {
    console.error('Moderator check error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ดึงรายชื่อผู้ใช้ทั้งหมด (เฉพาะ moderator)
router.post('/list', checkModerator, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, line_user_id, display_name, picture_url, email, role, created_at, updated_at 
       FROM users 
       ORDER BY created_at DESC`
    );

    res.json({
      success: true,
      users: result.rows
    });
  } catch (error) {
    console.error('List users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// เพิ่มผู้ใช้ใหม่ (เฉพาะ moderator)
router.post('/add', checkModerator, async (req, res) => {
  try {
    const { lineUserId, displayName, email, role } = req.body;

    if (!lineUserId || !displayName) {
      return res.status(400).json({ 
        error: 'LINE User ID and Display Name are required' 
      });
    }

    // ตรวจสอบว่ามี user นี้อยู่แล้วหรือไม่
    const existingUser = await pool.query(
      'SELECT * FROM users WHERE line_user_id = $1',
      [lineUserId]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({ 
        error: 'User already exists',
        user: existingUser.rows[0]
      });
    }

    // เพิ่มผู้ใช้ใหม่
    const result = await pool.query(
      `INSERT INTO users (line_user_id, display_name, email, role) 
       VALUES ($1, $2, $3, $4) 
       RETURNING *`,
      [lineUserId, displayName, email || null, role || 'technician']
    );

    res.status(201).json({
      success: true,
      user: result.rows[0]
    });
  } catch (error) {
    console.error('Add user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// อัพเดทข้อมูลผู้ใช้ (เฉพาะ moderator)
router.post('/update', checkModerator, async (req, res) => {
  try {
    const { targetUserId, displayName, email, role } = req.body;

    if (!targetUserId) {
      return res.status(400).json({ error: 'Target User ID is required' });
    }

    // ตรวจสอบว่า user มีอยู่จริง
    const existingUser = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [targetUserId]
    );

    if (existingUser.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // อัพเดทข้อมูล
    const result = await pool.query(
      `UPDATE users 
       SET display_name = COALESCE($1, display_name),
           email = COALESCE($2, email),
           role = COALESCE($3, role),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING *`,
      [displayName, email, role, targetUserId]
    );

    res.json({
      success: true,
      user: result.rows[0]
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ลบผู้ใช้ (เฉพาะ moderator)
router.post('/delete', checkModerator, async (req, res) => {
  try {
    const { userId: moderatorId, targetUserId } = req.body;

    if (!targetUserId) {
      return res.status(400).json({ error: 'Target User ID is required' });
    }

    // ป้องกันไม่ให้ลบตัวเอง
    if (moderatorId === targetUserId) {
      return res.status(400).json({ 
        error: 'Cannot delete your own account' 
      });
    }

    // ตรวจสอบว่า user ที่จะลบมีอยู่จริง
    const existingUser = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [targetUserId]
    );

    if (existingUser.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // ป้องกันไม่ให้ลบ moderator คนอื่น
    if (existingUser.rows[0].role === 'moderator') {
      return res.status(403).json({ 
        error: 'Cannot delete another moderator account' 
      });
    }

    // ลบผู้ใช้
    await pool.query('DELETE FROM users WHERE id = $1', [targetUserId]);

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ค้นหาผู้ใช้จาก LINE User ID (เฉพาะ moderator)
router.post('/search', checkModerator, async (req, res) => {
  try {
    const { lineUserId } = req.body;

    if (!lineUserId) {
      return res.status(400).json({ error: 'LINE User ID is required' });
    }

    const result = await pool.query(
      `SELECT id, line_user_id, display_name, picture_url, email, role, created_at 
       FROM users 
       WHERE line_user_id = $1`,
      [lineUserId]
    );

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        found: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      found: true,
      user: result.rows[0]
    });
  } catch (error) {
    console.error('Search user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
