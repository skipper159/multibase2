import { Router, Request, Response } from 'express';
import BackupService from '../services/BackupService';
import AuthService from '../services/AuthService';
import { logger } from '../utils/logger';

export function createBackupRoutes() {
  const router = Router();

  /**
   * Middleware to check authentication
   */
  const requireAuth = async (req: Request, res: Response, next: Function) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const session = await AuthService.validateSession(token);
      if (!session) {
        return res.status(401).json({ error: 'Invalid or expired session' });
      }

      (req as any).user = session.user;
      next();
    } catch (error) {
      res.status(401).json({ error: 'Unauthorized' });
    }
  };

  /**
   * POST /api/backups
   * Create a new backup
   */
  router.post('/', requireAuth, async (req: Request, res: Response) => {
    try {
      const { type, instanceId, name } = req.body;
      const user = (req as any).user;

      if (!type) {
        return res.status(400).json({ error: 'Backup type is required' });
      }

      if (type === 'instance' && !instanceId) {
        return res.status(400).json({ error: 'Instance ID is required for instance backup' });
      }

      const backup = await BackupService.createBackup({
        type,
        instanceId,
        name,
        createdBy: user.id
      });

      res.json(backup);
    } catch (error) {
      logger.error('Error in create backup route:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to create backup'
      });
    }
  });

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
        error: error instanceof Error ? error.message : 'Failed to list backups'
      });
    }
  });

  /**
   * GET /api/backups/:id
   * Get backup by ID
   */
  router.get('/:id', requireAuth, async (req: Request, res: Response) => {
    try {
      const backup = await BackupService.getBackup(req.params.id);

      if (!backup) {
        return res.status(404).json({ error: 'Backup not found' });
      }

      res.json(backup);
    } catch (error) {
      logger.error('Error in get backup route:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to get backup'
      });
    }
  });

  /**
   * POST /api/backups/:id/restore
   * Restore from backup
   */
  router.post('/:id/restore', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;

      // Only admins can restore
      if (user.role !== 'admin') {
        return res.status(403).json({ error: 'Only admins can restore backups' });
      }

      const { instanceId } = req.body;

      const result = await BackupService.restoreBackup({
        backupId: req.params.id,
        instanceId
      });

      res.json(result);
    } catch (error) {
      logger.error('Error in restore backup route:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to restore backup'
      });
    }
  });

  /**
   * DELETE /api/backups/:id
   * Delete backup
   */
  router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
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
        error: error instanceof Error ? error.message : 'Failed to delete backup'
      });
    }
  });

  return router;
}
