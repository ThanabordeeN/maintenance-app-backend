import express, { Request, Response, Router } from 'express';
import pool from '../config/database.js';

const router: Router = express.Router();

// ===========================================
// CHECKLIST TEMPLATES
// ===========================================

// Get all templates
router.get('/templates', async (req: Request, res: Response) => {
  try {
    const { category, equipment_type, active } = req.query;

    let query = `
      SELECT ct.*, 
        COUNT(cti.id) as item_count,
        u.display_name as created_by_name
      FROM checklist_templates ct
      LEFT JOIN checklist_template_items cti ON ct.id = cti.template_id
      LEFT JOIN maintenance_users u ON ct.created_by = u.id
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramIndex = 1;

    if (category) {
      query += ` AND ct.category = $${paramIndex++}`;
      params.push(category);
    }

    if (equipment_type) {
      query += ` AND ct.equipment_type = $${paramIndex++}`;
      params.push(equipment_type);
    }

    if (active !== undefined) {
      query += ` AND ct.is_active = $${paramIndex++}`;
      params.push(active === 'true');
    }

    query += ` GROUP BY ct.id, u.display_name ORDER BY ct.name`;

    const result = await pool.query(query, params);
    
    // Fetch items for each template
    const templatesWithItems = await Promise.all(
      result.rows.map(async (template) => {
        const itemsResult = await pool.query(`
          SELECT id, item_order, item_text as description, item_type as type, options, is_required as required
          FROM checklist_template_items
          WHERE template_id = $1
          ORDER BY item_order
        `, [template.id]);
        
        return {
          ...template,
          items: itemsResult.rows
        };
      })
    );
    
    res.json({ templates: templatesWithItems });
  } catch (error: any) {
    console.error('Error fetching templates:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single template with items
router.get('/templates/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const template = await pool.query(`
      SELECT ct.*, u.display_name as created_by_name
      FROM checklist_templates ct
      LEFT JOIN maintenance_users u ON ct.created_by = u.id
      WHERE ct.id = $1
    `, [id]);

    if (template.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const items = await pool.query(`
      SELECT * FROM checklist_template_items
      WHERE template_id = $1
      ORDER BY item_order
    `, [id]);

    res.json({
      template: template.rows[0],
      items: items.rows
    });
  } catch (error: any) {
    console.error('Error fetching template:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create template
router.post('/templates', async (req: Request, res: Response) => {
  const client = await pool.connect();
  
  try {
    const { name, description, category, equipment_type, frequency, items, created_by } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    await client.query('BEGIN');

    const templateResult = await client.query(`
      INSERT INTO checklist_templates (name, description, category, equipment_type, frequency, created_by)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [name, description, category, equipment_type, frequency || 'daily', created_by]);

    const template = templateResult.rows[0];

    // Add items
    if (items && Array.isArray(items)) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const itemText = item.item_text || item.description || item.text || '';
        if (!itemText) continue; // Skip empty items
        
        await client.query(`
          INSERT INTO checklist_template_items (
            template_id, item_order, item_text, item_type, options, is_required
          ) VALUES ($1, $2, $3, $4, $5, $6)
        `, [
          template.id,
          i,
          itemText,
          item.item_type || item.type || 'checkbox',
          item.options ? JSON.stringify(item.options) : null,
          item.is_required ?? item.required ?? false
        ]);
      }
    }

    await client.query('COMMIT');

    res.status(201).json({ template });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error creating template:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// Update template
router.put('/templates/:id', async (req: Request, res: Response) => {
  const client = await pool.connect();
  
  try {
    const { id } = req.params;
    const { name, description, category, equipment_type, frequency, items, is_active } = req.body;

    await client.query('BEGIN');

    const result = await client.query(`
      UPDATE checklist_templates SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        category = COALESCE($3, category),
        equipment_type = COALESCE($4, equipment_type),
        frequency = COALESCE($5, frequency),
        is_active = COALESCE($6, is_active),
        updated_at = NOW()
      WHERE id = $7
      RETURNING *
    `, [name, description, category, equipment_type, frequency, is_active, id]);

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Template not found' });
    }

    // Update items if provided
    if (items && Array.isArray(items)) {
      // Delete existing items
      await client.query('DELETE FROM checklist_template_items WHERE template_id = $1', [id]);

      // Add new items
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const itemText = item.item_text || item.description || item.text || '';
        
        // Skip empty items
        if (!itemText.trim()) continue;
        
        await client.query(`
          INSERT INTO checklist_template_items (
            template_id, item_order, item_text, item_type, options, is_required
          ) VALUES ($1, $2, $3, $4, $5, $6)
        `, [
          id,
          i,
          itemText,
          item.item_type || item.type || 'checkbox',
          item.options ? JSON.stringify(item.options) : null,
          item.is_required ?? item.required ?? false
        ]);
      }
    }

    await client.query('COMMIT');

    res.json({ template: result.rows[0] });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error updating template:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// Delete template
router.delete('/templates/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Check if has responses
    const responses = await pool.query(
      'SELECT COUNT(*) FROM checklist_responses WHERE template_id = $1',
      [id]
    );

    if (parseInt(responses.rows[0].count) > 0) {
      // Soft delete
      await pool.query(
        'UPDATE checklist_templates SET is_active = false WHERE id = $1',
        [id]
      );
      return res.json({ message: 'Template deactivated (has responses)' });
    }

    // Hard delete
    await pool.query('DELETE FROM checklist_templates WHERE id = $1', [id]);
    res.json({ message: 'Template deleted' });
  } catch (error: any) {
    console.error('Error deleting template:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===========================================
// CHECKLIST RESPONSES
// ===========================================

// Get responses for maintenance record
router.get('/responses', async (req: Request, res: Response) => {
  try {
    const { maintenance_record_id, equipment_id } = req.query;

    let query = `
      SELECT cr.*, 
        ct.name as template_name,
        e.equipment_name,
        u.display_name as completed_by_name
      FROM checklist_responses cr
      LEFT JOIN checklist_templates ct ON cr.template_id = ct.id
      LEFT JOIN equipment e ON cr.equipment_id = e.id
      LEFT JOIN maintenance_users u ON cr.completed_by = u.id
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramIndex = 1;

    if (maintenance_record_id) {
      query += ` AND cr.maintenance_record_id = $${paramIndex++}`;
      params.push(maintenance_record_id);
    }

    if (equipment_id) {
      query += ` AND cr.equipment_id = $${paramIndex++}`;
      params.push(equipment_id);
    }

    query += ` ORDER BY cr.completed_at DESC`;

    const result = await pool.query(query, params);
    res.json({ responses: result.rows });
  } catch (error: any) {
    console.error('Error fetching responses:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single response with items
router.get('/responses/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const response = await pool.query(`
      SELECT cr.*, 
        ct.name as template_name,
        e.equipment_name,
        u.display_name as completed_by_name
      FROM checklist_responses cr
      LEFT JOIN checklist_templates ct ON cr.template_id = ct.id
      LEFT JOIN equipment e ON cr.equipment_id = e.id
      LEFT JOIN maintenance_users u ON cr.completed_by = u.id
      WHERE cr.id = $1
    `, [id]);

    if (response.rows.length === 0) {
      return res.status(404).json({ error: 'Response not found' });
    }

    const items = await pool.query(`
      SELECT * FROM checklist_response_items
      WHERE response_id = $1
      ORDER BY id
    `, [id]);

    res.json({
      response: response.rows[0],
      items: items.rows
    });
  } catch (error: any) {
    console.error('Error fetching response:', error);
    res.status(500).json({ error: error.message });
  }
});

// Submit checklist response
router.post('/responses', async (req: Request, res: Response) => {
  const client = await pool.connect();
  
  try {
    const {
      template_id, maintenance_record_id, equipment_id,
      completed_by, notes, items
    } = req.body;

    if (!template_id || !items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'template_id and items are required' });
    }

    await client.query('BEGIN');

    const responseResult = await client.query(`
      INSERT INTO checklist_responses (
        template_id, maintenance_record_id, equipment_id, completed_by, notes
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [template_id, maintenance_record_id, equipment_id, completed_by, notes]);

    const response = responseResult.rows[0];

    // Add response items
    for (const item of items) {
      await client.query(`
        INSERT INTO checklist_response_items (
          response_id, template_item_id, item_text, response_value, is_passed, notes
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        response.id,
        item.template_item_id,
        item.item_text,
        item.response_value,
        item.is_passed,
        item.notes
      ]);
    }

    // Update maintenance record if linked
    if (maintenance_record_id) {
      await client.query(
        'UPDATE maintenance_records SET checklist_id = $1 WHERE id = $2',
        [response.id, maintenance_record_id]
      );
    }

    await client.query('COMMIT');

    res.status(201).json({ response });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error submitting response:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// ===========================================
// DAILY CHECKLIST ENDPOINTS
// ===========================================

// Get daily responses for a specific date
router.get('/daily/:date', async (req: Request, res: Response) => {
  try {
    const { date } = req.params;
    
    // Get all responses for this date with items
    const result = await pool.query(`
      SELECT 
        cr.id, cr.template_id, cr.schedule_date, cr.completed_at, cr.notes,
        ct.name as template_name, ct.frequency,
        u.display_name as completed_by_name
      FROM checklist_responses cr
      LEFT JOIN checklist_templates ct ON cr.template_id = ct.id
      LEFT JOIN maintenance_users u ON cr.completed_by = u.id
      WHERE cr.schedule_date = $1
      ORDER BY cr.template_id
    `, [date]);
    
    // Get items for each response
    const responses = await Promise.all(result.rows.map(async (resp) => {
      const itemsResult = await pool.query(`
        SELECT 
          cri.*, 
          cti.item_text as template_item_text,
          u.display_name as checked_by_name
        FROM checklist_response_items cri
        LEFT JOIN checklist_template_items cti ON cri.template_item_id = cti.id
        LEFT JOIN maintenance_users u ON cri.checked_by = u.id
        WHERE cri.response_id = $1
        ORDER BY cti.item_order
      `, [resp.id]);
      
      return {
        ...resp,
        items: itemsResult.rows
      };
    }));
    
    res.json({ responses });
  } catch (error: any) {
    console.error('Error fetching daily responses:', error);
    res.status(500).json({ error: error.message });
  }
});

// Check/update a single item for daily checklist
router.post('/daily/check-item', async (req: Request, res: Response) => {
  const client = await pool.connect();
  
  try {
    const { template_id, template_item_id, schedule_date, is_passed, checked_by, notes } = req.body;
    
    await client.query('BEGIN');
    
    // Get or create response for this template + date
    let responseResult = await client.query(`
      SELECT id FROM checklist_responses 
      WHERE template_id = $1 AND schedule_date = $2
    `, [template_id, schedule_date]);
    
    let responseId;
    if (responseResult.rows.length === 0) {
      // Create new response
      const newResp = await client.query(`
        INSERT INTO checklist_responses (template_id, schedule_date, completed_by)
        VALUES ($1, $2, $3)
        RETURNING id
      `, [template_id, schedule_date, checked_by]);
      responseId = newResp.rows[0].id;
    } else {
      responseId = responseResult.rows[0].id;
    }
    
    // Get item text from template
    const templateItem = await client.query(
      'SELECT item_text FROM checklist_template_items WHERE id = $1',
      [template_item_id]
    );
    const itemText = templateItem.rows[0]?.item_text || '';
    
    // Check if item response exists
    const existingItem = await client.query(`
      SELECT id FROM checklist_response_items 
      WHERE response_id = $1 AND template_item_id = $2
    `, [responseId, template_item_id]);
    
    if (existingItem.rows.length > 0) {
      // Update existing
      await client.query(`
        UPDATE checklist_response_items 
        SET is_passed = $1, checked_by = $2, checked_at = NOW(), notes = COALESCE($3, notes)
        WHERE id = $4
      `, [is_passed, checked_by, notes, existingItem.rows[0].id]);
    } else {
      // Create new
      await client.query(`
        INSERT INTO checklist_response_items (
          response_id, template_item_id, item_text, is_passed, checked_by, checked_at, notes
        ) VALUES ($1, $2, $3, $4, $5, NOW(), $6)
      `, [responseId, template_item_id, itemText, is_passed, checked_by, notes]);
    }
    
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error checking item:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// Update note for a daily item
router.post('/daily/update-note', async (req: Request, res: Response) => {
  try {
    const { template_id, template_item_id, schedule_date, notes } = req.body;
    
    await pool.query(`
      UPDATE checklist_response_items cri
      SET notes = $1
      FROM checklist_responses cr
      WHERE cri.response_id = cr.id 
        AND cr.template_id = $2 
        AND cr.schedule_date = $3
        AND cri.template_item_id = $4
    `, [notes, template_id, schedule_date, template_item_id]);
    
    res.json({ success: true });
  } catch (error: any) {
    console.error('Error updating note:', error);
    res.status(500).json({ error: error.message });
  }
});

// Upload image for daily checklist item
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const dailyChecklistStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/daily-checklists';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const dailyChecklistUpload = multer({ storage: dailyChecklistStorage });

router.post('/daily/upload-image', dailyChecklistUpload.single('image'), async (req: Request, res: Response) => {
  const client = await pool.connect();
  
  try {
    const { template_id, template_item_id, schedule_date, checked_by } = req.body;
    const file = req.file;
    
    if (!file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }
    
    const imageUrl = `/uploads/daily-checklists/${file.filename}`;
    
    await client.query('BEGIN');
    
    // Get or create response
    let responseResult = await client.query(`
      SELECT id FROM checklist_responses 
      WHERE template_id = $1 AND schedule_date = $2
    `, [template_id, schedule_date]);
    
    let responseId;
    if (responseResult.rows.length === 0) {
      const newResp = await client.query(`
        INSERT INTO checklist_responses (template_id, schedule_date, completed_by)
        VALUES ($1, $2, $3)
        RETURNING id
      `, [template_id, schedule_date, checked_by]);
      responseId = newResp.rows[0].id;
    } else {
      responseId = responseResult.rows[0].id;
    }
    
    // Get item text from template
    const templateItem = await client.query(
      'SELECT item_text FROM checklist_template_items WHERE id = $1',
      [template_item_id]
    );
    const itemText = templateItem.rows[0]?.item_text || '';
    
    // Check if item response exists
    const existingItem = await client.query(`
      SELECT id FROM checklist_response_items 
      WHERE response_id = $1 AND template_item_id = $2
    `, [responseId, template_item_id]);
    
    if (existingItem.rows.length > 0) {
      await client.query(`
        UPDATE checklist_response_items 
        SET image_url = $1, checked_by = COALESCE(checked_by, $2), checked_at = COALESCE(checked_at, NOW())
        WHERE id = $3
      `, [imageUrl, checked_by, existingItem.rows[0].id]);
    } else {
      await client.query(`
        INSERT INTO checklist_response_items (
          response_id, template_item_id, item_text, image_url, checked_by, checked_at
        ) VALUES ($1, $2, $3, $4, $5, NOW())
      `, [responseId, template_item_id, itemText, imageUrl, checked_by]);
    }
    
    await client.query('COMMIT');
    res.json({ success: true, image_url: imageUrl });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error uploading image:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

export default router;
