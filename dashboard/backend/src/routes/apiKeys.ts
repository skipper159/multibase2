import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { auditLog } from '../middleware/auditLog';

const prisma = new PrismaClient();

/**
 * Hash an API key for storage
 */
function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Generate a new API key with prefix
 */
function generateApiKey(): { key: string; keyPrefix: string } {
  const key = `mb_${crypto.randomBytes(24).toString('hex')}`;
  const keyPrefix = key.slice(0, 11); // "mb_" + first 8 chars
  return { key, keyPrefix };
}

import { requireAuth } from '../middleware/auth';

// ... (Hash/Generate functions remain)

// Inline requireAuth removed

export function createApiKeyRoutes() {
  const router = Router();

  /**
   * POST /api/keys
   * Create a new API key
   */
  router.post('/', requireAuth, auditLog('API_KEY_CREATE'), async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { name, scopes = ['*'], expiresIn } = req.body;

      if (!name) {
        return res.status(400).json({ error: 'Name is required' });
      }

      const { key, keyPrefix } = generateApiKey();
      const hashedKey = hashApiKey(key);

      // Calculate expiration if provided (in days)
      let expiresAt: Date | null = null;
      if (expiresIn && typeof expiresIn === 'number') {
        expiresAt = new Date(Date.now() + expiresIn * 24 * 60 * 60 * 1000);
      }

      const apiKey = await prisma.apiKey.create({
        data: {
          userId: user.id,
          name,
          key: hashedKey,
          keyPrefix,
          scopes: JSON.stringify(scopes),
          expiresAt,
        },
        select: {
          id: true,
          name: true,
          keyPrefix: true,
          scopes: true,
          expiresAt: true,
          createdAt: true,
        },
      });

      logger.info(`API key created: ${keyPrefix} by user ${user.id}`);

      // Return the full key only once - it cannot be retrieved later
      res.status(201).json({
        ...apiKey,
        key, // Full key - only shown once!
        scopes: JSON.parse(apiKey.scopes),
        warning: 'Make sure to copy this key now. You will not be able to see it again!',
      });
    } catch (error) {
      logger.error('Error creating API key:', error);
      res.status(500).json({ error: 'Failed to create API key' });
    }
  });

  /**
   * GET /api/keys
   * List all API keys for current user
   */
  router.get('/', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;

      const keys = await prisma.apiKey.findMany({
        where: { userId: user.id },
        select: {
          id: true,
          name: true,
          keyPrefix: true,
          scopes: true,
          expiresAt: true,
          lastUsedAt: true,
          usageCount: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      res.json({
        keys: keys.map((k) => ({
          ...k,
          scopes: JSON.parse(k.scopes),
        })),
      });
    } catch (error) {
      logger.error('Error listing API keys:', error);
      res.status(500).json({ error: 'Failed to list API keys' });
    }
  });

  /**
   * GET /api/keys/stats
   * Get aggregate statistics for API keys
   * NOTE: Must be before /:id route to avoid conflict
   */
  router.get('/stats', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Get all keys for this user
      const keys = await prisma.apiKey.findMany({
        where: { userId: user.id },
        select: {
          usageCount: true,
          lastUsedAt: true,
          expiresAt: true,
        },
      });

      const totalKeys = keys.length;
      const totalUsage = keys.reduce((sum, k) => sum + k.usageCount, 0);
      const activeKeys = keys.filter((k) => k.lastUsedAt && k.lastUsedAt >= sevenDaysAgo).length;
      const expiredKeys = keys.filter((k) => k.expiresAt && k.expiresAt < now).length;

      res.json({
        totalKeys,
        totalUsage,
        activeKeys,
        expiredKeys,
      });
    } catch (error) {
      logger.error('Error getting API key stats:', error);
      res.status(500).json({ error: 'Failed to get API key stats' });
    }
  });

  /**
   * GET /api/keys/:id
   * Get details of a specific API key
   */
  router.get('/:id', requireAuth, async (req: Request, res: Response): Promise<any> => {
    try {
      const user = (req as any).user;
      const id = parseInt(req.params.id, 10);

      if (isNaN(id)) {
        return res.status(400).json({ error: 'Invalid key ID' });
      }

      const key = await prisma.apiKey.findFirst({
        where: { id, userId: user.id },
        select: {
          id: true,
          name: true,
          keyPrefix: true,
          scopes: true,
          expiresAt: true,
          lastUsedAt: true,
          usageCount: true,
          createdAt: true,
        },
      });

      if (!key) {
        return res.status(404).json({ error: 'API key not found' });
      }

      res.json({
        ...key,
        scopes: JSON.parse(key.scopes),
      });
    } catch (error) {
      logger.error('Error getting API key:', error);
      res.status(500).json({ error: 'Failed to get API key' });
    }
  });

  /**
   * DELETE /api/keys/:id
   * Revoke/delete an API key
   */
  router.delete(
    '/:id',
    requireAuth,
    auditLog('API_KEY_REVOKE'),
    async (req: Request, res: Response): Promise<any> => {
      try {
        const user = (req as any).user;
        const id = parseInt(req.params.id, 10);

        if (isNaN(id)) {
          return res.status(400).json({ error: 'Invalid key ID' });
        }

        // Check ownership
        const key = await prisma.apiKey.findFirst({
          where: { id, userId: user.id },
        });

        if (!key) {
          return res.status(404).json({ error: 'API key not found' });
        }

        await prisma.apiKey.delete({
          where: { id },
        });

        logger.info(`API key revoked: ${key.keyPrefix} by user ${user.id}`);
        res.json({ message: 'API key revoked successfully' });
      } catch (error) {
        logger.error('Error revoking API key:', error);
        res.status(500).json({ error: 'Failed to revoke API key' });
      }
    }
  );

  return router;
}

/**
 * Middleware to authenticate requests via API key
 * Checks X-API-Key header or ?api_key query parameter
 */
export const authenticateApiKey = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<any> => {
  // Skip if already authenticated via session
  if ((req as any).user) {
    return next();
  }

  const apiKeyHeader = req.headers['x-api-key'] as string;
  const apiKeyQuery = req.query.api_key as string;
  const apiKey = apiKeyHeader || apiKeyQuery;

  if (!apiKey) {
    return next(); // No API key provided, might use session auth
  }

  try {
    const hashedKey = hashApiKey(apiKey);
    const key = await prisma.apiKey.findUnique({
      where: { key: hashedKey },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            username: true,
            role: true,
            isActive: true,
          },
        },
      },
    });

    if (!key || !key.user.isActive) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    // Check expiration
    if (key.expiresAt && key.expiresAt < new Date()) {
      return res.status(401).json({ error: 'API key expired' });
    }

    // Update usage stats
    await prisma.apiKey.update({
      where: { id: key.id },
      data: {
        lastUsedAt: new Date(),
        usageCount: { increment: 1 },
      },
    });

    // Attach user and key info to request
    (req as any).user = key.user;
    (req as any).apiKey = {
      id: key.id,
      scopes: JSON.parse(key.scopes),
    };

    next();
  } catch (error) {
    logger.error('Error authenticating API key:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
};
