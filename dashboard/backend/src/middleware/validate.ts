import { Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';
import { logger } from '../utils/logger';

/**
 * Validation middleware for request body
 * Parses and validates the request body against the provided Zod schema
 */
export const validate = (schema: z.ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        }));
        logger.warn('Validation failed:', { errors, body: req.body });
        res.status(400).json({
          error: 'Validation failed',
          details: errors,
        });
        return;
      }
      next(error);
    }
  };
};

/**
 * Validation middleware for URL parameters
 * Parses and validates req.params against the provided Zod schema
 */
export const validateParams = (schema: z.ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const parsed = schema.parse(req.params);
      // Merge parsed params back (maintains type safety)
      Object.assign(req.params, parsed);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        }));
        logger.warn('Parameter validation failed:', { errors, params: req.params });
        res.status(400).json({
          error: 'Invalid parameters',
          details: errors,
        });
        return;
      }
      next(error);
    }
  };
};

/**
 * Validation middleware for query parameters
 * Parses and validates req.query against the provided Zod schema
 */
export const validateQuery = (schema: z.ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const parsed = schema.parse(req.query);
      Object.assign(req.query, parsed);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        }));
        logger.warn('Query validation failed:', { errors, query: req.query });
        res.status(400).json({
          error: 'Invalid query parameters',
          details: errors,
        });
        return;
      }
      next(error);
    }
  };
};
