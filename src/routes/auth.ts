import express, { Request, Response, Router } from 'express';
import axios from 'axios';
import pool from '../config/database.js';

const router: Router = express.Router();

interface VerifyBody {
  accessToken: string;
}

interface RegisterBody {
  lineUserId: string;
  displayName?: string;
}

interface LineProfile {
  userId: string;
  displayName: string;
  pictureUrl?: string;
}

// Verify LINE access token and authenticate user
router.post('/verify', async (req: Request, res: Response) => {
  try {
    const { accessToken } = req.body as VerifyBody;

    if (!accessToken) {
      return res.status(400).json({ error: 'Access token is required' });
    }

    // 🔓 DEV MODE: Bypass LINE authentication
    const isDev = process.env.NODE_ENV !== 'production';
    if (isDev && accessToken === 'dev-token') {
      console.log('🔓 DEV MODE: Bypassing LINE authentication');
      
      // Return mock user data for development
      return res.json({
        success: true,
        user: {
          id: 1,
          lineUserId: 'dev-user-123',
          displayName: 'Dev User',
          pictureUrl: 'https://via.placeholder.com/150',
          role: 'admin',
          status: 'active'
        }
      });
    }

    // Verify token with LINE API
    const lineResponse = await axios.get<LineProfile>('https://api.line.me/v2/profile', {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    const lineProfile = lineResponse.data;
    const lineUserId = lineProfile.userId;

    // Check if user exists in database (use maintenance_users table)
    let userQuery = await pool.query(
      'SELECT * FROM maintenance_users WHERE line_user_id = $1',
      [lineUserId]
    );

    // FIRST USER LOGIC: If no users exist, the first one becomes Admin
    const usersCount = await pool.query('SELECT COUNT(*) FROM maintenance_users');
    const isFirstUser = parseInt(usersCount.rows[0].count) === 0;

    if (userQuery.rows.length === 0) {
      if (isFirstUser) {
        // Auto-register first user as admin
        const result = await pool.query(
          `INSERT INTO maintenance_users (line_user_id, display_name, picture_url, role, status) 
           VALUES ($1, $2, $3, 'admin', 'active') 
           RETURNING *`,
          [lineUserId, lineProfile.displayName, lineProfile.pictureUrl]
        );
        const user = result.rows[0];
        return res.json({
          success: true,
          user: {
            id: user.id,
            lineUserId: user.line_user_id,
            displayName: user.display_name,
            pictureUrl: user.picture_url,
            role: user.role,
            status: user.status
          }
        });
      }

      // REGISTRATION GATING: Whitelist is now mandatory
      const regQuery = await pool.query('SELECT value FROM system_settings WHERE key = \'ALLOW_REGISTRATION\'');
      const allowRegistration = regQuery.rows.length > 0 ? regQuery.rows[0].value === 'true' : true;

      if (!allowRegistration) {
        return res.status(403).json({ 
          error: 'Unauthorized', 
          message: 'New registrations are currently closed.' 
        });
      }

      // Always create pending user (Whitelist only)
      await pool.query(
        `INSERT INTO maintenance_users (line_user_id, display_name, picture_url, role, status) 
         VALUES ($1, $2, $3, 'technician', 'pending')`,
        [lineUserId, lineProfile.displayName, lineProfile.pictureUrl]
      );
      return res.status(403).json({ 
        error: 'Pending', 
        message: 'Your registration is pending approval.',
        status: 'pending'
      });
    }

    const user = userQuery.rows[0];

    // Status check
    if (user.status === 'pending') {
      return res.status(403).json({ 
        error: 'Pending', 
        message: 'Your registration is pending approval.',
        status: 'pending'
      });
    }
    if (user.status === 'rejected') {
      return res.status(403).json({ 
        error: 'Rejected', 
        message: 'Your access has been denied by an administrator.' 
      });
    }

    // Update profile info
    await pool.query(
      `UPDATE maintenance_users 
       SET display_name = $1, picture_url = $2, updated_at = CURRENT_TIMESTAMP 
       WHERE line_user_id = $3`,
      [lineProfile.displayName, lineProfile.pictureUrl, lineUserId]
    );

    res.json({
      success: true,
      user: {
        id: user.id,
        lineUserId: user.line_user_id,
        displayName: lineProfile.displayName,
        pictureUrl: lineProfile.pictureUrl,
        role: user.role,
        status: user.status
      }
    });

  } catch (error: any) {
    console.error('Auth verification error:', error);
    
    if (error.response?.status === 401) {
      return res.status(401).json({ 
        error: 'Invalid token', 
        message: 'LINE access token expired or invalid' 
      });
    }

    res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message 
    });
  }
});

// Register new user
router.post('/register-user', async (req: Request, res: Response) => {
  try {
    const { lineUserId, displayName } = req.body as RegisterBody;

    if (!lineUserId) {
      return res.status(400).json({ error: 'LINE User ID is required' });
    }

    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT * FROM maintenance_users WHERE line_user_id = $1',
      [lineUserId]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({ 
        error: 'User already exists',
        user: existingUser.rows[0]
      });
    }

    // Add new user
    const result = await pool.query(
      `INSERT INTO maintenance_users (line_user_id, display_name) 
       VALUES ($1, $2) 
       RETURNING *`,
      [lineUserId, displayName]
    );

    res.status(201).json({
      success: true,
      user: result.rows[0]
    });

  } catch (error: any) {
    console.error('User registration error:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message 
    });
  }
});

export default router;
