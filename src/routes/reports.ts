import express, { Request, Response, Router } from 'express';
import pool from '../config/database.js';

const router: Router = express.Router();

// ===========================================
// DASHBOARD & KPIs
// ===========================================

// Get dashboard summary
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, equipmentId } = req.query;

    // Default to last 30 days
    const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const end = endDate || new Date().toISOString().split('T')[0];

    let equipmentFilter = '';
    const params: any[] = [start, end];
    
    if (equipmentId) {
      equipmentFilter = ' AND mr.equipment_id = $3';
      params.push(equipmentId);
    }

    // Work order stats
    const workOrderStats = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
        COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled,
        COUNT(CASE WHEN status = 'on_hold' THEN 1 END) as on_hold,
        COUNT(CASE WHEN priority = 'critical' THEN 1 END) as critical,
        COUNT(CASE WHEN priority = 'high' THEN 1 END) as high_priority
      FROM maintenance_records mr
      WHERE mr.created_at >= $1 AND mr.created_at <= $2::date + interval '1 day'
      ${equipmentFilter}
    `, params);

    // Cost summary
    const costStats = await pool.query(`
      SELECT 
        COALESCE(SUM(labor_cost), 0) as total_labor_cost,
        COALESCE(SUM(parts_cost), 0) as total_parts_cost,
        COALESCE(SUM(total_cost), 0) as total_cost,
        COUNT(CASE WHEN total_cost > 0 THEN 1 END) as records_with_cost
      FROM maintenance_records mr
      WHERE mr.created_at >= $1 AND mr.created_at <= $2::date + interval '1 day'
        AND mr.status = 'completed'
      ${equipmentFilter}
    `, params);

    // Downtime summary
    const downtimeStats = await pool.query(`
      SELECT 
        COALESCE(SUM(downtime_hours), 0) as total_downtime_hours,
        COALESCE(AVG(downtime_hours), 0) as avg_downtime_hours,
        COUNT(CASE WHEN downtime_hours > 0 THEN 1 END) as records_with_downtime
      FROM maintenance_records mr
      WHERE mr.created_at >= $1 AND mr.created_at <= $2::date + interval '1 day'
        AND mr.status = 'completed'
      ${equipmentFilter}
    `, params);

    // Maintenance by type
    const byType = await pool.query(`
      SELECT 
        maintenance_type,
        COUNT(*) as count,
        COALESCE(SUM(total_cost), 0) as total_cost
      FROM maintenance_records mr
      WHERE mr.created_at >= $1 AND mr.created_at <= $2::date + interval '1 day'
      ${equipmentFilter}
      GROUP BY maintenance_type
      ORDER BY count DESC
    `, params);

    // Top equipment by maintenance count
    const topEquipment = await pool.query(`
      SELECT 
        e.id,
        e.equipment_name,
        e.equipment_code,
        COUNT(mr.id) as maintenance_count,
        COALESCE(SUM(mr.total_cost), 0) as total_cost,
        COALESCE(SUM(mr.downtime_hours), 0) as total_downtime
      FROM equipment e
      LEFT JOIN maintenance_records mr ON e.id = mr.equipment_id
        AND mr.created_at >= $1 AND mr.created_at <= $2::date + interval '1 day'
      GROUP BY e.id, e.equipment_name, e.equipment_code
      HAVING COUNT(mr.id) > 0
      ORDER BY maintenance_count DESC
      LIMIT 10
    `, [start, end]);

    // Monthly trend
    const monthlyTrend = await pool.query(`
      SELECT 
        TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') as month,
        COUNT(*) as count,
        COALESCE(SUM(total_cost), 0) as total_cost,
        COALESCE(SUM(downtime_hours), 0) as total_downtime
      FROM maintenance_records
      WHERE created_at >= $1::date - interval '12 months'
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY month
    `, [end]);

    res.json({
      period: { start, end },
      workOrders: workOrderStats.rows[0],
      costs: costStats.rows[0],
      downtime: downtimeStats.rows[0],
      byType: byType.rows,
      topEquipment: topEquipment.rows,
      monthlyTrend: monthlyTrend.rows
    });
  } catch (error: any) {
    console.error('Error fetching dashboard:', error);
    res.status(500).json({ error: error.message });
  }
});

// Calculate MTBF (Mean Time Between Failures)
router.get('/mtbf', async (req: Request, res: Response) => {
  try {
    const { equipmentId, startDate, endDate } = req.query;

    const start = startDate || new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const end = endDate || new Date().toISOString().split('T')[0];

    let query = `
      SELECT 
        e.id,
        e.equipment_name,
        e.equipment_code,
        e.current_usage as total_operating_hours,
        COUNT(mr.id) as failure_count,
        CASE 
          WHEN COUNT(mr.id) > 0 THEN e.current_usage / COUNT(mr.id)
          ELSE e.current_usage
        END as mtbf_hours
      FROM equipment e
      LEFT JOIN maintenance_records mr ON e.id = mr.equipment_id
        AND mr.maintenance_type IN ('breakdown', 'corrective', 'emergency')
        AND mr.created_at >= $1 AND mr.created_at <= $2::date + interval '1 day'
      WHERE e.is_active = true
    `;

    const params: any[] = [start, end];

    if (equipmentId) {
      query += ` AND e.id = $3`;
      params.push(equipmentId);
    }

    query += ` GROUP BY e.id, e.equipment_name, e.equipment_code, e.current_usage
               ORDER BY mtbf_hours DESC`;

    const result = await pool.query(query, params);

    // Calculate overall MTBF
    const overall = await pool.query(`
      SELECT 
        SUM(e.current_usage) as total_hours,
        COUNT(mr.id) as total_failures,
        CASE 
          WHEN COUNT(mr.id) > 0 THEN SUM(e.current_usage) / COUNT(mr.id)
          ELSE SUM(e.current_usage)
        END as overall_mtbf
      FROM equipment e
      LEFT JOIN maintenance_records mr ON e.id = mr.equipment_id
        AND mr.maintenance_type IN ('breakdown', 'corrective', 'emergency')
        AND mr.created_at >= $1 AND mr.created_at <= $2::date + interval '1 day'
      WHERE e.is_active = true
    `, [start, end]);

    res.json({
      period: { start, end },
      equipment: result.rows,
      overall: overall.rows[0]
    });
  } catch (error: any) {
    console.error('Error calculating MTBF:', error);
    res.status(500).json({ error: error.message });
  }
});

// Calculate MTTR (Mean Time To Repair)
router.get('/mttr', async (req: Request, res: Response) => {
  try {
    const { equipmentId, startDate, endDate } = req.query;

    const start = startDate || new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const end = endDate || new Date().toISOString().split('T')[0];

    let query = `
      SELECT 
        e.id,
        e.equipment_name,
        e.equipment_code,
        COUNT(mr.id) as repair_count,
        COALESCE(SUM(mr.downtime_hours), 0) as total_repair_hours,
        CASE 
          WHEN COUNT(mr.id) > 0 THEN COALESCE(SUM(mr.downtime_hours), 0) / COUNT(mr.id)
          ELSE 0
        END as mttr_hours
      FROM equipment e
      LEFT JOIN maintenance_records mr ON e.id = mr.equipment_id
        AND mr.status = 'completed'
        AND mr.downtime_hours > 0
        AND mr.created_at >= $1 AND mr.created_at <= $2::date + interval '1 day'
      WHERE e.is_active = true
    `;

    const params: any[] = [start, end];

    if (equipmentId) {
      query += ` AND e.id = $3`;
      params.push(equipmentId);
    }

    query += ` GROUP BY e.id, e.equipment_name, e.equipment_code
               ORDER BY mttr_hours DESC`;

    const result = await pool.query(query, params);

    // Calculate overall MTTR
    const overall = await pool.query(`
      SELECT 
        COUNT(mr.id) as total_repairs,
        COALESCE(SUM(mr.downtime_hours), 0) as total_repair_hours,
        CASE 
          WHEN COUNT(mr.id) > 0 THEN COALESCE(SUM(mr.downtime_hours), 0) / COUNT(mr.id)
          ELSE 0
        END as overall_mttr
      FROM maintenance_records mr
      WHERE mr.status = 'completed'
        AND mr.downtime_hours > 0
        AND mr.created_at >= $1 AND mr.created_at <= $2::date + interval '1 day'
    `, [start, end]);

    res.json({
      period: { start, end },
      equipment: result.rows,
      overall: overall.rows[0]
    });
  } catch (error: any) {
    console.error('Error calculating MTTR:', error);
    res.status(500).json({ error: error.message });
  }
});

// Calculate OEE (Overall Equipment Effectiveness)
router.get('/oee', async (req: Request, res: Response) => {
  try {
    const { equipmentId, startDate, endDate } = req.query;

    const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const end = endDate || new Date().toISOString().split('T')[0];

    // Calculate days in period
    const daysDiff = Math.ceil((new Date(end as string).getTime() - new Date(start as string).getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const plannedHours = daysDiff * 24; // Assuming 24h operation

    let query = `
      SELECT 
        e.id,
        e.equipment_name,
        e.equipment_code,
        $3::numeric as planned_hours,
        COALESCE(SUM(mr.downtime_hours), 0) as downtime_hours,
        $3::numeric - COALESCE(SUM(mr.downtime_hours), 0) as operating_hours,
        CASE 
          WHEN $3::numeric > 0 THEN (($3::numeric - COALESCE(SUM(mr.downtime_hours), 0)) / $3::numeric) * 100
          ELSE 100
        END as availability_percent
      FROM equipment e
      LEFT JOIN maintenance_records mr ON e.id = mr.equipment_id
        AND mr.created_at >= $1 AND mr.created_at <= $2::date + interval '1 day'
        AND mr.downtime_hours > 0
      WHERE e.is_active = true
    `;

    const params: any[] = [start, end, plannedHours];

    if (equipmentId) {
      query += ` AND e.id = $4`;
      params.push(equipmentId);
    }

    query += ` GROUP BY e.id, e.equipment_name, e.equipment_code
               ORDER BY availability_percent ASC`;

    const result = await pool.query(query, params);

    // Overall availability
    const overall = await pool.query(`
      SELECT 
        $3::numeric * COUNT(DISTINCT e.id) as total_planned_hours,
        COALESCE(SUM(mr.downtime_hours), 0) as total_downtime,
        CASE 
          WHEN $3::numeric * COUNT(DISTINCT e.id) > 0 
          THEN (($3::numeric * COUNT(DISTINCT e.id) - COALESCE(SUM(mr.downtime_hours), 0)) / ($3::numeric * COUNT(DISTINCT e.id))) * 100
          ELSE 100
        END as overall_availability
      FROM equipment e
      LEFT JOIN maintenance_records mr ON e.id = mr.equipment_id
        AND mr.created_at >= $1 AND mr.created_at <= $2::date + interval '1 day'
        AND mr.downtime_hours > 0
      WHERE e.is_active = true
    `, [start, end, plannedHours]);

    res.json({
      period: { start, end, days: daysDiff },
      equipment: result.rows,
      overall: overall.rows[0]
    });
  } catch (error: any) {
    console.error('Error calculating OEE:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get maintenance schedule calendar
router.get('/calendar', async (req: Request, res: Response) => {
  try {
    const { month, year } = req.query;
    
    const targetMonth = month ? parseInt(month as string) : new Date().getMonth() + 1;
    const targetYear = year ? parseInt(year as string) : new Date().getFullYear();

    // Get scheduled maintenance
    const scheduled = await pool.query(`
      SELECT 
        mr.id,
        mr.work_order,
        mr.scheduled_date,
        mr.priority,
        mr.status,
        mr.maintenance_type,
        e.equipment_name,
        e.equipment_code,
        u.display_name as assigned_to_name
      FROM maintenance_records mr
      LEFT JOIN equipment e ON mr.equipment_id = e.id
      LEFT JOIN maintenance_users u ON mr.assigned_to = u.id
      WHERE EXTRACT(MONTH FROM mr.scheduled_date) = $1
        AND EXTRACT(YEAR FROM mr.scheduled_date) = $2
      ORDER BY mr.scheduled_date
    `, [targetMonth, targetYear]);

    // Get PM schedules that are due
    const pmDue = await pool.query(`
      SELECT 
        ems.id,
        ems.task_name,
        ems.interval_value,
        ems.last_completed_at_usage,
        ems.current_ticket_id,
        e.id as equipment_id,
        e.equipment_name,
        e.equipment_code,
        e.current_usage,
        (ems.last_completed_at_usage + ems.interval_value) as next_due_usage,
        (ems.last_completed_at_usage + ems.interval_value - e.current_usage) as remaining
      FROM equipment_maintenance_schedules ems
      JOIN equipment e ON ems.equipment_id = e.id
      WHERE e.is_active = true
      ORDER BY remaining ASC
    `);

    res.json({
      month: targetMonth,
      year: targetYear,
      scheduled: scheduled.rows,
      pmDue: pmDue.rows.filter((p: any) => p.remaining <= p.interval_value * 0.2) // 20% or less remaining
    });
  } catch (error: any) {
    console.error('Error fetching calendar:', error);
    res.status(500).json({ error: error.message });
  }
});

// Export data (for PDF/Excel generation on frontend)
router.get('/export', async (req: Request, res: Response) => {
  try {
    const { type, startDate, endDate, equipmentId, status } = req.query;

    const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const end = endDate || new Date().toISOString().split('T')[0];

    let query = `
      SELECT 
        mr.work_order,
        mr.created_at,
        mr.scheduled_date,
        mr.completed_at,
        mr.maintenance_type,
        mr.priority,
        mr.status,
        mr.description,
        mr.root_cause,
        mr.action_taken,
        mr.labor_cost,
        mr.parts_cost,
        mr.total_cost,
        mr.downtime_hours,
        e.equipment_name,
        e.equipment_code,
        e.location,
        creator.display_name as created_by,
        assignee.display_name as assigned_to
      FROM maintenance_records mr
      LEFT JOIN equipment e ON mr.equipment_id = e.id
      LEFT JOIN maintenance_users creator ON mr.created_by = creator.id
      LEFT JOIN maintenance_users assignee ON mr.assigned_to = assignee.id
      WHERE mr.created_at >= $1 AND mr.created_at <= $2::date + interval '1 day'
    `;

    const params: any[] = [start, end];
    let paramIndex = 3;

    if (equipmentId) {
      query += ` AND mr.equipment_id = $${paramIndex++}`;
      params.push(equipmentId);
    }

    if (status) {
      query += ` AND mr.status = $${paramIndex++}`;
      params.push(status);
    }

    query += ` ORDER BY mr.created_at DESC`;

    const result = await pool.query(query, params);

    // Summary
    const summary = {
      period: { start, end },
      totalRecords: result.rows.length,
      totalCost: result.rows.reduce((sum: number, r: any) => sum + parseFloat(r.total_cost || 0), 0),
      totalDowntime: result.rows.reduce((sum: number, r: any) => sum + parseFloat(r.downtime_hours || 0), 0)
    };

    res.json({
      summary,
      records: result.rows
    });
  } catch (error: any) {
    console.error('Error exporting data:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
