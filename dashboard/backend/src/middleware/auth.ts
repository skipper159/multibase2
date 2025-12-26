import { Request, Response, NextFunction } from 'express';
import AuthService from '../services/AuthService';

/**
 * Middleware to check authentication (Session or API Key).
 * Expects req.user to be set by apiKeyAuth OR checks Bearer token.
 */
export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<any> => {
  try {
    // 1. Check if already authenticated via API Key
    if ((req as any).user) {
      return next();
    }

    // 2. Check Bearer Token (Session)
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized: No token or API key provided' });
    }

    const session = await AuthService.validateSession(token);
    if (!session) {
      return res.status(401).json({ error: 'Unauthorized: Invalid session' });
    }

    (req as any).user = session.user;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Unauthorized' });
  }
};
