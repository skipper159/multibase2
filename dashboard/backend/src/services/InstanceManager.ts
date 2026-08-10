import fs from 'fs';
import path from 'path';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { PrismaClient } from '@prisma/client';
import yaml from 'js-yaml';
import { Client } from 'pg';

import {
  CreateInstanceRequest,
  SupabaseInstance,
  InstanceCredentials,
  PortMapping,
  ResourceLimits,
  StackType,
  SHARED_SERVICES,
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
import { loadImageMatrix } from './ImageRegistryService';
import { RedisCache } from './RedisCache';
import {
  generateAndWriteTenantConfig,
  reloadNginxGateway,
  removeNginxTenantConfig,
} from './NginxGatewayGenerator';

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

  /** Keep tenant directories and environment files private to the service user. */
  private secureProjectSecretFiles(projectPath: string): void {
    try {
      fs.chmodSync(projectPath, 0o750);
      for (const entry of fs.readdirSync(projectPath, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.startsWith('.env')) {
          fs.chmodSync(path.join(projectPath, entry.name), 0o600);
        }
      }
    } catch (error) {
      logger.warn(`Could not harden secret file permissions for ${projectPath}:`, error);
    }
  }

  /**
   * Detect if an instance uses the cloud (shared) or classic stack.
   * Cloud instances have PROJECT_DB in .env and no POSTGRES_PORT.
   */
  private detectStackType(envConfig: Record<string, string>): StackType {
    if (envConfig['PROJECT_DB'] && !envConfig['POSTGRES_PORT']) {
      return 'cloud';
    }
    return 'classic';
  }

  /**
   * Get shared PostgreSQL connection config for cloud instances.
   */
  private getSharedDbConfig(envConfig: Record<string, string>) {
    const sharedEnvPath = path.resolve(this.templatesPath, 'shared', '.env.shared');
    let sharedPassword = envConfig['POSTGRES_PASSWORD'];
    let sharedPort = 5432;

    if (fs.existsSync(sharedEnvPath)) {
      const sharedEnv = parseEnvFile(sharedEnvPath);
      sharedPassword = sharedEnv['SHARED_POSTGRES_PASSWORD'] || sharedPassword;
      sharedPort = parseInt(sharedEnv['SHARED_PG_PORT'] || '5432', 10);
    }

    const projectDb = envConfig['PROJECT_DB'] || 'postgres';
    return { host: 'localhost', port: sharedPort, database: projectDb, password: sharedPassword };
  }

  private getDbConnectionCandidates(
    envConfig: Record<string, string>,
    stackType: StackType
  ): {
    host: string;
    port: number;
    database: string;
    password: string;
    users: string[];
  } {
    if (stackType === 'cloud') {
      const sharedDb = this.getSharedDbConfig(envConfig);
      const users = [envConfig['POSTGRES_USER'] || '', 'supabase_admin', 'postgres'].filter(
        (value, index, arr) => value && arr.indexOf(value) === index
      );

      return {
        host: sharedDb.host,
        port: sharedDb.port,
        database: sharedDb.database,
        password: sharedDb.password,
        users,
      };
    }

    return {
      host: 'localhost',
      port: parseInt(envConfig['POSTGRES_PORT'] || '5432', 10),
      database: envConfig['POSTGRES_DB'] || 'postgres',
      password: envConfig['POSTGRES_PASSWORD'] || '',
      users: [envConfig['POSTGRES_USER'] || 'postgres'],
    };
  }

  private async connectToInstanceDb(
    envConfig: Record<string, string>,
    stackType: StackType
  ): Promise<Client> {
    const config = this.getDbConnectionCandidates(envConfig, stackType);

    if (!config.password) {
      throw new Error('Database password not found');
    }

    let lastError: any;

    for (const user of config.users) {
      const client = new Client({
        user,
        host: config.host,
        database: config.database,
        password: config.password,
        port: config.port,
      });

      try {
        await client.connect();
        return client;
      } catch (error: any) {
        lastError = error;
        await client.end().catch(() => {});
      }
    }

    throw new Error(lastError?.message || 'Failed to connect to database');
  }

  private async runCloudPsql(
    database: string,
    sql: string,
    options?: { csv?: boolean; tuplesOnly?: boolean }
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = [
        'exec',
        'multibase-db',
        'psql',
        '-U',
        'supabase_admin',
        '-d',
        database,
        '-v',
        'ON_ERROR_STOP=1',
      ];

      if (options?.csv) {
        args.push('--csv');
      }

      if (options?.tuplesOnly) {
        args.push('-t', '-A');
      }

      args.push('-c', sql);

      const proc = spawn('docker', args, { windowsHide: true });
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      proc.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      proc.on('error', (error) => reject(error));

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
          return;
        }

        reject(new Error(stderr.trim() || stdout.trim() || `psql exited with code ${code}`));
      });
    });
  }

  private parseCsvLine(line: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      const next = line[index + 1];

      if (char === '"') {
        if (inQuotes && next === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (char === ',' && !inQuotes) {
        values.push(current);
        current = '';
        continue;
      }

      current += char;
    }

    values.push(current);
    return values;
  }

  private parsePgArray(value: string): string[] {
    const trimmed = value.slice(1, -1);
    if (!trimmed) {
      return [];
    }

    const parts: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let index = 0; index < trimmed.length; index += 1) {
      const char = trimmed[index];
      const next = trimmed[index + 1];

      if (char === '"') {
        if (inQuotes && next === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (char === ',' && !inQuotes) {
        parts.push(current);
        current = '';
        continue;
      }

      current += char;
    }

    parts.push(current);
    return parts;
  }

  private coercePsqlValue(value: string): any {
    if (value === '') {
      return null;
    }

    if (value === 't') {
      return true;
    }

    if (value === 'f') {
      return false;
    }

    if (/^-?\d+$/.test(value)) {
      return Number(value);
    }

    if (/^-?\d+\.\d+$/.test(value)) {
      return Number(value);
    }

    if (value.startsWith('{') && value.endsWith('}')) {
      return this.parsePgArray(value);
    }

    return value;
  }

  private parseCsvResult(csvOutput: string): any[] {
    if (!csvOutput) {
      return [];
    }

    const lines = csvOutput
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (lines.length < 2) {
      return [];
    }

    const headers = this.parseCsvLine(lines[0]);
    return lines.slice(1).map((line) => {
      const values = this.parseCsvLine(line);
      const row: Record<string, any> = {};

      headers.forEach((header, index) => {
        row[header] = this.coercePsqlValue(values[index] ?? '');
      });

      return row;
    });
  }

  /**
   * Read the shared JWT secret from shared/.env.shared.
   * Cloud tenants must use the same JWT secret as shared infrastructure so that
   * tokens issued by the shared Studio validate inside tenant services.
   */
  private getSharedJwtSecret(): string | undefined {
    const sharedEnvPath = path.resolve(this.templatesPath, 'shared', '.env.shared');
    if (fs.existsSync(sharedEnvPath)) {
      const secret = parseEnvFile(sharedEnvPath)['SHARED_JWT_SECRET'];
      if (secret) return secret;
    }
    logger.warn(
      'SHARED_JWT_SECRET not found in shared/.env.shared – cloud tenant gets an isolated JWT secret'
    );
    return undefined;
  }

  /**
   * Check if shared infrastructure is running.
   */
  async isSharedInfraRunning(): Promise<boolean> {
    try {
      const containers = await this.dockerManager.listAllContainers();
      return containers.some((c: any) => c.Names?.some((n: string) => n.includes('multibase-db')));
    } catch {
      return false;
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
      return instances;
    } catch (error) {
      logger.error('Error listing instances:', error);
      throw error;
    }
  }

  /**
   * List all instance configurations (lightweight, no Docker status)
   */
  async listInstanceConfigs(): Promise<{ name: string; ports: PortMapping }[]> {
    try {
      if (!fs.existsSync(this.projectsPath)) {
        return [];
      }

      const projectDirs = fs
        .readdirSync(this.projectsPath, { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => dirent.name);

      const configs = projectDirs.map((name) => {
        try {
          const projectPath = path.join(this.projectsPath, name);
          const envPath = path.join(projectPath, '.env');
          if (!fs.existsSync(envPath)) return null;

          const envConfig = parseEnvFile(envPath);
          const stackType = this.detectStackType(envConfig);
          const ports = this.normalizePortsForDisplay(extractPorts(envConfig), stackType);
          return { name, ports };
        } catch (e) {
          return null;
        }
      });

      return configs.filter((c): c is { name: string; ports: PortMapping } => c !== null);
    } catch (error) {
      logger.error('Error listing instance configs:', error);
      return [];
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
      const stackType = this.detectStackType(envConfig);
      const ports = this.normalizePortsForDisplay(extractPorts(envConfig), stackType);

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
        stackType,
        basePort: ports.gateway_port,
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

  private normalizePortsForDisplay(ports: PortMapping, stackType: StackType): PortMapping {
    if (stackType === 'cloud') {
      return ports;
    }

    return {
      ...ports,
      studio: ports.studio ?? 3000,
      postgres: ports.postgres ?? 5432,
      pooler: ports.pooler ?? 6543,
      analytics: ports.analytics ?? 4000,
    };
  }

  /**
   * Create a new Supabase instance
   */
  async createInstance(request: CreateInstanceRequest): Promise<SupabaseInstance> {
    const { name, basePort } = request;

    logger.info(`Creating new instance: ${name}`);
    logger.info(
      `Request details: deploymentType=${request.deploymentType}, env keys=${request.env ? Object.keys(request.env).join(',') : 'none'}, resourceLimits=${JSON.stringify(request.resourceLimits)}`
    );

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
          env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
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

      // -------------------------------------------------------
      // Automatisch SUPABASE_PUBLIC_URL setzen basierend auf
      // DEPLOYMENT_MODE. Muss VOR den user-overrides geschehen,
      // damit der User es bei Bedarf noch überschreiben kann.
      // -------------------------------------------------------
      {
        const isLocal = request.deploymentType === 'localhost' || process.env.DEPLOYMENT_MODE === 'local';
        const mode = isLocal ? 'local' : (process.env.DEPLOYMENT_MODE || 'cloud');
        const envPath = path.join(projectPath, '.env');
        if (fs.existsSync(envPath)) {
          const currentEnv = parseEnvFile(envPath);
          const gatewayPort =
            currentEnv['GATEWAY_PORT'] ||
            currentEnv['KONG_HTTP_PORT'] ||
            String(basePort ? basePort + 40 : 8000);

          let publicUrl: string;
          if (mode === 'local') {
            // Browser erreicht Kong direkt über localhost
            publicUrl = `http://localhost:${gatewayPort}`;
          } else {
            // Cloud: Browser geht über nginx + echte Domain
            const domain = process.env.BACKEND_DOMAIN || 'localhost';
            const rootDomain =
              process.env.ROOT_DOMAIN ||
              (() => {
                const parts = domain.split('.');
                return parts.length >= 3 ? parts.slice(-2).join('.') : domain;
              })();
            publicUrl = `https://${name}-api.${rootDomain}`;
          }

          const updatedEnv = { ...currentEnv, SUPABASE_PUBLIC_URL: publicUrl };
          writeEnvFile(envPath, updatedEnv);
          logger.info(`[DEPLOYMENT_MODE=${mode}] Set SUPABASE_PUBLIC_URL=${publicUrl} for ${name}`);
        }
      }

      // Apply user-provided Environment Overrides (can still override SUPABASE_PUBLIC_URL)
      if (request.env && Object.keys(request.env).length > 0) {
        try {
          const envPath = path.join(projectPath, '.env');
          if (fs.existsSync(envPath)) {
            const currentEnv = parseEnvFile(envPath);
            const newEnv = { ...currentEnv, ...request.env };
            writeEnvFile(envPath, newEnv);
            logger.info(`Applied environment overrides for ${name}`);
          } else {
            logger.warn(`Could not find .env file to update for ${name}`);
          }
        } catch (envError) {
          logger.error(`Failed to update environment overrides for ${name}:`, envError);
        }
      }

      this.secureProjectSecretFiles(projectPath);

      // Apply Resource Limits if specified
      if (request.resourceLimits) {
        try {
          await this.applyResourceLimits(projectPath, request.resourceLimits);
          logger.info(
            `Applied resource limits for ${name}: CPU=${request.resourceLimits.cpus}, Memory=${request.resourceLimits.memory}MB`
          );
        } catch (limitsError) {
          logger.error(`Failed to apply resource limits for ${name}:`, limitsError);
        }
      }

      // Get and return the created instance
      const instance = await this.getInstance(name);
      if (!instance) {
        throw new Error('Failed to retrieve created instance');
      }

      // Generate Nginx Config
      await this.createNginxConfig(instance, request.deploymentType);

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
   * Generate Nginx configuration for the instance.
   *
   * DEPLOYMENT_MODE=local  → skip entirely (Studio/Kong direkt über localhost:<port>)
   * DEPLOYMENT_MODE=cloud  → nginx-Config mit Domain + SSL schreiben + reload
   */
  private async createNginxConfig(
    instance: SupabaseInstance,
    deploymentType: 'localhost' | 'cloud'
  ): Promise<void> {
    const isLocal = deploymentType === 'localhost' || process.env.DEPLOYMENT_MODE === 'local' || process.platform === 'win32';

    // ── LOCAL MODE ──────────────────────────────────────────────────────────
    if (isLocal) {
      logger.info(
        `[local] Skipping nginx config for "${instance.name}" — ` +
          `Studio: http://localhost:${instance.ports.studio ?? 3000}, ` +
          `API/Kong: http://localhost:${instance.ports.gateway_port ?? 8000}`
      );
      return;
    }

    // ── CLOUD MODE ──────────────────────────────────────────────────────────
    try {
      // Target: multibase/nginx/sites-enabled
      const nginxDir = path.resolve(this.templatesPath, 'nginx', 'sites-enabled');
      if (!fs.existsSync(nginxDir)) {
        fs.mkdirSync(nginxDir, { recursive: true });
      }

      const domain = process.env.BACKEND_DOMAIN || 'localhost';
      // ROOT_DOMAIN: 2nd-level base domain for instance subdomains (e.g. tyto-design.de)
      // Derived from BACKEND_DOMAIN by stripping the leftmost subdomain label.
      // backend.tyto-design.de → tyto-design.de  |  tyto-design.de → tyto-design.de
      const rootDomain =
        process.env.ROOT_DOMAIN ||
        (() => {
          const parts = domain.split('.');
          return parts.length >= 3 ? parts.slice(-2).join('.') : domain;
        })();
      const dashboardUrl =
        process.env.DASHBOARD_URL || `https://${process.env.FRONTEND_DOMAIN || domain}`;
      const backendUrl = process.env.BACKEND_URL || `https://${domain}`;

      // Cloud-Version: Studio Proxy zeigt auf Shared Studio
      const studioPort =
        instance.stackType === 'cloud'
          ? process.env.SHARED_STUDIO_PORT || '3000'
          : instance.ports.studio || '3000';

      const execAsync = promisify(exec);

      // Helper: check cert file exists AND is not expired
      const isCertValid = async (certPath: string): Promise<boolean> => {
        if (!fs.existsSync(certPath)) return false;
        try {
          await execAsync(`openssl x509 -in "${certPath}" -checkend 0 -noout`);
          return true;
        } catch {
          return false;
        }
      };

      const wildcardCertDir = `/etc/letsencrypt/live/${rootDomain}`;
      const studioDomain = `${instance.name}.${rootDomain}`;
      const apiDomain = `${instance.name}-api.${rootDomain}`;
      const perInstanceCertDir = `/etc/letsencrypt/live/${studioDomain}`;

      // Resolve which cert to use: wildcard → per-instance → issue new via certbot
      let resolvedCertDir = '';
      if (deploymentType === 'cloud') {
        if (await isCertValid(`${wildcardCertDir}/fullchain.pem`)) {
          resolvedCertDir = wildcardCertDir;
          logger.info(`Wildcard cert covers ${studioDomain} — no per-instance cert needed.`);
        } else if (await isCertValid(`${perInstanceCertDir}/fullchain.pem`)) {
          resolvedCertDir = perInstanceCertDir;
          logger.info(`Using existing per-instance cert for ${studioDomain}.`);
        } else {
          // No valid cert: write a minimal HTTP config so certbot can run HTTP-01 challenge
          const configPath = path.join(nginxDir, `${instance.name}.conf`);
          const httpOnlyConfig = `server {\n    listen 80;\n    server_name ${studioDomain} ${apiDomain};\n}\n`;
          fs.writeFileSync(configPath, httpOnlyConfig);
          try {
            await execAsync('sudo nginx -t && sudo nginx -s reload');
          } catch {
            /* ignore */
          }

          try {
            const adminEmail = process.env.LETSENCRYPT_EMAIL || `admin@${rootDomain}`;
            await execAsync(
              `sudo certbot certonly --nginx ` +
                `-d ${studioDomain} -d ${apiDomain} ` +
                `--non-interactive --agree-tos --email ${adminEmail}`,
              { timeout: 120000 }
            );
            if (await isCertValid(`${perInstanceCertDir}/fullchain.pem`)) {
              resolvedCertDir = perInstanceCertDir;
              logger.info(`Certbot issued new cert for ${studioDomain}.`);
            }
          } catch (certbotError: any) {
            logger.warn(`Certbot failed for ${instance.name}: ${certbotError.message}`);
          }
        }
      }

      // SSL block reused for both Studio and API server blocks
      const sslBlock = resolvedCertDir
        ? `    ssl_certificate ${resolvedCertDir}/fullchain.pem;
    ssl_certificate_key ${resolvedCertDir}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
`
        : '';

      const configContent = `# Auto-generated config for ${instance.name}
# SSL: uses wildcard cert *.${rootDomain} if valid, otherwise per-instance cert.
server {
    listen 80;
    server_name ${instance.name}.${rootDomain};
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name ${instance.name}.${rootDomain};
${sslBlock}
    client_max_body_size 100M;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Auth subrequest to dashboard backend
    location = /auth-check {
        internal;
        proxy_pass ${backendUrl}/api/auth/verify-instance-access;
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
        proxy_set_header Cookie $http_cookie;
        proxy_set_header X-Instance-Name "${instance.name}";
        proxy_set_header X-Original-URI $request_uri;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header apikey $http_apikey;
    }

    # Health check endpoint (without auth for monitoring)
    location /health {
        access_log off;
        return 200 "OK";
        add_header Content-Type text/plain;
    }

    # Storage endpoint - NO auth_request, Supabase validates SERVICE_ROLE_KEY itself
    location /storage/ {
        proxy_pass http://127.0.0.1:${instance.ports.gateway_port}/storage/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Authorization $http_authorization;
    }
    
    # Main location with authentication
    location / {
        # Require authentication
        auth_request /auth-check;
        
        # On auth failure, redirect to login
        error_page 401 = @error401;
        error_page 403 = @error403;

        proxy_pass http://127.0.0.1:${studioPort};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Error handler for 401 Unauthorized
    location @error401 {
        return 302 ${dashboardUrl}/login?redirect=$scheme://$host$request_uri&reason=auth_required;
    }

    # Error handler for 403 Forbidden
    location @error403 {
        return 302 ${dashboardUrl}/login?redirect=$scheme://$host$request_uri&reason=access_denied;
    }
}

server {
    listen 80;
    server_name ${instance.name}-api.${rootDomain};
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name ${instance.name}-api.${rootDomain};
${sslBlock}
    client_max_body_size 100M;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Auth subrequest to dashboard backend
    location = /auth-check {
        internal;
        proxy_pass ${backendUrl}/api/auth/verify-instance-access;
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
        proxy_set_header Cookie $http_cookie;
        proxy_set_header X-Instance-Name "${instance.name}";
        proxy_set_header X-Original-URI $request_uri;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header apikey $http_apikey;
    }

    # Health check endpoint (without auth for monitoring)
    location /health {
        access_log off;
        return 200 "OK";
        add_header Content-Type text/plain;
    }

    # Supabase Auth is public-by-design; GoTrue validates the anon key and credentials.
    # The dashboard auth_request must not intercept browser CORS preflight requests.
    location /auth/v1/ {
        auth_request off;
        if ($request_method = OPTIONS) { return 204; }
        proxy_hide_header Access-Control-Allow-Origin;
        proxy_hide_header Access-Control-Allow-Credentials;
        proxy_hide_header Access-Control-Allow-Headers;
        proxy_hide_header Access-Control-Expose-Headers;
        add_header Access-Control-Allow-Origin $http_origin always;
        add_header Access-Control-Allow-Credentials true always;
        add_header Access-Control-Allow-Methods "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Accept, Authorization, Content-Type, X-Requested-With, apikey, x-client-info, x-supabase-api-version, accept-profile, content-profile, prefer, Range" always;
        add_header Access-Control-Expose-Headers "Content-Length, Content-Range, Content-Type, X-Supabase-Api-Version" always;
        add_header Vary Origin always;
        proxy_pass http://127.0.0.1:${instance.ports.gateway_port};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Authorization $http_authorization;
        proxy_set_header apikey $http_apikey;
        proxy_buffering off;
        proxy_request_buffering off;
    }

    # Main API location with authentication
    location / {
        # Require authentication
        auth_request /auth-check;
        
        # On auth failure, redirect to login
        error_page 401 = @error401;
        error_page 403 = @error403;

        proxy_pass http://127.0.0.1:${instance.ports.gateway_port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Timeouts for API requests
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        
        # Buffering
        proxy_buffering off;
        proxy_request_buffering off;
    }

    # Error handler for 401 Unauthorized
    location @error401 {
        return 302 ${dashboardUrl}/login?redirect=$scheme://$host$request_uri&reason=auth_required;
    }

    # Error handler for 403 Forbidden
    location @error403 {
        return 302 ${dashboardUrl}/login?redirect=$scheme://$host$request_uri&reason=access_denied;
    }
}
`;
      const configPath = path.join(nginxDir, `${instance.name}.conf`);
      fs.writeFileSync(configPath, configContent);
      logger.info(`Created Nginx config with authentication for ${instance.name}: ${configPath}`);

      // Reload Nginx to apply changes
      try {
        await execAsync('sudo nginx -s reload');
        logger.info('Nginx reloaded successfully');
      } catch (reloadError) {
        logger.error('Failed to reload Nginx. Configurations might not be applied:', reloadError);
      }

      if (!resolvedCertDir) {
        logger.warn(
          `No valid SSL cert for ${studioDomain}. ` +
            `Instance serves HTTP only. Check certbot or set LETSENCRYPT_EMAIL.`
        );
      }
    } catch (error) {
      logger.error(`Failed to create Nginx config for ${instance.name}:`, error);
    }
  }

  /**
   * Apply resource limits to docker-compose.yml
   * Adds deploy.resources.limits to all services
   */
  private async applyResourceLimits(projectPath: string, limits: ResourceLimits): Promise<void> {
    const composePath = path.join(projectPath, 'docker-compose.yml');

    if (!fs.existsSync(composePath)) {
      throw new Error(`docker-compose.yml not found at ${composePath}`);
    }

    // Read and parse docker-compose.yml
    const composeContent = fs.readFileSync(composePath, 'utf-8');
    const compose = yaml.load(composeContent) as any;

    if (!compose.services) {
      throw new Error('No services found in docker-compose.yml');
    }

    // Prepare different resource configurations
    const getLimitValue = (val: number, type: 'cpus' | 'memory') =>
      type === 'memory' ? `${val}M` : val.toString();

    const getReservationValue = (val: number, type: 'cpus' | 'memory') =>
      type === 'memory' ? `${Math.round(val * 0.5)}M` : (val * 0.5).toString();

    // Default Configuration (for DB and others if not specified)
    const defaultConfig = {
      limits: {
        cpus: limits.cpus ? getLimitValue(limits.cpus, 'cpus') : undefined,
        memory: limits.memory ? getLimitValue(limits.memory, 'memory') : undefined,
      },
      reservations: {
        cpus: limits.cpus ? getReservationValue(limits.cpus, 'cpus') : undefined,
        memory: limits.memory ? getReservationValue(limits.memory, 'memory') : undefined,
      },
    };

    // Analytics Specific Configuration
    // User requested: Small=512MB, Medium=1024MB, Large=1536MB
    let analyticsMemory = 512; // Default baseline
    if (limits.preset === 'medium') analyticsMemory = 1024;
    else if (limits.preset === 'large') analyticsMemory = 1536;
    else if (limits.preset === 'custom' && limits.memory) {
      // For custom, cap analytics at 1.5GB or 50% of total memory, whichever is lower (but at least 256MB)
      analyticsMemory = Math.max(256, Math.min(1536, Math.round(limits.memory * 0.5)));
    }

    const analyticsConfig = {
      limits: {
        cpus: limits.cpus ? getLimitValue(Math.min(limits.cpus, 1), 'cpus') : undefined, // Cap analytics CPU at 1 core
        memory: `${analyticsMemory}M`,
      },
      reservations: {
        cpus: limits.cpus ? getReservationValue(Math.min(limits.cpus, 1), 'cpus') : undefined,
        memory: `${Math.round(analyticsMemory * 0.5)}M`,
      },
    };

    // Apply to all services
    for (const serviceName of Object.keys(compose.services)) {
      const service = compose.services[serviceName];
      let resources;

      if (
        serviceName.includes('analytics') ||
        serviceName.includes('vector') ||
        serviceName.includes('logflare')
      ) {
        resources = analyticsConfig;
      } else {
        // Use default (high) limits for DB and others
        resources = defaultConfig;
      }

      // Remove undefined keys
      const cleanResources = {
        limits: Object.fromEntries(
          Object.entries(resources.limits).filter(([_, v]) => v !== undefined)
        ),
        reservations: Object.fromEntries(
          Object.entries(resources.reservations).filter(([_, v]) => v !== undefined)
        ),
      };

      if (Object.keys(cleanResources.limits).length > 0) {
        if (service.deploy) {
          service.deploy.resources = cleanResources;
        } else {
          service.deploy = { resources: cleanResources };
        }
      }
    }

    // Write back to file
    const newContent = yaml.dump(compose, {
      lineWidth: -1, // Don't wrap lines
      noRefs: true,
      quotingType: '"',
      forceQuotes: false,
    });

    fs.writeFileSync(composePath, newContent, 'utf-8');
    logger.info(`Applied resource limits to ${composePath}`);
  }

  /**
   * Update environment variables for an existing instance
   * @param name Instance name
   * @param envVars Key-value pairs to update
   */
  async updateInstanceEnv(
    name: string,
    envVars: Record<string, string>
  ): Promise<{ success: boolean; backupPath?: string }> {
    const projectPath = path.join(this.projectsPath, name);
    const envPath = path.join(projectPath, '.env');

    if (!fs.existsSync(envPath)) {
      throw new Error(`Environment file not found for instance ${name}`);
    }

    // Create backup before modifying
    const backupPath = backupEnvFile(envPath);
    logger.info(`Created backup of .env at ${backupPath}`);

    // Parse current env file
    const currentEnv = parseEnvFile(envPath);

    // Merge with new values (new values override existing)
    const mergedEnv = { ...currentEnv, ...envVars };

    // Write back
    writeEnvFile(envPath, mergedEnv);
    this.secureProjectSecretFiles(projectPath);
    logger.info(`Updated environment variables for ${name}`);

    // Invalidate cache
    if (this.redisCache) {
      await this.redisCache.delete(`instance:${name}`);
    }

    return { success: true, backupPath };
  }

  /**
   * Update resource limits for an existing instance
   * @param name Instance name
   * @param limits New resource limits
   */
  async updateInstanceResources(
    name: string,
    limits: ResourceLimits
  ): Promise<{ success: boolean }> {
    const projectPath = path.join(this.projectsPath, name);

    if (!fs.existsSync(projectPath)) {
      throw new Error(`Instance ${name} not found`);
    }

    // Use existing applyResourceLimits method
    await this.applyResourceLimits(projectPath, limits);
    logger.info(`Updated resource limits for ${name}`);

    // Invalidate cache
    if (this.redisCache) {
      await this.redisCache.delete(`instance:${name}`);
    }

    return { success: true };
  }

  /**
   * Clone an existing instance with a new name
   * @param sourceName Source instance name
   * @param newName New instance name
   * @param options Clone options
   */
  async cloneInstance(
    sourceName: string,
    newName: string,
    _options: { copyEnv?: boolean } = { copyEnv: true }
  ): Promise<SupabaseInstance> {
    const sourcePath = path.join(this.projectsPath, sourceName);
    const targetPath = path.join(this.projectsPath, newName);

    // Verify source exists
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Source instance ${sourceName} not found`);
    }

    // Verify target doesn't exist
    if (fs.existsSync(targetPath)) {
      throw new Error(`Instance ${newName} already exists`);
    }

    logger.info(`Cloning instance ${sourceName} to ${newName}`);

    try {
      // Create target directory
      fs.mkdirSync(targetPath, { recursive: true });

      // Copy files (excluding volumes directory)
      const filesToCopy = fs.readdirSync(sourcePath);
      for (const file of filesToCopy) {
        if (file === 'volumes') continue; // Skip volume data

        const srcFile = path.join(sourcePath, file);
        const destFile = path.join(targetPath, file);

        if (fs.statSync(srcFile).isDirectory()) {
          // Recursively copy directories
          this.copyDirectorySync(srcFile, destFile);
        } else {
          fs.copyFileSync(srcFile, destFile);
        }
      }

      // Create empty volumes directory
      fs.mkdirSync(path.join(targetPath, 'volumes'), { recursive: true });

      // Generate new ports
      const newBasePort = getRandomBasePort();
      const newPorts = await calculatePorts(newBasePort);

      // Detect source stack type first to decide which JWT secret to use
      const envPath = path.join(targetPath, '.env');
      if (fs.existsSync(envPath)) {
        const envContent = parseEnvFile(envPath);
        const stackType = this.detectStackType(envContent);

        // Cloud tenants must share the same JWT secret as shared infrastructure
        const jwtSecretOverride = stackType === 'cloud' ? this.getSharedJwtSecret() : undefined;
        const newKeys = generateAllKeys(jwtSecretOverride);

        // Update ports - Cloud instances only have gateway port
        envContent['GATEWAY_PORT'] = newPorts.gateway_port.toString();
        // Keep KONG_HTTP_PORT for backward compatibility during migration
        envContent['KONG_HTTP_PORT'] = newPorts.gateway_port.toString();
        if (stackType === 'classic') {
          envContent['POSTGRES_PORT'] = newPorts.postgres?.toString() || '';
          envContent['POOLER_PORT'] = newPorts.pooler?.toString() || '';
          envContent['STUDIO_PORT'] = newPorts.studio?.toString() || '';
          envContent['ANALYTICS_PORT'] = newPorts.analytics?.toString() || '';
        } else {
          // Cloud: Update PROJECT_DB for the new tenant
          const newDbName = `project_${newName}`.replace(/-/g, '_');
          envContent['PROJECT_DB'] = newDbName;
        }

        // Update keys
        envContent['JWT_SECRET'] = newKeys.jwt_secret;
        envContent['ANON_KEY'] = newKeys.anon_key;
        envContent['SERVICE_ROLE_KEY'] = newKeys.service_role_key;
        envContent['DASHBOARD_PASSWORD'] = newKeys.dashboard_password;
        envContent['POSTGRES_PASSWORD'] = newKeys.postgres_password;
        envContent['SECRET_KEY_BASE'] = newKeys.secret_key_base;
        envContent['VAULT_ENC_KEY'] = newKeys.vault_enc_key;

        // Update URLs
        const protocol = envContent['SITE_URL']?.startsWith('https') ? 'https' : 'http';
        const domain = envContent['SITE_URL']?.includes('localhost')
          ? 'localhost'
          : envContent['SITE_URL']?.split('://')[1]?.split(':')[0] || 'localhost';

        if (domain === 'localhost') {
          envContent['SITE_URL'] = `${protocol}://${domain}:${newPorts.gateway_port}`;
          envContent['API_EXTERNAL_URL'] = `${protocol}://${domain}:${newPorts.gateway_port}`;
          envContent['SUPABASE_PUBLIC_URL'] = `${protocol}://${domain}:${newPorts.gateway_port}`;
          envContent['STUDIO_DEFAULT_ORGANIZATION'] = newName;
          envContent['STUDIO_DEFAULT_PROJECT'] = newName;
        }

        writeEnvFile(envPath, envContent);
        logger.info(`Updated .env for cloned instance ${newName}`);
      }

      // Store in database
      await this.prisma.instance.create({
        data: {
          id: crypto.randomUUID(),
          name: newName,
          basePort: newBasePort,
          status: 'created',
          createdAt: new Date(),
        },
      });

      logger.info(`Successfully cloned ${sourceName} to ${newName}`);

      // Return the new instance
      const clonedInstance = await this.getInstance(newName);
      if (!clonedInstance) {
        throw new Error('Failed to retrieve cloned instance');
      }
      return clonedInstance;
    } catch (error) {
      // Cleanup on failure
      if (fs.existsSync(targetPath)) {
        fs.rmSync(targetPath, { recursive: true, force: true });
      }
      throw error;
    }
  }

  /**
   * Helper method to recursively copy a directory
   */
  private copyDirectorySync(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        this.copyDirectorySync(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  /**
   * Get database schema for an instance
   * Cloud-Version: Uses shared PostgreSQL with project-specific database
   * @param name Instance name
   */
  async getSchema(name: string): Promise<any[]> {
    const projectPath = path.join(this.projectsPath, name);
    const envPath = path.join(projectPath, '.env');

    if (!fs.existsSync(envPath)) {
      throw new Error(`Instance ${name} not found`);
    }

    const env = parseEnvFile(envPath);
    const stackType = this.detectStackType(env);

    if (stackType === 'cloud') {
      try {
        const sharedDb = this.getSharedDbConfig(env);
        const schemaSql = `
          SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)::text
          FROM (
            SELECT
              tbl.table_schema as schema,
              tbl.table_name as name,
              tbl.table_type as type,
              COALESCE((
                SELECT json_agg(json_build_object(
                  'column_name', c.column_name,
                  'data_type', c.data_type,
                  'is_nullable', c.is_nullable,
                  'column_default', c.column_default,
                  'is_primary_key', (
                    SELECT EXISTS (
                      SELECT 1
                      FROM information_schema.key_column_usage kcu
                      JOIN information_schema.table_constraints tc
                        ON kcu.constraint_name = tc.constraint_name
                        AND kcu.table_schema = tc.table_schema
                      WHERE kcu.table_schema = c.table_schema
                        AND kcu.table_name = c.table_name
                        AND kcu.column_name = c.column_name
                        AND tc.constraint_type = 'PRIMARY KEY'
                    )
                  )
                ) ORDER BY c.ordinal_position)
                FROM information_schema.columns c
                WHERE c.table_schema = tbl.table_schema
                  AND c.table_name = tbl.table_name
              ), '[]'::json) as columns
            FROM information_schema.tables tbl
            WHERE tbl.table_schema = 'public'
            ORDER BY tbl.table_name
          ) t;
        `;

        const rawJson = await this.runCloudPsql(sharedDb.database, schemaSql, { tuplesOnly: true });
        if (!rawJson) {
          return [];
        }

        return JSON.parse(rawJson);
      } catch (error: any) {
        logger.error(`Failed to get schema for ${name}:`, error.message);
        return [];
      }
    }

    const client = await this.connectToInstanceDb(env, stackType);

    try {
      await client.connect();

      const query = `
        SELECT 
          t.table_schema,
          t.table_name,
          t.table_type,
          (
            SELECT json_agg(json_build_object(
              'column_name', c.column_name,
              'data_type', c.data_type,
              'is_nullable', c.is_nullable,
              'column_default', c.column_default,
              'is_primary_key', (
                SELECT EXISTS (
                  SELECT 1 
                  FROM information_schema.key_column_usage kcu
                  JOIN information_schema.table_constraints tc ON kcu.constraint_name = tc.constraint_name
                  WHERE kcu.table_schema = c.table_schema 
                    AND kcu.table_name = c.table_name 
                    AND kcu.column_name = c.column_name
                    AND tc.constraint_type = 'PRIMARY KEY'
                )
              )
            ) ORDER BY c.ordinal_position)
            FROM information_schema.columns c
            WHERE c.table_schema = t.table_schema AND c.table_name = t.table_name
          ) as columns
        FROM information_schema.tables t
        WHERE t.table_schema = 'public'
        ORDER BY t.table_name;
      `;

      const result = await client.query(query);

      return result.rows.map((row: any) => ({
        schema: row.table_schema,
        name: row.table_name,
        type: row.table_type,
        columns: row.columns || [],
      }));
    } catch (error: any) {
      logger.error(`Failed to get schema for ${name}:`, error.message);
      return [];
    } finally {
      await client.end().catch(() => {});
    }
  }

  /**
   * Execute SQL query on an instance database
   * Cloud-Version: Uses shared PostgreSQL with project-specific database
   * @param name Instance name
   * @param sql SQL query to execute
   */
  async executeSQL(name: string, sql: string): Promise<{ rows: any[]; error?: string }> {
    const projectPath = path.join(this.projectsPath, name);
    const envPath = path.join(projectPath, '.env');

    if (!fs.existsSync(envPath)) {
      throw new Error(`Instance ${name} not found`);
    }

    const env = parseEnvFile(envPath);
    const stackType = this.detectStackType(env);

    if (stackType === 'cloud') {
      try {
        const sharedDb = this.getSharedDbConfig(env);
        const csvOutput = await this.runCloudPsql(sharedDb.database, sql, { csv: true });
        const rows = this.parseCsvResult(csvOutput);
        return { rows };
      } catch (error: any) {
        return { rows: [], error: error.message };
      }
    }

    const client = await this.connectToInstanceDb(env, stackType);

    try {
      await client.connect();
      const result = await client.query(sql);
      return { rows: result.rows };
    } catch (error: any) {
      return { rows: [], error: error.message };
    } finally {
      await client.end().catch(() => {});
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
      GATEWAY_PORT: `${ports.gateway_port}`,
      // Keep KONG_HTTP_PORT for backward compatibility during migration
      KONG_HTTP_PORT: `${ports.gateway_port}`,
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

    // Keep newly generated tenant stacks on the same reviewed image matrix as
    // shared and temporary Studio/Meta containers.
    try {
      const matrix = loadImageMatrix(path.join(this.templatesPath, 'shared', 'image-versions.yml'));
      const replacements: Array<[RegExp, string]> = [
        [/image: supabase\/studio:[^\s]+/g, 'tenant-studio'],
        [/image: kong:[^\s]+/g, 'tenant-kong'],
        [/image: supabase\/gotrue:[^\s]+/g, 'tenant-auth'],
        [/image: postgrest\/postgrest:[^\s]+/g, 'tenant-rest'],
        [/image: supabase\/realtime:[^\s]+/g, 'tenant-realtime'],
        [/image: supabase\/storage-api:[^\s]+/g, 'tenant-storage'],
        [/image: darthsim\/imgproxy:[^\s]+/g, 'tenant-imgproxy'],
        [/image: supabase\/postgres-meta:[^\s]+/g, 'tenant-meta'],
        [/image: supabase\/edge-runtime:[^\s]+/g, 'tenant-functions'],
        [/image: supabase\/logflare:[^\s]+/g, 'tenant-analytics'],
        [/image: supabase\/postgres:[^\s]+/g, 'tenant-db'],
        [/image: timberio\/vector:[^\s]+/g, 'tenant-vector'],
        [/image: supabase\/supavisor:[^\s]+/g, 'tenant-pooler'],
      ];
      for (const [pattern, matrixName] of replacements) {
        const definition = matrix.images[matrixName];
        if (definition) content = content.replace(pattern, `image: ${definition.repository}:${definition.tag}`);
      }
    } catch (error) {
      logger.warn(`Image matrix unavailable while creating tenant ${projectName}: ${error instanceof Error ? error.message : String(error)}`);
    }

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
   * Create Nginx gateway config for this tenant
   * (replaces createKongConfig)
   */
  private async createNginxGatewayConfig(
    projectPath: string,
    _apiUrl: string,
    _corsOrigins: string[]
  ): Promise<void> {
    const projectName = path.basename(projectPath);
    const sharedDir = path.resolve(this.projectsPath, '..', 'shared');

    try {
      await generateAndWriteTenantConfig(projectName, this.projectsPath, sharedDir);
      logger.info(`Nginx gateway config generated for ${projectName}`);

      // Try to reload nginx-gateway if it's running
      try {
        await reloadNginxGateway();
      } catch {
        logger.debug('Nginx gateway not running yet, config will be applied on next start');
      }
    } catch (error: any) {
      logger.warn(`Failed to create Nginx gateway config for ${projectName}: ${error.message}`);
      // Non-fatal: tenant still works, gateway config can be regenerated later
    }
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
   * Create docker-compose.override.yml (no longer needed for Kong)
   * Kept as no-op for backward compatibility.
   */
  private async createDockerComposeOverride(_projectPath: string): Promise<void> {
    // Kong override no longer needed since tenants use shared nginx-gateway
    logger.debug('createDockerComposeOverride: no-op (Kong removed)');
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
   * Recreate an instance (docker compose down + up)
   * Use this to apply docker-compose.yml changes like memory limits
   */
  async recreateInstance(name: string): Promise<void> {
    const projectPath = path.join(this.projectsPath, name);

    if (!fs.existsSync(projectPath)) {
      throw new Error(`Instance ${name} does not exist`);
    }

    try {
      logger.info(`Recreating instance: ${name}`);

      // Copy latest docker-compose.yml from template
      const templateCompose = path.join(__dirname, '..', '..', '..', 'docker-compose.yml');
      const projectCompose = path.join(projectPath, 'docker-compose.yml');

      if (fs.existsSync(templateCompose)) {
        fs.copyFileSync(templateCompose, projectCompose);
        logger.info(`Updated docker-compose.yml for ${name}`);
      }

      // Force recreate all containers
      await execAsync('docker compose down', { cwd: projectPath });
      await execAsync('docker compose up -d --force-recreate', { cwd: projectPath });

      logger.info(`Successfully recreated instance: ${name}`);
    } catch (error) {
      logger.error(`Error recreating instance ${name}:`, error);
      throw error;
    }
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
        // For cloud tenants, use shared JWT secret so tokens stay compatible
        // with the shared Studio and Kong
        const stackType = this.detectStackType(envConfig);
        const jwtSecretOverride = stackType === 'cloud' ? this.getSharedJwtSecret() : undefined;
        const keys = generateAllKeys(jwtSecretOverride);
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
   * Get instance environment configuration
   */
  async getInstanceEnv(name: string): Promise<Record<string, string>> {
    const projectPath = path.join(this.projectsPath, name);
    const envPath = path.join(projectPath, '.env');

    if (!fs.existsSync(envPath)) {
      throw new Error(`Instance configuration not found at ${envPath}`);
    }

    return parseEnvFile(envPath);
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
