import path from 'path';
import { Router, Request, Response } from 'express';
import AuthService from '../services/AuthService';
import { logger } from '../utils/logger';
import prisma from '../lib/prisma';
import { parseEnvFile, extractCredentials } from '../utils/envParser';

export function createInstanceAuthRoutes() {
  const router = Router();

  /**
   * GET /api/auth/verify-instance-access
   * Verifies if the user has access to an instance
   * Called by Nginx auth_request
   */
  router.get('/verify-instance-access', async (req: Request, res: Response): Promise<any> => {
    try {
      // 1. Extract token from cookie (parsed or raw header) or Authorization header
      let token = req.cookies?.auth_token || req.cookies?.session;
      if (!token && req.headers.cookie) {
        const match = req.headers.cookie.match(/(?:^|;\s*)(?:auth_token|session)=([^;]+)/);
        if (match) token = decodeURIComponent(match[1]);
      }
      if (!token) {
        token = req.headers.authorization?.replace('Bearer ', '');
      }

      if (!token) {
        // Fallback: Supabase instance API key (apikey header sent by Supabase JS SDK)
        const supabaseApiKey = req.headers['apikey'] as string;
        const instanceNameForKey = req.headers['x-instance-name'] as string;

        if (supabaseApiKey && instanceNameForKey) {
          const instanceForKey = await prisma.instance.findFirst({
            where: { OR: [{ id: instanceNameForKey }, { name: instanceNameForKey }] },
          });
          if (!instanceForKey) {
            return res.status(401).json({ error: 'Instance not found' });
          }
          try {
            const projectsPath =
              process.env.PROJECTS_PATH || path.join(__dirname, '../../../projects');
            const envConfig = parseEnvFile(path.join(projectsPath, instanceNameForKey, '.env'));
            const credentials = extractCredentials(envConfig);

            if (credentials.service_role_key && supabaseApiKey === credentials.service_role_key) {
              logger.debug(`Instance access granted via service_role key: ${instanceNameForKey}`);
              return res.status(200).json({ allowed: true, role: 'service_role' });
            }
            if (credentials.anon_key && supabaseApiKey === credentials.anon_key) {
              logger.debug(`Instance access granted via anon key: ${instanceNameForKey}`);
              return res.status(200).json({ allowed: true, role: 'anon' });
            }
          } catch (err) {
            logger.debug(`Could not read env for instance ${instanceNameForKey}: ${err}`);
          }
        }

        logger.debug('Instance access denied: No token provided');
        return res.status(401).json({ error: 'Unauthorized - No token' });
      }

      // 2. Validate session
      const session = await AuthService.validateSession(token);

      if (!session) {
        logger.debug('Instance access denied: Invalid session');
        return res.status(401).json({ error: 'Unauthorized - Invalid session' });
      }

      // 3. Check if user is active
      if (!session.user.isActive) {
        logger.debug(`Instance access denied: User ${session.user.username} is not active`);
        return res.status(403).json({ error: 'Forbidden - User not active' });
      }

      // 4. Optional: Instance-specific access control
      const instanceName = req.headers['x-instance-name'] as string;

      if (instanceName) {
        const instance = await prisma.instance.findFirst({
          where: { OR: [{ id: instanceName }, { name: instanceName }] },
        });

        if (!instance) {
          logger.debug(`Instance access denied: Instance ${instanceName} not found`);
          return res.status(401).json({ error: 'Instance not found' });
        }

        if (session.user.role === 'viewer') {
          logger.debug(
            `Instance access granted (read-only): ${session.user.username} → ${instanceName}`
          );
        } else {
          logger.debug(`Instance access granted: ${session.user.username} → ${instanceName}`);
        }
      }

      // 5. Success - Nginx will forward the request
      return res.status(200).json({
        allowed: true,
        user: session.user.username,
        role: session.user.role,
      });
    } catch (error) {
      logger.error('Error verifying instance access:', error);
      return res.status(401).json({ error: 'Unauthorized - Error verifying access' });
    }
  });

  /**
   * GET /api/auth/instance-login-url
   * Generates a login URL with redirect back to the instance
   */
  router.get('/instance-login-url', async (req: Request, res: Response): Promise<any> => {
    try {
      const redirectUrl = req.query.redirect as string;

      if (!redirectUrl) {
        return res.status(400).json({ error: 'redirect parameter required' });
      }

      const dashboardUrl = process.env.DASHBOARD_URL || 'https://multibase.tyto-design.de';
      const loginUrl = `${dashboardUrl}/login?redirect=${encodeURIComponent(redirectUrl)}`;

      return res.json({ loginUrl });
    } catch (error) {
      logger.error('Error generating login URL:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
