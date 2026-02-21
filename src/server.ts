import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.js';
import maintenanceRoutes from './routes/maintenance.js';
import usersRoutes from './routes/users.js';
import statusRoutes from './routes/status.js';
import usageRoutes from './routes/usage.js';
import setupRoutes from './routes/setup.js';
import reportsRoutes from './routes/reports.js';
import notificationsRoutes, { checkAndNotifyOverdue, createNotification } from './routes/notifications.js';

import pool from './config/database.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3002; // Different port from main backend

// Trust proxy - needed when behind nginx reverse proxy (1 = behind 1 proxy)
app.set('trust proxy', 1);

// Security Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow images to load cross-origin
  contentSecurityPolicy: false // Disable CSP for API server
}));

// Rate Limiting - prevent brute force attacks
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // limit each IP to 500 requests per windowMs
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false }, // Disable trust proxy validation
});

// Stricter rate limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // limit auth attempts
  message: { error: 'Too many login attempts, please try again later.' },
  validate: { trustProxy: false }, // Disable trust proxy validation
});

app.use('/api/', limiter);
app.use('/api/auth', authLimiter);

// CORS Configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:5173', 'http://localhost:3000', 'https://liff.line.me'];

app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? allowedOrigins
    : true, // Allow all origins in development
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Limit JSON body size to prevent DoS
app.use(express.json({ limit: '1mb' }));

// Sanitize inputs middleware
import { sanitizeInputs } from './middleware/validation.js';
app.use(sanitizeInputs);

// Serve static files
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
app.use('/uploads', express.static(uploadDir));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/maintenance', usageRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/status', statusRoutes);
app.use('/api/setup', setupRoutes);

app.use('/api/reports', reportsRoutes);
app.use('/api/notifications', notificationsRoutes);


// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'OK', message: 'Maintenance API server is running' });
});

// Global Error Handler - Hide sensitive error details in production
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled error:', err);

  const isDev = process.env.NODE_ENV !== 'production';

  res.status(err.status || 500).json({
    error: isDev ? err.message : 'An internal error occurred',
    ...(isDev && { stack: err.stack })
  });
});

// ========================================
// PM SCHEDULE CHECK & NOTIFICATION
// ========================================

// Check PM schedules that are due or approaching
async function checkPMSchedules() {
  try {
    console.log('🔍 Checking PM schedules...');

    const activeSchedules = await pool.query(`
      SELECT 
        ems.id,
        ems.equipment_id,
        ems.interval_value,
        ems.description,
        ems.current_ticket_id,
        e.equipment_name,
        e.equipment_code,
        e.current_usage,
        (ems.last_completed_at_usage + ems.interval_value) as next_due,
        (ems.last_completed_at_usage + ems.interval_value - e.current_usage) as remaining
      FROM equipment_maintenance_schedules ems
      JOIN equipment e ON ems.equipment_id = e.equipment_id
      WHERE e.is_active = true
        AND ems.current_ticket_id IS NULL
    `);

    if (activeSchedules.rows.length === 0) {
      console.log('✅ No active PM schedules to check');
      return { count: 0, schedules: [], tickets: [] };
    }

    const notifiedSchedules = [];
    const createdTickets = [];

    // Get all technicians/admins to notify
    const users = await pool.query(
      "SELECT id, display_name, line_notify_token FROM maintenance_users WHERE role IN ('admin', 'supervisor', 'technician')"
    );

    // Get first admin/supervisor for auto-assignment
    const defaultAssignee = await pool.query(
      "SELECT id FROM maintenance_users WHERE role IN ('admin', 'supervisor') ORDER BY id LIMIT 1"
    );
    const assigneeId = defaultAssignee.rows[0]?.id || 1;

    for (const schedule of activeSchedules.rows) {
      const remainingHours = parseFloat(schedule.remaining);
      const isOverdue = remainingHours <= 0;
      let shouldAlert = isOverdue;
      let statusText = '';
      let notificationType = 'info';

      // Calculate 7-day average usage for predictive alerts if not overdue
      if (!isOverdue) {
        // Also check if physical usage has reached 80% of interval
        const currentUsagePercentage = (schedule.interval_value - remainingHours) / schedule.interval_value;
        const reached80Percent = currentUsagePercentage >= 0.8;

        const avgQuery = await pool.query(`
          SELECT COALESCE(SUM(EXTRACT(EPOCH FROM uptime) / 3600.0) / 7.0, 0) as avg_daily
          FROM equipment_daily_summary
          WHERE equipment_id = $1 
            AND date >= CURRENT_DATE - INTERVAL '7 days'
        `, [schedule.equipment_id]);

        const avgDailyUsage = parseFloat(avgQuery.rows[0]?.avg_daily || 0);
        let estimatedDays = Infinity;

        // Condition 1: Predictive 5-day alert
        if (avgDailyUsage > 0) {
          estimatedDays = remainingHours / avgDailyUsage;
          if (estimatedDays <= 5) {
            shouldAlert = true;
            statusText = `อีก ~${Math.ceil(estimatedDays)} วัน (${Math.round(remainingHours)} ชม.)`;
            notificationType = 'warning';
          }
        }

        // Condition 2 & 3: Fallbacks
        if (!shouldAlert) {
          if (reached80Percent) {
            // Priority fallback: If machine usage reaches 80% of interval, alert.
            shouldAlert = true;
            statusText = `ถึง 80% แล้ว (เหลืออีก ${Math.round(remainingHours)} ชม.)`;
            notificationType = 'warning';
          } else if (remainingHours <= 24) {
            // Critical manual fallback: Less than 24h absolute hours remain.
            shouldAlert = true;
            statusText = `อีก ${Math.round(remainingHours)} ชม.`;
            notificationType = 'warning';
          }
        }
      } else {
        statusText = 'ถึงกำหนดแล้ว';
        notificationType = 'warning';
      }

      if (!shouldAlert) continue;

      // Check if notification already sent today for this schedule
      const existingNotif = await pool.query(`
        SELECT id FROM maintenance_notifications 
        WHERE reference_type = 'equipment_maintenance_schedule' 
          AND reference_id = $1 
          AND created_at > NOW() - INTERVAL '24 hours'
        LIMIT 1
      `, [schedule.id]);

      // Skip if already notified today (unless it's overdue and we haven't created ticket yet)
      if (existingNotif.rows.length > 0 && !isOverdue) {
        continue;
      }

      // ===== AUTO CREATE TICKET เมื่อถึงกำหนด (remaining <= 0) =====
      let ticketId = null;
      let workOrder = null;

      if (isOverdue) {
        try {
          const year = new Date().getFullYear();
          const countResult = await pool.query(`
            SELECT COUNT(*) FROM maintenance_records 
            WHERE EXTRACT(YEAR FROM created_at) = $1
          `, [year]);
          const count = parseInt(countResult.rows[0].count) + 1;
          workOrder = `PM-${year}-${String(count).padStart(6, '0')}`;

          const ticketResult = await pool.query(`
            INSERT INTO maintenance_records 
            (work_order, equipment_id, created_by, assigned_to, maintenance_type, priority, status, category, title, description, scheduled_date, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_DATE, NOW(), NOW())
            RETURNING id
          `, [
            workOrder,
            schedule.equipment_id,
            assigneeId,
            assigneeId,
            'preventive',
            'medium',
            'pending',
            'mechanical',
            `PM: ${schedule.equipment_name} - ${schedule.description || 'บำรุงรักษาตามกำหนด'}`,
            `บำรุงรักษาตามกำหนดรอบ ${schedule.interval_value} ชม.\nอุปกรณ์: ${schedule.equipment_name}\nUsage ปัจจุบัน: ${schedule.current_usage} ชม.`
          ]);

          ticketId = ticketResult.rows[0].id;

          await pool.query(
            'UPDATE equipment_maintenance_schedules SET current_ticket_id = $1, updated_at = NOW() WHERE id = $2',
            [ticketId, schedule.id]
          );

          await pool.query(
            `INSERT INTO maintenance_timeline (maintenance_id, status, changed_by, notes)
             VALUES ($1, $2, $3, $4)`,
            [ticketId, 'pending', assigneeId, 'สร้างอัตโนมัติจากระบบ PM']
          );

          console.log(`✅ Created PM ticket: ${workOrder} for ${schedule.equipment_name}`);

          createdTickets.push({
            id: ticketId,
            workOrder,
            equipment: schedule.equipment_name,
            scheduleId: schedule.id,
          });

        } catch (ticketError) {
          console.error(`❌ Failed to create ticket for schedule ${schedule.id}:`, ticketError);
        }
      }

      // Create in-app notification for each user
      for (const user of users.rows) {
        const notifTitle = ticketId
          ? `🔧 สร้าง PM Ticket: ${workOrder}`
          : (isOverdue
            ? `🔴 PM ถึงกำหนด: ${schedule.equipment_name}`
            : `🟡 PM ใกล้ถึง: ${schedule.equipment_name}`);

        const notifMessage = ticketId
          ? `สร้างใบสั่งงาน PM อัตโนมัติสำหรับ ${schedule.equipment_name} - ${schedule.description || 'บำรุงรักษาตามกำหนด'}`
          : `${schedule.description || 'บำรุงรักษาตามกำหนด'} - ทุก ${schedule.interval_value} ชม. (${statusText})`;

        await createNotification({
          user_id: user.id,
          title: notifTitle,
          message: notifMessage,
          type: notificationType,
          category: 'schedule',
          reference_type: ticketId ? 'maintenance_record' : 'equipment_maintenance_schedule',
          reference_id: ticketId || schedule.id,
        });
      }

      notifiedSchedules.push({
        id: schedule.id,
        equipment: schedule.equipment_name,
        remaining: schedule.remaining,
        statusText,
        isOverdue,
        ticketCreated: !!ticketId,
        workOrder,
      });
    }

    console.log(`📧 Sent notifications for ${notifiedSchedules.length} PM schedules`);
    if (createdTickets.length > 0) console.log(`🎫 Created ${createdTickets.length} PM tickets`);

    return { count: notifiedSchedules.length, schedules: notifiedSchedules, tickets: createdTickets };

  } catch (error) {
    console.error('❌ Error checking PM schedules:', error);
    return { error: String(error) };
  }
}

// API endpoint to manually trigger PM check
app.get('/api/check-pm', async (req: Request, res: Response) => {
  const result = await checkPMSchedules();
  res.json(result);
});

// DEBUG ENDPOINT
app.get('/api/debug-schema', async (req: Request, res: Response) => {
  try {
    const result = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'equipment_maintenance_schedules'");
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});


// API endpoint to get PM schedules status (without creating notifications)
app.get('/api/pm-status', async (req: Request, res: Response) => {
  try {
    const schedules = await pool.query(`
      SELECT 
        ems.id,
        ems.equipment_id,
        ems.interval_value,
        ems.description,
        ems.current_ticket_id,
        e.equipment_name,
        e.equipment_code,
        e.current_usage,
        (ems.last_completed_at_usage + ems.interval_value) as next_due,
        (ems.last_completed_at_usage + ems.interval_value - e.current_usage) as remaining
      FROM equipment_maintenance_schedules ems
      JOIN equipment e ON ems.equipment_id = e.equipment_id
      WHERE e.is_active = true
      ORDER BY remaining ASC
    `);

    // Fetch 7-day average for all equipment returned
    const statusResults = [];
    for (const s of schedules.rows) {
      const remainingHours = parseFloat(s.remaining);
      const currentUsagePercentage = (s.interval_value - remainingHours) / s.interval_value;
      const reached80Percent = currentUsagePercentage >= 0.8;

      let estimatedDays = Infinity;
      let status: string = 'ok';

      if (remainingHours <= 0) {
        status = 'overdue';
        estimatedDays = 0;
      } else {
        const avgQuery = await pool.query(`
          SELECT COALESCE(SUM(EXTRACT(EPOCH FROM uptime) / 3600.0) / 7.0, 0) as avg_daily
          FROM equipment_daily_summary
          WHERE equipment_id = $1 
            AND date >= CURRENT_DATE - INTERVAL '7 days'
        `, [s.equipment_id]);

        const avgDailyUsage = parseFloat(avgQuery.rows[0]?.avg_daily || 0);

        if (avgDailyUsage > 0) {
          estimatedDays = remainingHours / avgDailyUsage;
          if (estimatedDays <= 5) status = 'approaching';
          else if (estimatedDays <= 14) status = 'warning'; // Warning tier for UI
        }

        // Fallbacks if predictive doesn't trigger 'approaching'
        if (status === 'ok' || status === 'warning') {
          if (reached80Percent) {
            status = 'approaching';
          } else if (remainingHours <= 24) {
            status = 'approaching'; // Fallback
          } else if (remainingHours <= 100 && status !== 'approaching') {
            status = 'warning'; // Fallback
          }
        }
      }

      statusResults.push({
        id: s.id,
        equipment: s.equipment_name,
        equipment_code: s.equipment_code,
        description: s.description,
        interval: s.interval_value,
        currentUsage: s.current_usage,
        nextDue: s.next_due,
        remaining: remainingHours,
        estimatedDays: estimatedDays === Infinity ? null : estimatedDays,
        hasTicket: !!s.current_ticket_id,
        ticketId: s.current_ticket_id,
        status
      });
    }

    res.json({ schedules: statusResults });
  } catch (error) {
    console.error('Error getting PM status:', error);
    res.status(500).json({ error: String(error) });
  }
});

// API endpoint to check all notifications (PM)
app.get('/api/check-alerts', async (req: Request, res: Response) => {
  const pmResult = await checkPMSchedules();
  const overdueResult = await checkAndNotifyOverdue();

  res.json({
    pm: pmResult,
    overdue: overdueResult,
  });
});

// Test database connection
async function testDatabaseConnection(): Promise<boolean> {
  try {
    await pool.query('SELECT NOW()');
    console.log('✅ Database connected');

    // MIGRATION: Auto-update legacy 'moderator' role to 'admin'
    await pool.query("UPDATE maintenance_users SET role = 'admin' WHERE role = 'moderator'");
    console.log('✅ Migrated legacy moderator roles to admin');

    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    return false;
  }
}

// Start server
async function startServer(): Promise<void> {
  try {
    console.log('🚀 Starting Maintenance API server...\n');

    // Run database migrations


    const dbConnected = await testDatabaseConnection();
    if (!dbConnected) {
      console.warn('⚠️  Running without database connection');
    }

    app.listen(Number(PORT), '0.0.0.0', () => {
      console.log(`✅ Maintenance API server running on port ${PORT}`);
      console.log(`📍 API available at http://0.0.0.0:${PORT}/api`);
      console.log(`💚 Health check: http://0.0.0.0:${PORT}/health\n`);

      // Start scheduled PM check (every hour)
      console.log('⏰ Starting scheduled PM check (every hour)...');
      setInterval(async () => {
        console.log('\n⏰ Running scheduled PM check...');
        await checkPMSchedules();
      }, 60 * 60 * 1000); // Every hour

      // Run initial check after 10 seconds
      setTimeout(async () => {
        console.log('\n🔍 Running initial PM check...');
        await checkPMSchedules();
      }, 10000);

      // ── Daily Summary Job: รันทุกวันตอน 00:05 AM ──────────────────────────
      console.log('📊 Starting daily summary scheduler (every day at 00:05)...');
      const scheduleDailySummary = () => {
        const now = new Date();
        // คำนวณเวลาถึง 00:05 ของวันถัดไป
        const next = new Date(now);
        next.setDate(next.getDate() + 1);
        next.setHours(0, 5, 0, 0);
        const msUntilNext = next.getTime() - now.getTime();
        setTimeout(async () => {
          const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
          console.log(`\n📊 Computing daily summary for ${yesterday}...`);
          try {
            const result = await pool.query('SELECT compute_daily_summary($1::DATE) AS upserted', [yesterday]);
            console.log(`✅ Daily summary done: ${result.rows[0].upserted} sensors for ${yesterday}`);
          } catch (err) {
            console.error('❌ Daily summary error:', err);
          }
          scheduleDailySummary(); // reschedule for next day
        }, msUntilNext);
        const hh = String(next.getHours()).padStart(2, '0');
        const mm = String(next.getMinutes()).padStart(2, '0');
        console.log(`📅 Next daily summary: ${next.toDateString()} ${hh}:${mm}`);
      };
      scheduleDailySummary();
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
