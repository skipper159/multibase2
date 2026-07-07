import { Router, Request, Response } from 'express';
import AuthService from '../services/AuthService';
import { logger } from '../utils/logger';
import { loginLimiter, registerLimiter } from '../middleware/rateLimiter';
import { validate } from '../middleware/validate';
import { LoginSchema, RegisterSchema, UpdatePasswordSchema } from '../middleware/schemas';
import { auditLog } from '../middleware/auditLog';
import { avatarUpload, AVATARS_URL_PREFIX } from '../middleware/uploadConfig';
import { generateCaptcha, validateCaptcha } from '../services/captchaService';

export function createAuthRoutes() {
  const router = Router();

  /**
   * GET /api/auth/captcha
   * Generate a new Math Captcha challenge.
   * Returns an SVG image (as text/plain) and a signed token.
   */
  router.get('/captcha', (_req: Request, res: Response) => {
    try {
      const { token, svg } = generateCaptcha();
      res.json({ token, svg });
    } catch (error) {
      logger.error('Error generating captcha:', error);
      res.status(500).json({ error: 'Failed to generate captcha' });
    }
  });

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
        const { email, username, password, website, captchaToken, captchaSolution } = req.body;

        // --- Honeypot check: bots fill hidden fields, humans never see them ---
        if (website && website.length > 0) {
          logger.warn('Bot registration attempt detected via honeypot');
          // Respond with 200 to not give bots a signal, but don't register
          return res.status(200).json({ message: 'Registration submitted' });
        }

        // --- Captcha validation ---
        if (!validateCaptcha(captchaToken, captchaSolution)) {
          return res.status(400).json({ error: 'Captcha-Lösung falsch oder abgelaufen. Bitte versuche es erneut.' });
        }

        // Validation is now handled by Zod middleware
        const user = await AuthService.register({
          email,
          username,
          password,
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
        const { email, password, twoFactorToken } = req.body;

        // Validation is now handled by Zod middleware
        const ipAddress = req.ip;
        const userAgent = req.get('user-agent');

        const result = await AuthService.login(
          { email, password, twoFactorToken },
          ipAddress,
          userAgent
        );

        // Set user in request for audit logger
        (req as any).user = result.user;

        // Set cookie for subdomain access if session was created
        if (result.session) {
          res.cookie('auth_token', result.session.token, {
            httpOnly: true,
            secure: true, // Required for SameSite=None
            sameSite: 'none',
            domain: process.env.COOKIE_DOMAIN,
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
          });
        }

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

        // Clear cookie
        res.clearCookie('auth_token', {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          domain: process.env.COOKIE_DOMAIN,
        });

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
  router.patch('/users/:id', auditLog('USER_UPDATE', { includeBody: true, getResource: (req) => req.params.id }), async (req: Request, res: Response): Promise<any> => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const session = await AuthService.validateSession(token);
      if (!session || session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden' });
      }
      (req as any).user = session.user;

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
  router.put('/users/:id', auditLog('USER_UPDATE', { includeBody: true, getResource: (req) => req.params.id }), async (req: Request, res: Response): Promise<any> => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const session = await AuthService.validateSession(token);
      if (!session || session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden' });
      }
      (req as any).user = session.user;

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
  router.put('/users/:id/password', auditLog('USER_PASSWORD_RESET', { getResource: (req) => req.params.id }), async (req: Request, res: Response): Promise<any> => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const session = await AuthService.validateSession(token);
      if (!session || session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden' });
      }
      (req as any).user = session.user;

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
  router.delete('/users/:id', auditLog('USER_DELETE', { getResource: (req) => req.params.id }), async (req: Request, res: Response): Promise<any> => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const session = await AuthService.validateSession(token);
      if (!session || session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden' });
      }
      (req as any).user = session.user;

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
    auditLog('USER_SESSION_REVOKE', { getResource: (req) => `${req.params.id}/${req.params.sessionId}` }),
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
        (req as any).user = currentSession.user;

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
  router.put('/profile', auditLog('PROFILE_UPDATE', { includeBody: true }), async (req: Request, res: Response): Promise<any> => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const session = await AuthService.validateSession(token);
      if (!session) {
        return res.status(401).json({ error: 'Invalid or expired session' });
      }
      (req as any).user = session.user;

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
    (req: Request, _res: Response, next) => {
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
  router.post('/2fa/enable', auditLog('TWO_FA_ENABLE_INIT'), async (req: Request, res: Response): Promise<any> => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const session = await AuthService.validateSession(token);
      if (!session) {
        return res.status(401).json({ error: 'Invalid or expired session' });
      }
      (req as any).user = session.user;

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
  router.post('/2fa/verify', auditLog('TWO_FA_ENABLE_CONFIRM'), async (req: Request, res: Response): Promise<any> => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const session = await AuthService.validateSession(token);
      if (!session) {
        return res.status(401).json({ error: 'Invalid or expired session' });
      }
      (req as any).user = session.user;

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
  router.post('/2fa/disable', auditLog('TWO_FA_DISABLE'), async (req: Request, res: Response): Promise<any> => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const session = await AuthService.validateSession(token);
      if (!session) {
        return res.status(401).json({ error: 'Invalid or expired session' });
      }
      (req as any).user = session.user;

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

        // Set cookie for subdomain access
        res.cookie('auth_token', result.session.token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          domain: process.env.COOKIE_DOMAIN,
          maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        });

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
  router.delete('/users/:id/2fa', auditLog('USER_2FA_ADMIN_RESET', { getResource: (req) => req.params.id }), async (req: Request, res: Response): Promise<any> => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const session = await AuthService.validateSession(token);
      if (!session || session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden - Admin only' });
      }
      (req as any).user = session.user;

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

  // ... (existing routes)

  /**
   * POST /api/auth/verify-email
   */
  router.post('/verify-email', async (req: Request, res: Response): Promise<any> => {
    try {
      const { token } = req.body;
      if (!token) {
        return res.status(400).json({ error: 'Token required' });
      }
      await AuthService.verifyEmail(token);
      res.json({ message: 'Email verified successfully' });
    } catch (error) {
      logger.error('Error verifying email:', error);
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Invalid verification token',
      });
    }
  });

  /**
   * POST /api/auth/forgot-password
   */
  router.post('/forgot-password', async (req: Request, res: Response): Promise<any> => {
    try {
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ error: 'Email required' });
      }
      await AuthService.forgotPassword(email);
      res.json({ message: 'If an account exists, a password reset email has been sent.' });
    } catch (error) {
      logger.error('Error in forgot password route:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/auth/reset-password
   */
  router.post('/reset-password', async (req: Request, res: Response): Promise<any> => {
    try {
      const { token, password } = req.body;
      if (!token || !password) {
        return res.status(400).json({ error: 'Token and new password required' });
      }
      await AuthService.resetPassword(token, password);
      res.json({ message: 'Password reset successfully' });
    } catch (error) {
      logger.error('Error in reset password route:', error);
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to reset password',
      });
    }
  });

  /**
   * POST /api/auth/delete-account
   */
  router.post('/delete-account', auditLog('ACCOUNT_DELETE'), async (req: Request, res: Response): Promise<any> => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const session = await AuthService.validateSession(token);
      if (!session) {
        return res.status(401).json({ error: 'Invalid or expired session' });
      }
      (req as any).user = session.user;

      const { password } = req.body;
      if (!password) {
        return res.status(400).json({ error: 'Password required' });
      }

      await AuthService.deleteSelf(session.user.id, password);
      res.json({ message: 'Account deleted successfully' });
    } catch (error) {
      logger.error('Error in delete account route:', error);
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to delete account',
      });
    }
  });

  return router;
}
