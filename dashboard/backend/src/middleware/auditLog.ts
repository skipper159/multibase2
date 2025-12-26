import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

interface AuditOptions {
  /** Include request body in audit log details (be careful with sensitive data) */
  includeBody?: boolean;
  /** Include query params in audit log details */
  includeQuery?: boolean;
  /** Custom resource extractor function */
  getResource?: (req: Request) => string;
}

/**
 * Audit logging middleware
 * Logs actions after the response is sent to not block the request
 *
 * @param action - The action name (e.g., 'create_instance', 'login')
 * @param options - Configuration options
 */
export const auditLog = (action: string, options: AuditOptions = {}) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();

    // Log after response is finished
    res.on('finish', async () => {
      try {
        const userId = (req as any).user?.id || null;
        const success = res.statusCode < 400;

        // Build resource identifier
        let resource = options.getResource
          ? options.getResource(req)
          : req.params.name || req.params.id || req.path;

        // Build details object
        const details: Record<string, any> = {
          method: req.method,
          statusCode: res.statusCode,
          duration: Date.now() - startTime,
        };

        if (options.includeBody && req.body && Object.keys(req.body).length > 0) {
          // Remove sensitive fields from body
          const sanitizedBody = { ...req.body };
          const sensitiveFields = [
            'password',
            'passwordHash',
            'token',
            'smtp_pass',
            'jwt_secret',
            'service_role_key',
            'anon_key',
            'postgres_password',
            'dashboard_password',
          ];

          sensitiveFields.forEach((field) => {
            if (sanitizedBody[field]) sanitizedBody[field] = '********';
          });

          details.body = sanitizedBody;
        }

        if (options.includeQuery && req.query && Object.keys(req.query).length > 0) {
          details.query = req.query;
        }

        await prisma.auditLog.create({
          data: {
            userId,
            action,
            resource,
            details: JSON.stringify(details),
            ipAddress: req.ip || req.socket.remoteAddress || null,
            userAgent: req.get('user-agent') || null,
            success,
          },
        });

        logger.debug(`Audit log created: ${action} on ${resource} by ${userId || 'anonymous'}`);
      } catch (error) {
        // Don't fail the request if audit logging fails
        logger.error('Failed to create audit log:', error);
      }
    });

    next();
  };
};

/**
 * Create an audit log entry manually (for use outside of middleware)
 */
export async function createAuditLogEntry(data: {
  userId?: string | null;
  action: string;
  resource: string;
  details?: Record<string, any>;
  ipAddress?: string | null;
  userAgent?: string | null;
  success?: boolean;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: data.userId || null,
        action: data.action,
        resource: data.resource,
        details: data.details ? JSON.stringify(data.details) : null,
        ipAddress: data.ipAddress || null,
        userAgent: data.userAgent || null,
        success: data.success ?? true,
      },
    });
  } catch (error) {
    logger.error('Failed to create manual audit log:', error);
  }
}

export default auditLog;
