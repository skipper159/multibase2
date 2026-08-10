import fs from 'fs';

import { EnvConfig, InstanceCredentials, PortMapping } from '../types';
import { logger } from './logger';

/**
 * Parse a .env file and return key-value pairs
 */
export function parseEnvFile(filePath: string): EnvConfig {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const config: EnvConfig = {};

    content.split('\n').forEach((rawLine) => {
      // Strip trailing \r for CRLF support (Windows line endings)
      const line = rawLine.replace(/\r$/, '');

      // Skip comments and empty lines
      if (line.trim().startsWith('#') || line.trim() === '') {
        return;
      }

      // Parse KEY=VALUE
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        let value = match[2].trim();

        // Remove surrounding quotes if present
        value = value.replace(/^["']|["']$/g, '');

        config[key] = value;
      }
    });

    return config;
  } catch (error) {
    logger.error(`Error parsing env file ${filePath}:`, error);
    throw error;
  }
}

/**
 * Extract credentials from env config
 */
export function extractCredentials(envConfig: EnvConfig): InstanceCredentials {
  return {
    project_url: envConfig.API_EXTERNAL_URL || envConfig.PUBLIC_REST_URL || '',
    studio_url: envConfig.SUPABASE_PUBLIC_URL || '',
    anon_key: envConfig.ANON_KEY || '',
    service_role_key: envConfig.SERVICE_ROLE_KEY || '',
    postgres_password: envConfig.POSTGRES_PASSWORD || '',
    jwt_secret: envConfig.JWT_SECRET || '',
    dashboard_username: envConfig.DASHBOARD_USERNAME || '',
    dashboard_password: envConfig.DASHBOARD_PASSWORD || '',
  };
}

/**
 * Extract port mappings from env config
 */
export function extractPorts(envConfig: EnvConfig): PortMapping {
  // Extract port from either "8000" or "host:8000" format
  const extractPort = (value: string | undefined, defaultPort: string, name: string): number => {
    logger.debug(`extractPort called for ${name}: value="${value}", default="${defaultPort}"`);

    if (!value) {
      // Try to parse default port
      const portMatch = defaultPort.match(/:?(\d+)$/);
      const result = portMatch ? parseInt(portMatch[1], 10) : 0;
      logger.debug(`  -> no value, using default: ${result}`);
      return result;
    }

    // Check if value is just a number
    if (/^\d+$/.test(value)) {
      const result = parseInt(value, 10);
      logger.debug(`  -> plain number: ${result}`);
      return result;
    }

    // Extract from host:port format
    const match = value.match(/:(\d+)$/);
    const result = match ? parseInt(match[1], 10) : 0;
    logger.debug(`  -> host:port format: ${result}`);
    return result;
  };

  const extractOptionalPort = (value: string | undefined, name: string): number | undefined => {
    logger.debug(`extractOptionalPort called for ${name}: value="${value}"`);

    if (!value) {
      logger.debug('  -> no value, using undefined');
      return undefined;
    }

    if (/^\d+$/.test(value)) {
      const result = parseInt(value, 10);
      logger.debug(`  -> plain number: ${result}`);
      return result;
    }

    const match = value.match(/:(\d+)$/);
    if (match) {
      const result = parseInt(match[1], 10);
      logger.debug(`  -> host:port format: ${result}`);
      return result;
    }

    logger.debug('  -> could not parse optional port, using undefined');
    return undefined;
  };

  const studioPort = extractOptionalPort(envConfig.STUDIO_PORT, 'STUDIO_PORT');
  const postgresPort = extractOptionalPort(envConfig.POSTGRES_PORT, 'POSTGRES_PORT');
  const poolerPort = extractOptionalPort(envConfig.POOLER_PORT, 'POOLER_PORT');
  const analyticsPort = extractOptionalPort(envConfig.ANALYTICS_PORT, 'ANALYTICS_PORT');

  const ports: PortMapping = {
    gateway_port: extractPort(
      envConfig.GATEWAY_PORT || envConfig.KONG_HTTP_PORT,
      '8000',
      'GATEWAY_PORT'
    ),
    // Backward compatibility
    kong_http: extractPort(
      envConfig.GATEWAY_PORT || envConfig.KONG_HTTP_PORT,
      '8000',
      'GATEWAY_PORT'
    ),
  };

  if (studioPort !== undefined) ports.studio = studioPort;
  if (postgresPort !== undefined) ports.postgres = postgresPort;
  if (poolerPort !== undefined) ports.pooler = poolerPort;
  if (analyticsPort !== undefined) ports.analytics = analyticsPort;

  logger.debug('Extracted ports:', ports);
  return ports;
}

/**
 * Write env config back to file
 */
export function writeEnvFile(filePath: string, config: EnvConfig): void {
  try {
    const lines: string[] = [];

    Object.entries(config).forEach(([key, value]) => {
      // Quote values that contain spaces or special characters
      const quotedValue = value.includes(' ') || value.includes('#') ? `"${value}"` : value;
      lines.push(`${key}=${quotedValue}`);
    });

    fs.writeFileSync(filePath, lines.join('\n'), { encoding: 'utf8', mode: 0o600 });
    // chmod is required as well because mode is ignored when the file already exists.
    fs.chmodSync(filePath, 0o600);
    logger.info(`Wrote env file: ${filePath}`);
  } catch (error) {
    logger.error(`Error writing env file ${filePath}:`, error);
    throw error;
  }
}

/**
 * Create backup of env file
 */
export function backupEnvFile(filePath: string): string {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${filePath}.bak.${timestamp}`;
    fs.copyFileSync(filePath, backupPath);
    fs.chmodSync(backupPath, 0o600);
    logger.info(`Created backup: ${backupPath}`);
    return backupPath;
  } catch (error) {
    logger.error(`Error creating backup of ${filePath}:`, error);
    throw error;
  }
}
