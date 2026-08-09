import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { CreateInstanceRequest } from '../types';
import InstanceManager from '../services/InstanceManager';
import DockerManager from '../services/DockerManager';
import MetricsCollector from '../services/MetricsCollector';
import { UpdateService } from '../services/UpdateService';
import { logger } from '../utils/logger';
import { validate } from '../middleware/validate';
import {
  CreateInstanceSchema,
  UpdateResourceLimitsSchema,
  CloneInstanceSchema,
} from '../middleware/schemas';
import { auditLog } from '../middleware/auditLog';
import { requireViewer, requireUser, requireAdmin, requireOrgRole } from '../middleware/authMiddleware';
import { requireAuth } from '../middleware/auth';
import { requireScope } from '../middleware/requireScope';
import { SCOPES } from '../constants/scopes';

export function createInstanceRoutes(
  instanceManager: InstanceManager,
  dockerManager: DockerManager,
  prisma: PrismaClient,
  metricsCollector?: MetricsCollector,
  updateService?: UpdateService
): Router {
  const router = Router();

  /**
   * Helper: Verify that the instance identified by req.params.name belongs
   * to the org specified in X-Org-Id. Returns 404 if not found.
   * Global admins can always access any instance regardless of org.
   */
  const verifyInstanceOrg = async (req: Request, res: Response): Promise<boolean> => {
    const orgId = (req as any).orgId as string | undefined;
    const name = req.params.name;
    const isAdmin = (req as any).user?.role === 'admin';

    // Admin → always allowed
    if (isAdmin) return true;
    if (!name) return true;

    const record = await prisma.instance.findFirst({ where: { name, orgId } });
    if (!record) {
      res.status(404).json({ error: 'Instance not found in this organisation' });
      return false;
    }
    return true;
  };

  /**
   * GET /api/instances
   * List instances scoped to the active organisation.
   * Global admins without X-Org-Id see ALL instances (including unassigned).
   * Global admins with X-Org-Id see that org's instances + unassigned ones.
   * Org members see only their org's instances.
   */
  router.get('/', requireViewer, requireOrgRole('viewer'), requireScope(SCOPES.INSTANCES.READ), async (req: Request, res: Response) => {
    try {
      const orgId = (req as any).orgId as string | undefined;
      const isAdmin = req.user?.role === 'admin';

      // Get all instances from filesystem
      const allInstances = await instanceManager.listInstances();

      // Enrich all instances with environment label from DB
      const allEnvRecords = await prisma.instance.findMany({ select: { name: true, environment: true } });
      const envLabelMap = new Map(allEnvRecords.map((r) => [r.name, r.environment ?? null]));
      allInstances.forEach((inst) => { (inst as any).environment = envLabelMap.get(inst.name) ?? null; });

      // Admin with no org header → return everything
      if (isAdmin && !orgId) {
        // Enrich with orgId + orgName from DB
        const allDbRecords = await prisma.instance.findMany({
          select: { name: true, orgId: true },
        });
        const orgIds = [...new Set(allDbRecords.map((r) => r.orgId).filter(Boolean) as string[])];
        const orgNameMap = new Map<string, string>();
        if (orgIds.length > 0) {
          const orgs = await prisma.organisation.findMany({
            where: { id: { in: orgIds } },
            select: { id: true, name: true },
          });
          orgs.forEach((o) => orgNameMap.set(o.id, o.name));
        }
        const orgInfoMap = new Map(
          allDbRecords.map((r) => [
            r.name,
            { orgId: r.orgId ?? null, orgName: r.orgId ? (orgNameMap.get(r.orgId) ?? null) : null },
          ])
        );
        allInstances.forEach((inst) => {
          const info = orgInfoMap.get(inst.name);
          (inst as any).orgId = info?.orgId ?? null;
          (inst as any).orgName = info?.orgName ?? null;
        });

        // Enrich with diskUsedMB in parallel
        if (metricsCollector) {
          await Promise.all(
            allInstances.map(async (inst) => {
              if (inst.metrics) {
                inst.metrics.diskUsedMB =
                  (await metricsCollector.getDiskUsageForInstance(inst.name)) ?? undefined;
              }
            })
          );
        }
        return res.json(allInstances);
      }

      // Get instance names that belong to this org from DB
      const whereClause: any = { orgId };
      const orgInstanceRecords = await prisma.instance.findMany({
        where: whereClause,
        select: { name: true },
      });
      const orgInstanceNames = new Set(orgInstanceRecords.map((r) => r.name));

      // Admin also sees instances with no org assigned yet (legacy / unassigned)
      if (isAdmin) {
        const unassigned = await prisma.instance.findMany({
          where: { orgId: null },
          select: { name: true },
        });
        unassigned.forEach((r) => orgInstanceNames.add(r.name));
      }

      // Filter to org (+ unassigned for admin) instances
      const instances = allInstances.filter((i) => orgInstanceNames.has(i.name));

      // Enrich with diskUsedMB in parallel
      if (metricsCollector) {
        await Promise.all(
          instances.map(async (inst) => {
            if (inst.metrics) {
              inst.metrics.diskUsedMB =
                (await metricsCollector.getDiskUsageForInstance(inst.name)) ?? undefined;
            }
          })
        );
      }

      return res.json(instances);
    } catch (error: any) {
      logger.error('Error listing instances:', error);
      return res.status(500).json({ error: error.message || 'Failed to list instances' });
    }
  });

  /**
   * POST /api/instances/bulk
   * Execute bulk actions on multiple instances (sequential execution)
   */
  router.post(
    '/bulk',
    requireUser,
    requireScope(SCOPES.INSTANCES.UPDATE),
    requireOrgRole('member'),
    auditLog('INSTANCE_BULK_ACTION', { includeBody: true }),
    async (req: Request, res: Response) => {
      try {
        const { action, instances: instanceNames } = req.body as {
          action: 'start' | 'stop' | 'restart';
          instances: string[];
        };

        if (!action || !['start', 'stop', 'restart'].includes(action)) {
          return res
            .status(400)
            .json({ error: 'Invalid action. Must be start, stop, or restart.' });
        }

        if (!instanceNames || !Array.isArray(instanceNames) || instanceNames.length === 0) {
          return res.status(400).json({ error: 'No instances provided.' });
        }

        const results: { name: string; success: boolean; message: string }[] = [];

        // Execute in parallel (limited by Promise.all, risky for huge batches but fine for typical usage)
        const promises = instanceNames.map(async (name) => {
          try {
            switch (action) {
              case 'start':
                await instanceManager.startInstance(name);
                break;
              case 'stop':
                await instanceManager.stopInstance(name, true);
                break;
              case 'restart':
                await instanceManager.restartInstance(name);
                break;
            }
            return { name, success: true, message: `${action} successful` };
          } catch (error: any) {
            logger.error(`Bulk ${action} failed for ${name}:`, error);
            return { name, success: false, message: error.message || `${action} failed` };
          }
        });

        const batchResults = await Promise.all(promises);
        results.push(...batchResults);

        const successCount = results.filter((r) => r.success).length;
        const failCount = results.filter((r) => !r.success).length;

        return res.json({
          message: `Bulk ${action}: ${successCount} succeeded, ${failCount} failed`,
          results,
        });
      } catch (error: any) {
        logger.error('Error executing bulk action:', error);
        return res.status(500).json({ error: error.message || 'Failed to execute bulk action' });
      }
    }
  );

  /**
   * GET /api/instances/:name
   * Get a specific instance by name.
   * Admins can open any instance regardless of org assignment.
   * Non-admins: instance must belong to their active org.
   */
  router.get('/:name', requireViewer, requireOrgRole('viewer'), requireScope(SCOPES.INSTANCES.READ), async (req: Request, res: Response) => {
    try {
      const { name } = req.params;
      const orgId = (req as any).orgId as string | undefined;
      const isAdmin = req.user?.role === 'admin';

      if (!isAdmin) {
        // Non-admin: instance must belong to their org
        const dbInstance = await prisma.instance.findFirst({ where: { name, orgId } });
        if (!dbInstance) {
          return res.status(404).json({ error: 'Instance not found in this organisation' });
        }
      }
      // Admin: no org-filter — can open any instance

      const instances = await instanceManager.listInstances();
      const instance = instances.find((i) => i.name === name);

      if (!instance) {
        return res.status(404).json({ error: 'Instance not found' });
      }

      // Enrich with diskUsedMB from MetricsCollector (cached, fast)
      if (metricsCollector && instance.metrics) {
        instance.metrics.diskUsedMB =
          (await metricsCollector.getDiskUsageForInstance(name)) ?? undefined;
      }

      // Enrich with environment label and orgId from DB
      const dbRecord = await prisma.instance.findFirst({ where: { name }, select: { environment: true, orgId: true } });
      (instance as any).environment = dbRecord?.environment ?? null;
      (instance as any).orgId = dbRecord?.orgId ?? null;

      return res.json(instance);
    } catch (error: any) {
      logger.error(`Error getting instance ${req.params.name}:`, error);
      return res.status(500).json({ error: error.message || 'Failed to get instance' });
    }
  });

  /**
   * POST /api/instances
   * Create a new instance (assigned to the active organisation)
   */
  router.post(
    '/',
    requireUser,
    requireScope(SCOPES.INSTANCES.CREATE),
    requireOrgRole('member'),
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

          // Merge: Template provides defaults, request-level fields take priority
          const mergedEnv = { ...(templateConfig.env || {}), ...(createRequest.env || {}) };
          createRequest = {
            ...templateConfig,
            ...createRequest,
            env: mergedEnv,
            resourceLimits: createRequest.resourceLimits || templateConfig.resourceLimits,
            extensions: createRequest.extensions || templateConfig.extensions,
            initSql: createRequest.initSql || templateConfig.initSql,
            environment: createRequest.environment || templateConfig.environment,
          };
        }

        // Validation is now handled by Zod middleware
        const instance = await instanceManager.createInstance(createRequest);

        // Assign instance to active organisation
        const orgId = (req as any).orgId as string | undefined;
        if (orgId) {
          try {
            await prisma.instance.updateMany({
              where: { name: instance.name },
              data: { orgId },
            });
          } catch (orgErr) {
            logger.warn(`Failed to set orgId for instance ${instance.name}:`, orgErr);
          }
        }

        // Apply Template Overrides (Post-Processing): env overrides
        const hasEnvOverrides =
          createRequest.env && Object.keys(createRequest.env).length > 0;
        if (hasEnvOverrides) {
          await instanceManager.applyTemplateConfig(instance.name, createRequest);
        }

        // Set environment label on DB record
        if (createRequest.environment) {
          try {
            await prisma.instance.updateMany({
              where: { name: instance.name },
              data: { environment: createRequest.environment },
            });
          } catch (envErr) {
            logger.warn(`Failed to set environment for instance ${instance.name}:`, envErr);
          }
        }

        // Auto-install extensions if specified
        if (createRequest.extensions && createRequest.extensions.length > 0) {
          for (const extensionId of createRequest.extensions) {
            try {
              const extension = await prisma.extension.findUnique({ where: { id: extensionId } });
              if (extension) {
                await prisma.installedExtension.create({
                  data: {
                    instanceId: instance.id,
                    extensionId: extension.id,
                    version: extension.version,
                    status: 'active',
                  },
                });
                logger.info(`Auto-installed extension ${extensionId} on ${instance.name}`);
              }
            } catch (extErr) {
              logger.warn(`Failed to auto-install extension ${extensionId}:`, extErr);
            }
          }
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
  router.delete(
    '/:name',
    requireUser,
    requireScope(SCOPES.INSTANCES.DELETE),
    requireOrgRole('admin'),
    auditLog('INSTANCE_DELETE'),
    async (req: Request, res: Response) => {
      try {
        const { name } = req.params;
        if (!(await verifyInstanceOrg(req, res))) return;

        const { removeVolumes } = req.query;

        await instanceManager.deleteInstance(name, removeVolumes === 'true');
        res.json({ message: `Instance ${name} deleted successfully` });
      } catch (error: any) {
        logger.error(`Error deleting instance ${req.params.name}:`, error);
        res.status(500).json({ error: error.message || 'Failed to delete instance' });
      }
    }
  );

  /**
   * POST /api/instances/:name/start
   * Start an instance
   */
  router.post(
    '/:name/start',
    requireUser,
    requireScope(SCOPES.INSTANCES.START),
    requireOrgRole('member'),
    auditLog('INSTANCE_START'),
    async (req: Request, res: Response) => {
      try {
        const { name } = req.params;
        if (!(await verifyInstanceOrg(req, res))) return;
        await instanceManager.startInstance(name);
        res.json({ message: `Instance ${name} started successfully` });
      } catch (error: any) {
        logger.error(`Error starting instance ${req.params.name}:`, error);
        res.status(500).json({ error: error.message || 'Failed to start instance' });
      }
    }
  );

  /**
   * POST /api/instances/:name/stop
   * Stop an instance
   */
  router.post(
    '/:name/stop',
    requireUser,
    requireScope(SCOPES.INSTANCES.STOP),
    requireOrgRole('member'),
    auditLog('INSTANCE_STOP'),
    async (req: Request, res: Response) => {
      try {
        const { name } = req.params;
        if (!(await verifyInstanceOrg(req, res))) return;
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
    requireUser,
    requireScope(SCOPES.INSTANCES.RESTART),
    requireOrgRole('member'),
    auditLog('INSTANCE_RESTART'),
    async (req: Request, res: Response) => {
      try {
        const { name } = req.params;
        if (!(await verifyInstanceOrg(req, res))) return;
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
    requireUser,
    requireScope(SCOPES.INSTANCES.RESTART),
    requireOrgRole('member'),
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
   * POST /api/instances/:name/recreate
   * Recreate an instance (down + up) to apply config changes
   */
  router.post(
    '/:name/recreate',
    requireUser,
    requireScope(SCOPES.INSTANCES.UPDATE),
    requireOrgRole('member'),
    auditLog('INSTANCE_RECREATE'),
    async (req: Request, res: Response) => {
      try {
        const { name } = req.params;
        if (!(await verifyInstanceOrg(req, res))) return;
        await instanceManager.recreateInstance(name);
        res.json({ message: `Instance ${name} recreated successfully` });
      } catch (error: any) {
        logger.error(`Error recreating instance ${req.params.name}:`, error);
        res.status(500).json({ error: error.message || 'Failed to recreate instance' });
      }
    }
  );

  /**
   * GET /api/instances/:name/image-updates
   * Return image status for this instance's tenant services only.
   */
  router.get(
    '/:name/image-updates',
    requireUser,
    requireOrgRole('member'),
    requireScope(SCOPES.INSTANCES.READ),
    async (req: Request, res: Response) => {
      try {
        if (!updateService) {
          res.status(503).json({ error: 'Tenant image updates are not available' });
          return;
        }
        if (!(await verifyInstanceOrg(req, res))) return;
        const forceRefresh = req.query.force === 'true';
        const status = await updateService.getTenantImageUpdateStatus(req.params.name, forceRefresh);
        res.json(status);
      } catch (error: any) {
        logger.error(`Error checking tenant images for ${req.params.name}:`, error);
        res.status(500).json({ error: error.message || 'Failed to check tenant images' });
      }
    }
  );

  /**
   * POST /api/instances/:name/image-updates
   * Manually update selected tenant services for this instance.
   */
  router.post(
    '/:name/image-updates',
    requireUser,
    requireOrgRole('member'),
    requireScope(SCOPES.INSTANCES.UPDATE),
    auditLog('INSTANCE_IMAGE_UPDATE', { includeBody: true }),
    async (req: Request, res: Response) => {
      try {
        if (!updateService) {
          res.status(503).json({ error: 'Tenant image updates are not available' });
          return;
        }
        if (!(await verifyInstanceOrg(req, res))) return;

        const instanceRecord = await prisma.instance.findUnique({
          where: { name: req.params.name },
          select: { id: true },
        });
        if (!instanceRecord) {
          res.status(404).json({ error: 'Instance not found' });
          return;
        }

        const { services, confirmSafetyGate, createBackup } = req.body as {
          services?: string[];
          confirmSafetyGate?: boolean;
          createBackup?: boolean;
        };
        if (!Array.isArray(services) || services.length === 0) {
          res.status(400).json({ error: 'At least one tenant service must be selected' });
          return;
        }
        if (confirmSafetyGate !== true) {
          res.status(409).json({
            error: 'Security and maintenance approval are required before starting the image update.',
          });
          return;
        }
        if (updateService.isInProgress) {
          res.status(423).json({ error: 'An update is already in progress' });
          return;
        }

        res.status(202).json({
          success: true,
          message: `Tenant image update started for ${req.params.name}`,
          services,
        });
        updateService
          .performTenantDockerUpdate(req.params.name, services, {
            confirmSafetyGate: true,
            createBackup: createBackup !== false,
            backupInstanceId: instanceRecord.id,
            requestedBy: String((req as any).user?.id || 'admin'),
          })
          .catch((error: Error) => logger.error(`Tenant image update failed for ${req.params.name}:`, error));
      } catch (error: any) {
        logger.error(`Error starting tenant image update for ${req.params.name}:`, error);
        res.status(500).json({ error: error.message || 'Failed to start tenant image update' });
      }
    }
  );

  /**
   * POST /api/instances/:name/image-updates/rollback
   * Manually restore the recorded previous image for selected tenant services.
   */
  router.post(
    '/:name/image-updates/rollback',
    requireUser,
    requireOrgRole('member'),
    requireScope(SCOPES.INSTANCES.UPDATE),
    auditLog('INSTANCE_IMAGE_ROLLBACK', { includeBody: true }),
    async (req: Request, res: Response) => {
      try {
        if (!updateService) {
          res.status(503).json({ error: 'Tenant image rollbacks are not available' });
          return;
        }
        if (!(await verifyInstanceOrg(req, res))) return;
        const instanceRecord = await prisma.instance.findUnique({
          where: { name: req.params.name },
          select: { id: true },
        });
        if (!instanceRecord) {
          res.status(404).json({ error: 'Instance not found' });
          return;
        }

        const { services, confirmSafetyGate, createBackup } = req.body as {
          services?: string[];
          confirmSafetyGate?: boolean;
          createBackup?: boolean;
        };
        if (!Array.isArray(services) || services.length === 0) {
          res.status(400).json({ error: 'At least one tenant service must be selected' });
          return;
        }
        if (confirmSafetyGate !== true) {
          res.status(409).json({ error: 'Maintenance confirmation is required before rollback.' });
          return;
        }
        if (updateService.isInProgress) {
          res.status(423).json({ error: 'An update is already in progress' });
          return;
        }

        res.status(202).json({
          success: true,
          message: `Tenant image rollback started for ${req.params.name}`,
          services,
        });
        updateService.performTenantDockerRollback(req.params.name, services, {
          confirmSafetyGate: true,
          createBackup: createBackup !== false,
          backupInstanceId: instanceRecord.id,
          requestedBy: String((req as any).user?.id || 'admin'),
        }).catch((error: Error) =>
          logger.error(`Tenant image rollback failed for ${req.params.name}:`, error)
        );
      } catch (error: any) {
        logger.error(`Error starting tenant image rollback for ${req.params.name}:`, error);
        res.status(500).json({ error: error.message || 'Failed to start tenant image rollback' });
      }
    }
  );

  /**
   * PUT /api/instances/:name/credentials
   * Update instance credentials
   */
  router.put(
    '/:name/credentials',
    requireUser,
    requireScope(SCOPES.INSTANCES.UPDATE),
    requireOrgRole('admin'),
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
  router.get('/:name/services', requireViewer, requireOrgRole('viewer'), requireScope(SCOPES.INSTANCES.READ), async (req: Request, res: Response) => {
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
    requireUser,
    requireScope(SCOPES.INSTANCES.UPDATE),
    requireOrgRole('admin'),
    auditLog('INSTANCE_UPDATE_SMTP', { includeBody: true }),
    async (req: Request, res: Response) => {
      try {
        const { name } = req.params;
        const { smtp_host, smtp_port, smtp_user, smtp_pass, smtp_sender_name, smtp_admin_email } =
          req.body;

        // Construct env updates
        const configUpdates: Record<string, string> = {};

        if (smtp_host !== undefined) configUpdates.SMTP_HOST = smtp_host;
        if (smtp_port !== undefined) configUpdates.SMTP_PORT = String(smtp_port);
        if (smtp_user !== undefined) configUpdates.SMTP_USER = smtp_user;
        if (smtp_pass !== undefined && smtp_pass !== '********') configUpdates.SMTP_PASS = smtp_pass;
        if (smtp_sender_name !== undefined) configUpdates.SMTP_SENDER_NAME = smtp_sender_name;
        if (smtp_admin_email !== undefined) configUpdates.SMTP_ADMIN_EMAIL = smtp_admin_email;

        await instanceManager.updateInstanceConfig(name, configUpdates);

        res.json({ message: 'Instance SMTP settings updated' });
      } catch (error: any) {
        logger.error(`Error updating SMTP settings for ${req.params.name}:`, error);
        res.status(500).json({ error: error.message || 'Failed to update settings' });
      }
    }
  );

  /**
   * GET /api/instances/:name/env
   * Get instance environment variables
   */
  router.get('/:name/env', requireViewer, requireOrgRole('viewer'), requireScope(SCOPES.INSTANCES.READ), async (req: Request, res: Response) => {
    try {
      const { name } = req.params;
      const { keys } = req.query; // Optional: comma-separated list of keys to fetch

      // We need to expose a method in InstanceManager to get raw env
      // But we can use parseEnvFile through a new method or expose it
      // For now, let's assume we implement `getInstanceConfig` in InstanceManager
      const config = await instanceManager.getInstanceEnv(name);

      if (!config) {
        return res.status(404).json({ error: 'Instance config not found' });
      }

      // Filter keys if requested
      if (keys) {
        const requestedKeys = (keys as string).split(',');
        const filteredConfig: Record<string, string> = {};
        requestedKeys.forEach((key) => {
          if (config[key] !== undefined) {
            filteredConfig[key] = config[key];
          }
        });
        return res.json(filteredConfig);
      }

      // Security: Filter out highly sensitive keys if needed?
      // Admin should see everything usually.
      return res.json(config);
    } catch (error: any) {
      logger.error(`Error getting env for ${req.params.name}:`, error);
      return res.status(500).json({ error: error.message || 'Failed to get env' });
    }
  });

  /**
   * PUT /api/instances/:name/env
   * Update instance environment variables directly
   */
  router.put(
    '/:name/env',
    requireUser,
    requireScope(SCOPES.INSTANCES.UPDATE),
    requireOrgRole('admin'),
    auditLog('INSTANCE_UPDATE_ENV', { includeBody: true }),
    async (req: Request, res: Response) => {
      try {
        const { name } = req.params;
        const configUpdates = req.body; // Expects Record<string, string>

        await instanceManager.updateInstanceConfig(name, configUpdates);

        res.json({ message: 'Instance configuration updated' });
      } catch (error: any) {
        logger.error(`Error updating env for ${req.params.name}:`, error);
        res.status(500).json({ error: error.message || 'Failed to update env' });
      }
    }
  );

  /**
   * PUT /api/instances/:name/resources
   * Update instance resource limits
   */
  router.put(
    '/:name/resources',
    requireUser,
    requireScope(SCOPES.INSTANCES.UPDATE),
    requireOrgRole('admin'),
    validate(UpdateResourceLimitsSchema),
    auditLog('INSTANCE_UPDATE_RESOURCES', { includeBody: true }),
    async (req: Request, res: Response) => {
      try {
        const { name } = req.params;
        const { resourceLimits } = req.body;

        const result = await instanceManager.updateInstanceResources(name, resourceLimits);

        res.json({
          message: 'Resource limits updated. Restart the instance to apply changes.',
          ...result,
        });
      } catch (error: any) {
        logger.error(`Error updating resources for ${req.params.name}:`, error);
        res.status(500).json({ error: error.message || 'Failed to update resources' });
      }
    }
  );

  /**
   * POST /api/instances/:name/clone
   * Clone an existing instance with a new name
   */
  router.post(
    '/:name/clone',
    requireUser,
    requireScope(SCOPES.INSTANCES.CREATE),
    requireOrgRole('member'),
    validate(CloneInstanceSchema),
    auditLog('INSTANCE_CLONE', { includeBody: true }),
    async (req: Request, res: Response) => {
      try {
        const { name } = req.params;
        const { newName, copyEnv } = req.body;

        logger.info(`Cloning instance ${name} to ${newName}`);
        const clonedInstance = await instanceManager.cloneInstance(name, newName, { copyEnv });

        res.status(201).json({
          message: `Instance ${name} successfully cloned to ${newName}`,
          instance: clonedInstance,
        });
      } catch (error: any) {
        logger.error(`Error cloning instance ${req.params.name}:`, error);
        res.status(500).json({ error: error.message || 'Failed to clone instance' });
      }
    }
  );

  /**
   * GET /api/instances/:name/schema
   * Get database schema for an instance
   */
  router.get('/:name/schema', requireViewer, requireOrgRole('viewer'), requireScope(SCOPES.INSTANCES.READ), async (req: Request, res: Response) => {
    try {
      const { name } = req.params;
      logger.info(`Getting schema for instance ${name}`);
      const schema = await instanceManager.getSchema(name);
      res.json({ tables: schema });
    } catch (error: any) {
      logger.error(`Error getting schema for ${req.params.name}:`, error);
      res.status(500).json({ error: error.message || 'Failed to get schema' });
    }
  });

  /**
   * POST /api/instances/:name/sql
   * Execute SQL query on an instance
   */
  router.post(
    '/:name/sql',
    requireAuth,
    requireScope(SCOPES.INSTANCES.UPDATE),
    requireOrgRole('admin'),
    auditLog('SQL_EXECUTE', { includeBody: false }),
    async (req: Request, res: Response) => {
      try {
        const { name } = req.params;
        const { query } = req.body;

        if (!query || typeof query !== 'string') {
          res.status(400).json({ error: 'SQL query is required' });
          return;
        }

        logger.info(`Executing SQL for instance ${name}`);
        const result = await instanceManager.executeSQL(name, query);

        if (result.error) {
          res.status(400).json({ error: result.error, rows: [] });
          return;
        }

        res.json(result);
      } catch (error: any) {
        logger.error(`Error executing SQL for ${req.params.name}:`, error);
        res.status(500).json({ error: error.message || 'Failed to execute SQL' });
      }
    }
  );

  /**
   * PATCH /api/instances/:name/environment
   * Set or clear the environment label of an instance.
   * Body: { environment: 'production' | 'staging' | 'dev' | 'preview' | null }
   */
  router.patch(
    '/:name/environment',
    requireUser,
    requireScope(SCOPES.INSTANCES.UPDATE),
    auditLog('INSTANCE_SET_ENVIRONMENT', { includeBody: true }),
    async (req: Request, res: Response): Promise<any> => {
      try {
        const { name } = req.params;
        const { environment } = req.body as { environment: string | null };

        const VALID_ENVS = ['production', 'staging', 'dev', 'preview', null];
        if (!VALID_ENVS.includes(environment)) {
          return res.status(400).json({
            error: `Invalid environment. Must be one of: ${VALID_ENVS.filter(Boolean).join(', ')}, or null`,
          });
        }

        const updated = await prisma.instance.updateMany({
          where: { name },
          data: { environment: environment ?? null },
        });

        if (updated.count === 0) {
          return res.status(404).json({ error: 'Instance not found in database' });
        }

        return res.json({ success: true, name, environment: environment ?? null });
      } catch (error: any) {
        logger.error(`Error setting environment for instance ${req.params.name}:`, error);
        return res.status(500).json({ error: error.message || 'Failed to set environment label' });
      }
    }
  );

  /**
   * PATCH /api/instances/:name/assign-org
   * Admin-only: assign (or unassign) an existing instance to/from an organisation.
   * Body: { orgId: string | null }
   */
  router.patch(
    '/:name/assign-org',
    requireAdmin,
    requireScope(SCOPES.INSTANCES.UPDATE),
    auditLog('INSTANCE_ASSIGN_ORG', { includeBody: true }),
    async (req: Request, res: Response): Promise<any> => {
      try {
        const { name } = req.params;
        const { orgId } = req.body as { orgId: string | null };

        // Validate org exists (if setting one)
        if (orgId) {
          const org = await prisma.organisation.findUnique({ where: { id: orgId } });
          if (!org) return res.status(404).json({ error: 'Organisation not found' });
        }

        const updated = await prisma.instance.updateMany({
          where: { name },
          data: { orgId: orgId ?? null },
        });

        if (updated.count === 0) {
          return res.status(404).json({ error: 'Instance not found in database' });
        }

        return res.json({ success: true, name, orgId: orgId ?? null });
      } catch (error: any) {
        logger.error(`Error assigning org for instance ${req.params.name}:`, error);
        return res.status(500).json({ error: error.message || 'Failed to assign org' });
      }
    }
  );

  return router;
}
