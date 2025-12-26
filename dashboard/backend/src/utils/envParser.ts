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

    content.split('\n').forEach((line) => {
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

  const ports = {
    kong_http: extractPort(envConfig.KONG_HTTP_PORT, '8000', 'KONG_HTTP_PORT'),
    kong_https: extractPort(envConfig.KONG_HTTPS_PORT, '8443', 'KONG_HTTPS_PORT'),
    studio: extractPort(envConfig.STUDIO_PORT, '3000', 'STUDIO_PORT'),
    postgres: extractPort(envConfig.POSTGRES_PORT, '5432', 'POSTGRES_PORT'),
    pooler: extractPort(envConfig.POOLER_PORT, '6543', 'POOLER_PORT'),
    analytics: extractPort(envConfig.ANALYTICS_PORT, '4000', 'ANALYTICS_PORT'),
  };
  
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

    fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
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
    logger.info(`Created backup: ${backupPath}`);
    return backupPath;
  } catch (error) {
    logger.error(`Error creating backup of ${filePath}:`, error);
    throw error;
  }
}
