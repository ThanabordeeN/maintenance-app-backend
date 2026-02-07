import express, { Request, Response, Router } from 'express';
import pool from '../config/database.js';
import { authenticateUser, requireAdminOrModerator, AuthRequest } from '../middleware/auth.js';

const router: Router = express.Router();

// ===========================================
// HELPER FUNCTIONS
// ===========================================

// Generate PO number: PO-YYYYMM-XXXX
const generatePONumber = async (): Promise<string> => {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;

    const result = await pool.query(
        `SELECT COUNT(*) FROM purchase_orders WHERE po_number LIKE $1`,
        [`PO-${yearMonth}-%`]
    );

    const count = parseInt(result.rows[0].count) + 1;
    return `PO-${yearMonth}-${String(count).padStart(4, '0')}`;
};

// ===========================================
// PURCHASE ORDERS (PO) ENDPOINTS
// ===========================================

// Get all purchase orders
router.get('/', async (req: Request, res: Response) => {
    try {
        const { status, vendor_id, from_date, to_date } = req.query;

        let query = `
      SELECT 
        po.*,
        v.vendor_name,
        v.contact_person as vendor_contact,
        v.phone as vendor_phone,
        mu.display_name as created_by_name,
        ma.display_name as approved_by_name,
        pr.pr_number,
        (SELECT COUNT(*) FROM purchase_order_items WHERE po_id = po.id) as item_count
      FROM purchase_orders po
      LEFT JOIN vendors v ON po.vendor_id = v.id
      LEFT JOIN maintenance_users mu ON po.created_by = mu.id
      LEFT JOIN maintenance_users ma ON po.approved_by = ma.id
      LEFT JOIN purchase_requisitions pr ON po.pr_id = pr.id
      WHERE 1=1
    `;
        const params: any[] = [];
        let paramIndex = 1;

        if (status) {
            query += ` AND po.status = $${paramIndex++}`;
            params.push(status);
        }

        if (vendor_id) {
            query += ` AND po.vendor_id = $${paramIndex++}`;
            params.push(vendor_id);
        }

        if (from_date) {
            query += ` AND po.created_at >= $${paramIndex++}`;
            params.push(from_date);
        }

        if (to_date) {
            query += ` AND po.created_at <= $${paramIndex++}`;
            params.push(to_date);
        }

        query += ` ORDER BY po.created_at DESC`;

        const result = await pool.query(query, params);

        // Get items for each order
        const ordersWithItems = await Promise.all(result.rows.map(async (po: any) => {
            const items = await pool.query(`
                SELECT 
                    poi.*,
                    sp.part_name,
                    sp.part_code,
                    sp.unit
                FROM purchase_order_items poi
                LEFT JOIN spare_parts sp ON poi.spare_part_id = sp.id
                WHERE poi.po_id = $1
                ORDER BY poi.id
            `, [po.id]);
            return { ...po, items: items.rows };
        }));

        // Get stats
        const stats = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'draft') as draft_count,
        COUNT(*) FILTER (WHERE status = 'sent') as sent_count,
        COUNT(*) FILTER (WHERE status = 'partial') as partial_count,
        COUNT(*) FILTER (WHERE status = 'received') as received_count,
        COALESCE(SUM(grand_total) FILTER (WHERE status IN ('sent', 'partial')), 0) as pending_value
      FROM purchase_orders
    `);

        res.json({
            orders: ordersWithItems,
            stats: stats.rows[0]
        });
    } catch (error: any) {
        console.error('Error fetching purchase orders:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get single purchase order with items
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const po = await pool.query(`
      SELECT 
        po.*,
        v.vendor_name,
        v.vendor_code,
        v.contact_person as vendor_contact,
        v.phone as vendor_phone,
        v.email as vendor_email,
        v.address as vendor_address,
        v.tax_id as vendor_tax_id,
        mu.display_name as created_by_name,
        ma.display_name as approved_by_name,
        pr.pr_number,
        pr.maintenance_record_id
      FROM purchase_orders po
      LEFT JOIN vendors v ON po.vendor_id = v.id
      LEFT JOIN maintenance_users mu ON po.created_by = mu.id
      LEFT JOIN maintenance_users ma ON po.approved_by = ma.id
      LEFT JOIN purchase_requisitions pr ON po.pr_id = pr.id
      WHERE po.id = $1
    `, [id]);

        if (po.rows.length === 0) {
            return res.status(404).json({ error: 'Purchase order not found' });
        }

        // Get items
        const items = await pool.query(`
      SELECT 
        poi.*,
        sp.part_name,
        sp.part_code,
        sp.unit
      FROM purchase_order_items poi
      LEFT JOIN spare_parts sp ON poi.spare_part_id = sp.id
      WHERE poi.po_id = $1
      ORDER BY poi.id
    `, [id]);

        res.json({
            order: po.rows[0],
            items: items.rows
        });
    } catch (error: any) {
        console.error('Error fetching purchase order:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get print data for purchase order (clean format for printing)
router.get('/:id/print', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const po = await pool.query(`
      SELECT 
        po.*,
        v.vendor_name,
        v.vendor_code,
        v.contact_person as vendor_contact,
        v.phone as vendor_phone,
        v.email as vendor_email,
        v.address as vendor_address,
        v.tax_id as vendor_tax_id,
        v.payment_terms as vendor_payment_terms,
        mu.display_name as created_by_name,
        ma.display_name as approved_by_name,
        pr.pr_number
      FROM purchase_orders po
      LEFT JOIN vendors v ON po.vendor_id = v.id
      LEFT JOIN maintenance_users mu ON po.created_by = mu.id
      LEFT JOIN maintenance_users ma ON po.approved_by = ma.id
      LEFT JOIN purchase_requisitions pr ON po.pr_id = pr.id
      WHERE po.id = $1
    `, [id]);

        if (po.rows.length === 0) {
            return res.status(404).json({ error: 'Purchase order not found' });
        }

        // Get items
        const items = await pool.query(`
      SELECT 
        ROW_NUMBER() OVER (ORDER BY poi.id) as row_num,
        COALESCE(sp.part_code, '-') as part_code,
        COALESCE(sp.part_name, poi.custom_item_name) as item_name,
        COALESCE(sp.unit, poi.custom_item_unit) as unit,
        poi.quantity,
        poi.unit_price,
        poi.total_price
      FROM purchase_order_items poi
      LEFT JOIN spare_parts sp ON poi.spare_part_id = sp.id
      WHERE poi.po_id = $1
      ORDER BY poi.id
    `, [id]);

        // Company info (should be from settings table in production)
        const companyInfo = {
            name: 'SmartQuary Co., Ltd.',
            address: '123 Industrial Road, Bangkok 10100',
            phone: '02-123-4567',
            tax_id: '0105XXXXXXXXX',
            email: 'purchase@smartquary.com'
        };

        res.json({
            company: companyInfo,
            order: po.rows[0],
            items: items.rows,
            print_date: new Date().toISOString()
        });
    } catch (error: any) {
        console.error('Error fetching print data:', error);
        res.status(500).json({ error: error.message });
    }
});

// Create purchase order from requisition
router.post('/', async (req: Request, res: Response) => {
    const client = await pool.connect();

    try {
        const {
            pr_id,
            vendor_id,
            created_by,
            payment_terms,
            delivery_date,
            delivery_address,
            tax_rate = 7,
            notes,
            items // Optional: override items from PR
        } = req.body;

        if (!vendor_id || !created_by) {
            return res.status(400).json({ error: 'Missing required fields: vendor_id and created_by' });
        }

        await client.query('BEGIN');

        // Generate PO number
        const poNumber = await generatePONumber();

        // If pr_id provided, get items from PR
        let poItems = items;
        if (pr_id && !items) {
            const prItems = await client.query(
                'SELECT * FROM purchase_requisition_items WHERE pr_id = $1',
                [pr_id]
            );
            poItems = prItems.rows.map((item: any) => ({
                pr_item_id: item.id,
                spare_part_id: item.spare_part_id,
                custom_item_name: item.custom_item_name,
                custom_item_unit: item.custom_item_unit,
                quantity: item.quantity,
                unit_price: item.unit_price
            }));
        }

        if (!poItems || poItems.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'No items provided for purchase order' });
        }

        // Calculate totals
        let totalAmount = 0;
        for (const item of poItems) {
            totalAmount += (item.quantity || 1) * (item.unit_price || 0);
        }
        const taxAmount = totalAmount * (tax_rate / 100);
        const grandTotal = totalAmount + taxAmount;

        // Create PO
        const poResult = await client.query(`
      INSERT INTO purchase_orders (
        po_number, pr_id, vendor_id, total_amount, tax_rate, tax_amount, grand_total,
        payment_terms, delivery_date, delivery_address, notes, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `, [
            poNumber, pr_id || null, vendor_id, totalAmount, tax_rate, taxAmount, grandTotal,
            payment_terms, delivery_date, delivery_address, notes, created_by
        ]);

        const poId = poResult.rows[0].id;

        // Create PO items
        for (const item of poItems) {
            const itemTotal = (item.quantity || 1) * (item.unit_price || 0);

            await client.query(`
        INSERT INTO purchase_order_items (
          po_id, pr_item_id, spare_part_id, custom_item_name, custom_item_unit, 
          quantity, unit_price, total_price
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
                poId,
                item.pr_item_id || null,
                item.spare_part_id || null,
                item.custom_item_name || null,
                item.custom_item_unit || 'ชิ้น',
                item.quantity || 1,
                item.unit_price || 0,
                itemTotal
            ]);
        }

        // Update PR status if linked
        if (pr_id) {
            await client.query(
                `UPDATE purchase_requisitions SET status = 'ordered', updated_at = NOW() WHERE id = $1`,
                [pr_id]
            );
        }

        await client.query('COMMIT');

        res.status(201).json({
            success: true,
            order: poResult.rows[0],
            po_number: poNumber
        });
    } catch (error: any) {
        await client.query('ROLLBACK');
        console.error('Error creating purchase order:', error);
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
});

// Update purchase order
router.put('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const {
            vendor_id, payment_terms, delivery_date, delivery_address, tax_rate, notes
        } = req.body;

        const po = await pool.query('SELECT * FROM purchase_orders WHERE id = $1', [id]);

        if (po.rows.length === 0) {
            return res.status(404).json({ error: 'Purchase order not found' });
        }

        if (!['draft'].includes(po.rows[0].status)) {
            return res.status(400).json({ error: 'Can only edit draft purchase orders' });
        }

        // Recalculate if tax_rate changed
        let taxAmount = po.rows[0].tax_amount;
        let grandTotal = po.rows[0].grand_total;

        if (tax_rate !== undefined && tax_rate !== po.rows[0].tax_rate) {
            taxAmount = po.rows[0].total_amount * (tax_rate / 100);
            grandTotal = po.rows[0].total_amount + taxAmount;
        }

        await pool.query(`
      UPDATE purchase_orders SET
        vendor_id = COALESCE($1, vendor_id),
        payment_terms = COALESCE($2, payment_terms),
        delivery_date = COALESCE($3, delivery_date),
        delivery_address = COALESCE($4, delivery_address),
        tax_rate = COALESCE($5, tax_rate),
        tax_amount = $6,
        grand_total = $7,
        notes = COALESCE($8, notes),
        updated_at = NOW()
      WHERE id = $9
    `, [vendor_id, payment_terms, delivery_date, delivery_address, tax_rate, taxAmount, grandTotal, notes, id]);

        res.json({ success: true, message: 'Purchase order updated' });
    } catch (error: any) {
        console.error('Error updating purchase order:', error);
        res.status(500).json({ error: error.message });
    }
});

// Approve and send purchase order (Admin/Moderator only)
router.put('/:id/approve', authenticateUser, requireAdminOrModerator, async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const approved_by = req.user?.id;

        if (!approved_by) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const po = await pool.query('SELECT * FROM purchase_orders WHERE id = $1', [id]);

        if (po.rows.length === 0) {
            return res.status(404).json({ error: 'Purchase order not found' });
        }

        if (po.rows[0].status !== 'draft') {
            return res.status(400).json({ error: 'Can only approve draft purchase orders' });
        }

        await pool.query(`
      UPDATE purchase_orders SET
        status = 'sent',
        approved_by = $1,
        approved_at = NOW(),
        sent_at = NOW(),
        updated_at = NOW()
      WHERE id = $2
    `, [approved_by, id]);

        // Get approver name and add to maintenance timeline
        const approver = await pool.query('SELECT display_name FROM maintenance_users WHERE id = $1', [approved_by]);
        const approverName = approver.rows[0]?.display_name || 'Unknown';

        // Check if PO is linked to maintenance via PR
        const prLink = await pool.query(`
            SELECT pr.maintenance_record_id, pr.pr_number 
            FROM purchase_orders po
            JOIN purchase_requisitions pr ON po.pr_id = pr.id
            WHERE po.id = $1
        `, [id]);

        if (prLink.rows[0]?.maintenance_record_id) {
            await pool.query(
                `INSERT INTO maintenance_timeline (maintenance_id, status, changed_by, notes)
                 VALUES ($1, 'po_approved', $2, $3)`,
                [prLink.rows[0].maintenance_record_id, approved_by, `อนุมัติใบสั่งซื้อ ${po.rows[0].po_number} โดย ${approverName} (จาก ${prLink.rows[0].pr_number})`]
            );
        }

        res.json({ success: true, message: 'Purchase order approved and marked as sent' });
    } catch (error: any) {
        console.error('Error approving purchase order:', error);
        res.status(500).json({ error: error.message });
    }
});

// Mark as ordered (Admin/Moderator only)
router.put('/:id/mark-ordered', authenticateUser, requireAdminOrModerator, async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const ordered_by = req.user?.id;

        if (!ordered_by) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const po = await pool.query('SELECT * FROM purchase_orders WHERE id = $1', [id]);

        if (po.rows.length === 0) {
            return res.status(404).json({ error: 'Purchase order not found' });
        }

        if (po.rows[0].status !== 'sent') {
            return res.status(400).json({ error: 'Can only mark sent purchase orders as ordered' });
        }

        await pool.query(`
      UPDATE purchase_orders SET
        status = 'ordered',
        ordered_by = $1,
        ordered_at = NOW(),
        updated_at = NOW()
      WHERE id = $2
    `, [ordered_by, id]);

        res.json({ success: true, message: 'Purchase order marked as ordered' });
    } catch (error: any) {
        console.error('Error marking PO as ordered:', error);
        res.status(500).json({ error: error.message });
    }
});

// Receive items (Admin/Moderator only)
router.put('/:id/receive', authenticateUser, requireAdminOrModerator, async (req: AuthRequest, res: Response) => {
    const client = await pool.connect();

    try {
        const { id } = req.params;
        const received_by = req.user?.id;
        const { items } = req.body;
        // items: Array of { po_item_id, received_quantity, actual_unit_price? }

        if (!items || items.length === 0) {
            return res.status(400).json({ error: 'items are required' });
        }

        await client.query('BEGIN');

        const po = await client.query(`
      SELECT po.*, pr.maintenance_record_id 
      FROM purchase_orders po
      LEFT JOIN purchase_requisitions pr ON po.pr_id = pr.id
      WHERE po.id = $1
    `, [id]);

        if (po.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Purchase order not found' });
        }

        if (!['sent', 'partial', 'ordered'].includes(po.rows[0].status)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Can only receive sent, ordered or partial purchase orders' });
        }

        let allReceived = true;

        for (const item of items) {
            // Get item details first
            const poItem = await client.query(
                'SELECT * FROM purchase_order_items WHERE id = $1',
                [item.po_item_id]
            );

            if (poItem.rows.length === 0) continue;

            const itemData = poItem.rows[0];
            
            // Determine the price to use (actual or original)
            const usePrice = item.actual_unit_price ?? itemData.unit_price;

            // Update PO item received quantity and actual price if provided
            if (item.actual_unit_price !== undefined && item.actual_unit_price !== null) {
                await client.query(`
          UPDATE purchase_order_items 
          SET received_quantity = received_quantity + $1,
              actual_unit_price = $2,
              updated_at = NOW()
          WHERE id = $3
        `, [item.received_quantity, item.actual_unit_price, item.po_item_id]);
            } else {
                await client.query(`
          UPDATE purchase_order_items 
          SET received_quantity = received_quantity + $1,
              updated_at = NOW()
          WHERE id = $2
        `, [item.received_quantity, item.po_item_id]);
            }

            // Check if fully received
            if (itemData.received_quantity + item.received_quantity < itemData.quantity) {
                allReceived = false;
            }

            // Add to stock if spare_part_id exists
            if (itemData.spare_part_id) {
                await client.query(
                    'UPDATE spare_parts SET current_stock = current_stock + $1, updated_at = NOW() WHERE id = $2',
                    [item.received_quantity, itemData.spare_part_id]
                );

                // Record transaction
                await client.query(`
            INSERT INTO spare_parts_transactions (
              spare_part_id, transaction_type, quantity, reference_type, reference_id, notes, created_by
            ) VALUES ($1, 'in', $2, 'purchase_order', $3, $4, $5)
          `, [itemData.spare_part_id, item.received_quantity, id, `PO ${po.rows[0].po_number}`, received_by]);

                    // If linked to maintenance record, create parts_used and deduct
                    if (po.rows[0].maintenance_record_id && itemData.pr_item_id) {
                        // Deduct from stock for maintenance
                        await client.query(
                            'UPDATE spare_parts SET current_stock = current_stock - $1, updated_at = NOW() WHERE id = $2',
                            [item.received_quantity, itemData.spare_part_id]
                        );

                        // Record outgoing transaction
                        await client.query(`
              INSERT INTO spare_parts_transactions (
                spare_part_id, transaction_type, quantity, reference_type, reference_id, notes, created_by
              ) VALUES ($1, 'out', $2, 'maintenance', $3, $4, $5)
            `, [
                            itemData.spare_part_id,
                            item.received_quantity,
                            po.rows[0].maintenance_record_id,
                            `Auto-deducted for PR`,
                            received_by
                        ]);

                        // Create parts_used record (use actual price if provided)
                        await client.query(`
              INSERT INTO maintenance_parts_used (
                maintenance_id, spare_part_id, quantity, unit_price, total_price, pr_item_id, status
              ) VALUES ($1, $2, $3, $4, $5, $6, 'used')
            `, [
                            po.rows[0].maintenance_record_id,
                            itemData.spare_part_id,
                            item.received_quantity,
                            usePrice,
                            item.received_quantity * usePrice,
                            itemData.pr_item_id
                        ]);
                    }
                }
        }

        // Update PO status
        const newStatus = allReceived ? 'received' : 'partial';
        await client.query(`
      UPDATE purchase_orders SET
        status = $1::varchar,
        received_at = CASE WHEN $1::varchar = 'received' THEN NOW() ELSE received_at END,
        updated_at = NOW()
      WHERE id = $2
    `, [newStatus, id]);

        // Update PR status if fully received
        if (allReceived && po.rows[0].pr_id) {
            await client.query(`
        UPDATE purchase_requisitions SET status = 'received', updated_at = NOW() WHERE id = $1
      `, [po.rows[0].pr_id]);

            // Update maintenance record
            if (po.rows[0].maintenance_record_id) {
                // Calculate total parts cost for this maintenance
                const partsCostResult = await client.query(`
          SELECT COALESCE(SUM(total_price), 0) as total_parts_cost
          FROM maintenance_parts_used
          WHERE maintenance_id = $1
        `, [po.rows[0].maintenance_record_id]);
                
                const partsCost = parseFloat(partsCostResult.rows[0].total_parts_cost) || 0;

                await client.query(`
          UPDATE maintenance_records 
          SET waiting_for_parts = false, 
              parts_cost = $1,
              total_cost = COALESCE(labor_cost, 0) + $1,
              updated_at = NOW() 
          WHERE id = $2
        `, [partsCost, po.rows[0].maintenance_record_id]);

                // Notify technician
                const pr = await client.query(
                    'SELECT requested_by, pr_number FROM purchase_requisitions WHERE id = $1',
                    [po.rows[0].pr_id]
                );

                if (pr.rows[0]?.requested_by) {
                    await client.query(`
            INSERT INTO maintenance_notifications (user_id, title, message, type, category, reference_type, reference_id)
            VALUES ($1, $2, $3, 'success', 'parts', 'maintenance', $4)
          `, [
                        pr.rows[0].requested_by,
                        '📦 อะไหล่พร้อมแล้ว!',
                        `รายการจาก ${pr.rows[0].pr_number} ได้รับแล้ว สามารถทำงานต่อได้`,
                        po.rows[0].maintenance_record_id
                    ]);
                }

                // Add to maintenance timeline (log)
                const receiver = await client.query('SELECT display_name FROM maintenance_users WHERE id = $1', [received_by]);
                const receiverName = receiver.rows[0]?.display_name || 'Unknown';
                await client.query(
                    `INSERT INTO maintenance_timeline (maintenance_id, status, changed_by, notes)
                     VALUES ($1, 'po_received', $2, $3)`,
                    [po.rows[0].maintenance_record_id, received_by, `รับอะไหล่ ${po.rows[0].po_number} โดย ${receiverName} - อะไหล่พร้อมใช้งาน`]
                );
            }
        }

        await client.query('COMMIT');

        res.json({
            success: true,
            status: newStatus,
            message: allReceived ? 'All items received' : 'Partial items received'
        });
    } catch (error: any) {
        await client.query('ROLLBACK');
        console.error('Error receiving items:', error);
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
});

// Cancel purchase order
router.put('/:id/cancel', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        const po = await pool.query('SELECT * FROM purchase_orders WHERE id = $1', [id]);

        if (po.rows.length === 0) {
            return res.status(404).json({ error: 'Purchase order not found' });
        }

        if (['received', 'cancelled'].includes(po.rows[0].status)) {
            return res.status(400).json({ error: `Cannot cancel purchase order with status: ${po.rows[0].status}` });
        }

        await pool.query(`
      UPDATE purchase_orders SET
        status = 'cancelled',
        notes = COALESCE(notes, '') || E'\n[ยกเลิก]: ' || $1,
        updated_at = NOW()
      WHERE id = $2
    `, [reason || 'No reason provided', id]);

        res.json({ success: true, message: 'Purchase order cancelled' });
    } catch (error: any) {
        console.error('Error cancelling purchase order:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
