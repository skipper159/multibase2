import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

/**
 * AlertMonitorService - Background service that periodically checks all alert rules
 * and triggers alerts when conditions are met.
 */
export class AlertMonitorService {
  private intervalId: NodeJS.Timeout | null = null;
  private checkIntervalMs: number;
  private isRunning: boolean = false;

  constructor(checkIntervalSeconds: number = 60) {
    this.checkIntervalMs = checkIntervalSeconds * 1000;
  }

  /**
   * Start the background monitoring
   */
  start(): void {
    if (this.intervalId) {
      logger.warn('AlertMonitor already running');
      return;
    }

    logger.info(`AlertMonitor starting, check interval: ${this.checkIntervalMs / 1000}s`);

    // Run immediately on start
    this.runCheck();

    // Then run periodically
    this.intervalId = setInterval(() => {
      this.runCheck();
    }, this.checkIntervalMs);
  }

  /**
   * Stop the background monitoring
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('AlertMonitor stopped');
    }
  }

  /**
   * Run a check of all alert rules
   */
  private async runCheck(): Promise<void> {
    if (this.isRunning) {
      logger.debug('AlertMonitor check already in progress, skipping');
      return;
    }

    this.isRunning = true;

    try {
      // Get all enabled alert rules
      const rules = await prisma.alertRule.findMany({
        where: { enabled: true },
        include: { instance: true },
      });

      if (rules.length === 0) {
        logger.debug('No enabled alert rules to check');
        return;
      }

      logger.debug(`Checking ${rules.length} alert rules`);

      for (const rule of rules) {
        await this.checkRule(rule);
      }
    } catch (error) {
      logger.error('AlertMonitor check failed:', error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Check a single alert rule against current metrics
   */
  private async checkRule(rule: any): Promise<void> {
    try {
      // Get current metrics for the instance
      // In a real implementation, this would fetch from Docker/container metrics
      const metrics = await this.getInstanceMetrics(rule.instanceId);

      if (!metrics) {
        return;
      }

      // Check if the condition is met
      const conditionMet = this.evaluateCondition(rule, metrics);

      if (conditionMet) {
        // Check if there's already an active alert for this rule
        const existingAlert = await prisma.alert.findFirst({
          where: {
            instanceId: rule.instanceId,
            rule: rule.rule,
            status: 'active',
          },
        });

        if (!existingAlert) {
          // Create new alert
          await this.triggerAlert(rule, metrics);
        }
      }
    } catch (error) {
      logger.error(`Error checking rule ${rule.id}:`, error);
    }
  }

  /**
   * Get metrics for an instance (simplified - would connect to Docker in production)
   */
  private async getInstanceMetrics(instanceId: string): Promise<Record<string, number> | null> {
    try {
      // In production, this would fetch real metrics from Docker
      // For now, we'll use a simple simulation based on random values
      // In a real implementation, you'd call dockerManager.getContainerStats()

      // Simulated metrics (replace with real Docker metrics)
      const metrics = {
        cpu: Math.random() * 100, // 0-100%
        memory: Math.random() * 100, // 0-100%
        disk: Math.random() * 100, // 0-100%
        responseTime: Math.random() * 1000, // 0-1000ms
      };

      return metrics;
    } catch (error) {
      logger.error(`Failed to get metrics for instance ${instanceId}:`, error);
      return null;
    }
  }

  /**
   * Evaluate if the alert condition is met
   */
  private evaluateCondition(rule: any, metrics: Record<string, number>): boolean {
    const threshold = rule.threshold || 80;

    switch (rule.rule) {
      case 'high_cpu':
        return metrics.cpu > threshold;
      case 'high_memory':
        return metrics.memory > threshold;
      case 'high_disk':
        return metrics.disk > threshold;
      case 'slow_response':
        return metrics.responseTime > (rule.threshold || 500);
      case 'service_down':
        // Would check container status
        return false;
      default:
        return false;
    }
  }

  /**
   * Trigger an alert and send notifications
   */
  private async triggerAlert(rule: any, metrics: Record<string, number>): Promise<void> {
    try {
      // Create the alert
      const alert = await prisma.alert.create({
        data: {
          instanceId: rule.instanceId,
          name: rule.name,
          rule: rule.rule,
          status: 'active',
          message: this.generateAlertMessage(rule, metrics),
          triggeredAt: new Date(),
          metadata: JSON.stringify(metrics),
        },
      });

      logger.info(`Alert triggered: ${alert.id} - ${rule.name}`);

      // Send notification (webhook)
      await this.sendNotification(alert, rule);
    } catch (error) {
      logger.error(`Failed to trigger alert for rule ${rule.id}:`, error);
    }
  }

  /**
   * Generate an alert message
   */
  private generateAlertMessage(rule: any, metrics: Record<string, number>): string {
    switch (rule.rule) {
      case 'high_cpu':
        return `CPU usage is at ${metrics.cpu.toFixed(1)}% (threshold: ${rule.threshold}%)`;
      case 'high_memory':
        return `Memory usage is at ${metrics.memory.toFixed(1)}% (threshold: ${rule.threshold}%)`;
      case 'high_disk':
        return `Disk usage is at ${metrics.disk.toFixed(1)}% (threshold: ${rule.threshold}%)`;
      case 'slow_response':
        return `Response time is ${metrics.responseTime.toFixed(0)}ms (threshold: ${
          rule.threshold
        }ms)`;
      default:
        return `Alert condition met for ${rule.name}`;
    }
  }

  /**
   * Send notification via configured channels
   */
  private async sendNotification(alert: any, rule: any): Promise<void> {
    try {
      // Log to console (always enabled)
      logger.info(`[ALERT] ${alert.name}: ${alert.message}`);

      // Check notification channels
      let channels: string[] = [];
      try {
        if (rule.notificationChannels) {
          channels = JSON.parse(rule.notificationChannels);
        } else if (alert.notificationChannels) {
          channels = JSON.parse(alert.notificationChannels);
        }
      } catch (e) {
        channels = ['browser']; // Default
      }

      // Email Notification
      if (channels.includes('email')) {
        await this.sendEmail(alert, rule);
      }

      // Webhook Notification
      if (channels.includes('webhook') && rule.webhookUrl) {
        // Implement webhook logic here if needed
      }
    } catch (error) {
      logger.error('Failed to send notification:', error);
    }
  }

  /**
   * Send email notification using Global Settings
   */
  private async sendEmail(alert: any, rule: any): Promise<void> {
    try {
      // Fetch global SMTP settings
      const settings = await prisma.globalSettings.findUnique({ where: { id: 1 } });

      if (!settings || !settings.smtp_host || !settings.smtp_user) {
        logger.warn('Cannot send email alert: SMTP settings incomplete');
        return;
      }

      const transporter = require('nodemailer').createTransport({
        host: settings.smtp_host,
        port: settings.smtp_port || 587,
        secure: settings.smtp_port === 465,
        auth: {
          user: settings.smtp_user,
          pass: settings.smtp_pass,
        },
      });

      const subject = `[Alert] ${alert.name} triggered on ${rule.instance?.name || 'Instance'}`;
      const html = `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #ef4444;">🚨 Alert Triggered</h2>
          <p><strong>Alert:</strong> ${alert.name}</p>
          <p><strong>Instance:</strong> ${rule.instance?.name || rule.instanceId}</p>
          <p><strong>Message:</strong> ${alert.message}</p>
          <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
          <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
          <p style="font-size: 12px; color: #64748b;">Sent from Multibase Dashboard</p>
        </div>
      `;

      await transporter.sendMail({
        from: `"${settings.smtp_sender_name || 'Multibase Monitor'}" <${settings.smtp_user}>`,
        to: settings.smtp_admin_email || settings.smtp_user,
        subject,
        html,
      });

      logger.info(`Email alert sent to ${settings.smtp_admin_email || settings.smtp_user}`);
    } catch (error) {
      logger.error('Failed to send email alert:', error);
    }
  }
}

// Singleton instance
let alertMonitor: AlertMonitorService | null = null;

/**
 * Get or create the AlertMonitor instance
 */
export function getAlertMonitor(): AlertMonitorService {
  if (!alertMonitor) {
    alertMonitor = new AlertMonitorService(60); // Check every 60 seconds
  }
  return alertMonitor;
}

/**
 * Start the AlertMonitor background service
 */
export function startAlertMonitor(): void {
  getAlertMonitor().start();
}

/**
 * Stop the AlertMonitor background service
 */
export function stopAlertMonitor(): void {
  if (alertMonitor) {
    alertMonitor.stop();
  }
}
