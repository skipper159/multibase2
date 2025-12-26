import { Router, Request, Response } from 'express';
import AuthService from '../services/AuthService';
import { logger } from '../utils/logger';
import { loginLimiter, registerLimiter } from '../middleware/rateLimiter';
import { validate } from '../middleware/validate';
import { LoginSchema, RegisterSchema, UpdatePasswordSchema } from '../middleware/schemas';
import { auditLog } from '../middleware/auditLog';
import { avatarUpload, AVATARS_URL_PREFIX } from '../middleware/uploadConfig';

export function createAuthRoutes() {
  const router = Router();

  /**
   * POST /api/auth/register
   * Register a new user
   */
  router.post(
    '/register',
    registerLimiter,
    validate(RegisterSchema),
    auditLog('USER_REGISTER'),
    async (req: Request, res: Response): Promise<any> => {
      try {
        const { email, username, password, role } = req.body;

        // Validation is now handled by Zod middleware
        const user = await AuthService.register({
          email,
          username,
          password,
          role,
        });

        // Set user in request for audit logger
        (req as any).user = user;

        res.json({ user });
      } catch (error) {
        logger.error('Error in register route:', error);
        res.status(500).json({
          error: error instanceof Error ? error.message : 'Failed to register user',
        });
      }
    }
  );

  /**
   * POST /api/auth/login
   * Login user
   */
  router.post(
    '/login',
    loginLimiter,
    validate(LoginSchema),
    auditLog('USER_LOGIN'),
    async (req: Request, res: Response): Promise<any> => {
      try {
        const { email, password } = req.body;

        // Validation is now handled by Zod middleware
        const ipAddress = req.ip;
        const userAgent = req.get('user-agent');

        const result = await AuthService.login({ email, password }, ipAddress, userAgent);

        // Set user in request for audit logger
        (req as any).user = result.user;

        res.json(result);
      } catch (error) {
        logger.error('Error in login route:', error);
        res.status(401).json({
          error: error instanceof Error ? error.message : 'Failed to login',
        });
      }
    }
  );

  /**
   * POST /api/auth/logout
   * Logout user
   */
  router.post(
    '/logout',
    auditLog('USER_LOGOUT'),
    async (req: Request, res: Response): Promise<any> => {
      try {
        const token = req.headers.authorization?.replace('Bearer ', '');

        if (!token) {
          return res.status(400).json({ error: 'Token required' });
        }

        // Validate session to get user for audit log before logout
        const session = await AuthService.validateSession(token);
        if (session) {
          (req as any).user = session.user;
        }

        await AuthService.logout(token);

        res.json({ message: 'Logged out successfully' });
      } catch (error) {
        logger.error('Error in logout route:', error);
        res.status(500).json({
          error: error instanceof Error ? error.message : 'Failed to logout',
        });
      }
    }
  );

  /**
   * GET /api/auth/me
   * Get current user
   */
  router.get('/me', async (req: Request, res: Response): Promise<any> => {
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
        error: error instanceof Error ? error.message : 'Failed to get user',
      });
    }
  });

  /**
   * GET /api/auth/users
   * Get all users (admin only)
   */
  router.get('/users', async (req: Request, res: Response): Promise<any> => {
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
        error: error instanceof Error ? error.message : 'Failed to get users',
      });
    }
  });

  /**
   * GET /api/auth/users/:id
   * Get user by ID (admin only)
   */
  router.get('/users/:id', async (req: Request, res: Response): Promise<any> => {
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
        error: error instanceof Error ? error.message : 'Failed to get user',
      });
    }
  });

  /**
   * PATCH /api/auth/users/:id
   * Update user (admin only)
   */
  router.patch('/users/:id', async (req: Request, res: Response): Promise<any> => {
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
        error: error instanceof Error ? error.message : 'Failed to update user',
      });
    }
  });

  /**
   * PUT /api/auth/users/:id
   * Update user (admin only) - for full updates
   */
  router.put('/users/:id', async (req: Request, res: Response): Promise<any> => {
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
        error: error instanceof Error ? error.message : 'Failed to update user',
      });
    }
  });

  /**
   * PUT /api/auth/users/:id/password
   * Reset user password (admin only)
   */
  router.put('/users/:id/password', async (req: Request, res: Response): Promise<any> => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const session = await AuthService.validateSession(token);
      if (!session || session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const { password } = req.body;
      if (!password) {
        return res.status(400).json({ error: 'Password is required' });
      }

      await AuthService.updatePassword(req.params.id, password);
      res.json({ message: 'Password updated successfully' });
    } catch (error) {
      logger.error('Error in update password route:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to update password',
      });
    }
  });

  /**
   * DELETE /api/auth/users/:id
   * Delete user (admin only)
   */
  router.delete('/users/:id', async (req: Request, res: Response): Promise<any> => {
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
        error: error instanceof Error ? error.message : 'Failed to delete user',
      });
    }
  });

  /**
   * GET /api/auth/users/:id/sessions
   * Get all active sessions for a user
   */
  router.get('/users/:id/sessions', async (req: Request, res: Response): Promise<any> => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const currentSession = await AuthService.validateSession(token);
      if (!currentSession) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // User can only view their own sessions, admins can view any
      const targetUserId = req.params.id;
      if (currentSession.user.id !== targetUserId && currentSession.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const sessions = await AuthService.getUserSessions(targetUserId);
      res.json({ sessions, currentSessionId: currentSession.session.id });
    } catch (error) {
      logger.error('Error in get sessions route:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to get sessions',
      });
    }
  });

  /**
   * DELETE /api/auth/users/:id/sessions/:sessionId
   * Terminate a specific session
   */
  router.delete(
    '/users/:id/sessions/:sessionId',
    async (req: Request, res: Response): Promise<any> => {
      try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) {
          return res.status(401).json({ error: 'Unauthorized' });
        }

        const currentSession = await AuthService.validateSession(token);
        if (!currentSession) {
          return res.status(401).json({ error: 'Unauthorized' });
        }

        // User can only delete their own sessions, admins can delete any
        const targetUserId = req.params.id;
        if (currentSession.user.id !== targetUserId && currentSession.user.role !== 'admin') {
          return res.status(403).json({ error: 'Forbidden' });
        }

        await AuthService.deleteSession(req.params.sessionId, targetUserId);
        res.json({ message: 'Session terminated successfully' });
      } catch (error) {
        logger.error('Error in delete session route:', error);
        res.status(500).json({
          error: error instanceof Error ? error.message : 'Failed to terminate session',
        });
      }
    }
  );

  // =====================================================
  // Profile & Avatar Routes
  // =====================================================

  /**
   * PUT /api/auth/profile
   * Update own profile (username, email)
   */
  router.put('/profile', async (req: Request, res: Response): Promise<any> => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const session = await AuthService.validateSession(token);
      if (!session) {
        return res.status(401).json({ error: 'Invalid or expired session' });
      }

      const { username, email } = req.body;
      const user = await AuthService.updateProfile(session.user.id, { username, email });
      res.json(user);
    } catch (error) {
      logger.error('Error in update profile route:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to update profile',
      });
    }
  });

  /**
   * POST /api/auth/avatar
   * Upload avatar image
   */
  router.post(
    '/avatar',
    (req: Request, res: Response, next) => {
      // Extract user ID before multer runs
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (token) {
        AuthService.validateSession(token)
          .then((session) => {
            if (session) {
              (req as any).userId = session.user.id;
            }
            next();
          })
          .catch(next);
      } else {
        next();
      }
    },
    avatarUpload.single('avatar'),
    async (req: Request, res: Response): Promise<any> => {
      try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) {
          return res.status(401).json({ error: 'Unauthorized' });
        }

        const session = await AuthService.validateSession(token);
        if (!session) {
          return res.status(401).json({ error: 'Invalid or expired session' });
        }

        if (!req.file) {
          return res.status(400).json({ error: 'No file uploaded' });
        }

        // Create the avatar URL
        const avatarUrl = `${AVATARS_URL_PREFIX}/${req.file.filename}`;

        const user = await AuthService.updateAvatar(session.user.id, avatarUrl);
        res.json(user);
      } catch (error) {
        logger.error('Error in upload avatar route:', error);
        res.status(500).json({
          error: error instanceof Error ? error.message : 'Failed to upload avatar',
        });
      }
    }
  );

  /**
   * DELETE /api/auth/avatar
   * Remove avatar
   */
  router.delete('/avatar', async (req: Request, res: Response): Promise<any> => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const session = await AuthService.validateSession(token);
      if (!session) {
        return res.status(401).json({ error: 'Invalid or expired session' });
      }

      const user = await AuthService.updateAvatar(session.user.id, null);
      res.json(user);
    } catch (error) {
      logger.error('Error in delete avatar route:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to delete avatar',
      });
    }
  });

  // =====================================================
  // Two-Factor Authentication Routes
  // =====================================================

  /**
   * POST /api/auth/2fa/enable
   * Generate 2FA secret and QR code
   */
  router.post('/2fa/enable', async (req: Request, res: Response): Promise<any> => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const session = await AuthService.validateSession(token);
      if (!session) {
        return res.status(401).json({ error: 'Invalid or expired session' });
      }

      const result = await AuthService.enable2FA(session.user.id);
      res.json(result);
    } catch (error) {
      logger.error('Error in enable 2FA route:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to enable 2FA',
      });
    }
  });

  /**
   * POST /api/auth/2fa/verify
   * Verify and activate 2FA
   */
  router.post('/2fa/verify', async (req: Request, res: Response): Promise<any> => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const session = await AuthService.validateSession(token);
      if (!session) {
        return res.status(401).json({ error: 'Invalid or expired session' });
      }

      const { code } = req.body;
      if (!code) {
        return res.status(400).json({ error: 'Verification code required' });
      }

      await AuthService.verify2FA(session.user.id, code);
      res.json({ message: '2FA enabled successfully' });
    } catch (error) {
      logger.error('Error in verify 2FA route:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to verify 2FA',
      });
    }
  });

  /**
   * POST /api/auth/2fa/disable
   * Disable 2FA (requires valid token)
   */
  router.post('/2fa/disable', async (req: Request, res: Response): Promise<any> => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const session = await AuthService.validateSession(token);
      if (!session) {
        return res.status(401).json({ error: 'Invalid or expired session' });
      }

      const { code } = req.body;
      if (!code) {
        return res.status(400).json({ error: 'Verification code required' });
      }

      await AuthService.disable2FA(session.user.id, code);
      res.json({ message: '2FA disabled successfully' });
    } catch (error) {
      logger.error('Error in disable 2FA route:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to disable 2FA',
      });
    }
  });

  /**
   * POST /api/auth/login-2fa
   * Login with 2FA token (second step after initial login check)
   */
  router.post(
    '/login-2fa',
    loginLimiter,
    auditLog('USER_LOGIN_2FA'),
    async (req: Request, res: Response): Promise<any> => {
      try {
        const { email, password, code } = req.body;

        if (!email || !password || !code) {
          return res.status(400).json({ error: 'Email, password, and 2FA code required' });
        }

        const ipAddress = req.ip;
        const userAgent = req.get('user-agent');

        const result = await AuthService.loginWith2FA(
          { email, password },
          code,
          ipAddress,
          userAgent
        );

        (req as any).user = result.user;
        res.json(result);
      } catch (error) {
        logger.error('Error in login-2fa route:', error);
        res.status(401).json({
          error: error instanceof Error ? error.message : 'Failed to login with 2FA',
        });
      }
    }
  );

  /**
   * GET /api/auth/2fa/status
   * Check if 2FA is enabled for current user
   */
  router.get('/2fa/status', async (req: Request, res: Response): Promise<any> => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const session = await AuthService.validateSession(token);
      if (!session) {
        return res.status(401).json({ error: 'Invalid or expired session' });
      }

      const enabled = await AuthService.has2FAEnabled(session.user.id);
      res.json({ enabled });
    } catch (error) {
      logger.error('Error in 2FA status route:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to get 2FA status',
      });
    }
  });

  /**
   * DELETE /api/auth/users/:id/2fa
   * Admin reset/disable 2FA for a user (no token required from user)
   */
  router.delete('/users/:id/2fa', async (req: Request, res: Response): Promise<any> => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const session = await AuthService.validateSession(token);
      if (!session || session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden - Admin only' });
      }

      const { id } = req.params;
      await AuthService.adminReset2FA(id);
      res.json({ message: '2FA disabled successfully' });
    } catch (error) {
      logger.error('Error in admin 2FA reset route:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to reset 2FA',
      });
    }
  });

  /**
   * GET /api/auth/users/:id/2fa
   * Admin check if user has 2FA enabled
   */
  router.get('/users/:id/2fa', async (req: Request, res: Response): Promise<any> => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const session = await AuthService.validateSession(token);
      if (!session || session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden - Admin only' });
      }

      const { id } = req.params;
      const enabled = await AuthService.has2FAEnabled(id);
      res.json({ enabled });
    } catch (error) {
      logger.error('Error in admin 2FA status route:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to get 2FA status',
      });
    }
  });

  return router;
}
