import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.js';
import maintenanceRoutes from './routes/maintenance.js';
import usersRoutes from './routes/users.js';
import statusRoutes from './routes/status.js';
import setupRoutes from './routes/setup.js';
import sparePartsRoutes from './routes/spareParts.js';
import reportsRoutes from './routes/reports.js';
import notificationsRoutes, { checkAndNotifyOverdue, checkAndNotifyLowStock, createNotification } from './routes/notifications.js';
import checklistsRoutes from './routes/checklists.js';
import vendorsRoutes from './routes/vendors.js';
import pool from './config/database.js';
import { setupDatabase } from '../config/setup.js';
import { notifyGroup, formatNewTicketMessage } from './services/lineNotify.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3002; // Different port from main backend

// Middleware
app.use(cors({
  origin: true, // Allow all origins for development debugging
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json());

// Serve static files
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
app.use('/uploads', express.static(uploadDir));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/status', statusRoutes);
app.use('/api/setup', setupRoutes);
app.use('/api/spare-parts', sparePartsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/checklists', checklistsRoutes);
app.use('/api/vendors', vendorsRoutes);

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'OK', message: 'Maintenance API server is running' });
});

// ========================================
// PM SCHEDULE CHECK & NOTIFICATION
// ========================================

// Check PM schedules that are due or approaching
async function checkPMSchedules() {
  try {
    console.log('🔍 Checking PM schedules...');
    
    // Find schedules that are due (remaining <= 0) or approaching (remaining <= threshold)
    const threshold = 50; // Notify when 50 hours remaining
    
    const dueSchedules = await pool.query(`
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
      JOIN equipment e ON ems.equipment_id = e.id
      WHERE e.is_active = true
        AND ems.current_ticket_id IS NULL
        AND (ems.last_completed_at_usage + ems.interval_value - e.current_usage) <= $1
      ORDER BY remaining ASC
    `, [threshold]);
    
    if (dueSchedules.rows.length === 0) {
      console.log('✅ No PM schedules due');
      return { count: 0, schedules: [], tickets: [] };
    }
    
    console.log(`⚠️ Found ${dueSchedules.rows.length} PM schedules due/approaching`);
    
    // Get all technicians/admins to notify
    const users = await pool.query(
      "SELECT id, display_name, line_notify_token FROM maintenance_users WHERE role IN ('admin', 'moderator', 'technician')"
    );
    
    // Get first admin/moderator for auto-assignment
    const defaultAssignee = await pool.query(
      "SELECT id FROM maintenance_users WHERE role IN ('admin', 'moderator') ORDER BY id LIMIT 1"
    );
    const assigneeId = defaultAssignee.rows[0]?.id || 1;
    
    const notifiedSchedules = [];
    const createdTickets = [];
    
    for (const schedule of dueSchedules.rows) {
      const isOverdue = parseFloat(schedule.remaining) <= 0;
      const statusText = isOverdue ? 'ถึงกำหนดแล้ว' : `อีก ${Math.round(schedule.remaining)} ชม.`;
      const notificationType = isOverdue ? 'warning' : 'info';
      
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
        console.log(`⏭️ Already notified for schedule ${schedule.id} today, skipping`);
        continue;
      }
      
      // ===== AUTO CREATE TICKET เมื่อถึงกำหนด (remaining <= 0) =====
      let ticketId = null;
      let workOrder = null;
      
      if (isOverdue) {
        try {
          // Generate work order number
          const year = new Date().getFullYear();
          const countResult = await pool.query(`
            SELECT COUNT(*) FROM maintenance_records 
            WHERE EXTRACT(YEAR FROM created_at) = $1
          `, [year]);
          const count = parseInt(countResult.rows[0].count) + 1;
          workOrder = `PM-${year}-${String(count).padStart(6, '0')}`;
          
          // Create maintenance record
          const ticketResult = await pool.query(`
            INSERT INTO maintenance_records 
            (work_order, equipment_id, created_by, assigned_to, maintenance_type, priority, status, category, title, description, scheduled_date, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_DATE, NOW(), NOW())
            RETURNING id
          `, [
            workOrder,
            schedule.equipment_id,
            assigneeId, // System created
            assigneeId,
            'preventive',
            'medium',
            'pending',
            'mechanical',
            `PM: ${schedule.equipment_name} - ${schedule.description || 'บำรุงรักษาตามกำหนด'}`,
            `บำรุงรักษาตามกำหนดรอบ ${schedule.interval_value} ชม.\nอุปกรณ์: ${schedule.equipment_name}\nUsage ปัจจุบัน: ${schedule.current_usage} ชม.`
          ]);
          
          ticketId = ticketResult.rows[0].id;
          
          // Update schedule with current_ticket_id
          await pool.query(
            'UPDATE equipment_maintenance_schedules SET current_ticket_id = $1, updated_at = NOW() WHERE id = $2',
            [ticketId, schedule.id]
          );
          
          // Add timeline entry
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
      
      // Send LINE Notify to group
      const lineMessage = ticketId
        ? `\n🔧 สร้าง PM Ticket อัตโนมัติ 🔧\n━━━━━━━━━━━━━━━\n📋 เลขที่: ${workOrder}\n🏭 เครื่อง: ${schedule.equipment_name}\n📝 รายการ: ${schedule.description || 'บำรุงรักษา'}\n⏰ รอบ: ทุก ${schedule.interval_value} ชม.\n📊 Usage: ${schedule.current_usage} ชม.\n━━━━━━━━━━━━━━━`
        : (isOverdue
          ? `\n🔴 PM ถึงกำหนดแล้ว! 🔴\n━━━━━━━━━━━━━━━\n🏭 เครื่อง: ${schedule.equipment_name}\n📋 รายการ: ${schedule.description || 'บำรุงรักษา'}\n⏰ รอบ: ทุก ${schedule.interval_value} ชม.\n📊 ใช้งานปัจจุบัน: ${schedule.current_usage} ชม.\n━━━━━━━━━━━━━━━`
          : `\n🟡 PM ใกล้ถึงกำหนด 🟡\n━━━━━━━━━━━━━━━\n🏭 เครื่อง: ${schedule.equipment_name}\n📋 รายการ: ${schedule.description || 'บำรุงรักษา'}\n⏰ เหลืออีก: ${Math.round(schedule.remaining)} ชม.\n📊 ใช้งานปัจจุบัน: ${schedule.current_usage} ชม.\n━━━━━━━━━━━━━━━`);
      
      await notifyGroup(lineMessage);
      
      notifiedSchedules.push({
        id: schedule.id,
        equipment: schedule.equipment_name,
        remaining: schedule.remaining,
        isOverdue,
        ticketCreated: !!ticketId,
        workOrder,
      });
    }
    
    console.log(`📧 Sent notifications for ${notifiedSchedules.length} PM schedules`);
    console.log(`🎫 Created ${createdTickets.length} PM tickets`);
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

// API endpoint to get PM schedules status (without creating notifications)
app.get('/api/pm-status', async (req: Request, res: Response) => {
  try {
    const threshold = 100; // Show schedules within 100 hours
    
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
      JOIN equipment e ON ems.equipment_id = e.id
      WHERE e.is_active = true
      ORDER BY remaining ASC
    `);
    
    res.json({
      schedules: schedules.rows.map(s => ({
        id: s.id,
        equipment: s.equipment_name,
        equipment_code: s.equipment_code,
        description: s.description,
        interval: s.interval_value,
        currentUsage: s.current_usage,
        nextDue: s.next_due,
        remaining: parseFloat(s.remaining),
        hasTicket: !!s.current_ticket_id,
        ticketId: s.current_ticket_id,
        status: parseFloat(s.remaining) <= 0 ? 'overdue' 
              : parseFloat(s.remaining) <= 50 ? 'warning' 
              : parseFloat(s.remaining) <= threshold ? 'approaching' 
              : 'ok'
      }))
    });
  } catch (error) {
    console.error('Error getting PM status:', error);
    res.status(500).json({ error: String(error) });
  }
});

// API endpoint to check all notifications (PM + Low Stock)
app.get('/api/check-alerts', async (req: Request, res: Response) => {
  const pmResult = await checkPMSchedules();
  const overdueResult = await checkAndNotifyOverdue();
  const lowStockResult = await checkAndNotifyLowStock();
  
  res.json({
    pm: pmResult,
    overdue: overdueResult,
    lowStock: lowStockResult,
  });
});

// Test database connection
async function testDatabaseConnection(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    console.log('✅ Database connection successful');
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
    await setupDatabase();
    
    const dbConnected = await testDatabaseConnection();
    if (!dbConnected) {
      console.warn('⚠️  Running without database connection');
    }
    
    app.listen(PORT, '0.0.0.0', () => {
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
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
