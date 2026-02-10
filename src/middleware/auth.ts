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
export const authenticateUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    console.log(`[Auth Debug] ${req.method} ${req.path}`);
    console.log('[Auth Debug] Body:', JSON.stringify(req.body));
    console.log('[Auth Debug] Query:', JSON.stringify(req.query));
    console.log('[Auth Debug] Headers x-user-id:', req.headers['x-user-id']);

    const userId = req.body.userId || req.query.userId || req.headers['x-user-id'];

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const result = await pool.query(
      'SELECT id, role, display_name, line_user_id FROM maintenance_users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid user' });
    }

    req.user = {
      id: result.rows[0].id,
      role: result.rows[0].role,
      displayName: result.rows[0].display_name,
      lineUserId: result.rows[0].line_user_id
    };

    next();
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(500).json({ error: 'Authentication failed' });
  }
};

/**
 * Middleware to require admin or moderator role
 */
export const requireAdminOrModerator = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (!['admin', 'moderator'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Admin or moderator access required' });
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
