/**
 * NginxGatewayGenerator - Generates dynamic Nginx configs for the shared
 * nginx-gateway container, replacing per-tenant Kong containers.
 *
 * Each tenant gets a dedicated config file under shared/volumes/nginx/tenants/{tenant}.conf
 * with port-based routing (each tenant keeps their assigned gateway port).
 *
 * After writing configs, the Nginx gateway is reloaded (~50ms, zero-downtime).
 */

import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';
import { parseEnvFile } from '../utils/envParser';
import { runDockerCommand } from '../utils/dockerCommand';

export interface NginxGatewayOptions {
  /** Tenant name, e.g. "cloud-test" */
  tenantName: string;
  /** Anon key for API key validation */
  anonKey: string;
  /** Service role key for admin routes */
  serviceRoleKey: string;
  /** Gateway port (replaces kong_http port) */
  gatewayPort: number;
  /** IP/CIDR addresses to whitelist. All other IPs are denied. */
  ipWhitelist?: string[];
  /** API rate limit in requests per minute. 0 or undefined = disabled. */
  rateLimitRpm?: number;
  /** Enforce HTTPS-only: redirect HTTP → HTTPS. */
  sslOnly?: boolean;
}

/**
 * Read the gateway template and replace placeholders with tenant-specific values.
 */
export function generateNginxGatewayConfig(options: NginxGatewayOptions): string {
  const { tenantName, anonKey, serviceRoleKey, gatewayPort, ipWhitelist, rateLimitRpm, sslOnly } =
    options;

  // Resolve template path (works from both dist/ and src/)
  const possiblePaths = [
    path.resolve(__dirname, '..', '..', '..', '..', 'templates', 'nginx', 'gateway.conf.template'),
    path.resolve(__dirname, '..', '..', '..', 'templates', 'nginx', 'gateway.conf.template'),
  ];

  let templateContent = '';
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      templateContent = fs.readFileSync(p, 'utf-8');
      break;
    }
  }

  if (!templateContent) {
    throw new Error(`Nginx gateway template not found. Searched: ${possiblePaths.join(', ')}`);
  }

  // Create a safe identifier for map variable names (no hyphens allowed in nginx vars)
  const tenantId = tenantName.replace(/-/g, '_');

  // --- Security: HTTP-context directives (limit_req_zone) ---
  let securityHttpDirectives = '';
  if (rateLimitRpm && rateLimitRpm > 0) {
    const ratePerSec = Math.max(1, Math.ceil(rateLimitRpm / 60));
    securityHttpDirectives =
      `# Rate limiting for ${tenantName}\n` +
      `limit_req_zone $binary_remote_addr zone=${tenantId}_rl:10m rate=${ratePerSec}r/s;\n`;
  }

  // --- Security: server-context directives ---
  let securityServerDirectives = '';
  if (sslOnly) {
    securityServerDirectives += `    # SSL-only enforcement\n    if ($scheme = http) { return 301 https://$host$request_uri; }\n`;
  }
  if (ipWhitelist && ipWhitelist.length > 0) {
    securityServerDirectives += `    # IP Whitelist\n`;
    securityServerDirectives += ipWhitelist.map(ip => `    allow ${ip};`).join('\n') + '\n';
    securityServerDirectives += `    deny all;\n`;
  }
  if (rateLimitRpm && rateLimitRpm > 0) {
    const burst = Math.max(5, Math.ceil(rateLimitRpm / 10));
    securityServerDirectives += `    # Rate limiting\n    limit_req zone=${tenantId}_rl burst=${burst} nodelay;\n`;
  }

  const config = templateContent
    .replace(/\{\{TENANT_NAME\}\}/g, tenantName)
    .replace(/\{\{TENANT_ID\}\}/g, tenantId)
    .replace(/\{\{ANON_KEY\}\}/g, anonKey)
    .replace(/\{\{SERVICE_ROLE_KEY\}\}/g, serviceRoleKey)
    .replace(/\{\{GATEWAY_PORT\}\}/g, String(gatewayPort))
    .replace(/\{\{TIMESTAMP\}\}/g, new Date().toISOString())
    .replace(/\{\{SECURITY_HTTP_DIRECTIVES\}\}/g, securityHttpDirectives)
    .replace(/\{\{SECURITY_SERVER_DIRECTIVES\}\}/g, securityServerDirectives);

  return config;
}

/**
 * Generate a tenant config from its .env file and write to the nginx tenants directory.
 */
export async function generateAndWriteTenantConfig(
  tenantName: string,
  projectsDir: string,
  sharedDir: string
): Promise<string> {
  const tenantEnvPath = path.join(projectsDir, tenantName, '.env');
  if (!fs.existsSync(tenantEnvPath)) {
    throw new Error(`Tenant .env not found: ${tenantEnvPath}`);
  }

  const tenantEnv = parseEnvFile(tenantEnvPath);
  const sharedEnvPath = path.join(sharedDir, '.env.shared');
  const sharedEnv = fs.existsSync(sharedEnvPath) ? parseEnvFile(sharedEnvPath) : {};

  const anonKey = tenantEnv['ANON_KEY'] || sharedEnv['SHARED_ANON_KEY'] || '';
  const serviceRoleKey =
    tenantEnv['SERVICE_ROLE_KEY'] || sharedEnv['SHARED_SERVICE_ROLE_KEY'] || '';
  const gatewayPort = parseInt(
    tenantEnv['GATEWAY_PORT'] || tenantEnv['KONG_HTTP_PORT'] || '8000',
    10
  );

  // Read optional SECURITY_* env vars
  const ipWhitelistRaw = tenantEnv['SECURITY_IP_WHITELIST'] || '';
  const ipWhitelist = ipWhitelistRaw
    ? ipWhitelistRaw
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    : undefined;
  const rateLimitRpmRaw = parseInt(tenantEnv['SECURITY_RATE_LIMIT_RPM'] || '0', 10);
  const rateLimitRpm = !isNaN(rateLimitRpmRaw) && rateLimitRpmRaw > 0 ? rateLimitRpmRaw : undefined;
  const sslOnly = tenantEnv['SECURITY_SSL_ONLY'] === 'true' ? true : undefined;

  const config = generateNginxGatewayConfig({
    tenantName,
    anonKey,
    serviceRoleKey,
    gatewayPort,
    ipWhitelist,
    rateLimitRpm,
    sslOnly,
  });

  const configPath = await writeNginxTenantConfig(tenantName, config, sharedDir);
  return configPath;
}

/**
 * Write a tenant's Nginx config to the shared volumes directory.
 */
export async function writeNginxTenantConfig(
  tenantName: string,
  config: string,
  sharedDir: string
): Promise<string> {
  const tenantsDir = path.join(sharedDir, 'volumes', 'nginx', 'tenants');
  fs.mkdirSync(tenantsDir, { recursive: true });

  const configPath = path.join(tenantsDir, `${tenantName}.conf`);

  // Backup existing config
  if (fs.existsSync(configPath)) {
    const backupPath = `${configPath}.backup`;
    fs.copyFileSync(configPath, backupPath);
  }

  fs.writeFileSync(configPath, config, 'utf-8');
  logger.info(`Nginx gateway config written: ${configPath}`);
  return configPath;
}

/**
 * Remove a tenant's Nginx config (when deleting a tenant).
 */
export async function removeNginxTenantConfig(
  tenantName: string,
  sharedDir: string
): Promise<void> {
  const configPath = path.join(sharedDir, 'volumes', 'nginx', 'tenants', `${tenantName}.conf`);
  if (fs.existsSync(configPath)) {
    fs.unlinkSync(configPath);
    logger.info(`Removed Nginx config for tenant "${tenantName}"`);
  }
}

/**
 * Reload the Nginx gateway container (zero-downtime, ~50ms).
 * Falls back to container restart if reload fails.
 */
export async function reloadNginxGateway(): Promise<void> {
  try {
    // First validate the config
    const { stderr: testStderr } = await runDockerCommand(
      ['exec', 'multibase-nginx-gateway', 'nginx', '-t'],
      {
        timeout: 10000,
      }
    );
    if (testStderr && !testStderr.includes('successful')) {
      logger.warn(`Nginx config test output: ${testStderr}`);
    }

    // Then reload
    await runDockerCommand(['exec', 'multibase-nginx-gateway', 'nginx', '-s', 'reload'], {
      timeout: 10000,
    });
    logger.info('Nginx gateway reloaded successfully');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`Nginx reload failed, attempting container restart: ${message}`);
    try {
      await runDockerCommand(['restart', 'multibase-nginx-gateway'], { timeout: 30000 });
      logger.info('Nginx gateway container restarted successfully');
    } catch (restartError: unknown) {
      const restartMessage =
        restartError instanceof Error ? restartError.message : String(restartError);
      throw new Error(`Failed to reload/restart Nginx gateway: ${restartMessage}`, {
        cause: restartError,
      });
    }
  }
}

/**
 * Check if the Nginx gateway container is running.
 */
export async function isNginxGatewayRunning(): Promise<boolean> {
  try {
    const { stdout } = await runDockerCommand(
      ['inspect', '--format={{.State.Running}}', 'multibase-nginx-gateway'],
      { timeout: 5000 }
    );
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Generate configs for ALL existing tenants and reload Nginx.
 * Useful after gateway container restart or initial setup.
 */
export async function regenerateAllTenantConfigs(
  projectsDir: string,
  sharedDir: string
): Promise<string[]> {
  const tenantsDir = path.join(sharedDir, 'volumes', 'nginx', 'tenants');
  fs.mkdirSync(tenantsDir, { recursive: true });

  const generated: string[] = [];

  if (!fs.existsSync(projectsDir)) {
    logger.warn(`Projects directory not found: ${projectsDir}`);
    return generated;
  }

  const tenants = fs.readdirSync(projectsDir).filter(name => {
    const envPath = path.join(projectsDir, name, '.env');
    return fs.existsSync(envPath) && fs.statSync(path.join(projectsDir, name)).isDirectory();
  });

  for (const tenantName of tenants) {
    try {
      await generateAndWriteTenantConfig(tenantName, projectsDir, sharedDir);
      generated.push(tenantName);
    } catch (error) {
      logger.error(`Failed to generate Nginx config for tenant "${tenantName}":`, error);
    }
  }

  if (generated.length > 0) {
    try {
      await reloadNginxGateway();
    } catch (error) {
      logger.warn('Could not reload Nginx gateway (may not be running yet):', error);
    }
  }

  logger.info(`Generated Nginx configs for ${generated.length} tenants: ${generated.join(', ')}`);
  return generated;
}

/**
 * Get the list of tenants with active Nginx configs.
 */
export function getConfiguredTenants(sharedDir: string): string[] {
  const tenantsDir = path.join(sharedDir, 'volumes', 'nginx', 'tenants');
  if (!fs.existsSync(tenantsDir)) return [];

  return fs
    .readdirSync(tenantsDir)
    .filter(f => f.endsWith('.conf') && !f.endsWith('.backup'))
    .map(f => f.replace('.conf', ''));
}
