import express, { Request, Response, Router } from 'express';
import pool from '../config/database.js';
import { notifyNewReturnToAdmin, notifyReturnResult } from '../services/lineMessaging.js';
import { validateBody } from '../middleware/validation.js';
import { authenticateUser, requireAdminOrModerator, AuthRequest } from '../middleware/auth.js';
import { z } from 'zod';

const router: Router = express.Router();

// Validation schema for create return
const createReturnSchema = z.object({
  maintenance_record_id: z.number().int().positive(),
  maintenance_part_used_id: z.number().int().positive().optional(),
  spare_part_id: z.number().int().positive(),
  quantity: z.number().int().positive().max(9999),
  reason: z.string().min(1).max(500),
  condition: z.enum(['good', 'damaged', 'defective']).optional(),
  notes: z.string().max(1000).optional(),
  returned_by: z.number().int().positive(),
});

// ===========================================
// HELPER FUNCTIONS
// ===========================================

// Generate Return number: RTN-YYYYMM-XXXX
const generateReturnNumber = async (): Promise<string> => {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;

    const result = await pool.query(
        `SELECT COUNT(*) FROM parts_returns WHERE return_number LIKE $1`,
        [`RTN-${yearMonth}-%`]
    );

    const count = parseInt(result.rows[0].count) + 1;
    return `RTN-${yearMonth}-${String(count).padStart(4, '0')}`;
};

// Reason labels
const REASON_LABELS: Record<string, string> = {
    'wrong_part': 'ไม่ตรงรุ่น',
    'defective': 'ชำรุด/เสียหาย',
    'not_needed': 'ไม่ต้องใช้',
    'excess': 'เกินจำนวน'
};

// ===========================================
// PARTS RETURNS ENDPOINTS
// ===========================================

// Get all returns
router.get('/', async (req: Request, res: Response) => {
    try {
        const { status, from_date, to_date } = req.query;

        let query = `
      SELECT 
        pr.*,
        sp.part_name,
        sp.part_code,
        sp.unit,
        mu.display_name as returned_by_name,
        ma.display_name as approved_by_name,
        mr.work_order
      FROM parts_returns pr
      LEFT JOIN spare_parts sp ON pr.spare_part_id = sp.id
      LEFT JOIN maintenance_users mu ON pr.returned_by = mu.id
      LEFT JOIN maintenance_users ma ON pr.approved_by = ma.id
      LEFT JOIN maintenance_records mr ON pr.maintenance_record_id = mr.id
      WHERE 1=1
    `;
        const params: any[] = [];
        let paramIndex = 1;

        if (status) {
            query += ` AND pr.status = $${paramIndex++}`;
            params.push(status);
        }

        if (from_date) {
            query += ` AND pr.created_at >= $${paramIndex++}`;
            params.push(from_date);
        }

        if (to_date) {
            query += ` AND pr.created_at <= $${paramIndex++}`;
            params.push(to_date);
        }

        query += ` ORDER BY pr.created_at DESC`;

        const result = await pool.query(query, params);

        // Get stats
        const stats = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
        COUNT(*) FILTER (WHERE status = 'approved') as approved_count,
        COUNT(*) FILTER (WHERE status = 'restocked') as restocked_count
      FROM parts_returns
    `);

        res.json({
            returns: result.rows,
            stats: stats.rows[0]
        });
    } catch (error: any) {
        console.error('Error fetching parts returns:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get returns by maintenance record
router.get('/by-maintenance/:maintenanceId', async (req: Request, res: Response) => {
    try {
        const { maintenanceId } = req.params;

        const result = await pool.query(`
      SELECT 
        pr.*,
        sp.part_name,
        sp.part_code,
        sp.unit,
        mu.display_name as returned_by_name,
        ma.display_name as approved_by_name
      FROM parts_returns pr
      LEFT JOIN spare_parts sp ON pr.spare_part_id = sp.id
      LEFT JOIN maintenance_users mu ON pr.returned_by = mu.id
      LEFT JOIN maintenance_users ma ON pr.approved_by = ma.id
      WHERE pr.maintenance_record_id = $1
      ORDER BY pr.created_at DESC
    `, [maintenanceId]);

        res.json({ returns: result.rows });
    } catch (error: any) {
        console.error('Error fetching returns by maintenance:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get single return
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const result = await pool.query(`
      SELECT 
        pr.*,
        sp.part_name,
        sp.part_code,
        sp.unit,
        sp.current_stock,
        mu.display_name as returned_by_name,
        ma.display_name as approved_by_name,
        mr.work_order,
        mpu.quantity as original_used_quantity
      FROM parts_returns pr
      LEFT JOIN spare_parts sp ON pr.spare_part_id = sp.id
      LEFT JOIN maintenance_users mu ON pr.returned_by = mu.id
      LEFT JOIN maintenance_users ma ON pr.approved_by = ma.id
      LEFT JOIN maintenance_records mr ON pr.maintenance_record_id = mr.id
      LEFT JOIN maintenance_parts_used mpu ON pr.maintenance_part_used_id = mpu.id
      WHERE pr.id = $1
    `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Return record not found' });
        }

        res.json({ return: result.rows[0] });
    } catch (error: any) {
        console.error('Error fetching return:', error);
        res.status(500).json({ error: error.message });
    }
});

// Create return request
router.post('/', validateBody(createReturnSchema), async (req: Request, res: Response) => {
    try {
        const {
            maintenance_record_id,
            maintenance_part_used_id,
            spare_part_id,
            quantity,
            reason,
            notes,
            returned_by
        } = req.body;

        // Validate reason (now handled by zod, but keep as fallback)
        if (!['wrong_part', 'defective', 'not_needed', 'excess'].includes(reason)) {
            return res.status(400).json({
                error: 'Invalid reason. Must be: wrong_part, defective, not_needed, or excess'
            });
        }

        // If maintenance_part_used_id provided, validate quantity against remaining
        if (maintenance_part_used_id) {
            const used = await pool.query(
                'SELECT quantity FROM maintenance_parts_used WHERE id = $1',
                [maintenance_part_used_id]
            );

            if (used.rows.length === 0) {
                return res.status(400).json({ error: 'ไม่พบรายการอะไหล่ที่เบิกไป' });
            }

            const usedQuantity = parseInt(used.rows[0].quantity);

            // Calculate already returned quantity (exclude rejected)
            const returnedResult = await pool.query(
                `SELECT COALESCE(SUM(quantity), 0) as total_returned 
                 FROM parts_returns 
                 WHERE maintenance_part_used_id = $1 AND status != 'rejected'`,
                [maintenance_part_used_id]
            );
            const alreadyReturned = parseInt(returnedResult.rows[0].total_returned);
            const remainingReturnable = usedQuantity - alreadyReturned;

            if (remainingReturnable <= 0) {
                return res.status(400).json({
                    error: `ไม่สามารถคืนได้อีก - คืนครบจำนวนที่เบิกไปแล้ว (เบิก ${usedQuantity}, คืนแล้ว ${alreadyReturned})`
                });
            }

            if (quantity > remainingReturnable) {
                return res.status(400).json({
                    error: `คืนได้อีกไม่เกิน ${remainingReturnable} ชิ้น (เบิก ${usedQuantity}, คืนแล้ว ${alreadyReturned})`
                });
            }
        }

        // Generate return number
        const returnNumber = await generateReturnNumber();

        const result = await pool.query(`
      INSERT INTO parts_returns (
        return_number, maintenance_record_id, maintenance_part_used_id,
        spare_part_id, quantity, reason, notes, returned_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
            returnNumber, maintenance_record_id, maintenance_part_used_id,
            spare_part_id, quantity, reason, notes, returned_by
        ]);

        // Notify admins
        const part = await pool.query('SELECT part_name FROM spare_parts WHERE id = $1', [spare_part_id]);
        const user = await pool.query('SELECT display_name FROM maintenance_users WHERE id = $1', [returned_by]);
        const partName = part.rows[0]?.part_name || 'Unknown';
        const userName = user.rows[0]?.display_name || 'Unknown';

        // Add to maintenance timeline (log)
        if (maintenance_record_id) {
            await pool.query(
                `INSERT INTO maintenance_timeline (maintenance_id, status, changed_by, notes)
                 VALUES ($1, 'parts_return', $2, $3)`,
                [maintenance_record_id, returned_by, `ขอคืนอะไหล่ ${returnNumber}: ${partName} x ${quantity} (${REASON_LABELS[reason] || reason})`]
            );
        }

        const admins = await pool.query(
            `SELECT id FROM maintenance_users WHERE role IN ('admin', 'supervisor')`
        );

        for (const admin of admins.rows) {
            await pool.query(`
        INSERT INTO maintenance_notifications (user_id, title, message, type, category, reference_type, reference_id)
        VALUES ($1, $2, $3, 'info', 'parts', 'return', $4)
      `, [
                admin.id,
                `🔄 ขอคืนอะไหล่ ${returnNumber}`,
                `${userName} ขอคืน ${partName} x ${quantity}\nเหตุผล: ${REASON_LABELS[reason] || reason}`,
                result.rows[0].id
            ]);

            // Send LINE notification to admin
            try {
                const workOrderResult = maintenance_record_id 
                    ? await pool.query('SELECT work_order FROM maintenance_records WHERE id = $1', [maintenance_record_id])
                    : null;
                await notifyNewReturnToAdmin({
                    adminUserId: admin.id,
                    returnNumber,
                    partName,
                    quantity,
                    reason,
                    requesterName: userName,
                    workOrder: workOrderResult?.rows[0]?.work_order
                });
            } catch (lineErr) {
                console.error('LINE notification error:', lineErr);
            }
        }

        res.status(201).json({
            success: true,
            return: result.rows[0],
            return_number: returnNumber
        });
    } catch (error: any) {
        console.error('Error creating return:', error);
        res.status(500).json({ error: error.message });
    }
});

// Approve and restock (Admin/Moderator only)
router.put('/:id/approve', authenticateUser, requireAdminOrModerator, async (req: AuthRequest, res: Response) => {
    const client = await pool.connect();

    try {
        const { id } = req.params;
        const approved_by = req.user?.id;

        if (!approved_by) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        await client.query('BEGIN');

        // Get return record
        const returnRecord = await client.query(
            'SELECT * FROM parts_returns WHERE id = $1',
            [id]
        );

        if (returnRecord.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Return record not found' });
        }

        const ret = returnRecord.rows[0];

        if (ret.status !== 'pending') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: `Cannot approve return with status: ${ret.status}` });
        }

        // Update return status to approved
        await client.query(`
      UPDATE parts_returns 
      SET status = 'approved', approved_by = $1, approved_at = NOW()
      WHERE id = $2
    `, [approved_by, id]);

        // Add back to stock
        await client.query(
            'UPDATE spare_parts SET current_stock = current_stock + $1, updated_at = NOW() WHERE id = $2',
            [ret.quantity, ret.spare_part_id]
        );

        // Record transaction
        await client.query(`
      INSERT INTO spare_parts_transactions (
        spare_part_id, transaction_type, quantity, reference_type, reference_id, notes, created_by
      ) VALUES ($1, 'in', $2, 'return', $3, $4, $5)
    `, [ret.spare_part_id, ret.quantity, id, `Return: ${ret.return_number}`, approved_by]);

        // Update maintenance_parts_used if linked
        if (ret.maintenance_part_used_id) {
            await client.query(`
        UPDATE maintenance_parts_used 
        SET quantity = quantity - $1,
            total_price = total_price - (unit_price * $1)
        WHERE id = $2
      `, [ret.quantity, ret.maintenance_part_used_id]);
        }

        // Update return status to restocked
        await client.query(`
      UPDATE parts_returns SET status = 'restocked' WHERE id = $1
    `, [id]);

        await client.query('COMMIT');

        // Notify requester
        if (ret.returned_by) {
            await pool.query(`
        INSERT INTO maintenance_notifications (user_id, title, message, type, category, reference_type, reference_id)
        VALUES ($1, $2, $3, 'success', 'parts', 'return', $4)
      `, [
                ret.returned_by,
                `✅ คืนอะไหล่สำเร็จ ${ret.return_number}`,
                'อะไหล่ถูกคืนเข้าสต๊อกแล้ว',
                id
            ]);

            // Send LINE notification
            try {
                const partInfo = await pool.query('SELECT part_name FROM spare_parts WHERE id = $1', [ret.spare_part_id]);
                const approverInfo = await pool.query('SELECT display_name FROM maintenance_users WHERE id = $1', [approved_by]);
                await notifyReturnResult({
                    technicianUserId: ret.returned_by,
                    returnNumber: ret.return_number,
                    partName: partInfo.rows[0]?.part_name || 'Unknown',
                    quantity: ret.quantity,
                    status: 'approved',
                    approverName: approverInfo.rows[0]?.display_name || 'Admin'
                });
            } catch (lineErr) {
                console.error('LINE notification error:', lineErr);
            }
        }

        res.json({
            success: true,
            message: 'Return approved and stock updated'
        });
    } catch (error: any) {
        await client.query('ROLLBACK');
        console.error('Error approving return:', error);
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
});

// Reject return (Admin/Moderator only)
router.put('/:id/reject', authenticateUser, requireAdminOrModerator, async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const approved_by = req.user?.id;
        const { reason } = req.body;

        if (!approved_by) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const returnRecord = await pool.query(
            'SELECT * FROM parts_returns WHERE id = $1',
            [id]
        );

        if (returnRecord.rows.length === 0) {
            return res.status(404).json({ error: 'Return record not found' });
        }

        if (returnRecord.rows[0].status !== 'pending') {
            return res.status(400).json({
                error: `Cannot reject return with status: ${returnRecord.rows[0].status}`
            });
        }

        await pool.query(`
      UPDATE parts_returns 
      SET status = 'rejected', 
          approved_by = $1, 
          approved_at = NOW(),
          notes = COALESCE(notes, '') || E'\n[ปฏิเสธ]: ' || $2
      WHERE id = $3
    `, [approved_by, reason || 'No reason provided', id]);

        // Notify requester
        const ret = returnRecord.rows[0];
        if (ret.returned_by) {
            await pool.query(`
        INSERT INTO maintenance_notifications (user_id, title, message, type, category, reference_type, reference_id)
        VALUES ($1, $2, $3, 'warning', 'parts', 'return', $4)
      `, [
                ret.returned_by,
                `❌ คืนอะไหล่ถูกปฏิเสธ ${ret.return_number}`,
                `เหตุผล: ${reason || 'ไม่ระบุ'}`,
                id
            ]);

            // Send LINE notification
            try {
                const partInfo = await pool.query('SELECT part_name FROM spare_parts WHERE id = $1', [ret.spare_part_id]);
                const approverInfo = await pool.query('SELECT display_name FROM maintenance_users WHERE id = $1', [approved_by]);
                await notifyReturnResult({
                    technicianUserId: ret.returned_by,
                    returnNumber: ret.return_number,
                    partName: partInfo.rows[0]?.part_name || 'Unknown',
                    quantity: ret.quantity,
                    status: 'rejected',
                    approverName: approverInfo.rows[0]?.display_name || 'Admin',
                    rejectReason: reason || 'ไม่ระบุ'
                });
            } catch (lineErr) {
                console.error('LINE notification error:', lineErr);
            }
        }

        res.json({ success: true, message: 'Return rejected' });
    } catch (error: any) {
        console.error('Error rejecting return:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
