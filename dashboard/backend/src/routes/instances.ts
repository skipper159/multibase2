import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { CreateInstanceRequest } from '../types';
import InstanceManager from '../services/InstanceManager';
import DockerManager from '../services/DockerManager';
import { logger } from '../utils/logger';
import { validate } from '../middleware/validate';
import { CreateInstanceSchema } from '../middleware/schemas';
import { auditLog } from '../middleware/auditLog';
import { requireAuth } from '../middleware/auth';

export function createInstanceRoutes(
  instanceManager: InstanceManager,
  dockerManager: DockerManager,
  prisma: PrismaClient
): Router {
  const router = Router();

  /**
   * GET /api/instances
   * List all instances
   */
  router.get('/', requireAuth, async (req: Request, res: Response) => {
    try {
      const instances = await instanceManager.listInstances();
      res.json(instances);
    } catch (error: any) {
      logger.error('Error listing instances:', error);
      res.status(500).json({ error: error.message || 'Failed to list instances' });
    }
  });

  /**
   * GET /api/instances/:name
   * Get a specific instance by name
   */
  router.get('/:name', requireAuth, async (req: Request, res: Response) => {
    try {
      const { name } = req.params;
      const instances = await instanceManager.listInstances();
      const instance = instances.find((i) => i.name === name);

      if (!instance) {
        return res.status(404).json({ error: 'Instance not found' });
      }

      res.json(instance);
    } catch (error: any) {
      logger.error(`Error getting instance ${req.params.name}:`, error);
      res.status(500).json({ error: error.message || 'Failed to get instance' });
    }
  });

  /**
   * POST /api/instances
   * Create a new instance
   */
  router.post(
    '/',
    requireAuth,
    validate(CreateInstanceSchema),
    auditLog('INSTANCE_CREATE', { includeBody: true }),
    async (req: Request, res: Response): Promise<any> => {
      try {
        let createRequest: CreateInstanceRequest = req.body;
        const user = (req as any).user;

        // Handle Template
        if (createRequest.templateId) {
          const template = await prisma.instanceTemplate.findUnique({
            where: { id: createRequest.templateId },
          });

          if (!template) {
            return res.status(404).json({ error: 'Template not found' });
          }

          // Access check
          if (!template.isPublic && template.createdBy !== user.id && user.role !== 'admin') {
            return res.status(403).json({ error: 'Access denied to this template' });
          }

          const templateConfig = JSON.parse(template.config);

          // Merge: Template Config < Request Overrides
          createRequest = {
            ...templateConfig,
            ...createRequest,
          };

          // Ensure basePort is unique/handled by manager if not provided?
          // The manager handles it if not provided? instanceManager.createInstance checks it.
        }

        // Validation is now handled by Zod middleware
        const instance = await instanceManager.createInstance(createRequest);

        // Apply Template Overrides (Post-Processing)
        // Only apply if there are actual services or env overrides
        const hasServiceOverrides = (createRequest as any).services?.length > 0;
        const hasEnvOverrides =
          (createRequest as any).env && Object.keys((createRequest as any).env).length > 0;
        if (hasServiceOverrides || hasEnvOverrides) {
          await instanceManager.applyTemplateConfig(instance.name, createRequest);
        }

        res.status(201).json(instance);
      } catch (error: any) {
        logger.error('Error creating instance:', error);
        res.status(500).json({ error: error.message || 'Failed to create instance' });
      }
    }
  );

  /**
   * DELETE /api/instances/:name
   * Delete an instance
   */
  router.delete('/:name', auditLog('INSTANCE_DELETE'), async (req: Request, res: Response) => {
    try {
      const { name } = req.params;
      const { removeVolumes } = req.query;

      await instanceManager.deleteInstance(name, removeVolumes === 'true');
      res.json({ message: `Instance ${name} deleted successfully` });
    } catch (error: any) {
      logger.error(`Error deleting instance ${req.params.name}:`, error);
      res.status(500).json({ error: error.message || 'Failed to delete instance' });
    }
  });

  /**
   * POST /api/instances/:name/start
   * Start an instance
   */
  router.post('/:name/start', auditLog('INSTANCE_START'), async (req: Request, res: Response) => {
    try {
      const { name } = req.params;
      await instanceManager.startInstance(name);
      res.json({ message: `Instance ${name} started successfully` });
    } catch (error: any) {
      logger.error(`Error starting instance ${req.params.name}:`, error);
      res.status(500).json({ error: error.message || 'Failed to start instance' });
    }
  });

  /**
   * POST /api/instances/:name/stop
   * Stop an instance
   */
  router.post(
    '/:name/stop',
    requireAuth,
    auditLog('INSTANCE_STOP'),
    async (req: Request, res: Response) => {
      try {
        const { name } = req.params;
        const { keepVolumes } = req.query;

        await instanceManager.stopInstance(name, keepVolumes !== 'false');
        res.json({ message: `Instance ${name} stopped successfully` });
      } catch (error: any) {
        logger.error(`Error stopping instance ${req.params.name}:`, error);
        res.status(500).json({ error: error.message || 'Failed to stop instance' });
      }
    }
  );

  /**
   * POST /api/instances/:name/restart
   * Restart an instance
   */
  router.post(
    '/:name/restart',
    requireAuth,
    auditLog('INSTANCE_RESTART'),
    async (req: Request, res: Response) => {
      try {
        const { name } = req.params;
        await instanceManager.restartInstance(name);
        res.json({ message: `Instance ${name} restarted successfully` });
      } catch (error: any) {
        logger.error(`Error restarting instance ${req.params.name}:`, error);
        res.status(500).json({ error: error.message || 'Failed to restart instance' });
      }
    }
  );

  /**
   * POST /api/instances/:name/services/:service/restart
   * Restart a specific service
   */
  router.post(
    '/:name/services/:service/restart',
    requireAuth,
    auditLog('INSTANCE_SERVICE_RESTART', {
      getResource: (req) => `${req.params.name}:${req.params.service}`,
    }),
    async (req: Request, res: Response) => {
      try {
        const { name, service } = req.params;
        await dockerManager.restartService(name, service);
        res.json({ message: `Service ${service} in ${name} restarted successfully` });
      } catch (error: any) {
        logger.error(
          `Error restarting service ${req.params.service} in ${req.params.name}:`,
          error
        );
        res.status(500).json({ error: error.message || 'Failed to restart service' });
      }
    }
  );

  /**
   * PUT /api/instances/:name/credentials
   * Update instance credentials
   */
  router.put(
    '/:name/credentials',
    requireAuth,
    auditLog('INSTANCE_UPDATE_CREDENTIALS', { includeBody: true }),
    async (req: Request, res: Response) => {
      try {
        const { name } = req.params;
        const { regenerateKeys } = req.body;

        const credentials = await instanceManager.updateCredentials(name, regenerateKeys);
        res.json(credentials);
      } catch (error: any) {
        logger.error(`Error updating credentials for ${req.params.name}:`, error);
        res.status(500).json({ error: error.message || 'Failed to update credentials' });
      }
    }
  );

  /**
   * GET /api/instances/:name/services
   * Get services status for an instance
   */
  router.get('/:name/services', requireAuth, async (req: Request, res: Response) => {
    try {
      const { name } = req.params;
      const services = await dockerManager.getServiceStatus(name);
      res.json(services);
    } catch (error) {
      logger.error(`Error getting services for ${req.params.name}:`, error);
      res.status(500).json({ error: 'Failed to get services' });
    }
  });

  /**
   * PUT /api/instances/:name/smtp
   * Update instance SMTP settings (override global)
   */
  router.put(
    '/:name/smtp',
    requireAuth,
    auditLog('INSTANCE_UPDATE_SMTP', { includeBody: true }),
    async (req: Request, res: Response) => {
      try {
        const { name } = req.params;
        const { smtp_host, smtp_port, smtp_user, smtp_pass, smtp_sender_name, smtp_admin_email } =
          req.body;

        // Construct env updates
        // We explicitly map config fields to SMTP_* env vars
        const configUpdates: Record<string, string> = {};

        if (smtp_host) configUpdates.SMTP_HOST = smtp_host;
        if (smtp_port) configUpdates.SMTP_PORT = String(smtp_port);
        if (smtp_user) configUpdates.SMTP_USER = smtp_user;
        if (smtp_pass && smtp_pass !== '********') configUpdates.SMTP_PASS = smtp_pass;
        if (smtp_sender_name) configUpdates.SMTP_SENDER_NAME = smtp_sender_name;
        if (smtp_admin_email) configUpdates.SMTP_ADMIN_EMAIL = smtp_admin_email;

        // If passing empty string, maybe we should remove the var?
        // For now, Supabase expects them to be set or uses defaults.
        // If we want to "reset" to global, we might need a flag.
        // But usually local .env takes precedence. If we want to use Global, we should remove them from .env.
        // Current implementation just sets them.

        await instanceManager.updateInstanceConfig(name, configUpdates);

        res.json({ message: 'Instance SMTP settings updated' });
      } catch (error: any) {
        logger.error(`Error updating SMTP settings for ${req.params.name}:`, error);
        res.status(500).json({ error: error.message || 'Failed to update settings' });
      }
    }
  );

  return router;
}
