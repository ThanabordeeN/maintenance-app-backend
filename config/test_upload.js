import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';

async function testUpload() {
  try {
    // 1. Create a dummy record to attach image to
    const recordRes = await axios.post('http://localhost:3002/api/maintenance/records', {
      equipmentId: 1,
      userId: 1, // Make sure this user exists (admin)
      maintenanceType: 'Test Upload',
      status: 'pending'
    });
    
    const recordId = recordRes.data.id;
    console.log(`Created record ID: ${recordId}`);

    // 2. Upload image
    const form = new FormData();
    // Create a dummy file
    fs.writeFileSync('test_image.png', 'fake image content');
    form.append('image', fs.createReadStream('test_image.png'));
    form.append('type', 'before');

    const uploadRes = await axios.post(`http://localhost:3002/api/maintenance/records/${recordId}/images`, form, {
      headers: {
        ...form.getHeaders()
      }
    });

    console.log('Upload response:', uploadRes.data);
    
    if (uploadRes.data.success) {
        console.log('✅ Image uploaded successfully');
        console.log('Image URL:', uploadRes.data.image.image_url);
        
        // 3. Verify serving
        const imageUrl = `http://localhost:3002${uploadRes.data.image.image_url}`;
        const serveRes = await axios.get(imageUrl);
        if (serveRes.status === 200) {
            console.log('✅ Image served successfully');
        } else {
            console.error('❌ Failed to serve image');
        }
    }

  } catch (error) {
    if (error.response) {
        console.error('Error response:', error.response.data);
    } else {
        console.error('Error:', error.message);
    }
  }
}

testUpload();
