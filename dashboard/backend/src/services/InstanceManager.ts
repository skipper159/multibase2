import fs from 'fs';
import path from 'path';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { PrismaClient } from '@prisma/client';
import yaml from 'js-yaml';

import {
  CreateInstanceRequest,
  SupabaseInstance,
  InstanceCredentials,
  PortMapping,
} from '../types';
import { generateAllKeys } from '../utils/keyGenerator';
import { calculatePorts, getRandomBasePort } from '../utils/portManager';
import {
  parseEnvFile,
  extractCredentials,
  extractPorts,
  writeEnvFile,
  backupEnvFile,
} from '../utils/envParser';
import { logger } from '../utils/logger';
import DockerManager from './DockerManager';
import { RedisCache } from './RedisCache';

const execAsync = promisify(exec);

export class InstanceManager {
  private projectsPath: string;
  private templatesPath: string;
  private dockerManager: DockerManager;
  private prisma: PrismaClient;
  private redisCache?: RedisCache;

  constructor(
    projectsPath: string,
    dockerManager: DockerManager,
    prisma: PrismaClient,
    redisCache?: RedisCache
  ) {
    this.projectsPath = path.resolve(projectsPath);
    this.templatesPath = path.resolve(path.join(projectsPath, '..'));
    this.dockerManager = dockerManager;
    this.prisma = prisma;
    this.redisCache = redisCache;

    // Ensure projects directory exists
    if (!fs.existsSync(this.projectsPath)) {
      fs.mkdirSync(this.projectsPath, { recursive: true });
      logger.info(`Created projects directory: ${this.projectsPath}`);
    }
  }

  /**
   * List all Supabase instances
   */
  async listInstances(): Promise<SupabaseInstance[]> {
    try {
      if (!fs.existsSync(this.projectsPath)) {
        return [];
      }

      const projectDirs = fs
        .readdirSync(this.projectsPath, { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => dirent.name);

      // Parallelize instance loading for better performance
      const instancePromises = projectDirs.map(async (projectName) => {
        try {
          const instance = await this.getInstance(projectName);
          return instance;
        } catch (error) {
          logger.warn(`Error loading instance ${projectName}:`, error);
          return null;
        }
      });

      const results = await Promise.all(instancePromises);
      const instances = results.filter(
        (instance): instance is SupabaseInstance => instance !== null
      );

      return instances;
    } catch (error) {
      logger.error('Error listing instances:', error);
      throw error;
    }
  }

  /**
   * Get a specific instance by name
   */
  async getInstance(name: string): Promise<SupabaseInstance | null> {
    try {
      const projectPath = path.join(this.projectsPath, name);
      const envPath = path.join(projectPath, '.env');

      if (!fs.existsSync(projectPath) || !fs.existsSync(envPath)) {
        return null;
      }

      // Parse .env file
      const envConfig = parseEnvFile(envPath);
      const credentials = extractCredentials(envConfig);
      const ports = extractPorts(envConfig);

      // Get service status from Docker
      const services = await this.dockerManager.getServiceStatus(name);

      // Calculate health status
      const healthyServices = services.filter((s) => s.health === 'healthy').length;
      const totalServices = services.length;

      let overallStatus: 'healthy' | 'degraded' | 'unhealthy' | 'stopped' = 'stopped';
      const runningServices = services.filter((s) => s.status === 'running').length;

      if (runningServices === 0) {
        overallStatus = 'stopped';
      } else if (healthyServices === totalServices) {
        overallStatus = 'healthy';
      } else if (healthyServices > 0) {
        overallStatus = 'degraded';
      } else {
        overallStatus = 'unhealthy';
      }

      // Get created/updated timestamps from directory stats
      const stats = fs.statSync(projectPath);

      // Get aggregated metrics from Redis if available
      let metrics;
      if (this.redisCache) {
        try {
          const metricsMap = await this.redisCache.getAllMetrics(name);
          let totalCpu = 0;
          let totalMemory = 0;
          let totalNetworkRx = 0;
          let totalNetworkTx = 0;
          let totalDiskRead = 0;
          let totalDiskWrite = 0;
          let latestTimestamp = new Date();

          metricsMap.forEach((value) => {
            if (value) {
              totalCpu += value.cpu || 0;
              totalMemory += value.memory || 0;
              totalNetworkRx += value.networkRx || 0;
              totalNetworkTx += value.networkTx || 0;
              totalDiskRead += value.diskRead || 0;
              totalDiskWrite += value.diskWrite || 0;
              if (value.timestamp) {
                latestTimestamp = new Date(value.timestamp);
              }
            }
          });

          if (metricsMap.size > 0) {
            metrics = {
              cpu: totalCpu,
              memory: totalMemory,
              networkRx: totalNetworkRx,
              networkTx: totalNetworkTx,
              diskRead: totalDiskRead,
              diskWrite: totalDiskWrite,
              timestamp: latestTimestamp,
            };
          }
        } catch (error) {
          logger.warn(`Failed to get metrics from Redis for ${name}:`, error);
        }
      }

      return {
        id: name,
        name,
        status: overallStatus,
        basePort: ports.kong_http,
        ports,
        credentials,
        services,
        health: {
          overall: overallStatus,
          healthyServices,
          totalServices,
          lastChecked: new Date(),
        },
        metrics,
        createdAt: stats.birthtime,
        updatedAt: stats.mtime,
      };
    } catch (error) {
      logger.error(`Error getting instance ${name}:`, error);
      return null;
    }
  }

  /**
   * Create a new Supabase instance
   */
  async createInstance(request: CreateInstanceRequest): Promise<SupabaseInstance> {
    const { name, basePort } = request;

    logger.info(`Creating new instance: ${name}`);

    // Validate name
    if (!/^[a-z0-9-]+$/.test(name)) {
      throw new Error('Instance name must contain only lowercase letters, numbers, and hyphens');
    }

    // Check if instance already exists
    const existing = await this.getInstance(name);
    if (existing) {
      throw new Error(`Instance ${name} already exists`);
    }

    const projectPath = path.join(this.projectsPath, name);

    try {
      // Use the existing Python setup script instead of custom logic
      const setupScript = path.join(this.templatesPath, 'supabase_manager.py');

      if (!fs.existsSync(setupScript)) {
        throw new Error(
          'supabase_manager.py not found. Please ensure it exists in the root directory.'
        );
      }

      // Build command
      const args = ['create', name];
      if (basePort) {
        args.push('--base-port', basePort.toString());
      }

      logger.info(`Running: python ${setupScript} ${args.join(' ')}`);

      // Execute the Python script with stdin input
      const pythonCmd =
        process.env.PYTHON_PATH || (process.platform === 'win32' ? 'python' : 'python3');

      const output = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn(pythonCmd, [setupScript, ...args], {
          cwd: this.templatesPath,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        child.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        child.on('error', (error) => {
          reject(error);
        });

        child.on('close', (code) => {
          if (code !== 0) {
            reject(new Error(`Python script exited with code ${code}\nStderr: ${stderr}`));
          } else {
            resolve({ stdout, stderr });
          }
        });

        // Send "Y\n" to stdin for localhost question
        child.stdin.write('Y\n');
        child.stdin.end();
      });

      const { stdout, stderr } = output;

      if (stderr && !stderr.includes('Warning')) {
        logger.warn(`Script warnings: ${stderr}`);
      }

      logger.info(`Script output: ${stdout}`);
      logger.info(`Successfully created instance: ${name}`);

      // Get and return the created instance
      const instance = await this.getInstance(name);
      if (!instance) {
        throw new Error('Failed to retrieve created instance');
      }

      // Store instance in database for metrics and tracking
      try {
        await this.prisma.instance.create({
          data: {
            id: name,
            name: name,
            status: instance.status,
            basePort: instance.basePort,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
        logger.info(`Instance ${name} stored in database`);
      } catch (dbError: any) {
        // Instance might already exist from previous attempt
        if (dbError.code === 'P2002') {
          logger.warn(`Instance ${name} already exists in database`);
        } else {
          logger.error(`Error storing instance in database:`, dbError);
        }
      }

      return instance;
    } catch (error) {
      // Cleanup on failure
      if (fs.existsSync(projectPath)) {
        fs.rmSync(projectPath, { recursive: true, force: true });
      }
      logger.error(`Error creating instance ${name}:`, error);
      throw error;
    }
  }

  /**
   * Generate .env configuration
   */
  private generateEnvConfig(
    projectName: string,
    ports: PortMapping,
    keys: ReturnType<typeof generateAllKeys>,
    apiExternalUrl: string,
    studioUrl: string,
    corsOrigins: string[]
  ): Record<string, string> {
    const corsOriginsStr = corsOrigins.length > 0 ? corsOrigins.join(',') : apiExternalUrl;

    return {
      // Project Info
      PROJECT_NAME: projectName,

      // Ports
      KONG_HTTP_PORT: `${ports.kong_http}`,
      KONG_HTTPS_PORT: `${ports.kong_https}`,
      STUDIO_PORT: `${ports.studio}`,
      POSTGRES_PORT: `${ports.postgres}`,
      POOLER_PORT: `${ports.pooler}`,
      ANALYTICS_PORT: `${ports.analytics}`,

      // Database
      POSTGRES_PASSWORD: keys.postgres_password,
      POSTGRES_HOST: 'db',
      POSTGRES_DB: 'postgres',
      POSTGRES_USER: 'postgres',

      // JWT
      JWT_SECRET: keys.jwt_secret,
      ANON_KEY: keys.anon_key,
      SERVICE_ROLE_KEY: keys.service_role_key,

      // Dashboard
      DASHBOARD_USERNAME: keys.dashboard_username,
      DASHBOARD_PASSWORD: keys.dashboard_password,

      // URLs
      API_EXTERNAL_URL: apiExternalUrl,
      SUPABASE_PUBLIC_URL: apiExternalUrl,
      PUBLIC_REST_URL: apiExternalUrl,
      STUDIO_URL: studioUrl,

      // Studio
      STUDIO_DEFAULT_ORGANIZATION: projectName,
      STUDIO_DEFAULT_PROJECT: projectName,

      // Auth
      SITE_URL: apiExternalUrl,
      ADDITIONAL_REDIRECT_URLS: '',
      JWT_EXPIRY: '3600',
      DISABLE_SIGNUP: 'false',
      API_EXTERNAL_URL_FINAL: apiExternalUrl,

      // Email (can be configured later)
      SMTP_ADMIN_EMAIL: 'admin@example.com',
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '587',
      SMTP_USER: '',
      SMTP_PASS: '',
      SMTP_SENDER_NAME: projectName,

      // Storage
      STORAGE_BACKEND: 'file',
      STORAGE_FILE_PATH: '/var/lib/storage',
      GLOBAL_S3_BUCKET: '',

      // Secrets
      SECRET_KEY_BASE: keys.secret_key_base,
      VAULT_ENC_KEY: keys.vault_enc_key,

      // Analytics
      LOGFLARE_API_KEY: keys.logflare_api_key,

      // CORS
      ADDITIONAL_ALLOWED_ORIGINS: corsOriginsStr,

      // Realtime
      REALTIME_TENANT_ID: 'realtime-dev',
      REALTIME_MAX_CONCURRENT_USERS: '200',

      // Rate Limiting
      RATE_LIMIT_ANON: '100',
      RATE_LIMIT_AUTHENTICATED: '200',
    };
  }

  /**
   * Copy and customize docker-compose template
   */
  private async copyDockerComposeTemplate(projectPath: string, projectName: string): Promise<void> {
    const templatePath = path.join(this.templatesPath, 'docker-compose.yml');
    const targetPath = path.join(projectPath, 'docker-compose.yml');

    let content = fs.readFileSync(templatePath, 'utf8');

    // Update project name
    content = content.replace(/^name: supabase$/m, `name: ${projectName}`);

    // Update container names
    content = content.replace(/container_name: supabase-/g, `container_name: ${projectName}-`);

    // Special case for realtime container (must preserve the realtime-dev. prefix)
    content = content.replace(
      /container_name: supabase-realtime$/gm,
      `container_name: realtime-dev.${projectName}-realtime`
    );

    // Update volume paths to be relative to project directory
    content = content.replace(/\.\/volumes\//g, './volumes/');

    fs.writeFileSync(targetPath, content, 'utf8');
    logger.info(`Created docker-compose.yml for ${projectName}`);
  }

  /**
   * Create volumes directory structure
   */
  private createVolumesStructure(projectPath: string, projectName: string): void {
    const volumesPath = path.join(projectPath, 'volumes');
    const dirs = [
      'db/data',
      'db/init',
      'storage',
      'functions',
      'logs',
      'api',
      'pooler',
      'analytics',
    ];

    dirs.forEach((dir) => {
      const fullPath = path.join(volumesPath, dir);
      fs.mkdirSync(fullPath, { recursive: true });
    });

    // Copy SQL init scripts
    const templateInitPath = path.join(this.templatesPath, 'volumes/db');
    const targetInitPath = path.join(volumesPath, 'db');

    if (fs.existsSync(templateInitPath)) {
      const sqlFiles = fs.readdirSync(templateInitPath).filter((f) => f.endsWith('.sql'));
      sqlFiles.forEach((file) => {
        fs.copyFileSync(path.join(templateInitPath, file), path.join(targetInitPath, file));
      });
    }

    logger.info(`Created volumes structure for ${projectName}`);
  }

  /**
   * Create Kong configuration
   */
  private async createKongConfig(
    projectPath: string,
    _apiUrl: string,
    corsOrigins: string[]
  ): Promise<void> {
    const templatePath = path.join(this.templatesPath, 'volumes/api/kong.yml');
    const targetPath = path.join(projectPath, 'volumes/api/kong.yml');

    if (!fs.existsSync(templatePath)) {
      logger.warn('Kong template not found, skipping');
      return;
    }

    let content = fs.readFileSync(templatePath, 'utf8');

    // Update CORS origins if specified
    if (corsOrigins.length > 0) {
      const originsStr = corsOrigins.join(',');
      content = content.replace(/origins: .*/, `origins: ${originsStr}`);
    }

    fs.writeFileSync(targetPath, content, 'utf8');
    logger.info('Created Kong configuration');
  }

  /**
   * Copy Vector logging configuration
   */
  private async copyVectorConfig(projectPath: string, projectName: string): Promise<void> {
    const templatePath = path.join(this.templatesPath, 'vector.yml');
    const targetPath = path.join(projectPath, 'volumes/logs/vector.yml');

    if (!fs.existsSync(templatePath)) {
      logger.warn('Vector template not found, skipping');
      return;
    }

    let content = fs.readFileSync(templatePath, 'utf8');

    // Update project name placeholders
    content = content.replace(/__PROJECT__/g, projectName);

    fs.writeFileSync(targetPath, content, 'utf8');
    logger.info('Created Vector configuration');
  }

  /**
   * Create docker-compose.override.yml for Kong YAML parsing fix
   */
  private async createDockerComposeOverride(projectPath: string): Promise<void> {
    const overrideContent = `# Override for Kong YAML environment variable substitution
services:
  kong:
    volumes:
      - ./volumes/api/kong.yml:/home/kong/temp.yml:ro
`;

    const targetPath = path.join(projectPath, 'docker-compose.override.yml');
    fs.writeFileSync(targetPath, overrideContent, 'utf8');
    logger.info('Created docker-compose.override.yml');
  }

  /**
   * Start an instance
   */
  async startInstance(name: string): Promise<void> {
    const projectPath = path.join(this.projectsPath, name);

    if (!fs.existsSync(projectPath)) {
      throw new Error(`Instance ${name} does not exist`);
    }

    try {
      logger.info(`Starting instance: ${name}`);
      const { stdout, stderr } = await execAsync('docker compose up -d', { cwd: projectPath });

      if (stderr && !stderr.includes('Creating') && !stderr.includes('Starting')) {
        logger.warn(`Docker compose stderr: ${stderr}`);
      }

      logger.info(`Successfully started instance: ${name}`);
      logger.debug(stdout);
    } catch (error) {
      logger.error(`Error starting instance ${name}:`, error);
      throw error;
    }
  }

  /**
   * Stop an instance
   */
  async stopInstance(name: string, keepVolumes: boolean = true): Promise<void> {
    const projectPath = path.join(this.projectsPath, name);

    if (!fs.existsSync(projectPath)) {
      throw new Error(`Instance ${name} does not exist`);
    }

    try {
      logger.info(`Stopping instance: ${name}`);
      const command = keepVolumes ? 'docker compose stop' : 'docker compose down -v';
      const { stdout, stderr } = await execAsync(command, { cwd: projectPath });

      if (stderr) {
        logger.warn(`Docker compose stderr: ${stderr}`);
      }

      logger.info(`Successfully stopped instance: ${name}`);
      logger.debug(stdout);
    } catch (error) {
      logger.error(`Error stopping instance ${name}:`, error);
      throw error;
    }
  }

  /**
   * Restart an instance
   */
  async restartInstance(name: string): Promise<void> {
    await this.stopInstance(name);
    await this.startInstance(name);
  }

  /**
   * Delete an instance
   */
  async deleteInstance(name: string, removeVolumes: boolean = false): Promise<void> {
    const projectPath = path.join(this.projectsPath, name);

    if (!fs.existsSync(projectPath)) {
      throw new Error(`Instance ${name} does not exist`);
    }

    try {
      logger.info(`Deleting instance: ${name}`);

      // Stop and remove containers
      try {
        const command = removeVolumes ? 'docker compose down -v' : 'docker compose down';
        await execAsync(command, { cwd: projectPath });
      } catch (error) {
        logger.warn('Error stopping containers, continuing with deletion:', error);
      }

      // Remove project directory
      fs.rmSync(projectPath, { recursive: true, force: true });

      logger.info(`Successfully deleted instance: ${name}`);
    } catch (error) {
      logger.error(`Error deleting instance ${name}:`, error);
      throw error;
    }
  }

  /**
   * Update instance credentials
   */
  async updateCredentials(
    name: string,
    regenerateKeys: boolean = false
  ): Promise<InstanceCredentials> {
    const projectPath = path.join(this.projectsPath, name);
    const envPath = path.join(projectPath, '.env');

    if (!fs.existsSync(envPath)) {
      throw new Error(`Instance ${name} does not exist`);
    }

    try {
      logger.info(`Updating credentials for instance: ${name}`);

      // Backup current .env
      backupEnvFile(envPath);

      // Parse current config
      const envConfig = parseEnvFile(envPath);

      if (regenerateKeys) {
        // Generate new keys
        const keys = generateAllKeys();
        envConfig.JWT_SECRET = keys.jwt_secret;
        envConfig.ANON_KEY = keys.anon_key;
        envConfig.SERVICE_ROLE_KEY = keys.service_role_key;
        envConfig.POSTGRES_PASSWORD = keys.postgres_password;
      }

      // Write updated config
      writeEnvFile(envPath, envConfig);

      logger.info(`Successfully updated credentials for ${name}`);

      return extractCredentials(envConfig);
    } catch (error) {
      logger.error(`Error updating credentials for ${name}:`, error);
      throw error;
    }
  }
  /**
   * Get system template configuration (parsed docker-compose.yml)
   */
  async getSystemTemplate(): Promise<any> {
    try {
      const composePath = path.join(this.templatesPath, 'docker-compose.yml');
      if (!fs.existsSync(composePath)) {
        throw new Error(`System docker-compose.yml not found at ${composePath}`);
      }

      const fileContent = fs.readFileSync(composePath, 'utf8');
      const compose = yaml.load(fileContent) as any;

      // Extract services and their relevant config
      const services = Object.entries(compose.services || {}).map(
        ([name, config]: [string, any]) => ({
          name,
          image: config.image,
          environment: config.environment,
          ports: config.ports,
          depends_on: config.depends_on,
        })
      );

      // Extract unique environment variables used in compose (e.g. ${VAR})
      const compileEnvVars = (obj: any, vars: Set<string>) => {
        if (typeof obj === 'string') {
          const matches = obj.match(/\${([A-Z0-9_]+)(?::-([^}]+))?}/g);
          if (matches) {
            matches.forEach((m) => {
              const varName = m.replace(/^\${|}$/g, '').split(':-')[0];
              vars.add(varName);
            });
          }
        } else if (typeof obj === 'object' && obj !== null) {
          Object.values(obj).forEach((v) => compileEnvVars(v, vars));
        }
      };

      const envVars = new Set<string>();
      compileEnvVars(compose, envVars);

      return {
        services,
        envVars: Array.from(envVars).sort(),
        raw: compose,
      };
    } catch (error) {
      logger.error('Error parsing system template:', error);
      throw error;
    }
  }

  /**
   * Apply template configuration to an instance
   */
  async applyTemplateConfig(instanceName: string, config: any): Promise<void> {
    const projectPath = path.join(this.projectsPath, instanceName);
    const composePath = path.join(projectPath, 'docker-compose.yml');
    const envPath = path.join(projectPath, '.env');

    logger.info(`Applying template config to ${instanceName}`, { config });

    try {
      // 1. Apply Environment Overrides
      if (config.env && Object.keys(config.env).length > 0) {
        if (fs.existsSync(envPath)) {
          let envContent = fs.readFileSync(envPath, 'utf8');
          const envLines = envContent.split('\n');
          const newEnvLines: string[] = [];
          const processedKeys = new Set<string>();

          // Update existing keys
          envLines.forEach((line) => {
            const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
            if (match) {
              const key = match[1];
              if (config.env[key] !== undefined) {
                newEnvLines.push(`${key}=${config.env[key]}`);
                processedKeys.add(key);
              } else {
                newEnvLines.push(line);
              }
            } else {
              newEnvLines.push(line);
            }
          });

          // Add new keys
          Object.entries(config.env).forEach(([key, value]) => {
            if (!processedKeys.has(key)) {
              newEnvLines.push(`${key}=${value}`);
            }
          });

          fs.writeFileSync(envPath, newEnvLines.join('\n'), 'utf8');
          logger.info(`Updated .env for ${instanceName}`);
        }
      }

      // 2. Apply Service Selection (Enable/Disable services)
      // Only filter services if list is explicitly provided AND non-empty
      if (config.services && Array.isArray(config.services) && config.services.length > 0) {
        if (fs.existsSync(composePath)) {
          const fileContent = fs.readFileSync(composePath, 'utf8');
          const compose = yaml.load(fileContent) as any;

          // If a service list is provided, we assume strictly these services should be enabled
          // OR we can interpret it as "disabled" list.
          // Let's assume config.services contains a list of ENABLED services or config objects.
          // If it's a list of strings, it's enabled services.

          const enabledServices = new Set(
            config.services.map((s: any) => (typeof s === 'string' ? s : s.name))
          );

          // We MUST NOT disable core services (db, analytics, auth, kong, rest, storage, meta) unless explicitly requested?
          // For safety, let's just remove services that are NOT in the enabled list,
          // BUT only if the list is comprehensive.

          // Actually, a better approach for "Selective Services" in this context is usually adding extra services.
          // However, if the user wants to DISABLE "studio" or "example-service", they can.

          // Strategy: Filter `compose.services` to only include enabled ones.
          // CAUTION: This might break dependencies.

          if (compose.services) {
            Object.keys(compose.services).forEach((serviceName) => {
              if (!enabledServices.has(serviceName)) {
                // Check if core service? Maybe not enforce logic here, let user shoot foot.
                delete compose.services[serviceName];
              }
            });
          }

          const newYaml = yaml.dump(compose);
          fs.writeFileSync(composePath, newYaml, 'utf8');
          logger.info(`Updated docker-compose.yml for ${instanceName} (Filtered Services)`);
        }
      }
    } catch (error) {
      logger.error(`Error applying template config to ${instanceName}:`, error);
      throw error;
    }
  }

  /**
   * Update instance configuration (env vars)
   */
  async updateInstanceConfig(name: string, configUpdates: Record<string, string>): Promise<void> {
    const instance = await this.getInstance(name);
    if (!instance) {
      throw new Error(`Instance ${name} not found`);
    }

    const projectPath = path.join(this.projectsPath, name);
    const envPath = path.join(projectPath, '.env');

    if (!fs.existsSync(envPath)) {
      throw new Error(`Instance configuration not found at ${envPath}`);
    }

    // Create backup
    backupEnvFile(envPath);

    // Read current config
    const currentConfig = parseEnvFile(envPath);

    // Merge updates
    const newConfig = { ...currentConfig, ...configUpdates };

    // Write back to file
    writeEnvFile(envPath, newConfig);

    // Restart relevant services to apply changes
    try {
      try {
        await this.dockerManager.restartService(name, 'auth');
        logger.info(`Restarted auth service for ${name}`);
      } catch (e) {
        // Fallback or ignore if auth service is named uniquely, try gotrue
        await this.dockerManager.restartService(name, 'gotrue');
        logger.info(`Restarted gotrue service for ${name}`);
      }
    } catch (error) {
      logger.warn(
        `Could not restart auth service for ${name}. Changes might not apply immediately. Error: ${error}`
      );
    }
  }
}

export default InstanceManager;
