import { PrismaClient } from '@prisma/client';
import BackupService from './BackupService';
import { logger } from '../utils/logger';
import { calculateNextRun } from '../utils/cron';
import { createAuditLogEntry } from '../middleware/auditLog';

const prisma = new PrismaClient();

export class SchedulerService {
  private intervalId: NodeJS.Timeout | null = null;
  private readonly CHECK_INTERVAL_MS = 60 * 1000; // Check every minute

  /**
   * Start the scheduler
   */
  start() {
    if (this.intervalId) {
      logger.warn('Scheduler service already running');
      return;
    }

    logger.info('Starting Backup Scheduler Service...');

    // Run immediately on start
    this.checkSchedules();

    // Then run interval
    this.intervalId = setInterval(() => {
      this.checkSchedules();
    }, this.CHECK_INTERVAL_MS);
  }

  /**
   * Stop the scheduler
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('Backup Scheduler Service stopped');
    }
  }

  /**
   * Check for due schedules and execute them
   */
  private async checkSchedules() {
    try {
      const now = new Date();

      // Find due schedules
      const dueSchedules = await prisma.backupSchedule.findMany({
        where: {
          enabled: true,
          nextRun: {
            lte: now,
          },
        },
      });

      if (dueSchedules.length > 0) {
        logger.info(`Found ${dueSchedules.length} due backup schedules`);
      }

      for (const schedule of dueSchedules) {
        await this.executeSchedule(schedule);
      }
    } catch (error) {
      logger.error('Error checking backup schedules:', error);
    }
  }

  /**
   * Execute a single schedule
   */
  private async executeSchedule(schedule: any) {
    const { id, instanceId, type, cronSchedule } = schedule;

    // Fetch instance to get name
    let instanceName = instanceId;
    try {
      const instance = await prisma.instance.findUnique({ where: { id: instanceId } });
      if (instance) instanceName = instance.name;
    } catch (e) {
      // ignore
    }

    logger.info(`Executing scheduled backup ${id} for instance ${instanceName}`);

    try {
      // 1. Create Backup
      const backupName = `auto-${instanceName}-${type}-${Date.now()}`;

      const backup = await BackupService.createBackup({
        type: type as any,
        instanceId,
        name: backupName,
        createdBy: 'SYSTEM', // System user
      });

      // 2. Update Schedule (nextRun, lastRun, lastStatus)
      const nextRun = calculateNextRun(cronSchedule);

      await prisma.backupSchedule.update({
        where: { id },
        data: {
          lastRun: new Date(),
          lastStatus: 'success',
          nextRun,
        },
      });

      // 3. Log Activity
      await createAuditLogEntry({
        action: 'BACKUP_AUTO_CREATE',
        resource: instanceName,
        userId: null, // System
        success: true,
        details: {
          scheduleId: id,
          backupId: backup.id,
          type,
        },
      });

      logger.info(`Scheduled backup completed: ${backup.name}`);
    } catch (error) {
      logger.error(`Failed to execute schedule ${id}:`, error);

      // Update schedule with failure status
      await prisma.backupSchedule.update({
        where: { id },
        data: {
          lastRun: new Date(),
          lastStatus: 'failed',
          // Note: We still update nextRun so it doesn't retry indefinitely every minute
          nextRun: calculateNextRun(cronSchedule),
        },
      });

      // Log Failure
      await createAuditLogEntry({
        action: 'BACKUP_AUTO_CREATE',
        resource: instanceName,
        userId: null,
        success: false,
        details: {
          scheduleId: id,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }
  }
}

export default new SchedulerService();
