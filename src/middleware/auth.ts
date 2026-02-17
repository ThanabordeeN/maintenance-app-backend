import { Request, Response, NextFunction } from 'express';
import pool from '../config/database.js';

// Extended Request type with user info
export interface AuthRequest extends Request {
  user?: {
    id: number;
    role: string;
    displayName: string;
    lineUserId: string;
  };
}

/**
 * Middleware to verify user exists and attach user info to request
 * Uses userId from body, query, or headers
 */
import { authService } from '../services/auth.service.js';

export const authenticateUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    
    // Check for Bearer token
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Token is required' });
    }

    // Verify using shared service
    try {
        const result = await authService.verifyLineToken(token);
        
        // Status check
        if (result.user.status !== 'active' && result.user.status !== 'approved' && !result.user.lineUserId.startsWith('dev-')) {
             // Allow pending users specifically for registration check endpoints if needed, 
             // but generally we block. For now, strict block except for active/approved.
             // Note: 'approved'/ 'active' mapping might vary, assuming 'active' based on previous code.
             
             // Wait, previous code allowed 'pending' users to hit verify endpoint but blocked them later?
             // Let's stick to blocking inactive/banned.
             if (['rejected', 'inactive', 'suspended'].includes(result.user.status)) {
                 return res.status(403).json({ error: `User status is ${result.user.status}` });
             }
        }

        req.user = {
            id: result.user.id,
            role: result.user.role,
            displayName: result.user.displayName,
            lineUserId: result.user.lineUserId
        };

        next();
    } catch (err: any) {
        if (err.message === 'User not found in database') {
             return res.status(401).json({ error: 'User not registered' });
        }
        console.error('Token verification failed:', err.message);
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

  } catch (error) {
    console.error('Authentication middleware error:', error);
    return res.status(500).json({ error: 'Internal server error during authentication' });
  }
};

/**
 * Middleware to require admin or supervisor role
 */
export const requireAdminOrSupervisor = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (!['admin', 'supervisor'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Admin or supervisor access required' });
  }

  next();
};

/**
 * Middleware to require admin role only
 */
export const requireAdmin = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  next();
};

/**
 * Optional authentication - attaches user if userId provided, but doesn't fail
 */
export const optionalAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.body.userId || req.query.userId || req.headers['x-user-id'];

    if (userId) {
      const result = await pool.query(
        'SELECT id, role, display_name, line_user_id FROM maintenance_users WHERE id = $1',
        [userId]
      );

      if (result.rows.length > 0) {
        req.user = {
          id: result.rows[0].id,
          role: result.rows[0].role,
          displayName: result.rows[0].display_name,
          lineUserId: result.rows[0].line_user_id
        };
      }
    }

    next();
  } catch (error) {
    // Don't fail, just continue without user
    next();
  }
};

/**
 * Development authentication bypass middleware
 * In development mode, this allows requests without authentication
 */
export function devAuthBypass(req: Request, res: Response, next: NextFunction) {
  const isDev = process.env.NODE_ENV !== 'production';
  
  if (isDev) {
    // Auto-authenticate in development mode
    // @ts-ignore
    req.user = {
      id: 1,
      lineUserId: 'dev-user',
      displayName: 'Dev User',
      role: 'admin'
    };
  }
  
  next();
}

/**
 * Optional: Middleware to require authentication
 * Use this on routes that need authentication even in dev mode
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  // @ts-ignore
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}
