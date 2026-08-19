/**
 * Update API Routes
 *
 * Admin-only endpoints for checking and triggering updates:
 *   GET  /api/updates/status    - Current version info + docker image states
 *   POST /api/updates/check     - Force re-check (bypass 5-min cache)
 *   POST /api/updates/multibase - Trigger Multibase git pull + rebuild
 *   POST /api/updates/docker    - Trigger Docker image pull for shared services
 *
 * Live progress is streamed via Socket.IO events:
 *   update:start, update:step, update:stepDone, update:log, update:complete, update:error
 */

import { Router, Request, Response } from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { UpdateService } from '../services/UpdateService';
import { requireAdmin } from '../middleware/authMiddleware';
import { auditLog } from '../middleware/auditLog';
import { logger } from '../utils/logger';
import { SHARED_SERVICES } from '../types';

const SOCKET_UPDATE_EVENTS = [
  'update:start',
  'update:step',
  'update:stepDone',
  'update:log',
  'update:backup',
  'update:serviceResult',
  'update:complete',
  'update:error',
] as const;

export function createUpdateRoutes(updateService: UpdateService, io: SocketIOServer): Router {
  const router = Router();

  // All update endpoints are admin-only
  router.use(requireAdmin);

  // Forward UpdateService events to all Socket.IO clients
  SOCKET_UPDATE_EVENTS.forEach((event) => {
    updateService.on(event, (data: unknown) => {
      io.emit(event, data);
    });
  });

  /**
   * GET /api/updates/status
   * Returns current Multibase version info and Docker image status.
   * Cached for 5 minutes; use POST /check to force a refresh.
   */
  router.get('/status', async (_req: Request, res: Response) => {
    try {
      const status = await updateService.getStatus();
      return res.json(status);
    } catch (error: any) {
      logger.error('Error fetching update status:', error);
      return res.status(500).json({ error: 'Failed to fetch update status' });
    }
  });

  /**
   * GET /api/updates/multibase/log
   * Returns the latest persisted Multibase web-update log.
   */
  router.get('/multibase/log', (_req: Request, res: Response) => {
    return res.json({ log: updateService.getMultibaseUpdateLog() });
  });

  /**
   * POST /api/updates/check
   * Bypasses the 5-minute cache and triggers a fresh check.
   */
  router.post('/check', async (_req: Request, res: Response) => {
    try {
      const status = await updateService.getStatus(true);
      return res.json(status);
    } catch (error: any) {
      logger.error('Error checking for updates:', error);
      return res.status(500).json({ error: 'Failed to check for updates' });
    }
  });

  /**
   * GET /api/updates/security-gate
   * Returns the current temporary image-update approval.
   */
  router.get('/security-gate', async (_req: Request, res: Response) => {
    try {
      return res.json(await updateService.getSecurityGateStatus());
    } catch (error) {
      logger.error('Error fetching image update security gate:', error);
      return res.status(500).json({ error: 'Failed to fetch image update security gate' });
    }
  });

  /**
   * POST /api/updates/security-gate/approve
   * Approves image updates for a short, bounded maintenance window.
   * Admin sessions must have completed 2FA.
   */
  router.post(
    '/security-gate/approve',
    auditLog('IMAGE_UPDATE_GATE_APPROVED', { includeBody: true }),
    async (req: Request, res: Response) => {
      try {
        if (!req.user?.twoFactorEnabled) {
          return res.status(403).json({
            error: 'Two-factor authentication must be enabled before approving image updates.',
          });
        }

        const durationMinutes = Number(req.body?.durationMinutes ?? 60);
        if (!Number.isFinite(durationMinutes)) {
          return res.status(400).json({ error: 'durationMinutes must be a number' });
        }

        const approval = await updateService.approveSecurityGate({
          userId: req.user.id,
          durationMinutes,
          reason: typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 500) : undefined,
        });
        return res.json(approval);
      } catch (error) {
        logger.error('Error approving image update security gate:', error);
        return res.status(500).json({ error: 'Failed to approve image update security gate' });
      }
    }
  );

  /**
   * POST /api/updates/security-gate/revoke
   * Revokes all active web approvals immediately.
   */
  router.post(
    '/security-gate/revoke',
    auditLog('IMAGE_UPDATE_GATE_REVOKED'),
    async (_req: Request, res: Response) => {
      try {
        return res.json(await updateService.revokeSecurityGate());
      } catch (error) {
        logger.error('Error revoking image update security gate:', error);
        return res.status(500).json({ error: 'Failed to revoke image update security gate' });
      }
    }
  );

  /**
   * POST /api/updates/multibase
   * Starts a Multibase self-update:
   *   git pull → npm ci (backend) → npm ci + build (frontend) → pm2 restart
   *
   * Returns immediately (202 Accepted). Progress comes via Socket.IO.
   * Returns 423 if an update is already running.
   */
  router.post(
    '/multibase',
    auditLog('MULTIBASE_UPDATE', {}),
    (req: Request, res: Response): void => {
      if (updateService.isInProgress) {
        res.status(423).json({ error: 'An update is already in progress' });
        return;
      }

      const { targetVersion } = req.body as { targetVersion?: string };

      // Respond before the update starts (the process will restart itself via PM2)
      res.status(202).json({
        success: true,
        message: targetVersion
          ? `Switching Multibase to v${targetVersion}`
          : 'Multibase update started',
        targetVersion: targetVersion ?? null,
      });

      updateService.performMultibaseUpdate(targetVersion).catch((err: Error) => {
        logger.error('Multibase update failed:', err);
      });
    }
  );

  /**
   * POST /api/updates/docker
   * Pulls the latest images for the specified shared services.
   * Body: { services?: string[] }  — if omitted, updates all shared services.
   *
   * Returns immediately (202 Accepted). Progress comes via Socket.IO.
   * Returns 423 if an update is already running.
   * Returns 400 if none of the requested services are valid.
   */
  router.post(
    '/docker',
    auditLog('DOCKER_UPDATE', { includeBody: true }),
    (req: Request, res: Response): void => {
      if (updateService.isInProgress) {
        res.status(423).json({ error: 'An update is already in progress' });
        return;
      }

      const { services, confirmSafetyGate, createBackup } = req.body as {
        services?: string[];
        confirmSafetyGate?: boolean;
        createBackup?: boolean;
      };
      const validServices = (SHARED_SERVICES as readonly string[]).filter(
        (service) => service !== 'multibase-db'
      );
      const toUpdate =
        Array.isArray(services) && services.length > 0
          ? services.filter((s) => validServices.includes(s))
          : [...validServices];

      if (toUpdate.length === 0) {
        res.status(400).json({
          error: 'No valid services specified',
          validServices,
        });
        return;
      }

      if (Array.isArray(services) && services.includes('multibase-db')) {
        res.status(409).json({
          error: 'PostgreSQL image updates require separate manual approval.',
          service: 'multibase-db',
        });
        return;
      }

      if (confirmSafetyGate !== true) {
        res.status(409).json({
          error: 'Security and maintenance approval are required before starting the image update.',
        });
        return;
      }

      res.status(202).json({
        success: true,
        message: `Docker update started for ${toUpdate.length} service(s)`,
        services: toUpdate,
      });

      updateService
        .performDockerUpdate(toUpdate, {
          confirmSafetyGate: true,
          createBackup: createBackup !== false,
          requestedBy: String((req as any).user?.id || 'admin'),
        })
        .catch((err: Error) => {
          logger.error('Docker update failed:', err);
        });
    }
  );

  /**
   * POST /api/updates/postgres
   * Manually update the shared PostgreSQL image after explicit confirmation.
   */
  router.post(
    '/postgres',
    auditLog('POSTGRES_IMAGE_UPDATE', { includeBody: true }),
    (req: Request, res: Response): void => {
      if (updateService.isInProgress) {
        res.status(423).json({ error: 'An update is already in progress' });
        return;
      }

      const { confirmSafetyGate, confirmPostgres, createBackup } = req.body as {
        confirmSafetyGate?: boolean;
        confirmPostgres?: boolean;
        createBackup?: boolean;
      };
      if (confirmSafetyGate !== true || confirmPostgres !== true) {
        res.status(409).json({
          error: 'Security approval and explicit PostgreSQL confirmation are required.',
        });
        return;
      }

      res.status(202).json({
        success: true,
        message: 'PostgreSQL image update started',
        services: ['multibase-db'],
      });

      updateService
        .performDockerUpdate(['multibase-db'], {
          confirmSafetyGate: true,
          allowPostgres: true,
          createBackup: createBackup !== false,
          requestedBy: String((req as any).user?.id || 'admin'),
        })
        .catch((err: Error) => {
          logger.error('PostgreSQL image update failed:', err);
        });
    }
  );

  return router;
}
