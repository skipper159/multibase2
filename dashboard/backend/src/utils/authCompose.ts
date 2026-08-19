import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

type ComposeDocument = {
  services?: Record<string, { environment?: Record<string, string> | string[] }>;
};

export function authProviderEnvironmentKeys(config: Record<string, string>): string[] {
  return Object.keys(config)
    .filter(
      key =>
        key.startsWith('GOTRUE_EXTERNAL_') &&
        ![
          'GOTRUE_EXTERNAL_EMAIL_ENABLED',
          'GOTRUE_EXTERNAL_PHONE_ENABLED',
          'GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED',
        ].includes(key)
    )
    .sort();
}

export function authServiceName(compose: ComposeDocument): 'auth' | 'gotrue' | null {
  if (compose.services?.auth) return 'auth';
  if (compose.services?.gotrue) return 'gotrue';
  return null;
}

export function authForceRecreateArgs(serviceName: 'auth' | 'gotrue'): string[] {
  return ['compose', 'up', '-d', '--no-deps', '--force-recreate', serviceName];
}

export function mergeAuthProviderOverride(
  document: ComposeDocument,
  serviceName: 'auth' | 'gotrue',
  keys: string[]
): ComposeDocument {
  const services = document.services ?? {};
  const service = services[serviceName] ?? {};
  const environment = service.environment;

  if (Array.isArray(environment)) {
    const replacedKeys = new Set(keys);
    service.environment = [
      ...environment.filter(entry => !replacedKeys.has(entry.split('=', 1)[0])),
      ...keys.map(key => `${key}=\${${key}}`),
    ];
  } else {
    const nextEnvironment = { ...(environment ?? {}) };
    for (const key of keys) nextEnvironment[key] = `\${${key}}`;
    service.environment = nextEnvironment;
  }

  services[serviceName] = service;
  return { ...document, services };
}

export function ensureAuthProviderComposeOverride(
  projectPath: string,
  keys: string[]
): 'auth' | 'gotrue' {
  const composePath = path.join(projectPath, 'docker-compose.yml');
  const compose = yaml.load(fs.readFileSync(composePath, 'utf8')) as ComposeDocument;
  const serviceName = authServiceName(compose);
  if (!serviceName) throw new Error('Auth service not found in docker-compose.yml');
  if (keys.length === 0) return serviceName;

  const overridePath = path.join(projectPath, 'docker-compose.override.yml');
  const override = fs.existsSync(overridePath)
    ? ((yaml.load(fs.readFileSync(overridePath, 'utf8')) as ComposeDocument) ?? {})
    : {};
  const updated = mergeAuthProviderOverride(override, serviceName, keys);
  fs.writeFileSync(overridePath, yaml.dump(updated, { noRefs: true }), 'utf8');
  return serviceName;
}
