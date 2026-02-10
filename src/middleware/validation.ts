import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';

/**
 * Validation schemas for API requests
 */

// User schemas
export const userCreateSchema = z.object({
  line_user_id: z.string().min(1).max(100),
  display_name: z.string().min(1).max(255),
  role: z.enum(['admin', 'moderator', 'technician', 'viewer']).optional(),
  employee_id: z.string().max(50).optional(),
  department: z.string().max(100).optional(),
  phone: z.string().max(20).optional(),
});

export const userUpdateSchema = z.object({
  display_name: z.string().min(1).max(255).optional(),
  role: z.enum(['admin', 'moderator', 'technician', 'viewer']).optional(),
  employee_id: z.string().max(50).optional(),
  department: z.string().max(100).optional(),
  phone: z.string().max(20).optional(),
  is_active: z.boolean().optional(),
});

// Maintenance schemas
export const maintenanceCreateSchema = z.object({
  userId: z.union([z.string(), z.number()]),
  equipmentId: z.union([z.string(), z.number()]).optional(),
  equipmentName: z.string().max(255).optional(),
  maintenanceType: z.enum(['corrective', 'preventive', 'breakdown', 'inspection']),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
  description: z.string().max(2000).optional(),
  assignedTo: z.union([z.string(), z.number()]).optional().nullable(),
});

export const maintenanceUpdateSchema = z.object({
  userId: z.union([z.string(), z.number()]),
  status: z.enum(['pending', 'assigned', 'in_progress', 'on_hold', 'completed', 'cancelled']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  assignedTo: z.union([z.string(), z.number()]).optional().nullable(),
  rootCause: z.string().max(2000).optional(),
  actionTaken: z.string().max(2000).optional(),
  notes: z.string().max(2000).optional(),
});



// Notification schemas
export const notificationSchema = z.object({
  user_id: z.number().int().positive(),
  title: z.string().min(1).max(255),
  message: z.string().max(1000).optional(),
  type: z.enum(['info', 'warning', 'error', 'success']).optional(),
  category: z.string().max(50).optional(),
  reference_type: z.string().max(50).optional(),
  reference_id: z.number().int().positive().optional(),
});

// ID parameter schema
export const idParamSchema = z.object({
  id: z.string().regex(/^\d+$/, 'ID must be a number'),
});

/**
 * Middleware factory to validate request body against a schema
 */
export const validateBody = <T extends z.ZodSchema>(schema: T) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = schema.safeParse(req.body);

      if (!result.success) {
        const errors = result.error.issues.map((e: any) => ({
          field: e.path.join('.'),
          message: e.message
        }));

        return res.status(400).json({
          error: 'Validation failed',
          details: errors
        });
      }

      // Replace body with validated/transformed data
      req.body = result.data;
      next();
    } catch (error) {
      return res.status(400).json({ error: 'Invalid request data' });
    }
  };
};

/**
 * Middleware factory to validate request params
 */
export const validateParams = <T extends z.ZodSchema>(schema: T) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = schema.safeParse(req.params);

      if (!result.success) {
        return res.status(400).json({
          error: 'Invalid parameters',
          details: result.error.issues
        });
      }

      next();
    } catch (error) {
      return res.status(400).json({ error: 'Invalid parameters' });
    }
  };
};

/**
 * Middleware factory to validate query parameters
 */
export const validateQuery = <T extends z.ZodSchema>(schema: T) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = schema.safeParse(req.query);

      if (!result.success) {
        return res.status(400).json({
          error: 'Invalid query parameters',
          details: result.error.issues
        });
      }

      next();
    } catch (error) {
      return res.status(400).json({ error: 'Invalid query parameters' });
    }
  };
};

/**
 * Sanitize string input - remove potential XSS
 */
export const sanitizeString = (input: string): string => {
  if (typeof input !== 'string') return input;

  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
};

/**
 * Sanitize object recursively
 */
export const sanitizeObject = (obj: any): any => {
  if (typeof obj === 'string') {
    return sanitizeString(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }

  if (obj !== null && typeof obj === 'object') {
    const sanitized: any = {};
    for (const key of Object.keys(obj)) {
      sanitized[key] = sanitizeObject(obj[key]);
    }
    return sanitized;
  }

  return obj;
};

/**
 * Middleware to sanitize all string inputs in body
 */
export const sanitizeInputs = (req: Request, res: Response, next: NextFunction) => {
  if (req.body) {
    req.body = sanitizeObject(req.body);
  }
  next();
};
