/**
 * StudioManager - Manages tenant switching for the shared Studio.
 *
 * When a user clicks "Studio" for a tenant, this service:
 * 1. Ensures a dedicated Studio + Meta container per tenant
 * 2. Generates/updates the Nginx gateway config for the tenant
 * 3. Reloads Nginx gateway (~50ms, zero-downtime)
 *
 * This makes the shared Studio fully functional for the selected tenant:
 * Auth, Storage, Functions, SQL Editor, RLS policies, etc.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import net from 'net';
import { logger } from '../utils/logger';
import { parseEnvFile } from '../utils/envParser';
import { generateAndWriteTenantConfig, reloadNginxGateway } from './NginxGatewayGenerator';
import DockerManager from './DockerManager';

const execAsync = promisify(exec);
const STUDIO_IMAGE = process.env.STUDIO_IMAGE || 'supabase/studio:latest';
const TENANT_STUDIO_IDLE_MS = Math.max(
  60_000,
  parseInt(process.env.TENANT_STUDIO_IDLE_MS || '600000', 10)
);
const TENANT_STUDIO_CLEANUP_INTERVAL_MS = Math.max(
  30_000,
  parseInt(process.env.TENANT_STUDIO_CLEANUP_INTERVAL_MS || '60000', 10)
);

export interface ActiveTenant {
  name: string;
  projectDb: string;
  activatedAt: Date;
}

export class StudioManager {
  private sharedDir: string;
  private projectsDir: string;
  private dockerManager: DockerManager;
  private activeTenant: ActiveTenant | null = null;
  private tenantStudioPorts = new Map<string, number>();
  private tenantLastAccess = new Map<string, number>();
  private cleanupTimer: NodeJS.Timeout;
  private switching = false;

  constructor(projectsDir: string, dockerManager: DockerManager) {
    this.projectsDir = path.resolve(projectsDir);
    this.sharedDir = path.resolve(projectsDir, '..', 'shared');
    this.dockerManager = dockerManager;

    this.cleanupTimer = setInterval(() => {
      this.cleanupIdleTenantStudios().catch((error) => {
        logger.warn('Idle Studio cleanup failed:', error);
      });
    }, TENANT_STUDIO_CLEANUP_INTERVAL_MS);

    this.cleanupTimer.unref();
  }

  /**
   * Get the currently active tenant for Studio
   */
  getActiveTenant(): ActiveTenant | null {
    return this.activeTenant;
  }

  /**
   * Check if a switch is currently in progress
   */
  isSwitching(): boolean {
    return this.switching;
  }

  /**
   * Activate a tenant for Studio access.
   * This configures Nginx gateway and ensures dedicated Studio+Meta.
   */
  async activateTenant(tenantName: string): Promise<ActiveTenant> {
    if (this.switching) {
      throw new Error('Tenant switch already in progress. Please wait.');
    }

    this.switching = true;
    const startTime = Date.now();

    try {
      logger.info(`Activating tenant "${tenantName}" for Studio...`);

      // 1. Validate tenant exists
      const tenantDir = path.join(this.projectsDir, tenantName);
      if (!fs.existsSync(tenantDir)) {
        throw new Error(`Tenant "${tenantName}" not found in projects directory`);
      }

      const tenantEnvPath = path.join(tenantDir, '.env');
      if (!fs.existsSync(tenantEnvPath)) {
        throw new Error(`Tenant "${tenantName}" has no .env file`);
      }

      const tenantEnv = parseEnvFile(tenantEnvPath);
      const projectDb = tenantEnv['PROJECT_DB'];
      if (!projectDb) {
        throw new Error(`Tenant "${tenantName}" has no PROJECT_DB in .env`);
      }

      // 2. Verify tenant containers are running
      await this.verifyTenantRunning(tenantName);

      // 3. Ensure dedicated Studio + Meta containers for this tenant
      logger.info(`[Studio Switch] Step 1/2: Ensuring dedicated Studio for "${tenantName}"...`);
      const studioPort = await this.ensureTenantStudio(tenantName, tenantEnv, projectDb);

      // 4. Ensure Nginx gateway config is up-to-date for this tenant
      logger.info(`[Studio Switch] Step 2/2: Updating Nginx gateway config for "${tenantName}"...`);
      await this.ensureTenantNginxRoute(tenantName, studioPort);

      // 4. Update state
      this.activeTenant = {
        name: tenantName,
        projectDb,
        activatedAt: new Date(),
      };
      this.tenantStudioPorts.set(tenantName, studioPort);
      this.markTenantAccess(tenantName);

      const elapsed = Date.now() - startTime;
      logger.info(
        `Tenant "${tenantName}" activated for dedicated Studio on port ${studioPort} in ${elapsed}ms`
      );

      return this.activeTenant;
    } catch (error) {
      logger.error(`Failed to activate tenant "${tenantName}":`, error);
      throw error;
    } finally {
      this.switching = false;
    }
  }

  getStudioUrl(tenantName: string, host: string = 'localhost'): string | null {
    const port = this.tenantStudioPorts.get(tenantName);
    if (!port) return null;
    this.markTenantAccess(tenantName);

    // In cloud/VPS deployment, use the public HTTPS subdomain URL.
    // Instances live on ROOT_DOMAIN (2nd-level, covered by wildcard cert).
    // Falls back to BACKEND_DOMAIN for backwards-compat, then derives root domain.
    const backendDomain = process.env.BACKEND_DOMAIN || '';
    const rootDomain =
      process.env.ROOT_DOMAIN ||
      (() => {
        const parts = backendDomain.split('.');
        return parts.length >= 3 ? parts.slice(-2).join('.') : backendDomain;
      })();
    if (rootDomain) {
      return `https://${tenantName}.${rootDomain}`;
    }

    return `http://${host}:${port}`;
  }

  /**
   * Keep a tenant's Studio alive (resets the idle timer).
   * Only effective if the tenant already has a running Studio.
   */
  keepAlive(tenantName: string): void {
    if (this.tenantLastAccess.has(tenantName)) {
      this.markTenantAccess(tenantName);
    }
  }

  private markTenantAccess(tenantName: string): void {
    this.tenantLastAccess.set(tenantName, Date.now());
  }

  private async cleanupIdleTenantStudios(): Promise<void> {
    const now = Date.now();

    for (const [tenantName, lastAccess] of this.tenantLastAccess.entries()) {
      const idleMs = now - lastAccess;
      if (idleMs < TENANT_STUDIO_IDLE_MS) {
        continue;
      }

      const studioContainer = `multibase-studio-${tenantName}`;
      const metaContainer = `multibase-meta-${tenantName}`;

      logger.info(
        `Auto-stopping idle tenant Studio for "${tenantName}" after ${Math.round(idleMs / 1000)}s inactivity`
      );

      await this.removeContainerIfExists(studioContainer);
      await this.removeContainerIfExists(metaContainer);

      this.tenantLastAccess.delete(tenantName);
      this.tenantStudioPorts.delete(tenantName);

      if (this.activeTenant?.name === tenantName) {
        this.activeTenant = null;
      }
    }
  }

  private async ensureTenantStudio(
    tenantName: string,
    tenantEnv: Record<string, string>,
    projectDb: string
  ): Promise<number> {
    const sharedEnvPath = path.join(this.sharedDir, '.env.shared');
    const sharedEnv = fs.existsSync(sharedEnvPath) ? parseEnvFile(sharedEnvPath) : {};

    const pgPassword =
      sharedEnv['SHARED_POSTGRES_PASSWORD'] || tenantEnv['POSTGRES_PASSWORD'] || '';
    const logflareApiKey =
      sharedEnv['SHARED_LOGFLARE_API_KEY'] || sharedEnv['LOGFLARE_API_KEY'] || '';
    const openaiApiKey =
      tenantEnv['OPENAI_API_KEY'] || sharedEnv['OPENAI_API_KEY'] || process.env.OPENAI_API_KEY || '';
    const studioOrg = sharedEnv['SHARED_STUDIO_ORG'] || 'Multibase';
    const studioProject = tenantName;
    const tenantFunctionsHostPath = path
      .join(this.projectsDir, tenantName, 'volumes', 'functions')
      .replace(/\\/g, '/');

    const tenantSnippetsHostPath = path
      .join(this.projectsDir, tenantName, 'volumes', 'snippets')
      .replace(/\\/g, '/');
    fs.mkdirSync(tenantSnippetsHostPath, { recursive: true });
    const metaContainer = `multibase-meta-${tenantName}`;
    const studioContainer = `multibase-studio-${tenantName}`;

    const existingPort = this.tenantStudioPorts.get(tenantName);
    const reservedPorts = new Set(this.tenantStudioPorts.values());
    const studioPort = existingPort || (await this.findAvailablePort(3100, reservedPorts));

    await this.removeContainerIfExists(metaContainer);
    await this.removeContainerIfExists(studioContainer);

    const metaCmd = [
      'docker run -d',
      `--name ${metaContainer}`,
      '--network multibase-shared',
      '--restart unless-stopped',
      '-e PG_META_PORT=8080',
      '-e PG_META_DB_HOST=multibase-db',
      '-e PG_META_DB_PORT=5432',
      `-e "PG_META_DB_NAME=${projectDb}"`,
      '-e PG_META_DB_USER=supabase_admin',
      `-e "PG_META_DB_PASSWORD=${pgPassword}"`,
      `-e "PG_META_DB_URL=postgresql://supabase_admin:${pgPassword}@multibase-db:5432/${projectDb}"`,
      'supabase/postgres-meta:v0.87.1',
    ].join(' ');

    await execAsync(metaCmd, { timeout: 20000 });
    await this.waitForContainer(metaContainer, 15000);

    const studioCmd = [
      'docker run -d',
      `--name ${studioContainer}`,
      '--network multibase-shared',
      '--restart unless-stopped',
      `-p ${studioPort}:3000`,
      '-v /var/run/docker.sock:/var/run/docker.sock:ro',
      `-v "${tenantSnippetsHostPath}:/home/studio/snippets"`,
      `-v "${tenantFunctionsHostPath}:/home/studio/functions"`,
      `-e STUDIO_PG_META_URL=http://${metaContainer}:8080`,
      `-e STORAGE_URL=http://${tenantName}-storage:5000`,
      `-e "POSTGRES_PASSWORD=${pgPassword}"`,
      `-e POSTGRES_HOST=multibase-db`,
      `-e POSTGRES_PORT=5432`,
      `-e "POSTGRES_DB=${projectDb}"`,
      `-e "DEFAULT_ORGANIZATION_NAME=${studioOrg}"`,
      `-e "DEFAULT_PROJECT_NAME=${studioProject}"`,
      `-e SUPABASE_URL=http://multibase-nginx-gateway:${tenantEnv['GATEWAY_PORT'] || tenantEnv['KONG_HTTP_PORT'] || '8000'}`,
      `-e SUPABASE_PUBLIC_URL=${tenantEnv['SUPABASE_PUBLIC_URL'] || tenantEnv['API_EXTERNAL_URL'] || `http://localhost:${tenantEnv['GATEWAY_PORT'] || tenantEnv['KONG_HTTP_PORT'] || '8000'}`}`,
      `-e "SUPABASE_ANON_KEY=${tenantEnv['ANON_KEY'] || ''}"`,
      `-e "SUPABASE_SERVICE_KEY=${tenantEnv['SERVICE_ROLE_KEY'] || ''}"`,
      `-e "AUTH_JWT_SECRET=${tenantEnv['JWT_SECRET'] || ''}"`,
      `-e "LOGFLARE_API_KEY=${logflareApiKey}"`,
      '-e LOGFLARE_URL=http://multibase-analytics:4000',
      '-e NEXT_PUBLIC_ENABLE_LOGS=true',
      '-e NEXT_ANALYTICS_BACKEND_PROVIDER=postgres',
      '-e EDGE_FUNCTIONS_MANAGEMENT_FOLDER=/home/studio/functions',
      '-e SNIPPETS_MANAGEMENT_FOLDER=/home/studio/snippets',
      '-e DOCKER_SOCKET_LOCATION=/var/run/docker.sock',
      ...(openaiApiKey ? [`-e "OPENAI_API_KEY=${openaiApiKey}"`] : []),
      STUDIO_IMAGE,
    ].join(' ');

    await execAsync(studioCmd, { timeout: 25000 });
    await this.waitForContainer(studioContainer, 20000);

    return studioPort;
  }

  /**
   * Update system nginx config to route the tenant subdomain to the correct
   * per-tenant studio port, then reload system nginx.
   * Also regenerates the Docker nginx-gateway config.
   */
  private async ensureTenantNginxRoute(tenantName: string, studioPort: number): Promise<void> {
    // 1. Update system nginx sites-enabled config to point to per-tenant studio port
    const sysNginxConfig = path.join(
      this.projectsDir,
      '..',
      'nginx',
      'sites-enabled',
      `${tenantName}.conf`
    );
    if (fs.existsSync(sysNginxConfig)) {
      try {
        let config = fs.readFileSync(sysNginxConfig, 'utf8');
        // Replace the studio proxy_pass port: find the first location / block that
        // contains auth_request (= studio block), then replace its proxy_pass port.
        // Supports configs with or without the "# Main location with authentication" comment.
        const authReqIdx = config.indexOf('auth_request /auth-check;');
        let updated = config;
        if (authReqIdx !== -1) {
          const proxyPassMarker = 'proxy_pass http://127.0.0.1:';
          const ppIdx = config.indexOf(proxyPassMarker, authReqIdx);
          if (ppIdx !== -1) {
            const afterProxyPass = ppIdx + proxyPassMarker.length;
            const semicolonIdx = config.indexOf(';', afterProxyPass);
            if (semicolonIdx !== -1) {
              updated =
                config.slice(0, afterProxyPass) + studioPort + config.slice(semicolonIdx);
            }
          }
        }
        if (updated !== config) {
          fs.writeFileSync(sysNginxConfig, updated);
          logger.info(`Updated system nginx studio proxy_pass for "${tenantName}" to port ${studioPort}`);
        }
        // Reload system nginx (multibase has sudo NOPASSWD for this)
        await execAsync('sudo nginx -s reload', { timeout: 10000 });
        logger.info(`System nginx reloaded for tenant "${tenantName}"`);
      } catch (err: any) {
        logger.warn(`Failed to update system nginx for "${tenantName}": ${err.message}`);
      }
    }

    // 2. Also update Docker nginx-gateway config for the Supabase API routes
    try {
      await generateAndWriteTenantConfig(tenantName, this.projectsDir, this.sharedDir);
      await reloadNginxGateway();
      logger.info(`Docker nginx-gateway config updated and reloaded for tenant "${tenantName}"`);
    } catch (error: any) {
      logger.warn(`Failed to update Docker nginx-gateway for tenant "${tenantName}": ${error.message}`);
      // Non-fatal: Studio can still work, just the gateway routes might be outdated
    }
  }

  private async removeContainerIfExists(containerName: string): Promise<void> {
    try {
      await execAsync(`docker rm -f ${containerName}`, { timeout: 10000 });
    } catch {
      // ignore if container does not exist
    }
  }

  private async findAvailablePort(startPort: number, reservedPorts: Set<number>): Promise<number> {
    const maxPort = startPort + 300;

    for (let port = startPort; port <= maxPort; port += 1) {
      if (reservedPorts.has(port)) {
        continue;
      }

      const isFree = await new Promise<boolean>((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => {
          server.close(() => resolve(true));
        });
        server.listen(port, '0.0.0.0');
      });

      if (isFree) {
        return port;
      }
    }

    throw new Error(`No available Studio port found in range ${startPort}-${maxPort}`);
  }

  // NOTE: reloadKong() removed – replaced by reloadNginxGateway() from NginxGatewayGenerator

  /**
   * Restart pg-meta with a different database name.
   * We use docker exec to set the environment and restart.
   */
  private async switchPgMeta(projectDb: string): Promise<void> {
    try {
      // Read shared env for password
      const sharedEnvPath = path.join(this.sharedDir, '.env.shared');
      const sharedEnv = fs.existsSync(sharedEnvPath) ? parseEnvFile(sharedEnvPath) : {};
      const pgPassword = sharedEnv['SHARED_POSTGRES_PASSWORD'] || '';

      // Stop current pg-meta
      await execAsync('docker stop multibase-meta', { timeout: 10000 });

      // Remove and recreate with new DB name
      await execAsync('docker rm multibase-meta', { timeout: 10000 });

      // Recreate pg-meta with the new database
      const createCmd = [
        'docker run -d',
        '--name multibase-meta',
        '--network multibase-shared',
        '--restart unless-stopped',
        `-e PG_META_PORT=8080`,
        `-e PG_META_DB_HOST=multibase-db`,
        `-e PG_META_DB_PORT=5432`,
        `-e "PG_META_DB_NAME=${projectDb}"`,
        `-e PG_META_DB_USER=supabase_admin`,
        `-e "PG_META_DB_PASSWORD=${pgPassword}"`,
        `supabase/postgres-meta:v0.87.1`,
      ].join(' ');

      await execAsync(createCmd, { timeout: 15000 });

      // Wait for pg-meta to be ready
      await this.waitForContainer('multibase-meta', 15000);
      logger.info(`pg-meta switched to database: ${projectDb}`);
    } catch (error) {
      throw new Error(`Failed to switch pg-meta to ${projectDb}: ${(error as Error).message}`);
    }
  }

  /**
   * Verify that the tenant's key containers are running
   */
  private async verifyTenantRunning(tenantName: string): Promise<void> {
    try {
      const containers = await this.dockerManager.listProjectContainers(tenantName);
      if (containers.length === 0) {
        throw new Error(`No running containers found for tenant "${tenantName}"`);
      }

      // Check at least auth, rest, storage are running
      const requiredServices = ['auth', 'rest', 'storage'];
      const containerNames = containers.map((c) => c.Names[0]?.replace('/', '') || '');

      for (const service of requiredServices) {
        const found = containerNames.some((name) => name.includes(`${tenantName}-${service}`));
        if (!found) {
          throw new Error(
            `Required service "${service}" is not running for tenant "${tenantName}"`
          );
        }
      }
    } catch (error) {
      throw new Error(`Tenant "${tenantName}" is not running: ${(error as Error).message}`);
    }
  }

  /**
   * Wait for a container to be healthy/running
   */
  private async waitForContainer(containerName: string, timeoutMs: number): Promise<void> {
    const start = Date.now();
    const pollInterval = 1000;

    while (Date.now() - start < timeoutMs) {
      try {
        const { stdout } = await execAsync(
          `docker inspect --format='{{.State.Status}}' ${containerName}`,
          { timeout: 5000 }
        );
        const status = stdout.trim().replace(/'/g, '');
        if (status === 'running') {
          // Give it a moment to actually be ready
          await new Promise((resolve) => setTimeout(resolve, 500));
          return;
        }
      } catch {
        // Container might not exist yet
      }
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Container ${containerName} did not become ready within ${timeoutMs}ms`);
  }

  /**
   * Deactivate Studio (clear active tenant state)
   */
  async deactivate(): Promise<void> {
    if (!this.activeTenant) {
      return;
    }

    logger.info(`Deactivating Studio for tenant "${this.activeTenant.name}"`);
    this.activeTenant = null;
  }
}
