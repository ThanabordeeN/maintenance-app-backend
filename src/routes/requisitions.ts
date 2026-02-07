import express, { Request, Response, Router } from 'express';
import pool from '../config/database.js';
import { notifyNewRequisitionToAdmin, notifyRequisitionResult } from '../services/lineMessaging.js';
import { authenticateUser, requireAdminOrModerator, AuthRequest } from '../middleware/auth.js';

const router: Router = express.Router();

// ===========================================
// HELPER FUNCTIONS
// ===========================================

// Generate PR number: PR-YYYYMM-XXXX
const generatePRNumber = async (): Promise<string> => {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;

    const result = await pool.query(
        `SELECT COUNT(*) FROM purchase_requisitions WHERE pr_number LIKE $1`,
        [`PR-${yearMonth}-%`]
    );

    const count = parseInt(result.rows[0].count) + 1;
    return `PR-${yearMonth}-${String(count).padStart(4, '0')}`;
};

// Send notification to admins (in-app + LINE push)
const notifyAdmins = async (
    title: string,
    message: string,
    category: string,
    referenceType: string,
    referenceId: number,
    prDetails?: {
        prNumber: string;
        requesterName: string;
        workOrder: string;
        equipmentName?: string;
        itemCount: number;
        totalAmount?: number;
        priority: string;
        notes?: string;
        items?: Array<{ name: string; quantity: number; unit_price?: number }>;
    }
) => {
    try {
        // Get all admin users
        const admins = await pool.query(
            `SELECT id, line_user_id FROM maintenance_users WHERE role IN ('admin', 'supervisor', 'moderator')`
        );

        // Create notifications for each admin
        for (const admin of admins.rows) {
            // In-app notification
            await pool.query(
                `INSERT INTO maintenance_notifications (user_id, title, message, type, category, reference_type, reference_id)
         VALUES ($1, $2, $3, 'info', $4, $5, $6)`,
                [admin.id, title, message, category, referenceType, referenceId]
            );

            // LINE Push notification (if PR details provided)
            if (prDetails && admin.line_user_id) {
                try {
                    await notifyNewRequisitionToAdmin({
                        adminUserId: admin.id,
                        prNumber: prDetails.prNumber,
                        requesterName: prDetails.requesterName,
                        workOrder: prDetails.workOrder,
                        equipmentName: prDetails.equipmentName,
                        itemCount: prDetails.itemCount,
                        totalAmount: prDetails.totalAmount,
                        priority: prDetails.priority,
                        notes: prDetails.notes,
                        items: prDetails.items
                    });
                } catch (lineError) {
                    console.error(`LINE push to admin ${admin.id} failed:`, lineError);
                }
            }
        }

        console.log(`Notified ${admins.rows.length} admins about new ${referenceType}`);
    } catch (error) {
        console.error('Error sending notifications:', error);
    }
};

// ===========================================
// PURCHASE REQUISITIONS (PR) ENDPOINTS
// ===========================================

// Get all requisitions (for admin)
router.get('/', async (req: Request, res: Response) => {
    try {
        const { status, priority, from_date, to_date } = req.query;

        let query = `
      SELECT 
        pr.*,
        mu.display_name as requester_name,
        mu.line_user_id as requester_line_id,
        ma.display_name as approver_name,
        mr.work_order,
        e.equipment_name,
        (SELECT COUNT(*) FROM purchase_requisition_items WHERE pr_id = pr.id) as item_count
      FROM purchase_requisitions pr
      LEFT JOIN maintenance_users mu ON pr.requested_by = mu.id
      LEFT JOIN maintenance_users ma ON pr.approved_by = ma.id
      LEFT JOIN maintenance_records mr ON pr.maintenance_record_id = mr.id
      LEFT JOIN equipment e ON mr.equipment_id = e.id
      WHERE 1=1
    `;
        const params: any[] = [];
        let paramIndex = 1;

        if (status) {
            query += ` AND pr.status = $${paramIndex++}`;
            params.push(status);
        }

        if (priority) {
            query += ` AND pr.priority = $${paramIndex++}`;
            params.push(priority);
        }

        if (from_date) {
            query += ` AND pr.created_at >= $${paramIndex++}`;
            params.push(from_date);
        }

        if (to_date) {
            query += ` AND pr.created_at <= $${paramIndex++}`;
            params.push(to_date);
        }

        query += ` ORDER BY 
      CASE pr.priority 
        WHEN 'urgent' THEN 1 
        WHEN 'high' THEN 2 
        WHEN 'normal' THEN 3 
        WHEN 'low' THEN 4 
      END,
      pr.created_at DESC`;

        const result = await pool.query(query, params);

        // Get items for each requisition
        const requisitionsWithItems = await Promise.all(result.rows.map(async (pr: any) => {
            const items = await pool.query(`
                SELECT 
                    pri.*,
                    sp.part_name,
                    sp.part_code,
                    sp.unit
                FROM purchase_requisition_items pri
                LEFT JOIN spare_parts sp ON pri.spare_part_id = sp.id
                WHERE pri.pr_id = $1
                ORDER BY pri.id
            `, [pr.id]);
            return { ...pr, items: items.rows };
        }));

        // Get stats
        const stats = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
        COUNT(*) FILTER (WHERE status = 'approved') as approved_count,
        COUNT(*) FILTER (WHERE status = 'ordered') as ordered_count,
        COUNT(*) FILTER (WHERE status = 'received') as received_count,
        COUNT(*) FILTER (WHERE priority = 'urgent' AND status = 'pending') as urgent_pending
      FROM purchase_requisitions
    `);

        res.json({
            requisitions: requisitionsWithItems,
            stats: stats.rows[0]
        });
    } catch (error: any) {
        console.error('Error fetching requisitions:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get single requisition with items
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const pr = await pool.query(`
      SELECT 
        pr.*,
        mu.display_name as requester_name,
        mu.line_user_id as requester_line_id,
        ma.display_name as approver_name,
        mr.work_order,
        mr.description as maintenance_description,
        e.equipment_name,
        e.location as equipment_location
      FROM purchase_requisitions pr
      LEFT JOIN maintenance_users mu ON pr.requested_by = mu.id
      LEFT JOIN maintenance_users ma ON pr.approved_by = ma.id
      LEFT JOIN maintenance_records mr ON pr.maintenance_record_id = mr.id
      LEFT JOIN equipment e ON mr.equipment_id = e.id
      WHERE pr.id = $1
    `, [id]);

        if (pr.rows.length === 0) {
            return res.status(404).json({ error: 'Requisition not found' });
        }

        // Get items
        const items = await pool.query(`
      SELECT 
        pri.*,
        sp.part_name,
        sp.part_code,
        sp.current_stock,
        sp.unit
      FROM purchase_requisition_items pri
      LEFT JOIN spare_parts sp ON pri.spare_part_id = sp.id
      WHERE pri.pr_id = $1
      ORDER BY pri.id
    `, [id]);

        res.json({
            requisition: pr.rows[0],
            items: items.rows
        });
    } catch (error: any) {
        console.error('Error fetching requisition:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get requisitions by maintenance record
router.get('/by-maintenance/:maintenanceId', async (req: Request, res: Response) => {
    try {
        const { maintenanceId } = req.params;

        const result = await pool.query(`
      SELECT 
        pr.*,
        mu.display_name as requester_name,
        ma.display_name as approver_name,
        (SELECT COUNT(*) FROM purchase_requisition_items WHERE pr_id = pr.id) as item_count
      FROM purchase_requisitions pr
      LEFT JOIN maintenance_users mu ON pr.requested_by = mu.id
      LEFT JOIN maintenance_users ma ON pr.approved_by = ma.id
      WHERE pr.maintenance_record_id = $1
      ORDER BY pr.created_at DESC
    `, [maintenanceId]);

        res.json({ requisitions: result.rows });
    } catch (error: any) {
        console.error('Error fetching requisitions by maintenance:', error);
        res.status(500).json({ error: error.message });
    }
});

// Create new requisition
router.post('/', async (req: Request, res: Response) => {
    const client = await pool.connect();

    try {
        const {
            maintenance_record_id,
            requested_by,
            priority = 'normal',
            notes,
            items // Array of { spare_part_id, custom_item_name, custom_item_unit, quantity, unit_price, notes }
        } = req.body;

        if (!requested_by || !items || items.length === 0) {
            return res.status(400).json({ error: 'Missing required fields: requested_by and items' });
        }

        await client.query('BEGIN');

        // Generate PR number
        const prNumber = await generatePRNumber();

        // Calculate total
        let totalAmount = 0;
        for (const item of items) {
            totalAmount += (item.quantity || 1) * (item.unit_price || 0);
        }

        // Create PR
        const prResult = await client.query(`
      INSERT INTO purchase_requisitions (
        pr_number, maintenance_record_id, requested_by, priority, total_amount, notes
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [prNumber, maintenance_record_id, requested_by, priority, totalAmount, notes]);

        const prId = prResult.rows[0].id;

        // Create PR items
        for (const item of items) {
            const itemTotal = (item.quantity || 1) * (item.unit_price || 0);

            await client.query(`
        INSERT INTO purchase_requisition_items (
          pr_id, spare_part_id, custom_item_name, custom_item_unit, quantity, unit_price, total_price, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
                prId,
                item.spare_part_id || null,
                item.custom_item_name || null,
                item.custom_item_unit || 'ชิ้น',
                item.quantity || 1,
                item.unit_price || 0,
                itemTotal,
                item.notes || null
            ]);
        }

        // Update maintenance record to waiting_for_parts if provided
        if (maintenance_record_id) {
            await client.query(
                `UPDATE maintenance_records SET waiting_for_parts = true, updated_at = NOW() WHERE id = $1`,
                [maintenance_record_id]
            );

            // Add to maintenance timeline (log)
            const itemSummary = items.map((item: any) => item.custom_item_name || 'อะไหล่').join(', ');
            await client.query(
                `INSERT INTO maintenance_timeline (maintenance_id, status, changed_by, notes)
                 VALUES ($1, 'parts_request', $2, $3)`,
                [maintenance_record_id, requested_by, `ขอเบิกอะไหล่ ${prNumber} จำนวน ${items.length} รายการ (฿${totalAmount.toLocaleString()})`]
            );
        }

        await client.query('COMMIT');

        // Get requester name and work order for notification
        const requester = await pool.query('SELECT display_name FROM maintenance_users WHERE id = $1', [requested_by]);
        const requesterName = requester.rows[0]?.display_name || 'Unknown';

        let workOrderNumber = '';
        let equipmentName = '';
        if (maintenance_record_id) {
            const mr = await pool.query(`
                SELECT mr.work_order, e.equipment_name 
                FROM maintenance_records mr 
                LEFT JOIN equipment e ON mr.equipment_id = e.id 
                WHERE mr.id = $1
            `, [maintenance_record_id]);
            workOrderNumber = mr.rows[0]?.work_order || '';
            equipmentName = mr.rows[0]?.equipment_name || '';
        }

        // Get part names for items with spare_part_id
        const itemsWithNames = await Promise.all(items.map(async (item: any) => {
            if (item.spare_part_id) {
                const part = await client.query('SELECT part_name FROM spare_parts WHERE id = $1', [item.spare_part_id]);
                return {
                    ...item,
                    name: part.rows[0]?.part_name || 'Unknown'
                };
            }
            return {
                ...item,
                name: item.custom_item_name || 'สินค้านอกระบบ'
            };
        }));

        // Notify admins (in-app + LINE push)
        await notifyAdmins(
            `🔔 ใบขอเบิกใหม่ ${prNumber}`,
            `ผู้ขอ: ${requesterName}\nจำนวน: ${items.length} รายการ\nมูลค่า: ฿${totalAmount.toLocaleString()}`,
            'parts',
            'requisition',
            prId,
            {
                prNumber,
                requesterName,
                workOrder: workOrderNumber,
                equipmentName,
                itemCount: items.length,
                totalAmount,
                priority,
                notes,
                items: itemsWithNames // เพิ่มรายการอะไหล่
            }
        );

        res.status(201).json({
            success: true,
            requisition: prResult.rows[0],
            pr_number: prNumber
        });
    } catch (error: any) {
        await client.query('ROLLBACK');
        console.error('Error creating requisition:', error);
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
});

// Approve requisition (Admin/Moderator only)
router.put('/:id/approve', authenticateUser, requireAdminOrModerator, async (req: AuthRequest, res: Response) => {
    const client = await pool.connect();

    try {
        const { id } = req.params;
        const approved_by = req.user?.id; // Use authenticated user ID

        if (!approved_by) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        await client.query('BEGIN');

        // Check if PR exists and is pending
        const pr = await client.query(
            'SELECT * FROM purchase_requisitions WHERE id = $1',
            [id]
        );

        if (pr.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Requisition not found' });
        }

        if (pr.rows[0].status !== 'pending') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: `Cannot approve requisition with status: ${pr.rows[0].status}` });
        }

        // Get items to check stock
        const items = await client.query(
            'SELECT * FROM purchase_requisition_items WHERE pr_id = $1',
            [id]
        );

        let allStockAvailable = true;
        const stockIssues: any[] = [];

        // Check stock for each item
        for (const item of items.rows) {
            if (item.spare_part_id) {
                const stock = await client.query(
                    'SELECT current_stock, part_name FROM spare_parts WHERE id = $1',
                    [item.spare_part_id]
                );

                if (stock.rows.length > 0 && stock.rows[0].current_stock < item.quantity) {
                    allStockAvailable = false;
                    stockIssues.push({
                        part_name: stock.rows[0].part_name,
                        required: item.quantity,
                        available: stock.rows[0].current_stock,
                        shortage: item.quantity - stock.rows[0].current_stock
                    });
                }
            }
        }

        // Update PR status
        await client.query(`
      UPDATE purchase_requisitions 
      SET status = 'approved', approved_by = $1, approved_at = NOW(), updated_at = NOW()
      WHERE id = $2
    `, [approved_by, id]);

        // If all stock available, deduct immediately
        if (allStockAvailable) {
            for (const item of items.rows) {
                if (item.spare_part_id) {
                    // Deduct stock
                    await client.query(
                        'UPDATE spare_parts SET current_stock = current_stock - $1, updated_at = NOW() WHERE id = $2',
                        [item.quantity, item.spare_part_id]
                    );

                    // Record transaction
                    await client.query(`
            INSERT INTO spare_parts_transactions (
              spare_part_id, transaction_type, quantity, reference_type, reference_id, notes, created_by
            ) VALUES ($1, 'out', $2, 'requisition', $3, $4, $5)
          `, [item.spare_part_id, item.quantity, id, `PR ${pr.rows[0].pr_number}`, approved_by]);

                    // Create parts_used record
                    if (pr.rows[0].maintenance_record_id) {
                        await client.query(`
              INSERT INTO maintenance_parts_used (
                maintenance_id, spare_part_id, quantity, unit_price, total_price, pr_item_id, status
              ) VALUES ($1, $2, $3, $4, $5, $6, 'used')
            `, [
                            pr.rows[0].maintenance_record_id,
                            item.spare_part_id,
                            item.quantity,
                            item.unit_price,
                            item.total_price,
                            item.id
                        ]);
                    }
                }
            }

            // Update maintenance record with parts cost
            if (pr.rows[0].maintenance_record_id) {
                // Calculate total parts cost for this maintenance
                const partsCostResult = await client.query(`
          SELECT COALESCE(SUM(total_price), 0) as total_parts_cost
          FROM maintenance_parts_used
          WHERE maintenance_id = $1
        `, [pr.rows[0].maintenance_record_id]);
                
                const partsCost = parseFloat(partsCostResult.rows[0].total_parts_cost) || 0;

                await client.query(`
          UPDATE maintenance_records 
          SET waiting_for_parts = false, 
              parts_cost = $1,
              total_cost = COALESCE(labor_cost, 0) + $1,
              updated_at = NOW()
          WHERE id = $2
        `, [partsCost, pr.rows[0].maintenance_record_id]);
            }

            // Update PR to received since stock was immediately deducted
            await client.query(`
        UPDATE purchase_requisitions SET status = 'received', updated_at = NOW() WHERE id = $1
      `, [id]);
        }

        await client.query('COMMIT');

        // Get approver name for notification
        const approver = await pool.query('SELECT display_name FROM maintenance_users WHERE id = $1', [approved_by]);
        const approverName = approver.rows[0]?.display_name || 'Unknown';

        // Add to maintenance timeline (log)
        if (pr.rows[0].maintenance_record_id) {
            const logMessage = allStockAvailable 
                ? `อนุมัติใบขอเบิก ${pr.rows[0].pr_number} โดย ${approverName} - อะไหล่พร้อมจ่าย`
                : `อนุมัติใบขอเบิก ${pr.rows[0].pr_number} โดย ${approverName} - รอสั่งซื้อเพิ่ม`;
            await pool.query(
                `INSERT INTO maintenance_timeline (maintenance_id, status, changed_by, notes)
                 VALUES ($1, 'pr_approved', $2, $3)`,
                [pr.rows[0].maintenance_record_id, approved_by, logMessage]
            );
        }

        // Notify requester (in-app + LINE)
        if (pr.rows[0].requested_by) {
            await pool.query(`
        INSERT INTO maintenance_notifications (user_id, title, message, type, category, reference_type, reference_id)
        VALUES ($1, $2, $3, 'success', 'parts', 'requisition', $4)
      `, [
                pr.rows[0].requested_by,
                `✅ ใบขอเบิก ${pr.rows[0].pr_number} ได้รับการอนุมัติ`,
                allStockAvailable ? 'อะไหล่พร้อมรับแล้ว' : 'รอสั่งซื้อเพิ่มเติม',
                id
            ]);

            // Get items for LINE notification
            const prItems = await pool.query(`
                SELECT pri.quantity, sp.part_name, pri.custom_item_name
                FROM purchase_requisition_items pri
                LEFT JOIN spare_parts sp ON pri.spare_part_id = sp.id
                WHERE pri.pr_id = $1
            `, [id]);
            
            const itemsForLine = prItems.rows.map((item: any) => ({
                name: item.part_name || item.custom_item_name || 'สินค้านอกระบบ',
                quantity: item.quantity
            }));

            // Send LINE notification to requester
            try {
                await notifyRequisitionResult({
                    requesterUserId: pr.rows[0].requested_by,
                    prNumber: pr.rows[0].pr_number,
                    status: 'approved',
                    approverName,
                    items: itemsForLine,
                    totalAmount: parseFloat(pr.rows[0].total_amount) || 0,
                    stockAvailable: allStockAvailable
                });
            } catch (lineError) {
                console.error('LINE notification to requester failed:', lineError);
            }
        }

        res.json({
            success: true,
            all_stock_available: allStockAvailable,
            stock_issues: stockIssues,
            message: allStockAvailable ? 'Approved and stock deducted' : 'Approved but need to order more stock'
        });
    } catch (error: any) {
        await client.query('ROLLBACK');
        console.error('Error approving requisition:', error);
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
});

// Reject requisition (Admin/Moderator only)
router.put('/:id/reject', authenticateUser, requireAdminOrModerator, async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const approved_by = req.user?.id; // Use authenticated user ID
        const { rejection_reason } = req.body;

        if (!rejection_reason) {
            return res.status(400).json({ error: 'rejection_reason is required' });
        }

        // Check if PR exists and is pending
        const pr = await pool.query(
            'SELECT * FROM purchase_requisitions WHERE id = $1',
            [id]
        );

        if (pr.rows.length === 0) {
            return res.status(404).json({ error: 'Requisition not found' });
        }

        if (pr.rows[0].status !== 'pending') {
            return res.status(400).json({ error: `Cannot reject requisition with status: ${pr.rows[0].status}` });
        }

        // Update PR
        await pool.query(`
      UPDATE purchase_requisitions 
      SET status = 'rejected', approved_by = $1, approved_at = NOW(), rejection_reason = $2, updated_at = NOW()
      WHERE id = $3
    `, [approved_by, rejection_reason, id]);

        // Update maintenance record
        if (pr.rows[0].maintenance_record_id) {
            await pool.query(`
        UPDATE maintenance_records SET waiting_for_parts = false, updated_at = NOW() WHERE id = $1
      `, [pr.rows[0].maintenance_record_id]);
        }

        // Get approver name for notification
        const approver = await pool.query('SELECT display_name FROM maintenance_users WHERE id = $1', [approved_by]);
        const approverName = approver.rows[0]?.display_name || 'Unknown';

        // Add to maintenance timeline (log)
        if (pr.rows[0].maintenance_record_id) {
            await pool.query(
                `INSERT INTO maintenance_timeline (maintenance_id, status, changed_by, notes)
                 VALUES ($1, 'pr_rejected', $2, $3)`,
                [pr.rows[0].maintenance_record_id, approved_by, `ปฏิเสธใบขอเบิก ${pr.rows[0].pr_number} โดย ${approverName} - ${rejection_reason}`]
            );
        }

        // Notify requester (in-app + LINE)
        if (pr.rows[0].requested_by) {
            await pool.query(`
        INSERT INTO maintenance_notifications (user_id, title, message, type, category, reference_type, reference_id)
        VALUES ($1, $2, $3, 'warning', 'parts', 'requisition', $4)
      `, [
                pr.rows[0].requested_by,
                `❌ ใบขอเบิก ${pr.rows[0].pr_number} ถูกปฏิเสธ`,
                `เหตุผล: ${rejection_reason}`,
                id
            ]);

            // Get items for LINE notification
            const prItems = await pool.query(`
                SELECT pri.quantity, sp.part_name, pri.custom_item_name
                FROM purchase_requisition_items pri
                LEFT JOIN spare_parts sp ON pri.spare_part_id = sp.id
                WHERE pri.pr_id = $1
            `, [id]);
            
            const itemsForLine = prItems.rows.map((item: any) => ({
                name: item.part_name || item.custom_item_name || 'สินค้านอกระบบ',
                quantity: item.quantity
            }));

            // Send LINE notification to requester
            try {
                await notifyRequisitionResult({
                    requesterUserId: pr.rows[0].requested_by,
                    prNumber: pr.rows[0].pr_number,
                    status: 'rejected',
                    approverName,
                    rejectReason: rejection_reason,
                    items: itemsForLine,
                    totalAmount: parseFloat(pr.rows[0].total_amount) || 0
                });
            } catch (lineError) {
                console.error('LINE notification to requester failed:', lineError);
            }
        }

        res.json({ success: true, message: 'Requisition rejected' });
    } catch (error: any) {
        console.error('Error rejecting requisition:', error);
        res.status(500).json({ error: error.message });
    }
});

// Cancel requisition
router.put('/:id/cancel', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { cancelled_by, reason } = req.body;

        const pr = await pool.query(
            'SELECT * FROM purchase_requisitions WHERE id = $1',
            [id]
        );

        if (pr.rows.length === 0) {
            return res.status(404).json({ error: 'Requisition not found' });
        }

        if (['received', 'cancelled'].includes(pr.rows[0].status)) {
            return res.status(400).json({ error: `Cannot cancel requisition with status: ${pr.rows[0].status}` });
        }

        await pool.query(`
      UPDATE purchase_requisitions 
      SET status = 'cancelled', notes = COALESCE(notes, '') || E'\n[ยกเลิก]: ' || $1, updated_at = NOW()
      WHERE id = $2
    `, [reason || 'No reason provided', id]);

        if (pr.rows[0].maintenance_record_id) {
            await pool.query(`
        UPDATE maintenance_records SET waiting_for_parts = false, updated_at = NOW() WHERE id = $1
      `, [pr.rows[0].maintenance_record_id]);
        }

        res.json({ success: true, message: 'Requisition cancelled' });
    } catch (error: any) {
        console.error('Error cancelling requisition:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
