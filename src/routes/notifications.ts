import express, { Request, Response, Router } from 'express';
import pool from '../config/database.js';
import { notifyPMOverdue } from '../services/lineMessaging.js';

const router: Router = express.Router();

// ===========================================
// NOTIFICATIONS
// ===========================================

// Get user notifications
router.get('/', async (req: Request, res: Response) => {
  try {
    const { userId, unreadOnly, limit } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    let query = `
      SELECT * FROM maintenance_notifications
      WHERE user_id = $1
    `;
    const params: any[] = [userId];

    if (unreadOnly === 'true') {
      query += ` AND is_read = false`;
    }

    query += ` ORDER BY created_at DESC`;

    if (limit) {
      query += ` LIMIT $2`;
      params.push(parseInt(limit as string));
    }

    const result = await pool.query(query, params);

    // Get unread count
    const unreadCount = await pool.query(
      'SELECT COUNT(*) FROM maintenance_notifications WHERE user_id = $1 AND is_read = false',
      [userId]
    );

    res.json({
      notifications: result.rows,
      unreadCount: parseInt(unreadCount.rows[0].count)
    });
  } catch (error: any) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create notification
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      user_id, title, message, type, category,
      reference_type, reference_id
    } = req.body;

    if (!user_id || !title) {
      return res.status(400).json({ error: 'user_id and title are required' });
    }

    const result = await pool.query(`
      INSERT INTO maintenance_notifications (
        user_id, title, message, type, category, reference_type, reference_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [user_id, title, message, type || 'info', category, reference_type, reference_id]);

    const msgId = result.rows[0].id;

    // Also update user's noti_list for fast polling (graceful if column doesn't exist)
    try {
      await pool.query(`
        UPDATE maintenance_users 
        SET noti_list = COALESCE(noti_list, '{}'::jsonb) || $1::jsonb
        WHERE id = $2
      `, [
        JSON.stringify({ [msgId]: { status: 'unread', type: type || 'info', title, created_at: new Date().toISOString() } }),
        user_id
      ]);
    } catch (notiError: any) {
      // Ignore if noti_list column doesn't exist
      if (notiError.code !== '42703') {
        console.warn('Warning updating noti_list:', notiError.message);
      }
    }

    res.status(201).json({ notification: result.rows[0] });
  } catch (error: any) {
    console.error('Error creating notification:', error);
    res.status(500).json({ error: error.message });
  }
});

// Send notification to multiple users (for broadcasts)
router.post('/broadcast', async (req: Request, res: Response) => {
  try {
    const {
      user_ids, role, title, message, type, category,
      reference_type, reference_id
    } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'title is required' });
    }

    let targetUsers: number[] = user_ids || [];

    // If role specified, get all users with that role
    if (role) {
      const users = await pool.query(
        'SELECT id FROM maintenance_users WHERE role = $1',
        [role]
      );
      targetUsers = users.rows.map((u: any) => u.id);
    }

    if (targetUsers.length === 0) {
      return res.status(400).json({ error: 'No target users specified' });
    }

    const notifications = await Promise.all(
      targetUsers.map(async (userId) => {
        const result = await pool.query(`
          INSERT INTO maintenance_notifications (
            user_id, title, message, type, category, reference_type, reference_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING *
        `, [userId, title, message, type || 'info', category, reference_type, reference_id]);
        return result.rows[0];
      })
    );

    res.status(201).json({
      count: notifications.length,
      notifications
    });
  } catch (error: any) {
    console.error('Error broadcasting notification:', error);
    res.status(500).json({ error: error.message });
  }
});

// Mark notification as read
router.patch('/:id/read', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      UPDATE maintenance_notifications
      SET is_read = true, read_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ notification: result.rows[0] });
  } catch (error: any) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ error: error.message });
  }
});

// Mark all as read for user
router.patch('/read-all', async (req: Request, res: Response) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    await pool.query(`
      UPDATE maintenance_notifications
      SET is_read = true, read_at = NOW()
      WHERE user_id = $1 AND is_read = false
    `, [userId]);

    res.json({ message: 'All notifications marked as read' });
  } catch (error: any) {
    console.error('Error marking all as read:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete notification
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM maintenance_notifications WHERE id = $1', [id]);
    res.json({ message: 'Notification deleted' });
  } catch (error: any) {
    console.error('Error deleting notification:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===========================================
// FAST POLLING API (using noti_list in user)
// ===========================================

// Quick check - returns only noti_list from user (very fast)
router.get('/quick/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    // Try to get noti_list, fall back to notifications table if column doesn't exist
    try {
      const result = await pool.query(
        'SELECT noti_list FROM maintenance_users WHERE id = $1',
        [userId]
      );

      if (result.rows.length === 0) {
        return res.json({ notiList: {}, unreadCount: 0 });
      }

      const notiList = result.rows[0].noti_list || {};
      const unreadCount = Object.values(notiList).filter((n: any) => n.status === 'unread').length;

      res.json({
        notiList,
        unreadCount
      });
    } catch (dbError: any) {
      // If noti_list column doesn't exist, fall back to notifications table
      if (dbError.code === '42703') {
        const countResult = await pool.query(
          'SELECT COUNT(*) FROM maintenance_notifications WHERE user_id = $1 AND is_read = false',
          [userId]
        );
        res.json({
          notiList: {},
          unreadCount: parseInt(countResult.rows[0].count)
        });
      } else {
        throw dbError;
      }
    }
  } catch (error: any) {
    console.error('Error quick check notifications:', error);
    // Return empty data instead of 500 error to prevent frontend spam
    res.json({ notiList: {}, unreadCount: 0 });
  }
});

// Mark notification as read in noti_list
router.patch('/quick/:userId/:msgId/read', async (req: Request, res: Response) => {
  try {
    const { userId, msgId } = req.params;

    // Update noti_list (graceful if column doesn't exist)
    try {
      await pool.query(`
        UPDATE maintenance_users 
        SET noti_list = jsonb_set(COALESCE(noti_list, '{}'::jsonb), $1, $2)
        WHERE id = $3
      `, [
        `{${msgId},status}`,
        '"read"',
        userId
      ]);
    } catch (notiError: any) {
      if (notiError.code !== '42703') {
        console.warn('Warning updating noti_list:', notiError.message);
      }
    }

    // Also update notifications table
    await pool.query(`
      UPDATE maintenance_notifications
      SET is_read = true, read_at = NOW()
      WHERE id = $1
    `, [msgId]);

    res.json({ success: true });
  } catch (error: any) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ error: error.message });
  }
});

// Mark all as read in noti_list
router.patch('/quick/:userId/read-all', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    // Get current noti_list (graceful if column doesn't exist)
    try {
      const result = await pool.query(
        'SELECT noti_list FROM maintenance_users WHERE id = $1',
        [userId]
      );

      if (result.rows.length > 0 && result.rows[0].noti_list) {
        const notiList = result.rows[0].noti_list;
        // Mark all as read
        for (const msgId of Object.keys(notiList)) {
          if (notiList[msgId].status === 'unread') {
            notiList[msgId].status = 'read';
          }
        }

        await pool.query(
          'UPDATE maintenance_users SET noti_list = $1 WHERE id = $2',
          [JSON.stringify(notiList), userId]
        );
      }
    } catch (notiError: any) {
      if (notiError.code !== '42703') {
        console.warn('Warning updating noti_list:', notiError.message);
      }
    }

    // Also update notifications table
    await pool.query(`
      UPDATE maintenance_notifications
      SET is_read = true, read_at = NOW()
      WHERE user_id = $1 AND is_read = false
    `, [userId]);

    res.json({ success: true });
  } catch (error: any) {
    console.error('Error marking all as read:', error);
    res.status(500).json({ error: error.message });
  }
});

// Clear all notifications for user (must be before :msgId route)
router.delete('/quick/:userId/clear-all', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    // Clear noti_list (graceful if column doesn't exist)
    try {
      await pool.query(
        "UPDATE maintenance_users SET noti_list = '{}'::jsonb WHERE id = $1",
        [userId]
      );
    } catch (notiError: any) {
      if (notiError.code !== '42703') {
        console.warn('Warning clearing noti_list:', notiError.message);
      }
    }

    // Also delete from notifications table
    await pool.query('DELETE FROM maintenance_notifications WHERE user_id = $1', [userId]);

    res.json({ success: true });
  } catch (error: any) {
    console.error('Error clearing all notifications:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete single notification (after clear-all route)
router.delete('/quick/:userId/:msgId', async (req: Request, res: Response) => {
  try {
    const { userId, msgId } = req.params;

    // Remove from noti_list (graceful if column doesn't exist)
    try {
      await pool.query(`
        UPDATE maintenance_users 
        SET noti_list = COALESCE(noti_list, '{}'::jsonb) - $1
        WHERE id = $2
      `, [msgId, userId]);
    } catch (notiError: any) {
      if (notiError.code !== '42703') {
        console.warn('Warning removing from noti_list:', notiError.message);
      }
    }

    // Also delete from notifications table
    await pool.query('DELETE FROM maintenance_notifications WHERE id = $1', [msgId]);

    res.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting notification:', error);
    res.status(500).json({ error: error.message });
  }
});

// Clear old notifications from noti_list (keep last 50)
router.delete('/quick/:userId/cleanup', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    try {
      const result = await pool.query(
        'SELECT noti_list FROM maintenance_users WHERE id = $1',
        [userId]
      );

      if (result.rows.length > 0 && result.rows[0].noti_list) {
        const notiList = result.rows[0].noti_list;
        const entries = Object.entries(notiList);

        // Keep only last 50
        if (entries.length > 50) {
          const sorted = entries.sort((a: any, b: any) =>
            new Date(b[1].created_at).getTime() - new Date(a[1].created_at).getTime()
          );
          const kept = Object.fromEntries(sorted.slice(0, 50));

          await pool.query(
            'UPDATE maintenance_users SET noti_list = $1 WHERE id = $2',
            [JSON.stringify(kept), userId]
          );
        }
      }
    } catch (notiError: any) {
      if (notiError.code !== '42703') {
        console.warn('Warning cleanup noti_list:', notiError.message);
      }
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('Error cleanup notifications:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get/Update user preferences
router.get('/preferences/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    let result = await pool.query(
      'SELECT * FROM notification_preferences WHERE user_id = $1',
      [userId]
    );

    // Create default if not exists
    if (result.rows.length === 0) {
      result = await pool.query(`
        INSERT INTO notification_preferences (user_id)
        VALUES ($1)
        RETURNING *
      `, [userId]);
    }

    res.json({ preferences: result.rows[0] });
  } catch (error: any) {
    console.error('Error fetching preferences:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/preferences/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const {
      enable_line_push, enable_email, enable_in_app,
      notify_new_ticket, notify_assigned, notify_status_change,
      notify_overdue, updated_at
    } = req.body;

    const result = await pool.query(`
      INSERT INTO notification_preferences (
        user_id, enable_line_push, enable_email, enable_in_app,
        notify_new_ticket, notify_assigned, notify_status_change,
        notify_overdue
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (user_id) DO UPDATE SET
        enable_line_push = COALESCE($2, notification_preferences.enable_line_push),
        enable_email = COALESCE($3, notification_preferences.enable_email),
        enable_in_app = COALESCE($4, notification_preferences.enable_in_app),
        notify_new_ticket = COALESCE($5, notification_preferences.notify_new_ticket),
        notify_assigned = COALESCE($6, notification_preferences.notify_assigned),
        notify_status_change = COALESCE($7, notification_preferences.notify_status_change),
        notify_overdue = COALESCE($8, notification_preferences.notify_overdue),
        updated_at = NOW()
      RETURNING *
    `, [
      userId, enable_line_push, enable_email, enable_in_app,
      notify_new_ticket, notify_assigned, notify_status_change,
      notify_overdue
    ]);

    res.json({ preferences: result.rows[0] });
  } catch (error: any) {
    console.error('Error updating preferences:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===========================================
// AUTO NOTIFICATION TRIGGERS (to be called by other routes)
// ===========================================

// Helper function to create notifications
export async function createNotification(data: {
  user_id: number;
  title: string;
  message?: string;
  type?: string;
  category?: string;
  reference_type?: string;
  reference_id?: number;
}) {
  try {
    // Insert into notifications table
    const result = await pool.query(`
      INSERT INTO maintenance_notifications (
        user_id, title, message, type, category, reference_type, reference_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `, [
      data.user_id,
      data.title,
      data.message,
      data.type || 'info',
      data.category,
      data.reference_type,
      data.reference_id
    ]);

    const msgId = result.rows[0].id;

    // Also update user's noti_list for fast polling
    await pool.query(`
      UPDATE maintenance_users 
      SET noti_list = noti_list || $1::jsonb
      WHERE id = $2
    `, [
      JSON.stringify({ [msgId]: { status: 'unread', type: data.type || 'info', title: data.title, created_at: new Date().toISOString() } }),
      data.user_id
    ]);

    return msgId;
  } catch (error) {
    console.error('Error creating notification:', error);
    return null;
  }
}

// Notify on maintenance overdue
export async function checkAndNotifyOverdue() {
  try {
    // Find overdue PM schedules
    const overdueSchedules = await pool.query(`
      SELECT 
        ems.id,
        ems.task_name,
        ems.interval_value,
        e.equipment_name,
        e.current_usage,
        (ems.last_completed_at_usage + ems.interval_value) as next_due,
        (ems.last_completed_at_usage + ems.interval_value - e.current_usage) as remaining
      FROM equipment_maintenance_schedules ems
      JOIN equipment e ON ems.equipment_id = e.id
      WHERE e.is_active = true
        AND ems.current_ticket_id IS NULL
        AND (ems.last_completed_at_usage + ems.interval_value - e.current_usage) < 0
    `);

    // Find overdue work orders
    const overdueWorkOrders = await pool.query(`
      SELECT mr.*, e.equipment_name
      FROM maintenance_records mr
      LEFT JOIN equipment e ON mr.equipment_id = e.id
      WHERE mr.status NOT IN ('completed', 'cancelled')
        AND mr.scheduled_date < CURRENT_DATE
    `);

    // Get admins/moderators to notify (ช่างจะเห็นเมื่อถูก assign งาน)
    const admins = await pool.query(
      "SELECT id FROM maintenance_users WHERE role IN ('admin', 'moderator')"
    );

    // Create notifications
    for (const admin of admins.rows) {
      for (const schedule of overdueSchedules.rows) {
        await createNotification({
          user_id: admin.id,
          title: `PM เกินกำหนด: ${schedule.equipment_name}`,
          message: `${schedule.task_name} เกินกำหนด ${Math.abs(schedule.remaining).toFixed(0)} ชม.`,
          type: 'warning',
          category: 'schedule',
          reference_type: 'equipment_maintenance_schedule',
          reference_id: schedule.id
        });

        // Send LINE notification to admin
        try {
          await notifyPMOverdue({
            userId: admin.id,
            equipmentName: schedule.equipment_name,
            taskName: schedule.task_name,
            overdueHours: Math.abs(schedule.remaining)
          });
        } catch (lineErr) {
          console.error('LINE PM notification error:', lineErr);
        }
      }
    }

    return {
      overdueSchedules: overdueSchedules.rows.length,
      overdueWorkOrders: overdueWorkOrders.rows.length
    };
  } catch (error) {
    console.error('Error checking overdue:', error);
    return null;
  }
}



export default router;
