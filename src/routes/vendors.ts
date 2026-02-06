import express, { Request, Response, Router } from 'express';
import pool from '../config/database.js';

const router: Router = express.Router();

// ===========================================
// VENDORS CRUD
// ===========================================

// Get all vendors
router.get('/', async (req: Request, res: Response) => {
  try {
    const { type, search, active } = req.query;

    let query = 'SELECT * FROM vendors WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (type) {
      query += ` AND vendor_type = $${paramIndex++}`;
      params.push(type);
    }

    if (search) {
      query += ` AND (vendor_name ILIKE $${paramIndex} OR vendor_code ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (active !== undefined) {
      query += ` AND is_active = $${paramIndex++}`;
      params.push(active === 'true');
    }

    query += ' ORDER BY vendor_name';

    const result = await pool.query(query, params);
    res.json({ vendors: result.rows });
  } catch (error: any) {
    console.error('Error fetching vendors:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single vendor
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const vendor = await pool.query('SELECT * FROM vendors WHERE id = $1', [id]);

    if (vendor.rows.length === 0) {
      return res.status(404).json({ error: 'Vendor not found' });
    }

    // Get related equipment
    const equipment = await pool.query(
      'SELECT id, equipment_name, equipment_code FROM equipment WHERE vendor_id = $1',
      [id]
    );

    // Get related spare parts
    const parts = await pool.query(
      'SELECT id, part_name, part_code FROM spare_parts WHERE vendor_id = $1',
      [id]
    );

    res.json({
      vendor: vendor.rows[0],
      equipment: equipment.rows,
      parts: parts.rows
    });
  } catch (error: any) {
    console.error('Error fetching vendor:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create vendor
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      vendor_code, vendor_name, vendor_type, contact_person,
      phone, email, address, tax_id, payment_terms, notes
    } = req.body;

    if (!vendor_name) {
      return res.status(400).json({ error: 'vendor_name is required' });
    }

    const result = await pool.query(`
      INSERT INTO vendors (
        vendor_code, vendor_name, vendor_type, contact_person,
        phone, email, address, tax_id, payment_terms, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [
      vendor_code, vendor_name, vendor_type, contact_person,
      phone, email, address, tax_id, payment_terms, notes
    ]);

    res.status(201).json({ vendor: result.rows[0] });
  } catch (error: any) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Vendor code already exists' });
    }
    console.error('Error creating vendor:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update vendor
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      vendor_code, vendor_name, vendor_type, contact_person,
      phone, email, address, tax_id, payment_terms, notes, is_active
    } = req.body;

    const result = await pool.query(`
      UPDATE vendors SET
        vendor_code = COALESCE($1, vendor_code),
        vendor_name = COALESCE($2, vendor_name),
        vendor_type = COALESCE($3, vendor_type),
        contact_person = COALESCE($4, contact_person),
        phone = COALESCE($5, phone),
        email = COALESCE($6, email),
        address = COALESCE($7, address),
        tax_id = COALESCE($8, tax_id),
        payment_terms = COALESCE($9, payment_terms),
        notes = COALESCE($10, notes),
        is_active = COALESCE($11, is_active),
        updated_at = NOW()
      WHERE id = $12
      RETURNING *
    `, [
      vendor_code, vendor_name, vendor_type, contact_person,
      phone, email, address, tax_id, payment_terms, notes, is_active, id
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Vendor not found' });
    }

    res.json({ vendor: result.rows[0] });
  } catch (error: any) {
    console.error('Error updating vendor:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete vendor
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Check dependencies
    const equipmentCheck = await pool.query(
      'SELECT COUNT(*) FROM equipment WHERE vendor_id = $1',
      [id]
    );
    const partsCheck = await pool.query(
      'SELECT COUNT(*) FROM spare_parts WHERE vendor_id = $1',
      [id]
    );

    if (parseInt(equipmentCheck.rows[0].count) > 0 || parseInt(partsCheck.rows[0].count) > 0) {
      await pool.query('UPDATE vendors SET is_active = false WHERE id = $1', [id]);
      return res.json({ message: 'Vendor deactivated (has dependencies)' });
    }

    await pool.query('DELETE FROM vendors WHERE id = $1', [id]);
    res.json({ message: 'Vendor deleted' });
  } catch (error: any) {
    console.error('Error deleting vendor:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===========================================
// WARRANTIES
// ===========================================

// Get warranties for equipment
router.get('/warranties', async (req: Request, res: Response) => {
  try {
    const { equipment_id, expiring } = req.query;

    let query = `
      SELECT ew.*, e.equipment_name, e.equipment_code
      FROM equipment_warranties ew
      LEFT JOIN equipment e ON ew.equipment_id = e.id
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramIndex = 1;

    if (equipment_id) {
      query += ` AND ew.equipment_id = $${paramIndex++}`;
      params.push(equipment_id);
    }

    if (expiring === 'true') {
      // Expiring within 90 days
      query += ` AND ew.end_date <= CURRENT_DATE + interval '90 days' AND ew.end_date >= CURRENT_DATE`;
    }

    query += ' ORDER BY ew.end_date';

    const result = await pool.query(query, params);
    res.json({ warranties: result.rows });
  } catch (error: any) {
    console.error('Error fetching warranties:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create warranty
router.post('/warranties', async (req: Request, res: Response) => {
  try {
    const {
      equipment_id, warranty_type, provider, start_date, end_date,
      coverage_details, contact_info, document_path
    } = req.body;

    if (!equipment_id || !end_date) {
      return res.status(400).json({ error: 'equipment_id and end_date are required' });
    }

    const result = await pool.query(`
      INSERT INTO equipment_warranties (
        equipment_id, warranty_type, provider, start_date, end_date,
        coverage_details, contact_info, document_path
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      equipment_id, warranty_type, provider, start_date, end_date,
      coverage_details, contact_info, document_path
    ]);

    res.status(201).json({ warranty: result.rows[0] });
  } catch (error: any) {
    console.error('Error creating warranty:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update warranty
router.put('/warranties/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      warranty_type, provider, start_date, end_date,
      coverage_details, contact_info, document_path, is_active
    } = req.body;

    const result = await pool.query(`
      UPDATE equipment_warranties SET
        warranty_type = COALESCE($1, warranty_type),
        provider = COALESCE($2, provider),
        start_date = COALESCE($3, start_date),
        end_date = COALESCE($4, end_date),
        coverage_details = COALESCE($5, coverage_details),
        contact_info = COALESCE($6, contact_info),
        document_path = COALESCE($7, document_path),
        is_active = COALESCE($8, is_active),
        updated_at = NOW()
      WHERE id = $9
      RETURNING *
    `, [
      warranty_type, provider, start_date, end_date,
      coverage_details, contact_info, document_path, is_active, id
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Warranty not found' });
    }

    res.json({ warranty: result.rows[0] });
  } catch (error: any) {
    console.error('Error updating warranty:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete warranty
router.delete('/warranties/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM equipment_warranties WHERE id = $1', [id]);
    res.json({ message: 'Warranty deleted' });
  } catch (error: any) {
    console.error('Error deleting warranty:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===========================================
// DOCUMENTS
// ===========================================

// Get documents for equipment
router.get('/documents', async (req: Request, res: Response) => {
  try {
    const { equipment_id, type } = req.query;

    let query = `
      SELECT ed.*, e.equipment_name, u.display_name as uploaded_by_name
      FROM equipment_documents ed
      LEFT JOIN equipment e ON ed.equipment_id = e.id
      LEFT JOIN maintenance_users u ON ed.uploaded_by = u.id
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramIndex = 1;

    if (equipment_id) {
      query += ` AND ed.equipment_id = $${paramIndex++}`;
      params.push(equipment_id);
    }

    if (type) {
      query += ` AND ed.document_type = $${paramIndex++}`;
      params.push(type);
    }

    query += ' ORDER BY ed.created_at DESC';

    const result = await pool.query(query, params);
    res.json({ documents: result.rows });
  } catch (error: any) {
    console.error('Error fetching documents:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create document record
router.post('/documents', async (req: Request, res: Response) => {
  try {
    const {
      equipment_id, document_type, title, description,
      file_path, file_name, file_size, mime_type, uploaded_by
    } = req.body;

    if (!equipment_id || !title) {
      return res.status(400).json({ error: 'equipment_id and title are required' });
    }

    const result = await pool.query(`
      INSERT INTO equipment_documents (
        equipment_id, document_type, title, description,
        file_path, file_name, file_size, mime_type, uploaded_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [
      equipment_id, document_type, title, description,
      file_path, file_name, file_size, mime_type, uploaded_by
    ]);

    res.status(201).json({ document: result.rows[0] });
  } catch (error: any) {
    console.error('Error creating document:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete document
router.delete('/documents/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM equipment_documents WHERE id = $1', [id]);
    res.json({ message: 'Document deleted' });
  } catch (error: any) {
    console.error('Error deleting document:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
