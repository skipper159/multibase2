import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import HealthMonitor from '../services/HealthMonitor';
import { RedisCache } from '../services/RedisCache';
import DockerManager from '../services/DockerManager';
import { logger } from '../utils/logger';

// Package.json version (fallback if not available)
const VERSION = process.env.npm_package_version || '1.0.0';
const startTime = Date.now();

interface HealthCheck {
  status: 'ok' | 'error';
  latency?: number;
  message?: string;
  details?: any;
}

interface HealthResponse {
  status: 'ok' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  checks: {
    database: HealthCheck;
    redis: HealthCheck;
    docker: HealthCheck;
  };
}

export function createHealthRoutes(
  healthMonitor: HealthMonitor,
  prisma?: PrismaClient,
  redisCache?: RedisCache,
  dockerManager?: DockerManager
): Router {
  const router = Router();

  /**
   * Check database connectivity
   */
  async function checkDatabase(): Promise<HealthCheck> {
    const start = Date.now();
    try {
      if (!prisma) {
        return { status: 'error', message: 'Prisma client not available' };
      }
      await prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', latency: Date.now() - start };
    } catch (error) {
      return {
        status: 'error',
        latency: Date.now() - start,
        message: error instanceof Error ? error.message : 'Database connection failed',
      };
    }
  }

  /**
   * Check Redis connectivity
   */
  async function checkRedis(): Promise<HealthCheck> {
    const start = Date.now();
    try {
      if (!redisCache) {
        return { status: 'error', message: 'Redis cache not available' };
      }
      const isOk = await redisCache.ping();
      if (isOk) {
        return { status: 'ok', latency: Date.now() - start };
      }
      return { status: 'error', latency: Date.now() - start, message: 'Redis ping failed' };
    } catch (error) {
      return {
        status: 'error',
        latency: Date.now() - start,
        message: error instanceof Error ? error.message : 'Redis connection failed',
      };
    }
  }

  /**
   * Check Docker connectivity
   */
  async function checkDocker(): Promise<HealthCheck> {
    const start = Date.now();
    try {
      if (!dockerManager) {
        return { status: 'error', message: 'Docker manager not available' };
      }
      const isOk = await dockerManager.ping();
      if (isOk) {
        return {
          status: 'ok',
          latency: Date.now() - start,
        };
      }
      return { status: 'error', latency: Date.now() - start, message: 'Docker ping failed' };
    } catch (error) {
      return {
        status: 'error',
        latency: Date.now() - start,
        message: error instanceof Error ? error.message : 'Docker connection failed',
      };
    }
  }

  /**
   * GET /api/health
   * Full health check with all dependencies
   */
  router.get('/', async (_req: Request, res: Response) => {
    try {
      const [database, redis, docker] = await Promise.all([
        checkDatabase(),
        checkRedis(),
        checkDocker(),
      ]);

      const checks = { database, redis, docker };
      const checkResults = Object.values(checks);
      const allOk = checkResults.every((c) => c.status === 'ok');
      const allFailed = checkResults.every((c) => c.status === 'error');

      let status: 'ok' | 'degraded' | 'unhealthy';
      if (allOk) {
        status = 'ok';
      } else if (allFailed) {
        status = 'unhealthy';
      } else {
        status = 'degraded';
      }

      const response: HealthResponse = {
        status,
        timestamp: new Date().toISOString(),
        uptime: Math.floor((Date.now() - startTime) / 1000),
        version: VERSION,
        checks,
      };

      const httpStatus = status === 'unhealthy' ? 503 : status === 'degraded' ? 200 : 200;
      res.status(httpStatus).json(response);
    } catch (error) {
      logger.error('Error in health check:', error);
      res.status(503).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: 'Health check failed',
      });
    }
  });

  /**
   * GET /api/health/live
   * Kubernetes Liveness probe - is the server responding?
   */
  router.get('/live', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  /**
   * GET /api/health/ready
   * Kubernetes Readiness probe - are all dependencies ready?
   */
  router.get('/ready', async (_req: Request, res: Response) => {
    try {
      const [database, _redis, docker] = await Promise.all([
        checkDatabase(),
        checkRedis(),
        checkDocker(),
      ]);

      // For readiness, we need at least database and docker to be ok
      // Redis is optional (in-memory fallback available)
      const isReady = database.status === 'ok' && docker.status === 'ok';

      if (isReady) {
        res.json({
          status: 'ok',
          ready: true,
          timestamp: new Date().toISOString(),
        });
      } else {
        res.status(503).json({
          status: 'error',
          ready: false,
          timestamp: new Date().toISOString(),
          failed: {
            database: database.status !== 'ok' ? database.message : undefined,
            docker: docker.status !== 'ok' ? docker.message : undefined,
          },
        });
      }
    } catch (error) {
      res.status(503).json({
        status: 'error',
        ready: false,
        timestamp: new Date().toISOString(),
      });
    }
  });

  /**
   * GET /api/health/instances/:name
   * Get health status for a specific instance
   */
  router.get('/instances/:name', async (req: Request, res: Response): Promise<any> => {
    try {
      const { name } = req.params;
      const health = await healthMonitor.getCachedHealth(name);

      if (!health) {
        // If not cached, fetch fresh
        const freshHealth = await healthMonitor.refreshInstanceHealth(name);
        return res.json(freshHealth);
      }

      res.json(health);
    } catch (error) {
      logger.error(`Error getting health for ${req.params.name}:`, error);
      res.status(500).json({ error: 'Failed to get health status' });
    }
  });

  /**
   * POST /api/health/instances/:name/refresh
   * Force refresh health status for an instance
   */
  router.post('/instances/:name/refresh', async (req: Request, res: Response) => {
    try {
      const { name } = req.params;
      const health = await healthMonitor.refreshInstanceHealth(name);
      res.json(health);
    } catch (error) {
      logger.error(`Error refreshing health for ${req.params.name}:`, error);
      res.status(500).json({ error: 'Failed to refresh health status' });
    }
  });

  return router;
}
