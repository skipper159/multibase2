/**
 * Shared Infrastructure API Routes (Cloud-Version)
 *
 * Endpoints for managing the shared infrastructure:
 * - GET  /api/shared/status    - Status of shared services
 * - POST /api/shared/start     - Start shared infrastructure
 * - POST /api/shared/stop      - Stop shared infrastructure
 * - GET  /api/shared/databases - List project databases
 * - POST /api/shared/databases - Create project database
 * - DELETE /api/shared/databases/:name - Drop project database
 */

import { Router, Request, Response } from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import DockerManager from '../services/DockerManager';
import { StudioManager } from '../services/StudioManager';
import MetricsCollector from '../services/MetricsCollector';
import { logger } from '../utils/logger';
import { parseEnvFile } from '../utils/envParser';
import { requireAuth, requireAdmin } from '../middleware/authMiddleware';
import { auditLog } from '../middleware/auditLog';
import { requireScope } from '../middleware/requireScope';
import { SCOPES } from '../constants/scopes';

const execFileAsync = promisify(execFile);

const PROJECT_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function projectDatabaseName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const projectName = value.trim().toLowerCase();
  if (!PROJECT_NAME_PATTERN.test(projectName)) return null;
  return `project_${projectName.replace(/-/g, '_')}`;
}

export function createSharedRoutes(
  dockerManager: DockerManager,
  studioManager?: StudioManager,
  metricsCollector?: MetricsCollector
): Router {
  const router = Router();

  // All shared infrastructure endpoints require a valid session
  router.use(requireAuth);

  const getSharedDir = () => {
    const projectsPath = process.env.PROJECTS_PATH || path.join(__dirname, '../../../projects');
    return path.resolve(projectsPath, '..', 'shared');
  };

  const getSharedEnv = () => {
    const sharedDir = getSharedDir();
    const envPath = path.join(sharedDir, '.env.shared');
    if (fs.existsSync(envPath)) {
      return parseEnvFile(envPath);
    }
    return null;
  };

  /**
   * GET /api/shared/status
   * Returns status of all shared infrastructure services
   */
  router.get('/status', async (_req: Request, res: Response) => {
    try {
      const services = await dockerManager.getSharedServiceStatus();
      const sharedEnv = getSharedEnv();

      const running = services.filter((s) => s.status === 'running').length;
      const total = services.length;
      let status: 'running' | 'stopped' | 'degraded' = 'stopped';
      if (running === total && total > 0) status = 'running';
      else if (running > 0) status = 'degraded';

      const ports = {
        postgres: parseInt(sharedEnv?.SHARED_PG_PORT || '5432', 10),
        studio: parseInt(sharedEnv?.STUDIO_PORT || '3000', 10),
        analytics: parseInt(sharedEnv?.ANALYTICS_PORT || '4000', 10),
        pooler: parseInt(sharedEnv?.POOLER_PORT || '6543', 10),
        gateway: parseInt(
          sharedEnv?.SHARED_GATEWAY_PORT || sharedEnv?.KONG_HTTP_PORT || '8000',
          10
        ),
        meta: parseInt(sharedEnv?.META_PORT || '8080', 10),
      };

      // Optionally append shared disk usage (cached 30 min, may be null on first call)
      let diskUsedMB: number | null = null;
      if (metricsCollector) {
        diskUsedMB = await metricsCollector.getDiskUsageForShared();
      }

      const servicesWithPorts = services.map((service) => ({
        ...service,
        ports: getSharedServicePorts(service.name, ports),
      }));

      res.json({
        status,
        services: servicesWithPorts,
        ports,
        totalServices: total,
        runningServices: running,
        activeTenant: studioManager?.getActiveTenant() || null,
        diskUsedMB,
      });
    } catch (error: any) {
      logger.error('Error getting shared status:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/shared/logs
   * Get recent logs for the shared infrastructure containers.
   * A service can be selected using its short name (e.g. "db" or "studio").
   */
  router.get('/logs', requireScope(SCOPES.LOGS.READ), async (req: Request, res: Response) => {
    try {
      const requestedService = typeof req.query.service === 'string' ? req.query.service.trim() : '';
      const parsedTail = typeof req.query.tail === 'string' ? parseInt(req.query.tail, 10) : 100;
      const tail = Number.isFinite(parsedTail) ? Math.min(Math.max(parsedTail, 1), 1000) : 100;
      const containers = await dockerManager.listSharedContainers();

      const selectedContainers = requestedService
        ? containers.filter((container) => {
            const containerName = container.Names[0].replace('/', '');
            const shortName = containerName.replace('multibase-', '');
            return containerName === requestedService || shortName === requestedService;
          })
        : containers;

      if (requestedService && selectedContainers.length === 0) {
        return res.status(404).json({ error: `Shared service ${requestedService} not found` });
      }

      const logs: string[] = [];
      for (const container of selectedContainers) {
        const containerName = container.Names[0].replace('/', '');
        const rawLogs = await dockerManager.getContainerLogs(container.Id, {
          tail,
          timestamps: true,
        });

        rawLogs
          .split('\n')
          .filter((line) => line.trim())
          .forEach((line) => logs.push(`[${containerName}] ${line}`));
      }

      return res.json({ logs });
    } catch (error: any) {
      logger.error('Error getting shared infrastructure logs:', error);
      return res.status(500).json({ error: error.message || 'Failed to get shared logs' });
    }
  });

  /**
   * POST /api/shared/services/:service/restart
   * Restart one shared infrastructure container.
   */
  router.post(
    '/services/:service/restart',
    requireScope(SCOPES.INSTANCES.RESTART),
    auditLog('SHARED_SERVICE_RESTART', {
      getResource: (req) => req.params.service,
    }),
    async (req: Request, res: Response) => {
      try {
        await dockerManager.restartSharedService(req.params.service);
        return res.json({ message: `Shared service ${req.params.service} restarted successfully` });
      } catch (error: any) {
        logger.error(`Error restarting shared service ${req.params.service}:`, error);
        return res.status(500).json({ error: error.message || 'Failed to restart shared service' });
      }
    }
  );

  /**
   * POST /api/shared/start
   * Start shared infrastructure via docker compose
   */
  router.post('/start', requireAdmin, auditLog('SHARED_INFRA_START'), async (_req: Request, res: Response) => {
    try {
      const sharedDir = getSharedDir();
      const composePath = path.join(sharedDir, 'docker-compose.shared.yml');

      if (!fs.existsSync(composePath)) {
        res.status(400).json({ error: 'shared/docker-compose.shared.yml nicht gefunden' });
        return;
      }

      logger.info('Starting shared infrastructure...');
      const { stdout, stderr } = await execFileAsync(
        'docker',
        ['compose', '-f', 'docker-compose.shared.yml', '--env-file', '.env.shared', 'up', '-d'],
        { cwd: sharedDir }
      );

      logger.info(`Shared start output: ${stdout}`);
      if (stderr) logger.warn(`Shared start stderr: ${stderr}`);

      res.json({ success: true, message: 'Shared Infrastructure gestartet', output: stdout });
    } catch (error: any) {
      logger.error('Error starting shared infrastructure:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/shared/stop
   * Stop shared infrastructure
   */
  router.post('/stop', requireAdmin, auditLog('SHARED_INFRA_STOP'), async (_req: Request, res: Response) => {
    try {
      const sharedDir = getSharedDir();

      logger.info('Stopping shared infrastructure...');
      const { stdout } = await execFileAsync(
        'docker',
        ['compose', '-f', 'docker-compose.shared.yml', '--env-file', '.env.shared', 'down'],
        { cwd: sharedDir }
      );

      res.json({ success: true, message: 'Shared Infrastructure gestoppt', output: stdout });
    } catch (error: any) {
      logger.error('Error stopping shared infrastructure:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/shared/databases
   * List all project databases in the shared cluster
   * Uses docker exec to avoid Docker Desktop Windows TCP auth issues
   */
  router.get('/databases', async (_req: Request, res: Response) => {
    try {
      const { stdout } = await execFileAsync('docker', [
        'exec', 'multibase-db', 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-A', '-t',
        '-c', "SELECT datname, pg_database_size(datname) FROM pg_database WHERE datname LIKE 'project_%' ORDER BY datname;",
      ]);

      const databases = stdout
        .trim()
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => {
          const [datname, sizeStr] = line.split('|');
          const bytes = parseInt(sizeStr, 10) || 0;
          return {
            name: datname,
            projectName: datname.replace('project_', '').replace(/_/g, '-'),
            sizeBytes: bytes,
            sizeFormatted: formatBytes(bytes),
          };
        });

      res.json({ databases, count: databases.length });
    } catch (error: any) {
      logger.error('Error listing databases:', error);
      res.status(500).json({ error: error.message || 'Failed to list databases' });
    }
  });

  /**
   * POST /api/shared/databases
   * Create a new project database
   * Uses docker exec to avoid Docker Desktop Windows TCP auth issues
   */
  router.post('/databases', requireAdmin, auditLog('SHARED_DATABASE_CREATE', { includeBody: true, getResource: (req) => req.body?.projectName || 'unknown' }), async (req: Request, res: Response) => {
    try {
      const { projectName } = req.body;
      const dbName = projectDatabaseName(projectName);
      if (!dbName) {
        res.status(400).json({ error: 'projectName must contain only lowercase letters, numbers, and single hyphens' });
        return;
      }

      await execFileAsync('docker', [
        'exec', 'multibase-db', 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1',
        '-c', `CREATE DATABASE "${dbName}";`,
      ]);

      logger.info(`Created database: ${dbName}`);
      res.json({ success: true, database: dbName });
    } catch (error: any) {
      logger.error('Error creating database:', error);
      res.status(500).json({ error: error.message || 'Failed to create database' });
    }
  });

  /**
   * DELETE /api/shared/databases/:name
   * Drop a project database
   * Uses docker exec to avoid Docker Desktop Windows TCP auth issues
   */
  router.delete('/databases/:name', requireAdmin, auditLog('SHARED_DATABASE_DROP', { getResource: (req) => req.params.name }), async (req: Request, res: Response) => {
    try {
      const dbName = projectDatabaseName(req.params.name);
      if (!dbName) {
        res.status(400).json({ error: 'Invalid project database name' });
        return;
      }

      // Terminate active connections first, then drop
      await execFileAsync('docker', [
        'exec', 'multibase-db', 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1',
        '-c', `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${dbName}' AND pid<>pg_backend_pid();`,
        '-c', `DROP DATABASE IF EXISTS "${dbName}";`,
      ]);

      logger.info(`Dropped database: ${dbName}`);
      res.json({ success: true, database: dbName });
    } catch (error: any) {
      logger.error('Error dropping database:', error);
      res.status(500).json({ error: error.message || 'Failed to drop database' });
    }
  });

  return router;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function getSharedServicePorts(
  serviceName: string,
  ports: { postgres: number; studio: number; analytics: number; pooler: number; gateway: number; meta: number }
) {
  const definitions: Record<string, Array<{
    label: string;
    host?: number;
    container: number;
    protocol: 'tcp' | 'http';
    public: boolean;
  }>> = {
    db: [{ label: 'PostgreSQL', host: ports.postgres, container: 5432, protocol: 'tcp', public: true }],
    studio: [{ label: 'Studio', host: ports.studio, container: 3000, protocol: 'http', public: true }],
    analytics: [{ label: 'Logflare API', host: ports.analytics, container: 4000, protocol: 'http', public: true }],
    'nginx-gateway': [{ label: 'HTTP Gateway', host: ports.gateway, container: 8000, protocol: 'http', public: true }],
    pooler: [
      { label: 'PgBouncer / Supavisor', host: ports.pooler, container: 6543, protocol: 'tcp', public: true },
      { label: 'Supavisor API', container: 4000, protocol: 'http', public: false },
    ],
    meta: [{ label: 'Postgres Meta API', container: ports.meta, protocol: 'http', public: false }],
    vector: [{ label: 'Vector health', container: 9001, protocol: 'http', public: false }],
    imgproxy: [{ label: 'imgproxy', container: 5001, protocol: 'http', public: false }],
  };

  return definitions[serviceName] || [];
}

export default createSharedRoutes;
