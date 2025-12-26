import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import AuthService from '../services/AuthService';
import { logger } from '../utils/logger';
import { auditLog } from '../middleware/auditLog';
import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import { parseEnvFile } from '../utils/envParser';

const prisma = new PrismaClient();

// In-memory migration history (in production, this would be stored in DB)
const migrationHistory: Array<{
  id: string;
  instanceId: string;
  sql: string;
  success: boolean;
  rowsAffected: number;
  error?: string;
  executedAt: Date;
  executedBy: string;
}> = [];

/**
 * Middleware to check admin authentication
 */
const requireAdmin = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
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

/**
 * Validate SQL query for safety
 */
function validateSql(sql: string): { valid: boolean; error?: string } {
  const trimmed = sql.trim().toLowerCase();

  // Block dangerous operations
  const blocked = ['drop database', 'drop schema', 'truncate', 'drop table'];
  for (const keyword of blocked) {
    if (trimmed.includes(keyword)) {
      return { valid: false, error: `Blocked operation: ${keyword.toUpperCase()}` };
    }
  }

  // Must start with allowed keywords
  const allowed = ['select', 'insert', 'update', 'delete', 'alter', 'create', 'drop', 'with'];
  const startsWithAllowed = allowed.some((kw) => trimmed.startsWith(kw));
  if (!startsWithAllowed) {
    return {
      valid: false,
      error: 'Query must start with SELECT, INSERT, UPDATE, DELETE, ALTER, CREATE, or WITH',
    };
  }

  return { valid: true };
}

export function createMigrationRoutes() {
  const router = Router();

  /**
   * GET /api/migrations/history
   * Get migration execution history
   */
  router.get('/history', requireAdmin, async (req: Request, res: Response) => {
    try {
      const { instanceId, limit = '50' } = req.query;

      let history = [...migrationHistory];

      if (instanceId) {
        history = history.filter((m) => m.instanceId === instanceId);
      }

      // Sort by newest first and limit
      history = history
        .sort((a, b) => b.executedAt.getTime() - a.executedAt.getTime())
        .slice(0, parseInt(limit as string, 10));

      res.json({
        count: history.length,
        history,
      });
    } catch (error) {
      logger.error('Error getting migration history:', error);
      res.status(500).json({ error: 'Failed to get migration history' });
    }
  });

  /**
   * POST /api/migrations/execute
   * Execute a SQL query (with safety checks)
   */
  router.post('/execute', requireAdmin, async (req: Request, res: Response): Promise<any> => {
    try {
      const user = (req as any).user;
      const { sql, instanceId, dryRun = false } = req.body;

      if (!sql) {
        return res.status(400).json({ error: 'SQL query is required' });
      }

      if (!instanceId) {
        return res.status(400).json({ error: 'instanceId is required' });
      }

      // Validate SQL
      const validation = validateSql(sql);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }

      // Dry run - just validate
      if (dryRun) {
        return res.json({
          dryRun: true,
          valid: true,
          sql,
          message: 'SQL query is valid and would be executed',
        });
      }

      // Real execution
      const PROJECTS_PATH = process.env.PROJECTS_PATH || path.join(__dirname, '../../../projects');
      const envPath = path.join(PROJECTS_PATH, instanceId, '.env');

      if (!fs.existsSync(envPath)) {
        return res.status(404).json({ error: `Instance configuration not found at ${envPath}` });
      }

      const envConfig = parseEnvFile(envPath);
      const password = envConfig.POSTGRES_PASSWORD;
      const port = envConfig.POSTGRES_PORT || '5432';

      if (!password) {
        return res.status(500).json({ error: 'Database password not found in configuration' });
      }

      const client = new Client({
        user: 'postgres',
        host: 'localhost',
        database: 'postgres',
        password: password,
        port: parseInt(port, 10),
      });

      try {
        await client.connect();
        const start = Date.now();
        const dbResult = await client.query(sql);
        const duration = Date.now() - start;

        const result = {
          id: `mig_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          instanceId,
          sql,
          success: true,
          rowsAffected: dbResult.rowCount || 0,
          executedAt: new Date(),
          executedBy: user.username,
        };

        migrationHistory.push(result);
        logger.info(
          `Migration executed: ${result.id} on ${instanceId} by ${user.username} (${duration}ms)`
        );

        // Create Audit Log entry
        await prisma.auditLog.create({
          data: {
            userId: user.id,
            action: 'execute_sql',
            resource: `instance/${instanceId}`,
            details: JSON.stringify({
              sql: sql.length > 500 ? sql.substring(0, 500) + '...' : sql,
              rowsAffected: dbResult.rowCount,
              duration,
            }),
            success: true,
            ipAddress: req.ip,
            userAgent: req.get('user-agent'),
          },
        });

        res.json({
          message: 'Migration executed successfully',
          migration: result,
          result: {
            command: dbResult.command,
            rowCount: dbResult.rowCount || 0,
            rows: dbResult.rows, // Return rows for SELECT queries
          },
        });
      } catch (dbError: any) {
        const result = {
          id: `mig_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          instanceId,
          sql,
          success: false,
          rowsAffected: 0,
          error: dbError.message,
          executedAt: new Date(),
          executedBy: user.username,
        };
        migrationHistory.push(result);

        logger.error('Database execution error:', dbError);

        // Create Failed Audit Log entry
        await prisma.auditLog.create({
          data: {
            userId: user.id,
            action: 'execute_sql',
            resource: `instance/${instanceId}`,
            details: JSON.stringify({
              sql: sql.length > 500 ? sql.substring(0, 500) + '...' : sql,
              error: dbError.message,
            }),
            success: false,
            ipAddress: req.ip,
            userAgent: req.get('user-agent'),
          },
        });

        res.status(400).json({ error: dbError.message, migration: result });
      } finally {
        await client.end();
      }
    } catch (error) {
      logger.error('Error executing migration:', error);
      res.status(500).json({ error: 'Failed to execute migration' });
    }
  });

  /**
   * POST /api/migrations/validate
   * Validate a SQL query without executing
   */
  router.post('/validate', requireAdmin, async (req: Request, res: Response): Promise<any> => {
    try {
      const { sql } = req.body;

      if (!sql) {
        return res.status(400).json({ error: 'SQL query is required' });
      }

      const validation = validateSql(sql);

      res.json({
        valid: validation.valid,
        error: validation.error,
        sql: sql.trim(),
      });
    } catch (error) {
      logger.error('Error validating SQL:', error);
      res.status(500).json({ error: 'Failed to validate SQL' });
    }
  });

  /**
   * GET /api/migrations/templates
   * Get common SQL templates (System + Custom)
   */
  router.get('/templates', requireAdmin, async (_req: Request, res: Response) => {
    try {
      const systemTemplates = [
        {
          id: 'sys_1',
          name: 'Add Column',
          description: 'Add a new column to a table',
          sql: 'ALTER TABLE table_name ADD COLUMN column_name data_type;',
          category: 'system',
        },
        {
          id: 'sys_2',
          name: 'Create Index',
          description: 'Create an index for faster queries',
          sql: 'CREATE INDEX idx_name ON table_name(column_name);',
          category: 'system',
        },
        {
          id: 'sys_3',
          name: 'Drop Index',
          description: 'Remove an index',
          sql: 'DROP INDEX IF EXISTS idx_name;',
          category: 'system',
        },
        {
          id: 'sys_4',
          name: 'Update Records',
          description: 'Update records with a condition',
          sql: 'UPDATE table_name SET column_name = value WHERE condition;',
          category: 'system',
        },
        {
          id: 'sys_5',
          name: 'Delete Records',
          description: 'Delete records with a condition',
          sql: 'DELETE FROM table_name WHERE condition;',
          category: 'system',
        },
        {
          id: 'sys_6',
          name: 'Select with Join',
          description: 'Query with a join',
          sql: 'SELECT a.*, b.column FROM table_a a JOIN table_b b ON a.id = b.a_id;',
          category: 'system',
        },
      ];

      // Fetch custom templates from DB
      const customTemplates = await prisma.migrationTemplate.findMany({
        orderBy: { createdAt: 'desc' },
      });

      res.json({
        templates: [...systemTemplates, ...customTemplates],
      });
    } catch (error) {
      logger.error('Error fetching templates:', error);
      res.status(500).json({ error: 'Failed to fetch templates' });
    }
  });

  /**
   * POST /api/migrations/templates
   * Create a custom SQL template
   */
  router.post(
    '/templates',
    requireAdmin,
    auditLog('MIGRATION_TEMPLATE_CREATE', { includeBody: true }),
    async (req: Request, res: Response): Promise<any> => {
      try {
        const { name, description, sql } = req.body;

        if (!name || !sql) {
          return res.status(400).json({ error: 'Name and SQL are required' });
        }

        const template = await prisma.migrationTemplate.create({
          data: {
            name,
            description,
            sql,
            category: 'custom',
          },
        });

        res.json({ message: 'Template created successfully', template });
      } catch (error) {
        logger.error('Error creating template:', error);
        res.status(500).json({ error: 'Failed to create template' });
      }
    }
  );

  /**
   * DELETE /api/migrations/templates/:id
   * Delete a custom SQL template
   */
  router.delete(
    '/templates/:id',
    requireAdmin,
    auditLog('MIGRATION_TEMPLATE_DELETE'),
    async (req: Request, res: Response): Promise<any> => {
      try {
        const { id } = req.params;

        await prisma.migrationTemplate.delete({
          where: { id: parseInt(id, 10) },
        });

        res.json({ message: 'Template deleted successfully' });
      } catch (error) {
        logger.error('Error deleting template:', error);
        res.status(500).json({ error: 'Failed to delete template' });
      }
    }
  );

  return router;
}
