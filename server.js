import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.js';
import maintenanceRoutes from './routes/maintenance.js';
import usersRoutes from './routes/users.js';
import statusRoutes from './routes/status.js';
import { setupDatabase } from './config/setup.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: function (origin, callback) {
    // อนุญาตทุก origin ที่เป็น localhost:5173 หรือ ngrok
    const allowedOrigins = [
      'http://localhost:5173',
      'https://m_frontend.2edge.co',
      'https://m_backend.2edge.co',
      'https://srung.2edge.co',
      /https:\/\/.*\.ngrok-free\.app$/,
      /https:\/\/.*\.ngrok\.io$/
    ];
    
    // อนุญาต requests ที่ไม่มี origin (เช่น Postman)
    if (!origin) return callback(null, true);
    
    // เช็คว่า origin ตรงกับ pattern ไหน
    const isAllowed = allowedOrigins.some(pattern => {
      if (typeof pattern === 'string') {
        return pattern === origin;
      }
      return pattern.test(origin);
    });
    
    if (isAllowed) {
      callback(null, true);
    } else {
      console.warn('⚠️  CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/status', statusRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

// Setup database และ start server
async function startServer() {
  try {
    console.log('🚀 Starting server...\n');
    
    // Setup database
    await setupDatabase();
    
    // Start listening
    app.listen(PORT, () => {
      console.log(`✅ Server is running on port ${PORT}`);
      console.log(`📍 API available at http://localhost:${PORT}/api`);
      console.log(`💚 Health check: http://localhost:${PORT}/health\n`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }
}

startServer();
