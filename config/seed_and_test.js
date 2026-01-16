import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  try {
    console.log('1. Seeding Equipment...');
    // Upsert dummy equipment
    const equipRes = await pool.query(`
      INSERT INTO equipment (equipment_name, equipment_code, equipment_type, location, status)
      VALUES ('Test Machine', 'TEST-001', 'Type-A', 'Lab', 'active')
      ON CONFLICT (equipment_code) DO UPDATE SET equipment_name = EXCLUDED.equipment_name
      RETURNING equipment_id
    `);
    const equipmentId = equipRes.rows[0].equipment_id;
    console.log(`Equipment ID: ${equipmentId}`);

    console.log('2. Fetching Admin User ID...');
    const userRes = await pool.query("SELECT id FROM maintenance_users WHERE role = 'admin' LIMIT 1");
    if (userRes.rows.length === 0) throw new Error('No admin user found. Run add_dev_user.js first.');
    const userId = userRes.rows[0].id;
    console.log(`User ID: ${userId}`);

    console.log('3. Creating Maintenance Record...');
    const recordRes = await axios.post('http://localhost:3002/api/maintenance/records', {
      equipmentId: equipmentId,
      userId: userId,
      maintenanceType: 'Test Upload Flow',
      status: 'pending'
    });
    const recordId = recordRes.data.id;
    console.log(`Record ID: ${recordId}`);

    console.log('4. Uploading Image...');
    const form = new FormData();
    fs.writeFileSync('test_image.png', 'fake image content');
    form.append('image', fs.createReadStream('test_image.png'));
    form.append('type', 'before');

    const uploadRes = await axios.post(`http://localhost:3002/api/maintenance/records/${recordId}/images`, form, {
      headers: { ...form.getHeaders() }
    });
    console.log('Upload Result:', uploadRes.data);

    if (uploadRes.data.success) {
        const imageUrl = `http://localhost:3002${uploadRes.data.image.image_url}`;
        console.log(`5. Verifying Image Serving at ${imageUrl}...`);
        try {
            const serveRes = await axios.get(imageUrl);
            if (serveRes.status === 200) {
                console.log('✅ SUCCESS: Image served correctly.');
            }
        } catch (e) {
            console.error('❌ FAILURE: Could not fetch image.');
        }
    }

  } catch (error) {
    if (error.response) {
       console.error('API Error:', error.response.data);
    } else {
       console.error('Error:', error);
    }
  } finally {
    await pool.end();
  }
}

run();
