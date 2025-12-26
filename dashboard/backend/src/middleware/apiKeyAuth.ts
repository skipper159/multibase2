import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

/**
 * Hash an API key for lookup
 */
function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Middleware to authenticate requests via API Key.
 * It does NOT block requests without a key (passive mode).
 * If a valid key is found, it sets req.user and req.apiKey.
 */
export const apiKeyAuth = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const apiKey = req.headers['x-api-key'] as string;

    if (!apiKey) {
      return next();
    }

    // Hash the provided key to verify against DB
    const hashedKey = hashApiKey(apiKey);

    const keyRecord = await prisma.apiKey.findUnique({
      where: { key: hashedKey },
      include: { user: true },
    });

    if (!keyRecord) {
      // Key provided but invalid -> we could just next() or fail.
      // Usually if credentials are provided but bad, we should fail?
      // But maybe we want to fallback to Session auth?
      // Let's log warning and continue (Session auth might save it, or it will fail 401 later)
      // Actually, if an API Key is explicitly provided and wrong, we should arguably 401.
      // But for simplicity/fallback, let's just ignore it and let requireAuth fail.
      return next();
    }

    // Check expiry
    if (keyRecord.expiresAt && keyRecord.expiresAt < new Date()) {
      return next();
    }

    // Retrieve full user details to match Session structure
    const user = await prisma.user.findUnique({
      where: { id: keyRecord.userId },
    });

    if (!user) {
      return next();
    }

    // Update lastUsedAt (async, don't await)
    prisma.apiKey
      .update({
        where: { id: keyRecord.id },
        data: {
          lastUsedAt: new Date(),
          usageCount: { increment: 1 },
        },
      })
      .catch((err) => logger.error('Failed to update API key stats', err));

    // Attach to request
    (req as any).user = user;
    (req as any).apiKey = keyRecord;

    logger.info(`Mainicated via API Key: ${keyRecord.name} (User: ${user.username})`);

    next();
  } catch (error) {
    logger.error('API Key Auth Error:', error);
    next();
  }
};
