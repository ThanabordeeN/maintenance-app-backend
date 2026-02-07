import express, { Request, Response, Router } from 'express';
import pool from '../config/database.js';
import { authenticateUser, requireAdminOrModerator, AuthRequest } from '../middleware/auth.js';
import { validateBody, sparePartSchema } from '../middleware/validation.js';

const router: Router = express.Router();

// ===========================================
// SPARE PARTS CRUD
// ===========================================

// Get all spare parts
router.get('/', async (req: Request, res: Response) => {
  try {
    const { category, lowStock, search } = req.query;
    
    let query = `
      SELECT sp.*, v.vendor_name
      FROM spare_parts sp
      LEFT JOIN vendors v ON sp.vendor_id = v.id
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramIndex = 1;

    if (category) {
      query += ` AND sp.category = $${paramIndex++}`;
      params.push(category);
    }

    if (lowStock === 'true') {
      query += ` AND sp.current_stock <= sp.min_stock_level`;
    }

    if (search) {
      query += ` AND (sp.part_code ILIKE $${paramIndex} OR sp.part_name ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    query += ` ORDER BY sp.part_name`;

    const result = await pool.query(query, params);
    
    // Get summary stats
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total_parts,
        COUNT(CASE WHEN current_stock <= min_stock_level THEN 1 END) as low_stock_count,
        SUM(current_stock * unit_price) as total_value
      FROM spare_parts
      WHERE is_active = true
    `);

    res.json({ 
      parts: result.rows,
      stats: stats.rows[0]
    });
  } catch (error: any) {
    console.error('Error fetching spare parts:', error);
    res.status(500).json({ error: 'Failed to fetch spare parts' });
  }
});

// Get single spare part
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(`
      SELECT sp.*, v.vendor_name
      FROM spare_parts sp
      LEFT JOIN vendors v ON sp.vendor_id = v.id
      WHERE sp.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Part not found' });
    }

    // Get transaction history
    const transactions = await pool.query(`
      SELECT spt.*, u.display_name as created_by_name
      FROM spare_parts_transactions spt
      LEFT JOIN maintenance_users u ON spt.created_by = u.id
      WHERE spt.spare_part_id = $1
      ORDER BY spt.created_at DESC
      LIMIT 50
    `, [id]);

    // Get usage in maintenance records
    const usage = await pool.query(`
      SELECT mpu.*, mr.work_order, e.equipment_name
      FROM maintenance_parts_used mpu
      LEFT JOIN maintenance_records mr ON mpu.maintenance_record_id = mr.id
      LEFT JOIN equipment e ON mr.equipment_id = e.id
      WHERE mpu.spare_part_id = $1
      ORDER BY mpu.created_at DESC
      LIMIT 20
    `, [id]);

    res.json({ 
      part: result.rows[0],
      transactions: transactions.rows,
      usage: usage.rows
    });
  } catch (error: any) {
    console.error('Error fetching spare part:', error);
    res.status(500).json({ error: 'Failed to fetch spare part' });
  }
});

// Create spare part (Admin/Moderator only)
router.post('/', authenticateUser, requireAdminOrModerator, validateBody(sparePartSchema), async (req: AuthRequest, res: Response) => {
  try {
    const {
      part_code, part_name, description, category, unit,
      unit_price, current_stock, min_stock_level, max_stock_level,
      location, supplier, vendor_id
    } = req.body;

    const result = await pool.query(`
      INSERT INTO spare_parts (
        part_code, part_name, description, category, unit,
        unit_price, current_stock, min_stock_level, max_stock_level,
        location, supplier, vendor_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `, [
      part_code, part_name, description, category, unit || 'ชิ้น',
      unit_price || 0, current_stock || 0, min_stock_level || 0, max_stock_level || 100,
      location, supplier, vendor_id
    ]);

    res.status(201).json({ part: result.rows[0] });
  } catch (error: any) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Part code already exists' });
    }
    console.error('Error creating spare part:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update spare part (Admin/Moderator only)
router.put('/:id', authenticateUser, requireAdminOrModerator, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const {
      part_code, part_name, description, category, unit,
      unit_price, min_stock_level, max_stock_level,
      location, supplier, vendor_id, is_active
    } = req.body;

    const result = await pool.query(`
      UPDATE spare_parts SET
        part_code = COALESCE($1, part_code),
        part_name = COALESCE($2, part_name),
        description = COALESCE($3, description),
        category = COALESCE($4, category),
        unit = COALESCE($5, unit),
        unit_price = COALESCE($6, unit_price),
        min_stock_level = COALESCE($7, min_stock_level),
        max_stock_level = COALESCE($8, max_stock_level),
        location = COALESCE($9, location),
        supplier = COALESCE($10, supplier),
        vendor_id = $11,
        is_active = COALESCE($12, is_active),
        updated_at = NOW()
      WHERE id = $13
      RETURNING *
    `, [
      part_code, part_name, description, category, unit,
      unit_price, min_stock_level, max_stock_level,
      location, supplier, vendor_id, is_active, id
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Part not found' });
    }

    res.json({ part: result.rows[0] });
  } catch (error: any) {
    console.error('Error updating spare part:', error);
    res.status(500).json({ error: error.message });
  }
});

// Adjust stock (Admin/Moderator only)
router.post('/:id/adjust', authenticateUser, requireAdminOrModerator, async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();
  
  try {
    const { id } = req.params;
    const { transaction_type, quantity, notes, user_id, reference_type, reference_id } = req.body;

    if (!transaction_type || !quantity) {
      return res.status(400).json({ error: 'transaction_type and quantity are required' });
    }

    await client.query('BEGIN');

    // Get current stock
    const partResult = await client.query('SELECT * FROM spare_parts WHERE id = $1', [id]);
    if (partResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Part not found' });
    }

    const part = partResult.rows[0];
    let newStock = part.current_stock;

    if (transaction_type === 'in') {
      newStock += quantity;
    } else if (transaction_type === 'out') {
      if (quantity > part.current_stock) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Insufficient stock' });
      }
      newStock -= quantity;
    } else if (transaction_type === 'adjust') {
      newStock = quantity; // Direct set
    }

    // Update stock
    await client.query(
      'UPDATE spare_parts SET current_stock = $1, updated_at = NOW() WHERE id = $2',
      [newStock, id]
    );

    // Record transaction
    const txResult = await client.query(`
      INSERT INTO spare_parts_transactions (
        spare_part_id, transaction_type, quantity, reference_type, reference_id, notes, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [id, transaction_type, quantity, reference_type, reference_id, notes, user_id]);

    await client.query('COMMIT');

    res.json({ 
      transaction: txResult.rows[0],
      new_stock: newStock
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error adjusting stock:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// Get categories
router.get('/meta/categories', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT category FROM spare_parts 
      WHERE category IS NOT NULL 
      ORDER BY category
    `);
    res.json({ categories: result.rows.map(r => r.category) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete spare part
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    // Check if used in any maintenance
    const usageCheck = await pool.query(
      'SELECT COUNT(*) FROM maintenance_parts_used WHERE spare_part_id = $1',
      [id]
    );
    
    if (parseInt(usageCheck.rows[0].count) > 0) {
      // Soft delete if has usage history
      await pool.query(
        'UPDATE spare_parts SET is_active = false, updated_at = NOW() WHERE id = $1',
        [id]
      );
      return res.json({ message: 'Part deactivated (has usage history)' });
    }

    // Hard delete if no usage
    await pool.query('DELETE FROM spare_parts WHERE id = $1', [id]);
    res.json({ message: 'Part deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting spare part:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
