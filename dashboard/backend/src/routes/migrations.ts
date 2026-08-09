import { Router, Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import AuthService from '../services/AuthService';
import BackupService from '../services/BackupService';
import { logger } from '../utils/logger';
import { auditLog } from '../middleware/auditLog';
import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import { parseEnvFile } from '../utils/envParser';
import { requireScope } from '../middleware/requireScope';
import { SCOPES } from '../constants/scopes';

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
  router.get('/history', requireAdmin, requireScope(SCOPES.MIGRATIONS.READ), async (req: Request, res: Response) => {
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
  router.post('/execute', requireAdmin, requireScope(SCOPES.MIGRATIONS.RUN), async (req: Request, res: Response): Promise<any> => {
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
  router.post('/validate', requireAdmin, requireScope(SCOPES.MIGRATIONS.RUN), async (req: Request, res: Response): Promise<any> => {
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
  router.get('/templates', requireAdmin, requireScope(SCOPES.MIGRATIONS.READ), async (_req: Request, res: Response) => {
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
    requireScope(SCOPES.MIGRATIONS.RUN),
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
    requireScope(SCOPES.MIGRATIONS.RUN),
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

  /**
   * GET /api/migrations/dumps
   * List all standalone .sql dump files in the backups folder
   */
  router.get('/dumps', requireAdmin, requireScope(SCOPES.MIGRATIONS.READ), async (_req: Request, res: Response): Promise<any> => {
    try {
      const dumps = await BackupService.listSqlDumps();
      res.json(dumps);
    } catch (error) {
      logger.error('Error listing SQL dumps:', error);
      res.status(500).json({ error: 'Failed to list SQL dumps' });
    }
  });

  /**
   * GET /api/migrations/dumps/:filename
   * Get content of a specific .sql dump file
   */
  router.get('/dumps/:filename', requireAdmin, requireScope(SCOPES.MIGRATIONS.READ), async (req: Request, res: Response): Promise<any> => {
    try {
      const dump = await BackupService.readSqlDump(req.params.filename);
      res.json(dump);
    } catch (error) {
      logger.error('Error reading SQL dump:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to read SQL dump' });
    }
  });

  /**
   * GET /api/migrations/dumps/:filename/inspect
   * Inspect metadata, table list, and statement count of a .sql dump file
   */
  router.get('/dumps/:filename/inspect', requireAdmin, requireScope(SCOPES.MIGRATIONS.READ), async (req: Request, res: Response): Promise<any> => {
    try {
      const info = await BackupService.inspectSqlDump(req.params.filename);
      res.json(info);
    } catch (error) {
      logger.error('Error inspecting SQL dump:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to inspect SQL dump' });
    }
  });

  /**
   * DELETE /api/migrations/dumps/:filename
   * Delete a .sql dump file from server
   */
  router.delete('/dumps/:filename', requireAdmin, requireScope(SCOPES.MIGRATIONS.RUN), async (req: Request, res: Response): Promise<any> => {
    try {
      await BackupService.deleteSqlDump(req.params.filename);
      res.json({ message: 'SQL dump deleted successfully' });
    } catch (error) {
      logger.error('Error deleting SQL dump:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to delete SQL dump' });
    }
  });

  /**
   * POST /api/migrations/dumps/bulk-delete
   * Delete multiple .sql dump files
   */
  router.post('/dumps/bulk-delete', requireAdmin, requireScope(SCOPES.MIGRATIONS.RUN), async (req: Request, res: Response): Promise<any> => {
    try {
      const { filenames } = req.body;
      if (!Array.isArray(filenames) || filenames.length === 0) {
        return res.status(400).json({ error: 'filenames array is required' });
      }

      const result = await BackupService.bulkDeleteSqlDumps(filenames);
      res.json({ message: `Deleted ${result.deleted} SQL dump(s)`, ...result });
    } catch (error) {
      logger.error('Error bulk deleting SQL dumps:', error);
      res.status(500).json({ error: 'Failed to delete SQL dumps' });
    }
  });

  /**
   * POST /api/migrations/dumps/upload
   * Upload a .sql dump file from the browser
   */
  router.post('/dumps/upload', requireAdmin, requireScope(SCOPES.MIGRATIONS.RUN), async (req: Request, res: Response): Promise<any> => {
    try {
      const { filename, content } = req.body;
      if (!content) {
        return res.status(400).json({ error: 'SQL content is required' });
      }

      const safeName = (filename || `uploaded-dump-${Date.now()}.sql`).replace(/[^a-zA-Z0-9_.-]/g, '_');
      const finalName = safeName.endsWith('.sql') ? safeName : `${safeName}.sql`;
      const targetPath = path.join((BackupService as any).BACKUP_DIR || path.join(process.cwd(), '../backups'), finalName);

      await fs.promises.writeFile(targetPath, content, 'utf-8');
      const stats = await fs.promises.stat(targetPath);

      logger.info(`Uploaded SQL dump: ${finalName} (${stats.size} bytes)`);
      res.json({
        message: 'SQL dump uploaded successfully',
        filename: finalName,
        size: stats.size,
      });
    } catch (error) {
      logger.error('Error uploading SQL dump:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to upload SQL dump' });
    }
  });

  /**
   * POST /api/migrations/dumps/:filename/apply
   * Apply a .sql dump to a target instance
   */
  router.post('/dumps/:filename/apply', requireAdmin, requireScope(SCOPES.MIGRATIONS.RUN), async (req: Request, res: Response): Promise<any> => {
    try {
      const { instanceId } = req.body;
      if (!instanceId) {
        return res.status(400).json({ error: 'instanceId is required' });
      }

      const filename = path.basename(req.params.filename);
      const backupDir = (BackupService as any).BACKUP_DIR || path.join(process.cwd(), '../backups');
      const sqlDumpPath = path.join(backupDir, filename);

      if (!fs.existsSync(sqlDumpPath)) {
        return res.status(404).json({ error: `SQL dump file ${filename} not found` });
      }

      const PROJECTS_PATH = process.env.PROJECTS_PATH || path.join(__dirname, '../../../projects');
      const envPath = path.join(PROJECTS_PATH, instanceId, '.env');
      if (!fs.existsSync(envPath)) {
        return res.status(404).json({ error: `Instance ${instanceId} configuration not found` });
      }

      const envConfig = parseEnvFile(envPath);
      const isCloud = !!envConfig.PROJECT_DB && !envConfig.POSTGRES_PORT;

      let success = false;
      if (isCloud) {
        success = await BackupService.restoreCloudTenantDb(instanceId, sqlDumpPath);
      } else {
        success = await BackupService.restoreClassicInstanceDb(instanceId, sqlDumpPath);
      }

      if (!success) {
        return res.status(500).json({ error: `Failed to restore SQL dump into instance ${instanceId}` });
      }

      logger.info(`Applied SQL dump ${filename} to instance ${instanceId}`);
      res.json({ message: `Successfully applied ${filename} to instance ${instanceId}` });
    } catch (error) {
      logger.error('Error applying SQL dump:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to apply SQL dump' });
    }
  });

  return router;
}
