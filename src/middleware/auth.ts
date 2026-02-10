import { Request, Response, NextFunction } from 'express';

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
