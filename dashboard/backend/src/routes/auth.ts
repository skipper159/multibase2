import { Router, Request, Response } from 'express';
import AuthService from '../services/AuthService';
import { logger } from '../utils/logger';

export function createAuthRoutes() {
  const router = Router();

  /**
   * POST /api/auth/register
   * Register a new user
   */
  router.post('/register', async (req: Request, res: Response) => {
    try {
      const { email, username, password, role } = req.body;

      if (!email || !username || !password) {
        return res.status(400).json({ error: 'Email, username, and password are required' });
      }

      const user = await AuthService.register({
        email,
        username,
        password,
        role
      });

      res.json({ user });
    } catch (error) {
      logger.error('Error in register route:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to register user'
      });
    }
  });

  /**
   * POST /api/auth/login
   * Login user
   */
  router.post('/login', async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }

      const ipAddress = req.ip;
      const userAgent = req.get('user-agent');

      const result = await AuthService.login(
        { email, password },
        ipAddress,
        userAgent
      );

      res.json(result);
    } catch (error) {
      logger.error('Error in login route:', error);
      res.status(401).json({
        error: error instanceof Error ? error.message : 'Failed to login'
      });
    }
  });

  /**
   * POST /api/auth/logout
   * Logout user
   */
  router.post('/logout', async (req: Request, res: Response) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');

      if (!token) {
        return res.status(400).json({ error: 'Token required' });
      }

      await AuthService.logout(token);

      res.json({ message: 'Logged out successfully' });
    } catch (error) {
      logger.error('Error in logout route:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to logout'
      });
    }
  });

  /**
   * GET /api/auth/me
   * Get current user
   */
  router.get('/me', async (req: Request, res: Response) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');

      if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const session = await AuthService.validateSession(token);

      if (!session) {
        return res.status(401).json({ error: 'Invalid or expired session' });
      }

      res.json(session.user);
    } catch (error) {
      logger.error('Error in me route:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to get user'
      });
    }
  });

  /**
   * GET /api/auth/users
   * Get all users (admin only)
   */
  router.get('/users', async (req: Request, res: Response) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const session = await AuthService.validateSession(token);
      if (!session || session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const users = await AuthService.getAllUsers();
      res.json(users);
    } catch (error) {
      logger.error('Error in users route:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to get users'
      });
    }
  });

  /**
   * GET /api/auth/users/:id
   * Get user by ID (admin only)
   */
  router.get('/users/:id', async (req: Request, res: Response) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const session = await AuthService.validateSession(token);
      if (!session || session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const user = await AuthService.getUserById(req.params.id);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.json(user);
    } catch (error) {
      logger.error('Error in get user route:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to get user'
      });
    }
  });

  /**
   * PATCH /api/auth/users/:id
   * Update user (admin only)
   */
  router.patch('/users/:id', async (req: Request, res: Response) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const session = await AuthService.validateSession(token);
      if (!session || session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const user = await AuthService.updateUser(req.params.id, req.body);
      res.json(user);
    } catch (error) {
      logger.error('Error in update user route:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to update user'
      });
    }
  });

  /**
   * DELETE /api/auth/users/:id
   * Delete user (admin only)
   */
  router.delete('/users/:id', async (req: Request, res: Response) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const session = await AuthService.validateSession(token);
      if (!session || session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      await AuthService.deleteUser(req.params.id);
      res.json({ message: 'User deleted successfully' });
    } catch (error) {
      logger.error('Error in delete user route:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to delete user'
      });
    }
  });

  return router;
}
