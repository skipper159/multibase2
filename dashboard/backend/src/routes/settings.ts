import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import AuthService from '../services/AuthService';
import { logger } from '../utils/logger';
import nodemailer from 'nodemailer';
import { auditLog } from '../middleware/auditLog';

const prisma = new PrismaClient();

/**
 * Middleware to check admin authentication
 */
const requireAdmin = async (req: Request, res: Response, next: any) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const session = await AuthService.validateSession(token);
    if (!session || session.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    (req as any).user = session.user;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Unauthorized' });
  }
};

export function createSettingsRoutes() {
  const router = Router();

  /**
   * GET /api/settings/smtp
   * Get global SMTP settings
   */
  router.get('/smtp', requireAdmin, async (_req: Request, res: Response) => {
    try {
      const settings = await prisma.globalSettings.findUnique({
        where: { id: 1 },
      });

      const response = settings
        ? {
            ...settings,
            smtp_pass: settings.smtp_pass ? '********' : null,
          }
        : {};

      return res.json(response);
    } catch (error) {
      logger.error('Error fetching SMTP settings:', error);
      return res.status(500).json({ error: 'Failed to fetch settings' });
    }
  });

  /**
   * PUT /api/settings/smtp
   * Update global SMTP settings
   */
  router.put(
    '/smtp',
    requireAdmin,
    auditLog('SETTINGS_UPDATE', { includeBody: true }),
    async (req: Request, res: Response) => {
      try {
        const data = req.body;
        const { smtp_host, smtp_port, smtp_user, smtp_pass, smtp_sender_name, smtp_admin_email } =
          data;

        // Check if updating or creating
        // We always use ID 1 for global settings
        const existing = await prisma.globalSettings.findUnique({ where: { id: 1 } });

        let updateData: any = {
          smtp_host,
          smtp_port: parseInt(smtp_port, 10),
          smtp_user,
          smtp_sender_name,
          smtp_admin_email,
        };

        // Only update password if provided and not mask
        if (smtp_pass && smtp_pass !== '********') {
          updateData.smtp_pass = smtp_pass;
        }

        let settings;
        if (existing) {
          settings = await prisma.globalSettings.update({
            where: { id: 1 },
            data: updateData,
          });
        } else {
          settings = await prisma.globalSettings.create({
            data: {
              id: 1,
              ...updateData,
            },
          });
        }

        return res.json({
          message: 'Settings updated successfully',
          settings: { ...settings, smtp_pass: '********' },
        });
      } catch (error) {
        logger.error('Error updating SMTP settings:', error);
        return res.status(500).json({ error: 'Failed to update settings' });
      }
    }
  );

  /**
   * POST /api/settings/smtp/test
   * Send a test email
   */
  router.post(
    '/smtp/test',
    requireAdmin,
    auditLog('SMTP_TEST_EMAIL', { includeBody: true }),
    async (req: Request, res: Response) => {
      try {
        const { to } = req.body;
        // Get current settings from DB to ensure we use saved credentials
        const settings = await prisma.globalSettings.findUnique({ where: { id: 1 } });

        if (!settings || !settings.smtp_host || !settings.smtp_user || !settings.smtp_pass) {
          return res.status(400).json({ error: 'SMTP settings are incomplete' });
        }

        const transporter = nodemailer.createTransport({
          host: settings.smtp_host,
          port: settings.smtp_port || 587,
          secure: settings.smtp_port === 465, // true for 465, false for other ports
          auth: {
            user: settings.smtp_user,
            pass: settings.smtp_pass,
          },
        });

        await transporter.sendMail({
          from: `"${settings.smtp_sender_name || 'Multibase Admin'}" <${settings.smtp_user}>`,
          to: to || settings.smtp_admin_email || settings.smtp_user, // Default to admin email or sender
          subject: 'Multibase SMTP Test',
          text: 'This is a test email from your Multibase Dashboard configuration. If you see this, SMTP is working correctly!',
          html: '<p>This is a test email from your <b>Multibase Dashboard</b> configuration.</p><p>If you see this, SMTP is working correctly! 🎉</p>',
        });

        return res.json({ message: 'Test email sent successfully' });
      } catch (error: any) {
        logger.error('Error sending test email:', error);
        return res.status(500).json({ error: `Failed to send email: ${error.message}` });
      }
    }
  );

  return router;
}
