import { Router, Request, Response } from 'express';
import BackupService from '../services/BackupService';
import { logger } from '../utils/logger';
import { validate } from '../middleware/validate';
import { CreateBackupSchema } from '../middleware/schemas';
import { auditLog } from '../middleware/auditLog';

import { requireAuth } from '../middleware/auth';

export function createBackupRoutes() {
  const router = Router();

  /**
   * POST /api/backups
   * Create a new backup
   */
  router.post(
    '/',
    requireAuth,
    validate(CreateBackupSchema),
    auditLog('BACKUP_CREATE', {
      includeBody: true,
      getResource: (req) => req.body.instanceId || req.body.name || 'FULL_BACKUP',
    }),
    async (req: Request, res: Response): Promise<any> => {
      try {
        const { type, instanceId, name } = req.body;
        const user = (req as any).user;

        // Validation is now handled by Zod middleware
        if (type === 'instance' && !instanceId) {
          return res.status(400).json({ error: 'Instance ID is required for instance backup' });
        }

        const backup = await BackupService.createBackup({
          type,
          instanceId,
          name,
          createdBy: user.id,
        });

        res.json(backup);
      } catch (error) {
        logger.error('Error in create backup route:', error);
        res.status(500).json({
          error: error instanceof Error ? error.message : 'Failed to create backup',
        });
      }
    }
  );

  // ... (LIST routes unchanged) ...

  /**
   * GET /api/backups
   * List all backups
   */
  router.get('/', requireAuth, async (req: Request, res: Response) => {
    try {
      const { type } = req.query;

      const backups = await BackupService.listBackups(type as string);
      res.json(backups);
    } catch (error) {
      logger.error('Error in list backups route:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to list backups',
      });
    }
  });

  /**
   * GET /api/backups/:id
   * Get backup by ID
   */
  router.get('/:id', requireAuth, async (req: Request, res: Response): Promise<any> => {
    try {
      const backup = await BackupService.getBackup(req.params.id);

      if (!backup) {
        return res.status(404).json({ error: 'Backup not found' });
      }

      res.json(backup);
    } catch (error) {
      logger.error('Error in get backup route:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to get backup',
      });
    }
  });

  /**
   * GET /api/backups/:id/preview
   * Preview what's in a backup (before restoring)
   */
  router.get('/:id/preview', requireAuth, async (req: Request, res: Response): Promise<any> => {
    try {
      const backup = await BackupService.getBackup(req.params.id);

      if (!backup) {
        return res.status(404).json({ error: 'Backup not found' });
      }

      // Return preview information
      const preview = {
        id: backup.id,
        name: backup.name,
        type: backup.type,
        instanceId: backup.instanceId,
        size: backup.size,
        createdAt: backup.createdAt,
        path: backup.path,
        contents: {
          database: backup.type === 'full' || backup.type === 'database',
          volumes: backup.type === 'full' || backup.type === 'instance',
          config: backup.type === 'full',
        },
        warnings: [
          'Restoring will overwrite current data',
          backup.type === 'full'
            ? 'All services will be affected'
            : `Only ${backup.type} data will be restored`,
        ],
      };

      res.json(preview);
    } catch (error) {
      logger.error('Error in preview backup route:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to preview backup',
      });
    }
  });

  /**
   * POST /api/backups/:id/restore
   * Restore from backup
   */
  router.post(
    '/:id/restore',
    requireAuth,
    auditLog('BACKUP_RESTORE', {
      getResource: (req) => req.params.id,
      includeBody: true,
    }),
    async (req: Request, res: Response): Promise<any> => {
      try {
        const user = (req as any).user;

        // Only admins can restore
        if (user.role !== 'admin') {
          return res.status(403).json({ error: 'Only admins can restore backups' });
        }

        const { instanceId } = req.body;

        const result = await BackupService.restoreBackup({
          backupId: req.params.id,
          instanceId,
        });

        res.json(result);
      } catch (error) {
        logger.error('Error in restore backup route:', error);
        res.status(500).json({
          error: error instanceof Error ? error.message : 'Failed to restore backup',
        });
      }
    }
  );

  /**
   * DELETE /api/backups/:id
   * Delete backup
   */
  router.delete(
    '/:id',
    requireAuth,
    auditLog('BACKUP_DELETE'),
    async (req: Request, res: Response): Promise<any> => {
      try {
        const user = (req as any).user;

        // Only admins can delete backups
        if (user.role !== 'admin') {
          return res.status(403).json({ error: 'Only admins can delete backups' });
        }

        await BackupService.deleteBackup(req.params.id);

        res.json({ message: 'Backup deleted successfully' });
      } catch (error) {
        logger.error('Error in delete backup route:', error);
        res.status(500).json({
          error: error instanceof Error ? error.message : 'Failed to delete backup',
        });
      }
    }
  );

  return router;
}
