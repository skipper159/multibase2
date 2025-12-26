import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import AuthService from '../services/AuthService';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

export function createAuditRoutes() {
  const router = Router();

  /**
   * Middleware to check admin authentication
   */
  const requireAdmin = async (req: Request, res: Response, next: Function): Promise<any> => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const session = await AuthService.validateSession(token);
      if (!session || session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden - Admin access required' });
      }

      (req as any).user = session.user;
      next();
    } catch (error) {
      res.status(401).json({ error: 'Unauthorized' });
    }
  };

  /**
   * GET /api/audit
   * List audit logs with filtering and pagination (Admin only)
   */
  router.get('/', requireAdmin, async (req: Request, res: Response) => {
    try {
      const { action, userId, success, limit = '50', offset = '0', startDate, endDate } = req.query;

      const where: any = {};
      if (action) where.action = action;
      if (userId) where.userId = userId;
      if (success !== undefined) where.success = success === 'true';

      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) where.createdAt.gte = new Date(startDate as string);
        if (endDate) where.createdAt.lte = new Date(endDate as string);
      }

      const [logs, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: Math.min(parseInt(limit as string, 10), 200),
          skip: parseInt(offset as string, 10),
          include: {
            user: {
              select: {
                id: true,
                username: true,
                email: true,
              },
            },
          },
        }),
        prisma.auditLog.count({ where }),
      ]);

      res.json({
        data: logs,
        pagination: {
          total,
          limit: parseInt(limit as string, 10),
          offset: parseInt(offset as string, 10),
        },
      });
    } catch (error) {
      logger.error('Error listing audit logs:', error);
      res.status(500).json({ error: 'Failed to list audit logs' });
    }
  });

  /**
   * GET /api/audit/stats
   * Get audit log statistics (Admin only)
   */
  router.get('/stats', requireAdmin, async (_req: Request, res: Response) => {
    try {
      const now = new Date();
      const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const [total, last24hCount, last7dCount, failedLast24h, topActions] = await Promise.all([
        prisma.auditLog.count(),
        prisma.auditLog.count({ where: { createdAt: { gte: last24h } } }),
        prisma.auditLog.count({ where: { createdAt: { gte: last7d } } }),
        prisma.auditLog.count({ where: { createdAt: { gte: last24h }, success: false } }),
        prisma.auditLog.groupBy({
          by: ['action'],
          _count: { action: true },
          orderBy: { _count: { action: 'desc' } },
          take: 10,
        }),
      ]);

      res.json({
        total,
        last24h: last24hCount,
        last7d: last7dCount,
        failedLast24h,
        topActions: topActions.map((a) => ({
          action: a.action,
          count: a._count.action,
        })),
      });
    } catch (error) {
      logger.error('Error getting audit stats:', error);
      res.status(500).json({ error: 'Failed to get audit statistics' });
    }
  });

  /**
   * GET /api/audit/:id
   * Get single audit log entry (Admin only)
   */
  router.get('/:id', requireAdmin, async (req: Request, res: Response): Promise<any> => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: 'Invalid audit log ID' });
      }

      const log = await prisma.auditLog.findUnique({
        where: { id },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              email: true,
            },
          },
        },
      });

      if (!log) {
        return res.status(404).json({ error: 'Audit log not found' });
      }

      res.json(log);
    } catch (error) {
      logger.error('Error getting audit log:', error);
      res.status(500).json({ error: 'Failed to get audit log' });
    }
  });

  return router;
}
