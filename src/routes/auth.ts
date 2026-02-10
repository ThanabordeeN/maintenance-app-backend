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
  email?: string;
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
          email: 'dev@example.com',
          role: 'admin'
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

    if (userQuery.rows.length === 0) {
      return res.status(403).json({ 
        error: 'Unauthorized', 
        message: 'User not found in system' 
      });
    }

    const user = userQuery.rows[0];

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
        email: user.email,
        role: user.role
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
    const { lineUserId, displayName, email } = req.body as RegisterBody;

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
      `INSERT INTO maintenance_users (line_user_id, display_name, email) 
       VALUES ($1, $2, $3) 
       RETURNING *`,
      [lineUserId, displayName, email]
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
