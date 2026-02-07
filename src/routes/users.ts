import express, { Request, Response, Router } from 'express';
import pool from '../config/database.js';
import { authenticateUser, requireAdminOrModerator, requireAdmin, AuthRequest } from '../middleware/auth.js';

const router: Router = express.Router();

// Get all users (Legacy GET)
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT id, line_user_id, display_name, picture_url, email, role, created_at
      FROM maintenance_users
      ORDER BY created_at DESC
    `);
    res.json({ users: result.rows });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /list (Used by frontend)
router.post('/list', async (req: Request, res: Response) => {
  try {
    const { userId } = req.body;
    // Basic auth check: only admin/moderator can list users
    const userCheck = await pool.query('SELECT role FROM maintenance_users WHERE id = $1', [userId]);
    if (userCheck.rows.length === 0 || !['admin', 'moderator'].includes(userCheck.rows[0].role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const result = await pool.query(`
      SELECT id, line_user_id, display_name, picture_url, email, role, created_at
      FROM maintenance_users
      ORDER BY created_at DESC
    `);
    res.json({ users: result.rows });
  } catch (error) {
    console.error('Error fetching users list:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /add (Used by frontend)
router.post('/add', async (req: Request, res: Response) => {
  try {
    const { userId, displayName, lineUserId, role, email, pictureUrl } = req.body;
    
    // Auth check
    const userCheck = await pool.query('SELECT role FROM maintenance_users WHERE id = $1', [userId]);
    if (userCheck.rows.length === 0 || !['admin', 'moderator'].includes(userCheck.rows[0].role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const result = await pool.query(
      `INSERT INTO maintenance_users (display_name, line_user_id, role, email, picture_url, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       RETURNING *`,
      [displayName, lineUserId, role || 'technician', email, pictureUrl]
    );

    res.status(201).json({ success: true, user: result.rows[0] });
  } catch (error) {
    console.error('Error adding user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /update (Used by frontend)
router.post('/update', async (req: Request, res: Response) => {
  try {
    const { userId, targetUserId, displayName, role, email } = req.body;
    
    // Auth check
    const userCheck = await pool.query('SELECT role FROM maintenance_users WHERE id = $1', [userId]);
    if (userCheck.rows.length === 0 || !['admin', 'moderator'].includes(userCheck.rows[0].role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const result = await pool.query(
      `UPDATE maintenance_users 
       SET display_name = COALESCE($1, display_name),
           role = COALESCE($2, role),
           email = COALESCE($3, email),
           updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [displayName, role, email, targetUserId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /delete (Used by frontend)
router.post('/delete', async (req: Request, res: Response) => {
  try {
    const { userId, targetUserId } = req.body;
    
    // Auth check
    const userCheck = await pool.query('SELECT role FROM maintenance_users WHERE id = $1', [userId]);
    if (userCheck.rows.length === 0 || !['admin', 'moderator'].includes(userCheck.rows[0].role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (userId === targetUserId) {
      return res.status(400).json({ error: 'Cannot delete yourself' });
    }

    const result = await pool.query(
      'DELETE FROM maintenance_users WHERE id = $1 RETURNING *',
      [targetUserId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ success: true, message: 'User deleted' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /search (Used by frontend)
router.post('/search', async (req: Request, res: Response) => {
  try {
    const { userId, lineUserId } = req.body;
    
    const result = await pool.query(
      'SELECT id, line_user_id, display_name, picture_url, email, role FROM maintenance_users WHERE line_user_id = $1',
      [lineUserId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('Error searching user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user by ID (Legacy GET)
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT id, line_user_id, display_name, picture_url, email, role FROM maintenance_users WHERE id = $1',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user role (ADMIN ONLY)
router.patch('/:id/role', authenticateUser, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    
    // Prevent changing own role
    if (req.user && req.user.id === parseInt(id)) {
      return res.status(403).json({ error: 'Cannot change your own role' });
    }
    
    if (!['admin', 'supervisor', 'technician', 'moderator'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    
    const result = await pool.query(
      'UPDATE maintenance_users SET role = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [role, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    console.error('Error updating user role:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete user (ADMIN ONLY)
router.delete('/:id', authenticateUser, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    
    // Prevent deleting yourself
    if (req.user && req.user.id === parseInt(id)) {
      return res.status(403).json({ error: 'Cannot delete yourself' });
    }
    
    const result = await pool.query(
      'DELETE FROM maintenance_users WHERE id = $1 RETURNING *',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ success: true, message: 'User deleted' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
