import fs from 'fs';
import yaml from 'js-yaml';

export type ImageUpdatePolicy = 'reviewed' | 'manual';

export interface ImageDefinition {
  repository: string;
  tag: string;
  digest?: string | null;
  updatePolicy: ImageUpdatePolicy;
}

export interface ImageMatrix {
  images: Record<string, ImageDefinition>;
}

export interface ParsedImageReference {
  repository: string;
  tag: string;
  digest: string | null;
}

export class RegistryRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'RegistryRequestError';
    this.status = status;
  }
}

/** Parse docker image references without treating a registry port as a tag separator. */
export function parseImageReference(reference: string): ParsedImageReference {
  const value = reference.trim();
  const [withoutDigest, digestPart] = value.split('@', 2);
  const lastSlash = withoutDigest.lastIndexOf('/');
  const lastColon = withoutDigest.lastIndexOf(':');
  const hasTag = lastColon > lastSlash;

  return {
    repository: (hasTag ? withoutDigest.slice(0, lastColon) : withoutDigest).toLowerCase(),
    tag: hasTag ? withoutDigest.slice(lastColon + 1) : 'latest',
    digest: digestPart?.startsWith('sha256:') ? digestPart : null,
  };
}

export function normalizeRepository(repository: string): string {
  const normalized = repository.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
  return normalized.startsWith('docker.io/') ? normalized.slice('docker.io/'.length) : normalized;
}

export function isStableImageTag(tag: string): boolean {
  const normalized = tag.toLowerCase();
  return (
    normalized !== 'latest' &&
    !/(?:^|[-_.])(rc|alpha|beta|nightly|canary|dev|edge|next)(?:[-_.]|$)/.test(normalized) &&
    !/(?:^|[-_.])(amd64|arm64|armv7|linux|windows)(?:[-_.]|$)/.test(normalized)
  );
}

/** Compare numeric release components in tags such as v0.95.2 or 2026.01.31. */
export function compareImageTags(left: string, right: string): number {
  const numbers = (value: string) => {
    const match = value.match(/\d+(?:\.\d+){1,3}/);
    return match ? match[0].split('.').map(Number) : [];
  };
  const a = numbers(left);
  const b = numbers(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return left.localeCompare(right);
}

/** Resolve a read-only update target without changing the approved image matrix. */
export function resolveImageTargetTag(
  currentTag: string,
  approvedTag: string,
  _latestRegistryTag: string | null
): string {
  // Registry tag discovery is informational only. Updates must be explicitly
  // approved in the image matrix; a newly published registry tag is never a
  // deployment target by itself.
  if (approvedTag !== currentTag && (currentTag === 'latest' || compareImageTags(approvedTag, currentTag) > 0)) {
    return approvedTag;
  }
  return currentTag;
}

/** Detect both version-tag updates and mutable-tag digest updates. */
export function getImageUpdateDecision(
  currentTag: string,
  targetTag: string,
  localDigest: string | null,
  targetDigest: string | null
): { tagOutdated: boolean; digestOutdated: boolean; updateAvailable: boolean } {
  const tagOutdated =
    targetTag !== currentTag &&
    (currentTag === 'latest' || compareImageTags(targetTag, currentTag) > 0);
  const digestOutdated =
    localDigest !== null && targetDigest !== null && localDigest !== targetDigest;
  return { tagOutdated, digestOutdated, updateAvailable: tagOutdated || digestOutdated };
}

export function loadImageMatrix(filePath: string): ImageMatrix {
  const raw = yaml.load(fs.readFileSync(filePath, 'utf8')) as { images?: unknown };
  if (!raw || typeof raw !== 'object' || !raw.images || typeof raw.images !== 'object') {
    throw new Error(`Invalid image matrix: ${filePath}`);
  }

  const images: Record<string, ImageDefinition> = {};
  for (const [name, value] of Object.entries(raw.images as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') throw new Error(`Invalid image definition: ${name}`);
    const definition = value as Partial<ImageDefinition>;
    if (!definition.repository || !definition.tag || !definition.updatePolicy) {
      throw new Error(`Incomplete image definition: ${name}`);
    }
    images[name] = {
      repository: normalizeRepository(definition.repository),
      tag: definition.tag,
      digest: definition.digest ?? null,
      updatePolicy: definition.updatePolicy,
    };
  }
  return { images };
}

export function saveImageMatrix(filePath: string, matrix: ImageMatrix): void {
  const content = yaml.dump({ images: matrix.images }, { indent: 2, lineWidth: -1 });
  const header = `# Approved container images for shared, tenant, and temporary containers.\n\n`;
  fs.writeFileSync(filePath, header + content, 'utf8');
}

interface RegistryClientOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  username?: string;
  password?: string;
}

/** Minimal Docker Registry V2 client. It supports Docker Hub and OCI-compatible registries. */
export class DockerRegistryClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly username?: string;
  private readonly password?: string;

  constructor(options: RegistryClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.username = options.username ?? process.env.REGISTRY_USERNAME;
    this.password = options.password ?? process.env.REGISTRY_PASSWORD;
  }

  async getManifestDigest(repositoryInput: string, tag: string): Promise<string> {
    const repository = normalizeRepository(repositoryInput);
    const { host, name } = this.getRegistryTarget(repository);
    const url = `https://${host}/v2/${name}/manifests/${encodeURIComponent(tag)}`;
    const headers: Record<string, string> = {
      Accept:
        'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json',
    };
    const response = await this.requestWithAuth(url, headers, host, name);
    const digest = response.headers.get('docker-content-digest');
    if (!digest) throw new RegistryRequestError(`Registry response has no digest for ${repository}:${tag}`, response.status);
    return digest;
  }

  async listTags(repositoryInput: string): Promise<string[]> {
    const repository = normalizeRepository(repositoryInput);
    const { host, name } = this.getRegistryTarget(repository);
    const url = `https://${host}/v2/${name}/tags/list`;
    const response = await this.requestWithAuth(url, {}, host, name);
    const data = (await response.json()) as { tags?: unknown };
    return Array.isArray(data.tags) ? data.tags.filter((tag): tag is string => typeof tag === 'string') : [];
  }

  async findLatestStableTag(repository: string, currentTag: string): Promise<string | null> {
    const tags = (await this.listTags(repository)).filter(isStableImageTag);
    if (currentTag === 'latest') {
      return tags.sort((left, right) => compareImageTags(right, left))[0] ?? null;
    }
    const candidates = tags.filter((tag) => compareImageTags(tag, currentTag) > 0);
    return candidates.sort((left, right) => compareImageTags(right, left))[0] ?? null;
  }

  private async requestWithAuth(
    url: string,
    headers: Record<string, string>,
    host: string,
    repository: string
  ): Promise<Response> {
    const signal = AbortSignal.timeout(this.timeoutMs);
    let response = await this.fetchImpl(url, { headers, signal });
    if (response.status === 401) {
      const challenge = response.headers.get('www-authenticate');
      const token = await this.getToken(challenge, host, repository);
      response = await this.fetchImpl(url, {
        headers: { ...headers, Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    }
    if (!response.ok) {
      throw new RegistryRequestError(`Registry request failed (${response.status}) for ${url}`, response.status);
    }
    return response;
  }

  private async getToken(challenge: string | null, host: string, repository: string): Promise<string> {
    const values = new Map<string, string>();
    const challengeMatch = challenge?.match(/^Bearer\s+(.+)$/i);
    challengeMatch?.[1].replace(/(realm|service|scope)="([^"]+)"/g, (_match, key: string, value: string) => {
      values.set(key, value);
      return '';
    });
    const realm = values.get('realm') ?? `https://${host}/token`;
    const tokenUrl = new URL(realm);
    tokenUrl.searchParams.set('service', values.get('service') ?? host);
    tokenUrl.searchParams.set('scope', values.get('scope') ?? `repository:${repository}:pull`);
    const authorization =
      this.username && this.password
        ? `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`
        : undefined;
    const response = await this.fetchImpl(tokenUrl, {
      headers: authorization ? { Authorization: authorization } : {},
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new RegistryRequestError(`Registry token request failed (${response.status})`, response.status);
    const body = (await response.json()) as { token?: string; access_token?: string };
    const token = body.token ?? body.access_token;
    if (!token) throw new RegistryRequestError('Registry token response has no token', response.status);
    return token;
  }

  private getRegistryTarget(repository: string): { host: string; name: string } {
    const parts = repository.split('/');
    const hasRegistryHost = parts.length > 1 && (parts[0].includes('.') || parts[0].includes(':') || parts[0] === 'localhost');
    return hasRegistryHost
      ? { host: parts[0], name: parts.slice(1).join('/') }
      : { host: 'registry-1.docker.io', name: parts.length === 1 ? `library/${parts[0]}` : repository };
  }
}
