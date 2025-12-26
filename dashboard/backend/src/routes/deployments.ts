import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import AuthService from '../services/AuthService';
import { logger } from '../utils/logger';
import { auditLog } from '../middleware/auditLog';

const prisma = new PrismaClient();

/**
 * Middleware to check admin authentication
 */
const requireAdmin = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const session = await AuthService.validateSession(token);
    if (!session || session.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    (req as any).user = session.user;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Unauthorized' });
  }
};

/**
 * Generate webhook secret
 */
function generateWebhookSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Verify webhook signature (GitHub style)
 */
function verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
  const hmac = crypto.createHmac('sha256', secret);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}

export function createDeploymentsRoutes() {
  const router = Router();

  // ============ WEBHOOKS ============

  /**
   * GET /api/deployments/webhooks
   * List all webhooks
   */
  router.get('/webhooks', requireAdmin, async (_req: Request, res: Response) => {
    try {
      const webhooks = await prisma.webhook.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          instanceId: true,
          source: true,
          events: true,
          enabled: true,
          lastTriggered: true,
          triggerCount: true,
          createdAt: true,
          // Don't expose secret
        },
      });

      res.json({
        webhooks: webhooks.map((w) => ({
          ...w,
          events: JSON.parse(w.events),
        })),
      });
    } catch (error) {
      logger.error('Error listing webhooks:', error);
      res.status(500).json({ error: 'Failed to list webhooks' });
    }
  });

  /**
   * POST /api/deployments/webhooks
   * Create a new webhook
   */
  router.post(
    '/webhooks',
    requireAdmin,
    auditLog('WEBHOOK_CREATE', { includeBody: true }),
    async (req: Request, res: Response): Promise<any> => {
      try {
        const user = (req as any).user;
        const { name, instanceId, source = 'custom', events = ['push'] } = req.body;

        if (!name) {
          return res.status(400).json({ error: 'Name is required' });
        }

        const secret = generateWebhookSecret();

        const webhook = await prisma.webhook.create({
          data: {
            name,
            instanceId,
            source,
            secret,
            events: JSON.stringify(events),
            createdBy: user.id,
          },
        });

        logger.info(`Webhook created: ${webhook.id} by ${user.id}`);

        // Return with secret (only shown once!)
        res.status(201).json({
          ...webhook,
          events: JSON.parse(webhook.events),
          warning: 'Save this secret! It will not be shown again.',
          webhookUrl: `/api/deployments/webhooks/${webhook.id}/trigger`,
        });
      } catch (error) {
        logger.error('Error creating webhook:', error);
        res.status(500).json({ error: 'Failed to create webhook' });
      }
    }
  );

  /**
   * DELETE /api/deployments/webhooks/:id
   * Delete a webhook
   */
  router.delete(
    '/webhooks/:id',
    requireAdmin,
    auditLog('WEBHOOK_DELETE'),
    async (req: Request, res: Response): Promise<any> => {
      try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
          return res.status(400).json({ error: 'Invalid webhook ID' });
        }

        await prisma.webhook.delete({ where: { id } });

        logger.info(`Webhook deleted: ${id}`);
        res.json({ message: 'Webhook deleted' });
      } catch (error: any) {
        if (error.code === 'P2025') {
          return res.status(404).json({ error: 'Webhook not found' });
        }
        logger.error('Error deleting webhook:', error);
        res.status(500).json({ error: 'Failed to delete webhook' });
      }
    }
  );

  /**
   * POST /api/deployments/webhooks/:id/trigger
   * Trigger a webhook (called by GitHub/GitLab)
   */
  router.post('/webhooks/:id/trigger', async (req: Request, res: Response): Promise<any> => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: 'Invalid webhook ID' });
      }

      const webhook = await prisma.webhook.findUnique({ where: { id } });
      if (!webhook || !webhook.enabled) {
        return res.status(404).json({ error: 'Webhook not found or disabled' });
      }

      // Verify signature if provided
      const signature =
        (req.headers['x-hub-signature-256'] as string) || (req.headers['x-gitlab-token'] as string);
      if (
        signature &&
        !verifyWebhookSignature(JSON.stringify(req.body), signature, webhook.secret)
      ) {
        return res.status(401).json({ error: 'Invalid signature' });
      }

      // Create deployment
      const deployment = await prisma.deployment.create({
        data: {
          instanceId: webhook.instanceId || 'all',
          version: req.body.after || req.body.ref || 'unknown',
          status: 'pending',
          source: 'webhook',
          triggeredBy: `webhook:${webhook.id}`,
        },
      });

      // Update webhook stats
      await prisma.webhook.update({
        where: { id },
        data: {
          lastTriggered: new Date(),
          triggerCount: { increment: 1 },
        },
      });

      logger.info(`Webhook triggered: ${id}, deployment: ${deployment.id}`);

      res.json({
        message: 'Deployment triggered',
        deploymentId: deployment.id,
      });
    } catch (error) {
      logger.error('Error triggering webhook:', error);
      res.status(500).json({ error: 'Failed to trigger deployment' });
    }
  });

  // ============ DEPLOYMENTS ============

  /**
   * GET /api/deployments
   * List deployments
   */
  router.get('/', requireAdmin, async (req: Request, res: Response) => {
    try {
      const { instanceId, status, limit = '50' } = req.query;

      const where: any = {};
      if (instanceId) where.instanceId = instanceId;
      if (status) where.status = status;

      const deployments = await prisma.deployment.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        take: parseInt(limit as string, 10),
      });

      res.json({ deployments });
    } catch (error) {
      logger.error('Error listing deployments:', error);
      res.status(500).json({ error: 'Failed to list deployments' });
    }
  });

  /**
   * POST /api/deployments
   * Trigger a manual deployment
   */
  router.post(
    '/',
    requireAdmin,
    auditLog('DEPLOYMENT_MANUAL_TRIGGER', {
      includeBody: true,
      getResource: (req) => req.body.instanceId,
    }),
    async (req: Request, res: Response): Promise<any> => {
      try {
        const user = (req as any).user;
        const { instanceId, version } = req.body;

        if (!instanceId) {
          return res.status(400).json({ error: 'instanceId is required' });
        }

        const deployment = await prisma.deployment.create({
          data: {
            instanceId,
            version,
            status: 'pending',
            source: 'manual',
            triggeredBy: user.id,
          },
        });

        logger.info(`Manual deployment triggered: ${deployment.id} by ${user.id}`);

        res.status(201).json(deployment);
      } catch (error) {
        logger.error('Error creating deployment:', error);
        res.status(500).json({ error: 'Failed to create deployment' });
      }
    }
  );

  /**
   * GET /api/deployments/:id
   * Get deployment details
   */
  router.get('/:id', requireAdmin, async (req: Request, res: Response): Promise<any> => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: 'Invalid deployment ID' });
      }

      const deployment = await prisma.deployment.findUnique({ where: { id } });

      if (!deployment) {
        return res.status(404).json({ error: 'Deployment not found' });
      }

      res.json(deployment);
    } catch (error) {
      logger.error('Error getting deployment:', error);
      res.status(500).json({ error: 'Failed to get deployment' });
    }
  });

  /**
   * POST /api/deployments/:id/rollback
   * Rollback to a previous deployment
   */
  router.post(
    '/:id/rollback',
    requireAdmin,
    auditLog('DEPLOYMENT_ROLLBACK', {
      getResource: (req) => req.params.id,
    }),
    async (req: Request, res: Response): Promise<any> => {
      try {
        const user = (req as any).user;
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
          return res.status(400).json({ error: 'Invalid deployment ID' });
        }

        const targetDeployment = await prisma.deployment.findUnique({ where: { id } });
        if (!targetDeployment) {
          return res.status(404).json({ error: 'Deployment not found' });
        }

        // Create rollback deployment
        const rollback = await prisma.deployment.create({
          data: {
            instanceId: targetDeployment.instanceId,
            version: targetDeployment.version,
            status: 'pending',
            source: 'manual',
            triggeredBy: user.id,
            rollbackOf: id,
          },
        });

        logger.info(`Rollback triggered: ${rollback.id} rolling back to ${id}`);

        res.status(201).json({
          message: 'Rollback initiated',
          deployment: rollback,
          rollingBackTo: targetDeployment,
        });
      } catch (error) {
        logger.error('Error creating rollback:', error);
        res.status(500).json({ error: 'Failed to create rollback' });
      }
    }
  );

  /**
   * GET /api/deployments/stats
   * Get deployment statistics
   */
  router.get('/stats/overview', requireAdmin, async (_req: Request, res: Response) => {
    try {
      const [total, pending, running, success, failed] = await Promise.all([
        prisma.deployment.count(),
        prisma.deployment.count({ where: { status: 'pending' } }),
        prisma.deployment.count({ where: { status: 'running' } }),
        prisma.deployment.count({ where: { status: 'success' } }),
        prisma.deployment.count({ where: { status: 'failed' } }),
      ]);

      const webhookCount = await prisma.webhook.count({ where: { enabled: true } });

      res.json({
        deployments: { total, pending, running, success, failed },
        webhooks: { active: webhookCount },
      });
    } catch (error) {
      logger.error('Error getting deployment stats:', error);
      res.status(500).json({ error: 'Failed to get statistics' });
    }
  });

  return router;
}
