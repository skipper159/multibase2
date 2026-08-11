import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import type { SharedServicePort } from '../types';

type TransportProtocol = 'tcp' | 'udp';

export interface RuntimePortBinding {
  container: number;
  transport: TransportProtocol;
  host?: number;
  hostAddress?: string;
}

export interface DockerInspectPortSource {
  HostConfig?: { PortBindings?: Record<string, DockerHostPortBinding[] | null | undefined> };
  NetworkSettings?: { Ports?: Record<string, DockerHostPortBinding[] | null | undefined> };
}

interface DockerHostPortBinding {
  HostIp?: string;
  HostPort?: string;
}

interface ExpectedSharedPort {
  label: string;
  container: number;
  transport: TransportProtocol;
  protocol: 'tcp' | 'http';
  host?: number;
  hostAddress?: string;
}

type ExpectedPortsByService = Record<string, ExpectedSharedPort[]>;

const INTERNAL_PORTS: ExpectedPortsByService = {
  pooler: [{ label: 'Supavisor API', container: 4000, transport: 'tcp', protocol: 'http' }],
  meta: [{ label: 'Postgres Meta API', container: 8080, transport: 'tcp', protocol: 'http' }],
  vector: [{ label: 'Vector health', container: 9001, transport: 'tcp', protocol: 'http' }],
  imgproxy: [{ label: 'imgproxy', container: 5001, transport: 'tcp', protocol: 'http' }],
};

function portFromEnv(env: Record<string, string>, key: string, fallback: number): number {
  const parsed = Number.parseInt(env[key] || '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function configuredBindAddress(env: Record<string, string>): string {
  return env.NGINX_BIND_HOST?.trim() || '127.0.0.1';
}

/** Read the concrete host/container mappings returned by Docker Inspect. */
export function extractDockerPortBindings(inspect: DockerInspectPortSource): RuntimePortBinding[] {
  const hostConfigPorts = inspect.HostConfig?.PortBindings || {};
  const networkPorts = inspect.NetworkSettings?.Ports || {};
  const keys = new Set([...Object.keys(hostConfigPorts), ...Object.keys(networkPorts)]);
  const result: RuntimePortBinding[] = [];
  const seen = new Set<string>();

  for (const key of keys) {
    const match = /^(\d+)\/(tcp|udp)$/.exec(key);
    if (!match) continue;

    const container = Number.parseInt(match[1], 10);
    const transport = match[2] as TransportProtocol;
    // NetworkSettings is Docker's runtime view. HostConfig remains a fallback
    // for stopped containers and incomplete inspect responses.
    const bindings = networkPorts[key] === undefined ? hostConfigPorts[key] : networkPorts[key];

    if (!bindings || bindings.length === 0) {
      const signature = `${container}/${transport}/internal`;
      if (!seen.has(signature)) {
        seen.add(signature);
        result.push({ container, transport });
      }
      continue;
    }

    for (const binding of bindings) {
      const host = Number.parseInt(binding.HostPort || '', 10);
      const hostAddress = binding.HostIp?.trim() || '0.0.0.0';
      const normalizedHost = Number.isFinite(host) ? host : undefined;
      const signature = `${container}/${transport}/${hostAddress}/${normalizedHost ?? 'internal'}`;
      if (seen.has(signature)) continue;
      seen.add(signature);
      result.push({
        container,
        transport,
        ...(normalizedHost === undefined ? {} : { host: normalizedHost, hostAddress }),
      });
    }
  }

  return result.sort(
    (left, right) =>
      left.container - right.container ||
      left.transport.localeCompare(right.transport) ||
      (left.host ?? -1) - (right.host ?? -1) ||
      (left.hostAddress || '').localeCompare(right.hostAddress || '')
  );
}

function parseComposePort(value: unknown): ExpectedSharedPort | null {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const port = value as { target?: unknown; published?: unknown; host_ip?: unknown; protocol?: unknown };
    const container = Number.parseInt(String(port.target || ''), 10);
    const host = Number.parseInt(String(port.published || ''), 10);
    if (!Number.isFinite(container)) return null;
    return {
      label: 'HTTP Gateway',
      container,
      transport: port.protocol === 'udp' ? 'udp' : 'tcp',
      protocol: 'http',
      ...(Number.isFinite(host)
        ? { host, hostAddress: typeof port.host_ip === 'string' && port.host_ip ? port.host_ip : '0.0.0.0' }
        : {}),
    };
  }

  if (typeof value !== 'string') return null;
  const match = /^(?:(\[[^\]]+\]|[^:]+):)?(\d+):(\d+)(?:\/(tcp|udp))?$/.exec(value.trim());
  if (!match) return null;
  const hostAddress = match[1]?.replace(/^\[|\]$/g, '') || '0.0.0.0';
  return {
    label: 'HTTP Gateway',
    host: Number.parseInt(match[2], 10),
    container: Number.parseInt(match[3], 10),
    transport: match[4] === 'udp' ? 'udp' : 'tcp',
    protocol: 'http',
    hostAddress,
  };
}

function getTenantGatewayPorts(sharedDir: string): ExpectedSharedPort[] {
  const overridePath = path.join(sharedDir, 'docker-compose.override.yml');
  if (!fs.existsSync(overridePath)) return [];

  try {
    const compose = yaml.load(fs.readFileSync(overridePath, 'utf8')) as {
      services?: Record<string, { ports?: unknown[] }>;
    };
    return (compose.services?.['nginx-gateway']?.ports || [])
      .map(parseComposePort)
      .filter((port): port is ExpectedSharedPort => port !== null);
  } catch {
    return [];
  }
}

/** Expected bindings are used only to flag missing mappings; actual values always come from Inspect. */
export function getExpectedSharedPorts(
  env: Record<string, string>,
  sharedDir: string
): ExpectedPortsByService {
  const loopback = configuredBindAddress(env);
  return {
    db: [{ label: 'PostgreSQL', host: portFromEnv(env, 'SHARED_PG_PORT', 5432), container: 5432, transport: 'tcp', protocol: 'tcp', hostAddress: '127.0.0.1' }],
    studio: [{ label: 'Studio', host: portFromEnv(env, 'SHARED_STUDIO_PORT', 3000), container: 3000, transport: 'tcp', protocol: 'http', hostAddress: '127.0.0.1' }],
    analytics: [{ label: 'Logflare API', host: portFromEnv(env, 'SHARED_ANALYTICS_PORT', 4000), container: 4000, transport: 'tcp', protocol: 'http', hostAddress: '127.0.0.1' }],
    'nginx-gateway': [
      { label: 'HTTP Gateway', host: portFromEnv(env, 'SHARED_GATEWAY_PORT', 8000), container: 8000, transport: 'tcp', protocol: 'http', hostAddress: loopback },
      ...getTenantGatewayPorts(sharedDir),
    ],
    pooler: [
      { label: 'PgBouncer / Supavisor', host: portFromEnv(env, 'SHARED_POOLER_PORT', 6543), container: 6543, transport: 'tcp', protocol: 'tcp', hostAddress: '127.0.0.1' },
      ...INTERNAL_PORTS.pooler,
    ],
    meta: INTERNAL_PORTS.meta,
    vector: INTERNAL_PORTS.vector,
    imgproxy: INTERNAL_PORTS.imgproxy,
  };
}

function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === 'localhost';
}

function toSharedPort(definition: ExpectedSharedPort, binding: RuntimePortBinding, actual: boolean): SharedServicePort {
  const host = binding.host ?? definition.host;
  const hostAddress = binding.hostAddress ?? definition.hostAddress;
  return {
    label: definition.label,
    container: binding.container,
    ...(host === undefined ? {} : { host }),
    ...(hostAddress === undefined ? {} : { hostAddress }),
    protocol: definition.protocol,
    public: actual && host !== undefined && !isLoopback(hostAddress),
    actual,
  };
}

/** Combine expected Compose ports with the live Docker bindings for one service. */
export function resolveSharedServicePorts(
  serviceName: string,
  runtimeBindings: RuntimePortBinding[] | undefined,
  expectedPorts: ExpectedPortsByService
): SharedServicePort[] {
  const expected = expectedPorts[serviceName] || [];
  const runtime = runtimeBindings || [];
  const used = new Set<number>();
  const ports: SharedServicePort[] = [];

  for (const definition of expected) {
    const matching = runtime
      .map((binding, index) => ({ binding, index }))
      .filter(({ binding, index }) =>
        !used.has(index) &&
        binding.container === definition.container &&
        binding.transport === definition.transport &&
        (definition.host === undefined || binding.host === definition.host)
      );
    if (matching.length > 0) {
      matching.forEach(({ binding, index }) => {
        used.add(index);
        ports.push(toSharedPort(definition, binding, true));
      });
    } else {
      ports.push(toSharedPort(definition, { container: definition.container, transport: definition.transport }, false));
    }
  }

  runtime.forEach((binding, index) => {
    if (used.has(index)) return;
    const matchingDefinition = expected.find(
      (definition) => definition.container === binding.container && definition.transport === binding.transport
    );
    const definition: ExpectedSharedPort = matchingDefinition || {
      label: serviceName === 'nginx-gateway' ? 'HTTP Gateway' : `${binding.container}/${binding.transport}`,
      container: binding.container,
      transport: binding.transport,
      protocol: serviceName === 'nginx-gateway' ? 'http' : 'tcp',
    };
    ports.push(toSharedPort(definition, binding, true));
  });

  return ports.sort(
    (left, right) =>
      left.container - right.container ||
      (left.host ?? -1) - (right.host ?? -1) ||
      left.label.localeCompare(right.label)
  );
}
