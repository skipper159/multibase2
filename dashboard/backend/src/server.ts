import express from 'express';
import { createServer } from 'http';
import { execSync } from 'child_process';
import { version as pkgVersion } from '../package.json';

function getVersion(): string {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    const map: Record<string, string> = {
      Feature_Roadmap: '3.0.0',
      'cloud-version': '2.0.0',
      main: '1.0.0',
    };
    return map[branch] ?? pkgVersion;
  } catch {
    return pkgVersion;
  }
}

const version = getVersion();
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import path from 'path';
import prisma from './lib/prisma';

// Services
import DockerManager from './services/DockerManager';
import InstanceManager from './services/InstanceManager';
import HealthMonitor from './services/HealthMonitor';
import MetricsCollector from './services/MetricsCollector';
import { RedisCache } from './services/RedisCache';
import { startAlertMonitor } from './services/AlertMonitorService';
import SchedulerService from './services/SchedulerService';

// Routes
import { createInstanceRoutes } from './routes/instances';
import { createMetricsRoutes } from './routes/metrics';
import { createHealthRoutes } from './routes/health';
import { createLogsRoutes } from './routes/logs';
import { createAlertRoutes } from './routes/alerts';
import { createAuthRoutes } from './routes/auth';
import { createInstanceAuthRoutes } from './routes/instance-auth';
import { createBackupRoutes } from './routes/backups';
import { createBackupDestinationRoutes } from './routes/backupDestinations';
import { createProxyRoutes } from './routes/proxy';
import { createAuditRoutes } from './routes/audit';
import { createApiKeyRoutes } from './routes/apiKeys';
import { createTemplateRoutes } from './routes/templates';
import { createScheduleRoutes } from './routes/schedules';
import { createNotificationRoutes } from './routes/notifications';
import { createSettingsRoutes } from './routes/settings';
import { createMigrationRoutes } from './routes/migrations';
import { createDeploymentsRoutes } from './routes/deployments';
import { createEmailTemplateRoutes } from './routes/emailTemplates';
import { createUptimeRoutes } from './routes/uptime';
import { createFunctionRoutes } from './routes/functions';
import { UptimeService } from './services/UptimeService';
import { FunctionService } from './services/FunctionService';
import { StorageService } from './services/StorageService';
import { createStorageRoutes } from './routes/storage';
import { createSharedRoutes } from './routes/shared';
import { createStudioRoutes } from './routes/studio';
import { createAiAgentRoutes } from './routes/ai-agent';
import { AiAgentService } from './services/AiAgentService';
import { StudioManager } from './services/StudioManager';
import { createOrgRoutes } from './routes/orgs';
import { createWebhookRoutes } from './routes/webhooks';
import { createCronRoutes } from './routes/cron';
import { createVectorRoutes } from './routes/vectors';
import { createQueueRoutes } from './routes/queues';
import { WebhookService } from './services/WebhookService';
import { CronService } from './services/CronService';
import { CustomDomainService } from './services/CustomDomainService';
import { createDomainRoutes } from './routes/domains';
import { createVaultRoutes } from './routes/vault';
import { createSecurityRoutes } from './routes/security';
import { createRealtimeRoutes } from './routes/realtime';
import { createReplicaRoutes } from './routes/replicas';
import { createLogDrainRoutes } from './routes/log-drains';
import { createMcpRoutes } from './routes/mcp';
import McpService from './services/McpService';
import { LogDrainService } from './services/LogDrainService';
import { VectorService } from './services/VectorService';
import { QueueService } from './services/QueueService';
import { createMarketplaceRoutes } from './routes/marketplace';
import { createExtensionRoutes } from './routes/extensions';
import { ExtensionUpdateChecker } from './services/ExtensionUpdateChecker';
import { createFeedbackRoutes } from './routes/feedback';
import { createUpdateRoutes } from './routes/updates';
import { UpdateService } from './services/UpdateService';

// Utils
import { logger } from './utils/logger';
import AuthService from './services/AuthService';

// Load environment variables
dotenv.config();

const PORT = parseInt(process.env.PORT || '3001', 10);
// Parse CORS origins - supports comma-separated list for multiple origins
const configuredCorsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((origin) => origin.trim())
  : ['http://localhost:5173', 'http://localhost:5174'];

const isOriginAllowed = (origin: string | undefined): boolean => {
  if (!origin) return true;
  if (configuredCorsOrigins.includes(origin)) return true;
  // Allow any localhost / 127.0.0.1 port in dev / local environment
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return false;
};

const PROJECTS_PATH = process.env.PROJECTS_PATH || path.join(process.cwd(), '../../projects');
const DOCKER_SOCKET_PATH = process.env.DOCKER_SOCKET_PATH;
const METRICS_INTERVAL = parseInt(process.env.METRICS_INTERVAL || '15000', 10);
const HEALTH_CHECK_INTERVAL = parseInt(process.env.HEALTH_CHECK_INTERVAL || '10000', 10);

// Initialize Express app
const app = express();
app.set('trust proxy', 1); // Trust first proxy (Nginx)
const httpServer = createServer(app);

// Initialize Socket.IO
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: (origin, callback) => {
      callback(null, isOriginAllowed(origin));
    },
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
  // Trust proxy headers when behind nginx reverse proxy
  // Allows Socket.io to detect real client IP and protocol from X-Forwarded-* headers
  path: '/socket.io/',
});

// Middleware
import { requestId } from './middleware/requestId';
app.use(requestId);
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"], // unsafe-inline needed for Vite HMR in dev
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'", '*', 'wss:', 'ws:'],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  })
);
app.use(
  cors({
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS error: Origin ${origin} is not allowed.`));
      }
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

// Static file serving for uploads (avatars)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Static file serving for extension manifests + SQL files
app.use('/extensions', express.static(path.join(__dirname, '../extensions')));

import { apiKeyAuth } from './middleware/apiKeyAuth';

// ...

// Request logging
app.use((req, _res, next) => {
  logger.info(`${req.method} ${req.path} [${req.requestId}]`);
  next();
});

// API Key Authentication (Passive)
app.use(apiKeyAuth);

// Initialize services
const dockerManager = new DockerManager(DOCKER_SOCKET_PATH);
const redisCache = new RedisCache();
const instanceManager = new InstanceManager(PROJECTS_PATH, dockerManager, prisma, redisCache);
const healthMonitor = new HealthMonitor(
  dockerManager,
  instanceManager,
  redisCache,
  HEALTH_CHECK_INTERVAL
);
const metricsCollector = new MetricsCollector(
  dockerManager,
  instanceManager,
  redisCache,
  prisma,
  METRICS_INTERVAL
);
const uptimeService = new UptimeService(prisma, instanceManager);
const functionService = new FunctionService(dockerManager, PROJECTS_PATH);
const storageService = new StorageService(instanceManager);
const studioManager = new StudioManager(PROJECTS_PATH, dockerManager);
const webhookService = new WebhookService(instanceManager);
const cronService = new CronService(instanceManager);
const customDomainService = new CustomDomainService(prisma, PROJECTS_PATH);
const vectorService = new VectorService(instanceManager);
const queueService = new QueueService(instanceManager);
const logDrainService = new LogDrainService(prisma, dockerManager);
const mcpService = new McpService(
  instanceManager,
  dockerManager,
  metricsCollector,
  prisma,
  functionService,
  storageService
);
const updateService = new UpdateService(dockerManager, path.resolve(__dirname, '../../..'), PROJECTS_PATH);

// Register services with Scheduler
SchedulerService.registerUptimeService(uptimeService);

// API Routes
app.use(
  '/api/instances',
  createInstanceRoutes(instanceManager, dockerManager, prisma, metricsCollector, updateService)
);
app.use('/api/metrics', createMetricsRoutes(metricsCollector, redisCache));
app.use('/api/health', createHealthRoutes(healthMonitor, prisma, redisCache, dockerManager));
app.use('/api/logs', createLogsRoutes(dockerManager));
app.use('/api/alerts', createAlertRoutes());
app.use('/api/auth', createAuthRoutes());
app.use('/api/auth', createInstanceAuthRoutes());
app.use('/api/backups', createBackupRoutes());
app.use('/api/backup-destinations', createBackupDestinationRoutes());
app.use('/api/proxy', createProxyRoutes(instanceManager));
app.use('/api/audit', createAuditRoutes());
app.use('/api/keys', createApiKeyRoutes());
app.use('/api/templates', createTemplateRoutes(instanceManager));
app.use('/api/schedules', createScheduleRoutes());
app.use('/api/notifications', createNotificationRoutes());
app.use('/api/settings', createSettingsRoutes());
app.use('/api/migrations', createMigrationRoutes());
app.use('/api/deployments', createDeploymentsRoutes());
app.use('/api/instances', createEmailTemplateRoutes(instanceManager, prisma));
app.use('/api/instances', createUptimeRoutes(uptimeService));
app.use('/api/instances/:name/functions', createFunctionRoutes(functionService, instanceManager));
app.use('/api/instances/:name/storage', createStorageRoutes(storageService));
app.use('/api/orgs', createOrgRoutes());
app.use('/api/instances/:name/webhooks', createWebhookRoutes(webhookService));
app.use('/api/instances/:name/domains', createDomainRoutes(customDomainService));
app.use('/api/instances/:name/vault', createVaultRoutes(instanceManager));
app.use('/api/instances/:name/security', createSecurityRoutes(instanceManager, PROJECTS_PATH));
app.use('/api/instances/:name/cron', createCronRoutes(cronService));
app.use('/api/instances/:name/vectors', createVectorRoutes(vectorService));
app.use('/api/instances/:name/queues', createQueueRoutes(queueService));
app.use('/api/instances/:name/realtime', createRealtimeRoutes(instanceManager, dockerManager));
app.use('/api/instances/:name/replicas', createReplicaRoutes(instanceManager, prisma));
app.use(
  '/api/instances/:name/log-drains',
  createLogDrainRoutes(prisma, instanceManager, logDrainService)
);
app.use('/api/mcp', createMcpRoutes(mcpService));
app.use('/api/shared', createSharedRoutes(dockerManager, studioManager, metricsCollector));
app.use('/api/studio', createStudioRoutes(studioManager));
app.use('/api/marketplace', createMarketplaceRoutes(prisma));
app.use('/api/feedback', createFeedbackRoutes(prisma));
app.use(
  '/api/instances/:name/extensions',
  createExtensionRoutes(prisma, instanceManager, redisCache, functionService)
);

// AI Agent
const aiAgentService = new AiAgentService(prisma, instanceManager, dockerManager, {
  metricsCollector,
  redisCache,
  uptimeService,
  functionService,
  storageService,
});
app.use('/api/ai-agent', createAiAgentRoutes(aiAgentService, prisma));
app.use('/api/updates', createUpdateRoutes(updateService, io));

// Health check endpoint for the dashboard itself
app.get('/api/ping', async (_req, res) => {
  try {
    const dockerOk = await dockerManager.ping();
    const redisOk = await redisCache.ping();

    res.json({
      status: 'ok',
      services: {
        docker: dockerOk,
        redis: redisOk,
      },
      timestamp: new Date(),
    });
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(500).json({
      status: 'error',
      error: 'Health check failed',
    });
  }
});

// Root endpoint
app.get('/', (_req, res) => {
  res.json({
    name: 'Multibase Dashboard API',
    version,
    status: 'running',
  });
});

// Socket.IO connection handling
io.on('connection', socket => {
  logger.info(`Client connected: ${socket.id}`);

  // Socket error handling
  socket.on('error', error => {
    logger.error(`Socket error for client ${socket.id}:`, error);
  });

  // NOTE: Removed slow listInstances() call from connection handler
  // The frontend already fetches instances via GET /api/instances
  // Socket.io is only used for real-time updates (health changes, metrics)
  // Calling listInstances() here was causing 54-second delay and connection timeouts

  // Subscribe to log streaming
  socket.on('logs:subscribe', async (data: { instanceName: string; serviceName: string }) => {
    try {
      const { instanceName, serviceName } = data;
      logger.info(`Client ${socket.id} subscribed to logs: ${instanceName}:${serviceName}`);

      const containers = instanceName === 'shared-infrastructure'
        ? await dockerManager.listSharedContainers()
        : await dockerManager.listProjectContainers(instanceName);
      const selectedContainers = serviceName
        ? containers.filter(c => {
            const containerName = c.Names[0].replace('/', '');
            const shortName = containerName.replace('multibase-', '');
            return containerName === serviceName || shortName === serviceName || containerName.includes(serviceName);
          })
        : containers;

      for (const container of selectedContainers) {
        dockerManager.streamContainerLogs(container.Id, chunk => {
          socket.emit('logs:data', {
            instanceName,
            serviceName,
            data: chunk,
          });
        });
      }
    } catch (error) {
      logger.error('Error subscribing to logs:', error);
      socket.emit('logs:error', { error: 'Failed to subscribe to logs' });
    }
  });

  // Unsubscribe from logs
  socket.on('logs:unsubscribe', () => {
    logger.info(`Client ${socket.id} unsubscribed from logs`);
    // Cleanup would go here
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    logger.info(`Client disconnected: ${socket.id}`);
  });
});

// Event handlers for real-time updates

// Health status changes
healthMonitor.on('health:changed', event => {
  logger.info('Health changed event:', event);
  io.emit('health:update', event);
});

// Alert triggers
healthMonitor.on('alert:triggered', event => {
  logger.warn('Alert triggered:', event);
  io.emit('alert:triggered', event);
});

// Metrics collected
metricsCollector.on('metrics:collected', metrics => {
  io.emit('metrics:update', metrics);
});

// Start background services
async function startServices() {
  try {
    logger.info('Starting background services...');

    // Check Docker connectivity
    const dockerOk = await dockerManager.ping();
    if (!dockerOk) {
      logger.error('Docker is not accessible. Please check Docker daemon.');
      process.exit(1);
    }

    // Check Redis connectivity
    const redisOk = await redisCache.ping();
    if (!redisOk) {
      logger.warn('Redis is not accessible. Caching will be disabled.');
    }

    // Start health monitoring
    healthMonitor.start();

    // Start metrics collection
    metricsCollector.start();

    // Start alert monitoring (checks rules every 60s)
    startAlertMonitor();

    // Start backup scheduler
    SchedulerService.start();

    // Start log drain delivery
    logDrainService.start();

    // Start extension update checker (runs once after 30s, then weekly)
    const extensionUpdateChecker = new ExtensionUpdateChecker(prisma);
    extensionUpdateChecker.on('update:available', evt => {
      logger.info(
        `Extension update available: ${evt.extensionId} ${evt.currentVersion} → ${evt.latestVersion}`
      );
      io.emit('extension:update-available', evt);
    });
    extensionUpdateChecker.start();
    // Store reference for graceful shutdown
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (app as any)._extensionUpdateChecker = extensionUpdateChecker;

    logger.info('Background services started successfully');
  } catch (error) {
    logger.error('Error starting services:', error);
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown() {
  logger.info('Shutting down gracefully...');

  healthMonitor.stop();
  metricsCollector.stop();
  SchedulerService.stop();
  logDrainService.stop();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (app as any)._extensionUpdateChecker?.stop();

  await redisCache.close();
  await prisma.$disconnect();

  httpServer.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });

  // Force close after 10 seconds
  setTimeout(() => {
    logger.error('Forcing shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Error handlers
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
  logger.error('Unhandled Rejection at:', {
    promise: promise.toString(),
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

process.on('uncaughtException', error => {
  logger.error('Uncaught Exception:', error);
  shutdown();
});

// Start server
async function seedMarketplace(): Promise<void> {
  const { MARKETPLACE_EXTENSIONS } = await import('./data/marketplace-extensions');
  let created = 0;
  let updated = 0;

  for (const ext of MARKETPLACE_EXTENSIONS) {
    const existing = await prisma.extension.findUnique({ where: { id: ext.id as string } });
    if (existing) {
      await prisma.extension.update({ where: { id: ext.id as string }, data: ext });
      updated++;
    } else {
      await prisma.extension.create({ data: ext });
      created++;
    }
  }

  if (created > 0 || updated > 0) {
    logger.info(
      `Marketplace sync: +${created} new, ${updated} updated (${MARKETPLACE_EXTENSIONS.length} total)`
    );
  }
}

async function start() {
  try {
    // Create initial admin user if needed
    await AuthService.createInitialAdmin();

    // Sync marketplace catalog (adds new extensions, updates existing)
    await seedMarketplace();

    await startServices();

    httpServer.listen(PORT, '127.0.0.1', () => {
      logger.info(`🚀 Multibase Dashboard API running on 127.0.0.1:${PORT}`, {
        service: 'multibase-dashboard',
      });
      logger.info(`📂 Projects Path: ${PROJECTS_PATH} (resolved: ${path.resolve(PROJECTS_PATH)})`, {
        service: 'multibase-dashboard',
      });
      logger.info(`📊 WebSocket server ready`, { service: 'multibase-dashboard' });
      logger.info(`🔗 CORS enabled for: ${configuredCorsOrigins.join(', ')}`, { service: 'multibase-dashboard' });
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
