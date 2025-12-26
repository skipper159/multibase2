import { Router, Request, Response, NextFunction } from 'express';
import AuthService from '../services/AuthService';
import { logger } from '../utils/logger';
import { auditLog } from '../middleware/auditLog';

/**
 * Notification message structure
 */
interface NotificationMessage {
  title: string;
  body: string;
  type: 'info' | 'warning' | 'error' | 'success';
  data?: Record<string, any>;
  timestamp: Date;
}

/**
 * Notification channel interface
 */
interface NotificationChannel {
  name: string;
  send(message: NotificationMessage, config: any): Promise<boolean>;
}

/**
 * Webhook notification channel
 */
class WebhookChannel implements NotificationChannel {
  name = 'webhook';

  async send(
    message: NotificationMessage,
    config: { url: string; secret?: string }
  ): Promise<boolean> {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (config.secret) {
        headers['X-Webhook-Secret'] = config.secret;
      }

      const response = await fetch(config.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...message,
          source: 'multibase-dashboard',
        }),
      });

      if (!response.ok) {
        logger.error(`Webhook failed: ${response.status} ${response.statusText}`);
        return false;
      }

      logger.info(`Webhook notification sent to ${config.url}`);
      return true;
    } catch (error) {
      logger.error('Webhook notification error:', error);
      return false;
    }
  }
}

/**
 * Console notification channel (for testing)
 */
class ConsoleChannel implements NotificationChannel {
  name = 'console';

  async send(message: NotificationMessage): Promise<boolean> {
    logger.info(`[NOTIFICATION] ${message.type.toUpperCase()}: ${message.title} - ${message.body}`);
    return true;
  }
}

/**
 * Notification Service
 */
class NotificationService {
  private channels: Map<string, NotificationChannel> = new Map();

  constructor() {
    this.registerChannel(new WebhookChannel());
    this.registerChannel(new ConsoleChannel());
  }

  registerChannel(channel: NotificationChannel) {
    this.channels.set(channel.name, channel);
  }

  async send(channelName: string, message: NotificationMessage, config: any): Promise<boolean> {
    const channel = this.channels.get(channelName);
    if (!channel) {
      logger.error(`Unknown notification channel: ${channelName}`);
      return false;
    }

    return channel.send(message, config);
  }

  getAvailableChannels(): string[] {
    return Array.from(this.channels.keys());
  }
}

export const notificationService = new NotificationService();

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

export function createNotificationRoutes() {
  const router = Router();

  /**
   * GET /api/notifications/channels
   * List available notification channels
   */
  router.get('/channels', requireAuth, (_req: Request, res: Response) => {
    const channels = notificationService.getAvailableChannels();
    res.json({ channels });
  });

  /**
   * POST /api/notifications/test
   * Send a test notification
   */
  router.post(
    '/test',
    requireAuth,
    auditLog('NOTIFICATION_TEST', { includeBody: true }),
    async (req: Request, res: Response): Promise<any> => {
      try {
        const user = (req as any).user;

        // Only admins can send test notifications
        if (user.role !== 'admin') {
          return res.status(403).json({ error: 'Admin access required' });
        }

        const { channel = 'console', config = {}, message } = req.body;

        const testMessage: NotificationMessage = {
          title: message?.title || 'Test Notification',
          body: message?.body || 'This is a test notification from Multibase Dashboard',
          type: message?.type || 'info',
          data: message?.data || { test: true },
          timestamp: new Date(),
        };

        const success = await notificationService.send(channel, testMessage, config);

        if (success) {
          res.json({
            success: true,
            message: `Test notification sent via ${channel}`,
            sentMessage: testMessage,
          });
        } else {
          res.status(500).json({
            success: false,
            error: `Failed to send notification via ${channel}`,
          });
        }
      } catch (error) {
        logger.error('Error sending test notification:', error);
        res.status(500).json({ error: 'Failed to send test notification' });
      }
    }
  );

  /**
   * POST /api/notifications/webhook
   * Send a webhook notification
   */
  router.post(
    '/webhook',
    requireAuth,
    auditLog('NOTIFICATION_WEBHOOK_TRIGGER', { includeBody: true }),
    async (req: Request, res: Response): Promise<any> => {
      try {
        const user = (req as any).user;

        if (user.role !== 'admin') {
          return res.status(403).json({ error: 'Admin access required' });
        }

        const { url, secret, title, body, type = 'info', data } = req.body;

        if (!url) {
          return res.status(400).json({ error: 'Webhook URL is required' });
        }

        const message: NotificationMessage = {
          title: title || 'Multibase Notification',
          body: body || '',
          type,
          data,
          timestamp: new Date(),
        };

        const success = await notificationService.send('webhook', message, { url, secret });

        if (success) {
          res.json({ success: true, message: 'Webhook sent successfully' });
        } else {
          res.status(500).json({ success: false, error: 'Failed to send webhook' });
        }
      } catch (error) {
        logger.error('Error sending webhook:', error);
        res.status(500).json({ error: 'Failed to send webhook' });
      }
    }
  );

  return router;
}
