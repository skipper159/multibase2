import { Router, Request, Response } from 'express';
import BackupService from '../services/BackupService';
import { ExternalStorageService } from '../services/ExternalStorageService';
import prisma from '../lib/prisma';
import { logger } from '../utils/logger';
import { validate } from '../middleware/validate';
import { CreateBackupSchema } from '../middleware/schemas';
import { auditLog } from '../middleware/auditLog';
import { requireViewer, requireUser, requireAdmin } from '../middleware/authMiddleware';
import { requireScope } from '../middleware/requireScope';
import { SCOPES } from '../constants/scopes';

export function createBackupRoutes() {
  const router = Router();

  /**
   * POST /api/backups
   * Create a new backup
   */
  router.post(
    '/',
    requireUser,
    requireScope(SCOPES.BACKUPS.CREATE),
    validate(CreateBackupSchema),
    auditLog('BACKUP_CREATE', {
      includeBody: true,
      getResource: (req) => req.body.instanceId || req.body.name || 'FULL_BACKUP',
    }),
    async (req: Request, res: Response): Promise<any> => {
      try {
        const { type, instanceId, name, destinationIds } = req.body;
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
          destinationIds: Array.isArray(destinationIds) ? destinationIds : undefined,
        });

        res.locals.auditResource = backup.name;
        res.locals.auditDetails = {
          backupId: backup.id,
          backupName: backup.name,
          backupType: backup.type,
          instanceId: backup.instanceId,
          size: backup.size,
        };

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
  router.get('/', requireViewer, requireScope(SCOPES.BACKUPS.READ), async (req: Request, res: Response) => {
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
  router.get('/:id', requireViewer, requireScope(SCOPES.BACKUPS.READ), async (req: Request, res: Response): Promise<any> => {
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
   * GET /api/backups/:id/uploads
   * Get upload status for a specific backup
   */
  router.get('/:id/uploads', requireViewer, requireScope(SCOPES.BACKUPS.READ), async (req: Request, res: Response): Promise<any> => {
    try {
      const backup = await BackupService.getBackup(req.params.id);
      if (!backup) return res.status(404).json({ error: 'Backup not found' });

      const uploads = await prisma.backupUpload.findMany({
        where: { backupId: req.params.id },
        include: {
          destination: {
            select: { id: true, name: true, type: true },
          },
        },
        orderBy: { startedAt: 'asc' },
      });
      res.json(uploads);
    } catch (error) {
      logger.error('Error fetching backup uploads:', error);
      res.status(500).json({ error: 'Failed to fetch upload status' });
    }
  });

  /**
   * POST /api/backups/:id/upload
   * Manually upload a backup to one or more destinations
   */
  router.post(
    '/:id/upload',
    requireAdmin,
    requireScope(SCOPES.BACKUPS.UPLOAD),
    async (req: Request, res: Response): Promise<any> => {
      try {
        const backup = await BackupService.getBackup(req.params.id);
        if (!backup) return res.status(404).json({ error: 'Backup not found' });

        res.locals.auditResource = backup.name;
        res.locals.auditDetails = {
          backupId: backup.id,
          backupName: backup.name,
          backupType: backup.type,
        };

        const { destinationIds } = req.body;
        if (!Array.isArray(destinationIds) || destinationIds.length === 0) {
          return res.status(400).json({ error: 'destinationIds array is required' });
        }

        // Fire-and-forget uploads; respond immediately
        for (const destinationId of destinationIds) {
          ExternalStorageService.uploadBackup(backup.path, backup.id, destinationId).catch(
            (err) => logger.error(`Upload to ${destinationId} failed:`, err)
          );
        }

        res.json({ message: `Upload started for ${destinationIds.length} destination(s)` });
      } catch (error) {
        logger.error('Error triggering backup upload:', error);
        res.status(500).json({ error: 'Failed to start upload' });
      }
    }
  );

  /**
   * GET /api/backups/:id/preview
   * Preview what's in a backup (before restoring)
   */
  router.get('/:id/preview', requireViewer, requireScope(SCOPES.BACKUPS.READ), async (req: Request, res: Response): Promise<any> => {
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
    requireAdmin,
    requireScope(SCOPES.BACKUPS.RESTORE),
    auditLog('BACKUP_RESTORE', {
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

        const backup = await BackupService.getBackup(req.params.id);
        const backupName = backup?.name || req.params.id;

        res.locals.auditResource = backupName;
        res.locals.auditDetails = {
          backupId: req.params.id,
          backupName,
          backupType: backup?.type,
          instanceId: instanceId || backup?.instanceId,
        };

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
    requireAdmin,
    requireScope(SCOPES.BACKUPS.DELETE),
    auditLog('BACKUP_DELETE'),
    async (req: Request, res: Response): Promise<any> => {
      try {
        const user = (req as any).user;

        // Only admins can delete backups
        if (user.role !== 'admin') {
          return res.status(403).json({ error: 'Only admins can delete backups' });
        }

        const backup = await BackupService.getBackup(req.params.id);
        const backupName = backup?.name || req.params.id;

        res.locals.auditResource = backupName;
        res.locals.auditDetails = {
          backupId: req.params.id,
          backupName,
          backupType: backup?.type,
          instanceId: backup?.instanceId,
        };

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

  /**
   * POST /api/backups/:id/extract-sql
   * Extract SQL dump file from backup ZIP into BACKUP_DIR for use in Migrations
   */
  router.post('/:id/extract-sql', requireViewer, requireScope(SCOPES.BACKUPS.READ), async (req: Request, res: Response): Promise<any> => {
    try {
      const result = await BackupService.extractSqlFromZip(req.params.id);
      res.json({
        message: `Extracted SQL dump to ${result.filename}`,
        filename: result.filename,
        size: result.size,
      });
    } catch (error) {
      logger.error('Error extracting SQL dump from ZIP:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to extract SQL dump' });
    }
  });

  /**
   * GET /api/backups/:id/download-sql
   * Download the SQL dump file directly from the backup ZIP
   */
  router.get('/:id/download-sql', requireViewer, requireScope(SCOPES.BACKUPS.READ), async (req: Request, res: Response): Promise<any> => {
    try {
      const { filename, content } = await BackupService.getSqlDumpFromZipStream(req.params.id);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(content);
    } catch (error) {
      logger.error('Error downloading SQL dump from ZIP:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to download SQL dump' });
    }
  });

  return router;
}
