import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import AuthService from '../services/AuthService';
import { logger } from '../utils/logger';
import { calculateNextRun } from '../utils/cron';
import { auditLog } from '../middleware/auditLog';

const prisma = new PrismaClient();

/**
 * Middleware to check authentication
 */
const requireAuth = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const session = await AuthService.validateSession(token);
    if (!session) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    (req as any).user = session.user;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Unauthorized' });
  }
};

export function createScheduleRoutes() {
  const router = Router();

  /**
   * GET /api/schedules
   * List all backup schedules
   */
  router.get('/', requireAuth, async (_req: Request, res: Response) => {
    try {
      const schedules = await prisma.backupSchedule.findMany({
        orderBy: { createdAt: 'desc' },
      });

      res.json({ schedules });
    } catch (error) {
      logger.error('Error listing schedules:', error);
      res.status(500).json({ error: 'Failed to list schedules' });
    }
  });

  /**
   * POST /api/schedules
   * Create a new backup schedule
   */
  router.post(
    '/',
    requireAuth,
    auditLog('SCHEDULE_CREATE', {
      getResource: (req) => req.body.instanceId,
      includeBody: true,
    }),
    async (req: Request, res: Response): Promise<any> => {
      try {
        const user = (req as any).user;
        const { instanceId, cronSchedule, type = 'full', retention = 7, enabled = true } = req.body;

        if (!instanceId || !cronSchedule) {
          return res.status(400).json({ error: 'instanceId and cronSchedule are required' });
        }

        // Validate cron format (basic check)
        const cronParts = cronSchedule.split(' ');
        if (cronParts.length !== 5) {
          return res.status(400).json({
            error:
              'Invalid cron format. Use: minute hour day month weekday (e.g., "0 2 * * *" for daily at 2:00 AM)',
          });
        }

        const nextRun = calculateNextRun(cronSchedule);

        const schedule = await prisma.backupSchedule.create({
          data: {
            instanceId,
            cronSchedule,
            type,
            retention,
            enabled,
            nextRun,
            createdBy: user.id,
          },
        });

        logger.info(`Backup schedule created: ${schedule.id} for ${instanceId}`);

        res.status(201).json(schedule);
      } catch (error) {
        logger.error('Error creating schedule:', error);
        res.status(500).json({ error: 'Failed to create schedule' });
      }
    }
  );

  /**
   * GET /api/schedules/:id
   * Get schedule details
   */
  router.get('/:id', requireAuth, async (req: Request, res: Response): Promise<any> => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: 'Invalid schedule ID' });
      }

      const schedule = await prisma.backupSchedule.findUnique({
        where: { id },
      });

      if (!schedule) {
        return res.status(404).json({ error: 'Schedule not found' });
      }

      res.json(schedule);
    } catch (error) {
      logger.error('Error getting schedule:', error);
      res.status(500).json({ error: 'Failed to get schedule' });
    }
  });

  /**
   * PUT /api/schedules/:id
   * Update a schedule
   */
  router.put(
    '/:id',
    requireAuth,
    auditLog('SCHEDULE_UPDATE', { includeBody: true }),
    async (req: Request, res: Response): Promise<any> => {
      try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
          return res.status(400).json({ error: 'Invalid schedule ID' });
        }

        const { cronSchedule, type, retention, enabled } = req.body;

        const updateData: any = {};
        if (cronSchedule) {
          updateData.cronSchedule = cronSchedule;
          updateData.nextRun = calculateNextRun(cronSchedule);
        }
        if (type) updateData.type = type;
        if (retention !== undefined) updateData.retention = retention;
        if (enabled !== undefined) updateData.enabled = enabled;

        const schedule = await prisma.backupSchedule.update({
          where: { id },
          data: updateData,
        });

        logger.info(`Backup schedule updated: ${id}`);

        res.json(schedule);
      } catch (error: any) {
        if (error.code === 'P2025') {
          return res.status(404).json({ error: 'Schedule not found' });
        }
        logger.error('Error updating schedule:', error);
        res.status(500).json({ error: 'Failed to update schedule' });
      }
    }
  );

  /**
   * DELETE /api/schedules/:id
   * Delete a schedule
   */
  router.delete(
    '/:id',
    requireAuth,
    auditLog('SCHEDULE_DELETE'),
    async (req: Request, res: Response): Promise<any> => {
      try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
          return res.status(400).json({ error: 'Invalid schedule ID' });
        }

        await prisma.backupSchedule.delete({
          where: { id },
        });

        logger.info(`Backup schedule deleted: ${id}`);

        res.json({ message: 'Schedule deleted successfully' });
      } catch (error: any) {
        if (error.code === 'P2025') {
          return res.status(404).json({ error: 'Schedule not found' });
        }
        logger.error('Error deleting schedule:', error);
        res.status(500).json({ error: 'Failed to delete schedule' });
      }
    }
  );

  /**
   * POST /api/schedules/:id/run
   * Manually trigger a scheduled backup
   */
  router.post(
    '/:id/run',
    requireAuth,
    auditLog('SCHEDULE_RUN_MANUAL'),
    async (req: Request, res: Response): Promise<any> => {
      try {
        const user = (req as any).user;

        // Only admins can manually trigger
        if (user.role !== 'admin') {
          return res.status(403).json({ error: 'Admin access required' });
        }

        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
          return res.status(400).json({ error: 'Invalid schedule ID' });
        }

        const schedule = await prisma.backupSchedule.findUnique({
          where: { id },
        });

        if (!schedule) {
          return res.status(404).json({ error: 'Schedule not found' });
        }

        // Mark as running (in a real implementation, this would trigger the actual backup)
        // With SchedulerService, we might want to actually TRIGGER it here immediately
        // But for now we just update status to test.
        // Ideally we should import SchedulerService here and call executeSchedule?
        // But SchedulerService.executeSchedule is private.
        // For now, let's just leave it as updating the DB to show intention,
        // OR we could update nextRun to NOW so the scheduler picks it up in < 1 min?
        // Updating nextRun to NOW is the safest integration.

        await prisma.backupSchedule.update({
          where: { id },
          data: {
            nextRun: new Date(), // Force run immediately
            lastStatus: 'pending',
          },
        });

        logger.info(`Backup schedule manually triggered: ${id} by ${user.id}`);

        res.json({
          message: 'Backup triggered (will run within 1 minute)',
          scheduleId: id,
          instanceId: schedule.instanceId,
        });
      } catch (error) {
        logger.error('Error triggering schedule:', error);
        res.status(500).json({ error: 'Failed to trigger backup' });
      }
    }
  );

  return router;
}
