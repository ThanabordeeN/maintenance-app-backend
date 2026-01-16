import express from 'express';
import axios from 'axios';
import pool from '../config/database.js';

const router = express.Router();

// ตรวจสอบ LINE Access Token และยืนยันผู้ใช้
router.post('/verify', async (req, res) => {
  try {
    const { accessToken } = req.body;

    if (!accessToken) {
      return res.status(400).json({ error: 'Access token is required' });
    }

    // ตรวจสอบ token กับ LINE API
    const lineResponse = await axios.get('https://api.line.me/v2/profile', {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    const lineProfile = lineResponse.data;
    const lineUserId = lineProfile.userId;

    // ตรวจสอบว่า user_id มีในฐานข้อมูลหรือไม่
    const userQuery = await pool.query(
      'SELECT * FROM users WHERE line_user_id = $1',
      [lineUserId]
    );

    if (userQuery.rows.length === 0) {
      return res.status(403).json({ 
        error: 'Unauthorized', 
        message: 'User not found in system' 
      });
    }

    const user = userQuery.rows[0];

    // อัพเดทข้อมูลโปรไฟล์ถ้ามีการเปลี่ยนแปลง
    await pool.query(
      `UPDATE users 
       SET display_name = $1, picture_url = $2, updated_at = CURRENT_TIMESTAMP 
       WHERE line_user_id = $3`,
      [lineProfile.displayName, lineProfile.pictureUrl, lineUserId]
    );

    // ส่งข้อมูลผู้ใช้กลับไป
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

  } catch (error) {
    console.error('Auth verification error:', error);
    
    if (error.response?.status === 401) {
      return res.status(401).json({ 
        error: 'Invalid token', 
        message: 'LINE access token หมดอายุหรือไม่ถูกต้อง กรุณา logout และ login ใหม่อีกครั้ง' 
      });
    }

    if (error.response?.status === 400) {
      return res.status(400).json({ 
        error: 'Bad request', 
        message: 'Authorization code ไม่ถูกต้อง กรุณาตรวจสอบ LIFF ID และ Channel settings' 
      });
    }

    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      return res.status(503).json({ 
        error: 'Service unavailable', 
        message: 'ไม่สามารถเชื่อมต่อกับ LINE API กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต' 
      });
    }

    res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message 
    });
  }
});

// เพิ่มผู้ใช้ใหม่ (สำหรับ Admin เท่านั้น)
router.post('/register-user', async (req, res) => {
  try {
    const { lineUserId, displayName, email } = req.body;

    if (!lineUserId) {
      return res.status(400).json({ error: 'LINE User ID is required' });
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
      `INSERT INTO users (line_user_id, display_name, email) 
       VALUES ($1, $2, $3) 
       RETURNING *`,
      [lineUserId, displayName, email]
    );

    res.status(201).json({
      success: true,
      user: result.rows[0]
    });

  } catch (error) {
    console.error('User registration error:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message 
    });
  }
});

export default router;
