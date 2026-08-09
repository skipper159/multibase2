/**
 * UpdateService
 *
 * Manages update checks and execution for:
 * 1. Multibase Dashboard itself (git pull → npm ci → build → pm2 restart)
 * 2. Supabase shared Docker images (stop → docker compose pull → up -d)
 *
 * Emits Socket.IO-compatible events via EventEmitter:
 *   update:start     { type, steps/services }
 *   update:step      { step, index, total }
 *   update:stepDone  { step, index }
 *   update:log       { line }
 *   update:complete  { type }
 *   update:error     { type, error }
 */

import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import DockerManager from './DockerManager';
import BackupService from './BackupService';
import {
  DockerRegistryClient,
  ImageDefinition,
  ImageMatrix,
  loadImageMatrix,
  normalizeRepository,
  parseImageReference,
  compareImageTags,
  resolveImageTargetTag,
  getImageUpdateDecision,
} from './ImageRegistryService';
import { logger } from '../utils/logger';
import { SHARED_SERVICES } from '../types';
import { createAuditLogEntry } from '../middleware/auditLog';
import { AUDIT_ACTIONS } from '../constants/auditActions';

const execFileAsync = promisify(execFile);

export interface GitHubReleaseItem {
  version: string;
  name: string;
  publishedAt: string | null;
  changelog: string | null;
  isLatest: boolean;
}

export interface VersionInfo {
  current: string;
  latest: string | null;
  hasUpdate: boolean;
  changelog: string | null;
  availableReleases?: GitHubReleaseItem[];
  checkedAt: Date | null;
}

export interface DockerServiceInfo {
  service: string;
  containerName: string;
  category: 'shared' | 'tenant' | 'temporary' | 'infrastructure' | 'other';
  image: string;
  repository: string;
  tag: string;
  configuredTag: string;
  localImageId: string | null;
  localDigest: string | null;
  registryDigest: string | null;
  latestRegistryTag: string | null;
  targetTag: string | null;
  targetDigest: string | null;
  latestApprovedTag: string | null;
  latestApprovedDigest: string | null;
  updateAvailable: boolean;
  digestMatches: boolean;
  managed: boolean;
  updatePolicy: 'reviewed' | 'manual' | null;
  updateStatus:
    | 'current'
    | 'update_available'
    | 'tag_outdated'
    | 'digest_mismatch'
    | 'registry_unreachable'
    | 'not_managed'
    | 'manual_approval_required'
    | 'missing';
  risk: 'low' | 'medium' | 'high';
  checkError: string | null;
  checkedAt: Date | null;
  status: 'running' | 'stopped' | 'missing';
}

export interface UpdateStatus {
  multibase: VersionInfo;
  docker: DockerServiceInfo[];
  tenantDocker: DockerServiceInfo[];
  isUpdateInProgress: boolean;
  lastCheckedAt: Date | null;
  /** 'local' = single-server. 'split' = multi-server (rsync to VPS1 or CI). */
  frontendServe: 'local' | 'split';
  /** true if VPS1 rsync vars are configured (split mode with auto-deploy) */
  frontendRsync: boolean;
  registry: {
    checkedAt: Date | null;
    cacheTtlMs: number;
    cacheBypassed: boolean;
  };
  securityGate: {
    status: 'blocked' | 'ready';
    reason: string | null;
  };
}

export interface TenantImageUpdateStatus {
  instanceName: string;
  services: DockerServiceInfo[];
  previousTags: Record<string, PreviousImageTag>;
  checkedAt: Date;
  cacheTtlMs: number;
  cacheBypassed: boolean;
  securityGate: UpdateStatus['securityGate'];
}

export interface PreviousImageTag {
  previousTag: string;
  previousImage: string;
  previousDigest: string | null;
  previousImageId: string | null;
  updatedAt: string;
}

export interface ImageUpdateResult {
  service: string;
  status: 'updated' | 'rolled_back' | 'rollback_failed' | 'skipped';
  previousTag?: string;
  targetTag?: string;
  error?: string;
}

export interface DockerUpdateOptions {
  confirmSafetyGate?: boolean;
  createBackup?: boolean;
  requestedBy?: string;
  allowPostgres?: boolean;
  backupInstanceId?: string;
  force?: boolean;
}

export class UpdateService extends EventEmitter {
  private readonly dockerManager: DockerManager;
  private readonly rootDir: string;
  private readonly projectsPath: string;
  private readonly frontendServe: 'local' | 'split';
  private _isInProgress = false;
  private cachedStatus: UpdateStatus | null = null;
  private cacheExpiry: Date | null = null;
  private readonly registry = new DockerRegistryClient();
  private readonly registryCache = new Map<
    string,
    { digest: string | null; error: string | null; checkedAt: Date }
  >();
  private readonly registryTagCache = new Map<
    string,
    { tag: string | null; checkedAt: Date }
  >();
  private imageMatrix: ImageMatrix | null = null;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  get isInProgress(): boolean {
    return this._isInProgress;
  }

  constructor(dockerManager: DockerManager, rootDir: string, projectsPath?: string) {
    super();
    this.dockerManager = dockerManager;
    this.rootDir = rootDir;
    this.projectsPath = path.resolve(projectsPath ?? path.join(rootDir, 'projects'));
    const mode = process.env.FRONTEND_SERVE ?? 'local';
    this.frontendServe = mode === 'split' ? 'split' : 'local';
  }

  // ──────────────────────────────────────────────
  // Status / Check
  // ──────────────────────────────────────────────

  private isCacheValid(): boolean {
    return (
      this.cachedStatus !== null &&
      this.cacheExpiry !== null &&
      Date.now() < this.cacheExpiry.getTime()
    );
  }

  private getCurrentVersion(): string {
    try {
      const pkgPath = path.join(this.rootDir, 'dashboard', 'backend', 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      return pkg.version || '3.0.0';
    } catch {
      return '3.0.0';
    }
  }

  private async fetchLatestGitHubRelease(): Promise<{
    version: string | null;
    changelog: string | null;
  }> {
    // 1. Try GitHub Releases API first
    try {
      const response = await fetch(
        'https://api.github.com/repos/skipper159/multibase2/releases/latest',
        {
          headers: {
            'User-Agent': 'multibase-dashboard/3.0.0',
            Accept: 'application/vnd.github+json',
          },
          signal: AbortSignal.timeout(8000),
        }
      );
      if (response.ok) {
        const data = (await response.json()) as { tag_name?: string; body?: string };
        const version = data.tag_name?.replace(/^v/, '') || null;
        if (version) {
          return { version, changelog: data.body || null };
        }
      }
    } catch {
      // fall through to package.json fallback
    }

    // 2. Fallback: read package.json from main branch via raw.githubusercontent.com
    try {
      const response = await fetch(
        'https://raw.githubusercontent.com/skipper159/multibase2/main/dashboard/backend/package.json',
        {
          headers: { 'User-Agent': 'multibase-dashboard/3.0.0' },
          signal: AbortSignal.timeout(8000),
        }
      );
      if (response.ok) {
        const pkg = (await response.json()) as { version?: string };
        const version = pkg.version || null;
        if (version) {
          return { version, changelog: null };
        }
      }
    } catch {
      // both methods failed
    }

    return { version: null, changelog: null };
  }

  async fetchRecentGitHubReleases(limit = 10): Promise<GitHubReleaseItem[]> {
    try {
      const response = await fetch(
        `https://api.github.com/repos/skipper159/multibase2/releases?per_page=${limit}`,
        {
          headers: {
            'User-Agent': 'multibase-dashboard/3.0.0',
            Accept: 'application/vnd.github+json',
          },
          signal: AbortSignal.timeout(8000),
        }
      );
      if (response.ok) {
        const items = (await response.json()) as Array<{
          tag_name?: string;
          name?: string;
          published_at?: string;
          body?: string;
        }>;
        if (Array.isArray(items)) {
          return items
            .slice(0, limit)
            .map((item, index) => ({
              version: item.tag_name?.replace(/^v/, '') || item.tag_name || '',
              name: item.name || item.tag_name || '',
              publishedAt: item.published_at || null,
              changelog: item.body || null,
              isLatest: index === 0,
            }))
            .filter((r) => !!r.version);
        }
      }
    } catch {
      // fall through
    }
    return [];
  }

  private compareVersions(a: string, b: string): number {
    const parse = (v: string) => v.split('.').map(n => parseInt(n, 10) || 0);
    const [am, an, ap] = parse(a);
    const [bm, bn, bp] = parse(b);
    if (am !== bm) return am - bm;
    if (an !== bn) return an - bn;
    return ap - bp;
  }

  private loadMatrix(): ImageMatrix {
    if (this.imageMatrix) return this.imageMatrix;
    const matrixPath = path.join(this.rootDir, 'shared', 'image-versions.yml');
    this.imageMatrix = loadImageMatrix(matrixPath);
    return this.imageMatrix;
  }

  private findDefinition(
    service: string,
    repository: string,
    category?: DockerServiceInfo['category']
  ): ImageDefinition | null {
    const matrix = this.loadMatrix();
    const shortName = service.replace(/^multibase-/, '').replace(/^supabase-/, '');
    const preferredNames = [
      ...(category === 'tenant' ? [`tenant-${shortName}`, `shared-${shortName}`] : [`shared-${shortName}`, `tenant-${shortName}`]),
      service,
      shortName,
    ];
    for (const name of preferredNames) {
      const definition = matrix.images[name];
      if (definition && normalizeRepository(definition.repository) === normalizeRepository(repository)) {
        return definition;
      }
    }
    return (
      Object.values(matrix.images).find(
        (definition) => normalizeRepository(definition.repository) === normalizeRepository(repository)
      ) || null
    );
  }

  private async getRegistryObservation(
    repository: string,
    tag: string,
    forceRefresh: boolean
  ): Promise<{ digest: string | null; error: string | null; checkedAt: Date }> {
    const key = `${normalizeRepository(repository)}:${tag}`;
    const cached = this.registryCache.get(key);
    if (!forceRefresh && cached && Date.now() - cached.checkedAt.getTime() < this.CACHE_TTL_MS) {
      return cached;
    }

    try {
      const digest = await this.registry.getManifestDigest(repository, tag);
      const observation = { digest, error: null, checkedAt: new Date() };
      this.registryCache.set(key, observation);
      return observation;
    } catch (error) {
      const observation = {
        digest: null,
        error: error instanceof Error ? error.message : String(error),
        checkedAt: new Date(),
      };
      this.registryCache.set(key, observation);
      return observation;
    }
  }

  private async getLatestRegistryTag(
    repository: string,
    currentTag: string,
    forceRefresh: boolean,
    includeLatestStableTag = false
  ): Promise<string | null> {
    // The mutable latest tag is checked by digest. For versioned tags we also
    // inspect the registry tag list so newer releases such as v2.187.0 are visible.
    if (currentTag === 'latest' && !includeLatestStableTag) return null;
    const key = `tags:${normalizeRepository(repository)}:${currentTag}`;
    const cached = this.registryTagCache.get(key);
    if (!forceRefresh && cached && Date.now() - cached.checkedAt.getTime() < this.CACHE_TTL_MS) {
      return cached.tag;
    }

    try {
      const tag = await this.registry.findLatestStableTag(repository, currentTag);
      this.registryTagCache.set(key, { tag, checkedAt: new Date() });
      return tag;
    } catch (error) {
      logger.warn(
        `Could not inspect registry tags for ${repository}:${currentTag}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      this.registryTagCache.set(key, { tag: null, checkedAt: new Date() });
      return null;
    }
  }

  private classifyContainer(containerName: string, labels?: Record<string, string>): DockerServiceInfo['category'] {
    if ((SHARED_SERVICES as readonly string[]).includes(containerName)) return 'shared';
    if (/^multibase-(studio|meta)-/.test(containerName)) return 'temporary';
    if (labels?.['com.docker.compose.project'] && labels['com.docker.compose.project'] !== 'multibase-shared') {
      return 'tenant';
    }
    if (/^(multibase-(redis|portainer)|redis|portainer)/.test(containerName)) return 'infrastructure';
    return 'other';
  }

  private emptyServiceInfo(serviceName: string): DockerServiceInfo {
    return {
      service: serviceName,
      containerName: serviceName,
      category: 'shared',
      image: 'unknown',
      repository: 'unknown',
      tag: 'unknown',
      configuredTag: 'unknown',
      localImageId: null,
      localDigest: null,
      registryDigest: null,
      latestApprovedTag: null,
      latestRegistryTag: null,
      targetTag: null,
      targetDigest: null,
      latestApprovedDigest: null,
      updateAvailable: false,
      digestMatches: false,
      managed: true,
      updatePolicy: null,
      updateStatus: 'missing',
      risk: 'high',
      checkError: null,
      checkedAt: null,
      status: 'missing',
    };
  }

  private async inspectDockerContainer(
    container: import('dockerode').ContainerInfo,
    forceRegistryRefresh: boolean
  ): Promise<DockerServiceInfo> {
    const containerName = (container.Names[0] || container.Id).replace(/^\//, '');
    const service = container.Labels?.['com.docker.compose.service'] || containerName;
    let image = container.Image || 'unknown';
    let parsed = parseImageReference(image);
    let localDigest: string | null = null;
    let localImageId = container.ImageID || null;
    try {
      const inspect = await this.dockerManager.inspectContainer(container.Id);
      localImageId = inspect.Image || localImageId;
      image = inspect.Config.Image || image;
    } catch (error) {
      logger.warn(`Could not inspect Docker container ${containerName}: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      const imageInspect = localImageId ? await this.dockerManager.inspectImage(localImageId) : null;
      const repoDigests = imageInspect?.RepoDigests ?? [];
      localDigest = repoDigests.find((value) => {
        const [repository] = value.split('@', 1);
        return normalizeRepository(repository) === normalizeRepository(parsed.repository);
      })?.split('@')[1] ?? null;

      // Update and rollback overrides can leave Config.Image as repo@digest.
      // Recover a stable local tag so the status check does not report a
      // permanent false update for an otherwise correct image.
      if (parsed.digest && imageInspect?.RepoTags) {
        const taggedImages = imageInspect.RepoTags
          .map((reference) => parseImageReference(reference))
          .filter((reference) =>
            normalizeRepository(reference.repository) === normalizeRepository(parsed.repository) &&
            reference.tag !== 'latest'
          )
          .sort((left, right) => compareImageTags(right.tag, left.tag));
        const taggedImage = taggedImages[0];
        if (taggedImage) {
          image = `${taggedImage.repository}:${taggedImage.tag}`;
          parsed = taggedImage;
        }
      }
    } catch (error) {
      logger.warn(`Could not inspect Docker image ${localImageId}: ${error instanceof Error ? error.message : String(error)}`);
    }

    const checkedAt = new Date();
    const status = container.State === 'running' ? ('running' as const) : ('stopped' as const);
    const category = this.classifyContainer(containerName, container.Labels);
    const definition = this.findDefinition(service, parsed.repository, category);
    if (!definition) {
      return {
        service,
        containerName,
        category,
        image,
        repository: parsed.repository,
        tag: parsed.tag,
        configuredTag: parsed.tag,
        localImageId,
        localDigest,
        registryDigest: null,
        latestApprovedTag: null,
        latestRegistryTag: null,
        targetTag: null,
        targetDigest: null,
        latestApprovedDigest: null,
        updateAvailable: false,
        digestMatches: false,
        managed: false,
        updatePolicy: null,
        updateStatus: 'not_managed',
        risk: 'high',
        checkError: null,
        checkedAt,
        status,
      };
    }

    const observation = await this.getRegistryObservation(parsed.repository, parsed.tag, forceRegistryRefresh);
    const latestRegistryTag = await this.getLatestRegistryTag(
      parsed.repository,
      parsed.tag,
      forceRegistryRefresh,
      category === 'tenant'
    );

    // The approved image matrix is the only deployment target. Registry tag
    // discovery remains a read-only observation and cannot authorize an update.
    const targetTag = resolveImageTargetTag(parsed.tag, definition.tag, latestRegistryTag);

    const targetObservation =
      parsed.tag === targetTag
        ? observation
        : await this.getRegistryObservation(parsed.repository, targetTag, forceRegistryRefresh);
    const digestMatches = localDigest !== null && observation.digest !== null && localDigest === observation.digest;
    const targetDigestMatches =
      localDigest !== null && targetObservation.digest !== null && localDigest === targetObservation.digest;
    const { tagOutdated, digestOutdated, updateAvailable } = getImageUpdateDecision(
      parsed.tag, targetTag, localDigest, targetObservation.digest
    );
    const registryErrorForCurrent = observation.error;
    const registryErrorForTarget = targetObservation.error;

    // An update is available if tag comparison shows targetTag is newer than parsed.tag.
    // Registry network/rate-limit errors for current digest check do not prevent updating to a known newer tag.
    const registryError = registryErrorForTarget || (tagOutdated ? null : registryErrorForCurrent);
    const updateStatus: DockerServiceInfo['updateStatus'] =
      definition.updatePolicy === 'manual'
        ? 'manual_approval_required'
        : registryErrorForTarget
          ? 'registry_unreachable'
          : tagOutdated
          ? 'tag_outdated'
          : registryErrorForCurrent
            ? 'registry_unreachable'
            : digestOutdated
              ? 'digest_mismatch'
              : 'current';

    return {
      service,
      containerName,
      category,
      image,
      repository: parsed.repository,
      tag: parsed.tag,
      configuredTag: parsed.tag,
      localImageId,
      localDigest,
      registryDigest: observation.digest,
      latestRegistryTag,
      targetTag,
      targetDigest: targetObservation.digest,
      latestApprovedTag: definition.tag,
      latestApprovedDigest:
        targetObservation.digest ?? (targetTag === definition.tag ? definition.digest ?? null : null),
      updateAvailable,
      digestMatches,
      managed: true,
      updatePolicy: definition.updatePolicy,
      updateStatus,
      risk: definition.updatePolicy === 'manual' || Boolean(registryError) || !targetDigestMatches ? 'high' : 'low',
      checkError: registryError,
      checkedAt: registryError ? observation.checkedAt : checkedAt,
      status,
    };
  }

  private async getDockerServiceInfo(forceRegistryRefresh = false): Promise<DockerServiceInfo[]> {
    const containers = await this.dockerManager.listAllContainers();
    const knownNames = new Set<string>();
    const services = await Promise.all(
      containers.map(async (container) => {
        const name = (container.Names[0] || container.Id).replace(/^\//, '');
        knownNames.add(name);
        return this.inspectDockerContainer(container, forceRegistryRefresh);
      })
    );
    for (const serviceName of SHARED_SERVICES as readonly string[]) {
      if (!knownNames.has(serviceName)) services.push(this.emptyServiceInfo(serviceName));
    }
    return services.sort((left, right) => left.service.localeCompare(right.service));
  }

  private getProjectPath(instanceName: string): string {
    const projectPath = path.resolve(this.projectsPath, instanceName);
    const projectsRoot = `${this.projectsPath}${path.sep}`;
    if (!projectPath.startsWith(projectsRoot)) {
      throw new Error('Invalid instance name');
    }
    return projectPath;
  }

  private async getTenantDockerServiceInfo(
    instanceName: string,
    forceRegistryRefresh = false
  ): Promise<DockerServiceInfo[]> {
    const containers = await this.dockerManager.listProjectContainers(instanceName);
    const services = await Promise.all(
      containers.map((container) => this.inspectDockerContainer(container, forceRegistryRefresh))
    );
    return services
      .filter((service) => service.category === 'tenant')
      .sort((left, right) => left.service.localeCompare(right.service));
  }

  async getTenantImageUpdateStatus(
    instanceName: string,
    forceRefresh = false
  ): Promise<TenantImageUpdateStatus> {
    const projectPath = this.getProjectPath(instanceName);
    if (!fs.existsSync(projectPath)) throw new Error(`Instance ${instanceName} does not exist`);

    const securityGateReady = process.env.IMAGE_UPDATE_SECURITY_GATE === 'approved';
    return {
      instanceName,
      services: await this.getTenantDockerServiceInfo(instanceName, forceRefresh),
      previousTags: this.getPreviousImageTags(instanceName),
      checkedAt: new Date(),
      cacheTtlMs: this.CACHE_TTL_MS,
      cacheBypassed: forceRefresh,
      securityGate: {
        status: securityGateReady ? 'ready' : 'blocked',
        reason: securityGateReady
          ? null
          : 'Production image updates remain blocked until the documented incident and security approval is complete.',
      },
    };
  }

  async getStatus(forceRefresh = false): Promise<UpdateStatus> {
    if (!forceRefresh && this.isCacheValid()) {
      return { ...this.cachedStatus!, isUpdateInProgress: this._isInProgress };
    }

    const current = this.getCurrentVersion();
    const { version: latest, changelog } = await this.fetchLatestGitHubRelease();
    const availableReleases = await this.fetchRecentGitHubReleases(10);

    const multibase: VersionInfo = {
      current,
      latest,
      hasUpdate: latest !== null && this.compareVersions(latest, current) > 0,
      changelog,
      availableReleases,
      checkedAt: new Date(),
    };

    const allDocker = await this.getDockerServiceInfo(forceRefresh);
    const docker = allDocker.filter((service) => service.category === 'shared');
    const tenantDocker = allDocker.filter((service) => service.category !== 'shared');

    const securityGateReady = process.env.IMAGE_UPDATE_SECURITY_GATE === 'approved';
    const latestRegistryCheck = allDocker
      .map((service) => service.checkedAt)
      .filter((value): value is Date => value instanceof Date)
      .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;

    const status: UpdateStatus = {
      multibase,
      docker,
      tenantDocker,
      isUpdateInProgress: this._isInProgress,
      lastCheckedAt: new Date(),
      frontendServe: this.frontendServe,
      frontendRsync: !!(
        process.env.VPS1_HOST &&
        process.env.VPS1_USER &&
        process.env.VPS1_KEY &&
        process.env.VPS1_FRONTEND_PATH
      ),
      registry: {
        checkedAt: latestRegistryCheck,
        cacheTtlMs: this.CACHE_TTL_MS,
        cacheBypassed: forceRefresh,
      },
      securityGate: {
        status: securityGateReady ? 'ready' : 'blocked',
        reason: securityGateReady
          ? null
          : 'Production image updates remain blocked until the documented incident and security approval is complete.',
      },
    };

    this.cachedStatus = status;
    this.cacheExpiry = new Date(Date.now() + this.CACHE_TTL_MS);
    return status;
  }

  // ──────────────────────────────────────────────
  // Multibase Update
  // ──────────────────────────────────────────────

  async performMultibaseUpdate(targetVersion?: string): Promise<void> {
    if (this._isInProgress) throw new Error('An update is already in progress');
    this._isInProgress = true;

    const vps1Host = process.env.VPS1_HOST;
    const vps1User = process.env.VPS1_USER;
    const vps1Key = process.env.VPS1_KEY;
    const vps1Path = process.env.VPS1_FRONTEND_PATH;
    const canDeploySplit = !!(vps1Host && vps1User && vps1Key && vps1Path);

    // split + VPS1 vars set  → build frontend here and rsync to VPS1
    // split + VPS1 vars missing → skip frontend entirely (CI handles it)
    // local                   → build frontend here (served from same server)
    const includeFrontend = this.frontendServe === 'local' || canDeploySplit;
    const gitLabel = targetVersion ? `install v${targetVersion}` : 'git pull';
    const steps =
      this.frontendServe === 'local'
        ? [gitLabel, 'backend install', 'frontend build', 'restart']
        : canDeploySplit
          ? [gitLabel, 'backend install', 'frontend build', 'frontend deploy', 'restart']
          : [gitLabel, 'backend install', 'restart'];
    this.emit('update:start', { type: 'multibase', steps, targetVersion: targetVersion ?? null });

    const gitBranch = process.env.GIT_UPDATE_BRANCH ?? 'main';

    try {
      // Step 0: git fetch + reset to either a specific tag or the branch tip
      this.emitStep(gitLabel, 0, steps.length);
      if (targetVersion) {
        // Normalise: accept both "3.1.9" and "v3.1.9"
        const tag = targetVersion.startsWith('v') ? targetVersion : `v${targetVersion}`;
        this.emit('update:log', { line: `Switching to release ${tag}...` });
        await this.runCommand('git', ['fetch', '--tags', 'origin'], this.rootDir);
        await this.runCommand('git', ['reset', '--hard', tag], this.rootDir);
      } else {
        await this.runCommand('git', ['fetch', 'origin', gitBranch], this.rootDir);
        await this.runCommand('git', ['reset', '--hard', `origin/${gitBranch}`], this.rootDir);
      }
      this.emitStepDone(gitLabel, 0);

      // Step 1: workspace npm install
      // --include=dev: tsc braucht @types/* zum Bauen (wird nach dem Build entfernt)
      // --ignore-scripts: verhindert husky-Fehler aus dem Root-workspace prepare-Script
      this.emitStep('backend install', 1, steps.length);
      this.emit('update:log', { line: 'Installing workspace dependencies...' });
      await this.runCommand(
        'npm',
        ['install', '--prefer-offline', '--include=dev', '--ignore-scripts'],
        this.rootDir
      );

      const backendDir = path.join(this.rootDir, 'dashboard', 'backend');
      // Prisma-Client explizit generieren (durch --ignore-scripts übersprungen)
      await this.runCommand('npx', ['prisma', 'generate'], backendDir);
      // Backend kompilieren (TypeScript -> JavaScript)
      this.emit('update:log', { line: 'Building backend...' });
      await this.runCommand('npm', ['run', 'build'], backendDir);
      this.emitStepDone('backend install', 1);

      const frontendDir = path.join(this.rootDir, 'dashboard', 'frontend');

      if (includeFrontend) {
        // frontend build step (both local and split with VPS1 vars)
        const buildStepIdx = steps.indexOf('frontend build');
        this.emitStep('frontend build', buildStepIdx, steps.length);
        this.emit('update:log', { line: 'Building frontend...' });
        const buildEnv: Record<string, string> = {};
        if (process.env.BACKEND_URL) buildEnv['VITE_API_URL'] = process.env.BACKEND_URL;
        await this.runCommand('npm', ['run', 'build'], frontendDir, false, buildEnv);
        this.emitStepDone('frontend build', buildStepIdx);

        if (canDeploySplit) {
          // split mode: rsync dist/ to VPS1
          const deployStepIdx = steps.indexOf('frontend deploy');
          this.emitStep('frontend deploy', deployStepIdx, steps.length);
          this.emit('update:log', {
            line: `Deploying frontend to ${vps1User}@${vps1Host}:${vps1Path} ...`,
          });
          const distDir = path.join(frontendDir, 'dist') + '/';
          await this.runCommand(
            'rsync',
            [
              '-rltDz',
              '--delete',
              '-e',
              `ssh -i ${vps1Key} -o StrictHostKeyChecking=no -o BatchMode=yes`,
              distDir,
              `${vps1User}@${vps1Host}:${vps1Path}`,
            ],
            this.rootDir
          );
          this.emit('update:log', { line: '✓ Frontend deployed to VPS1' });
          this.emitStepDone('frontend deploy', deployStepIdx);
        }
      } else {
        this.emit('update:log', {
          line: 'Skipping frontend (FRONTEND_SERVE=split, no VPS1 vars set — deploy via CI).',
        });
      }

      // Last step: pm2 restart (detached so the process can restart itself)
      const restartIdx = steps.length - 1;
      this.emitStep('restart', restartIdx, steps.length);
      this.emit('update:log', { line: 'Restarting via PM2 — connection will briefly drop...' });
      await this.runCommand('pm2', ['restart', 'all'], this.rootDir, true);
      this.emitStepDone('restart', restartIdx);

      this.emit('update:complete', { type: 'multibase' });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit('update:error', { type: 'multibase', error: message });
      throw error;
    } finally {
      this._isInProgress = false;
      this.cachedStatus = null; // Invalidate cache after update
    }
  }

  // ──────────────────────────────────────────────
  // Docker Image Update
  // ──────────────────────────────────────────────

  async performDockerUpdate(services: string[], options: DockerUpdateOptions = {}): Promise<void> {
    if (this._isInProgress) throw new Error('An update is already in progress');
    services = [...new Set(services)];
    this._isInProgress = true;

    const sharedDir = path.join(this.rootDir, 'shared');
    const composeArgs = this.getComposeArgs(sharedDir);
    const updateId = `docker-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const previous = new Map<string, DockerServiceInfo>();
    const results: ImageUpdateResult[] = [];
    const imageOverridePath = path.join(sharedDir, '.update-reports', `${updateId}-images.yml`);

    this.emit('update:start', {
      type: 'docker',
      services: [...services].sort((left, right) => this.updateOrder(left) - this.updateOrder(right)),
    });

    try {
      const preflight = await this.preflightDockerUpdate(services, composeArgs, sharedDir, options, updateId);
      preflight.services.forEach((service) => previous.set(service.service, service));
      results.push(...preflight.skipped);
      preflight.skipped.forEach((result) => this.emit('update:serviceResult', result));

      const servicesToUpdate = preflight.services.filter((service) => service.updateAvailable || options.force);
      for (const service of preflight.services.filter((entry) => !servicesToUpdate.includes(entry))) {
        const result: ImageUpdateResult = {
          service: service.service,
          status: 'skipped',
          error: 'Already up to date',
        };
        results.push(result);
        this.emit('update:serviceResult', result);
      }

      const orderedServices = servicesToUpdate
        .map((service) => service.service)
        .sort((left, right) => this.updateOrder(left) - this.updateOrder(right));
      if (orderedServices.length === 0) {
        const outcome = this.getUpdateOutcome(results);
        this.cachedStatus = null;
        this.emit('update:complete', {
          type: 'docker', services: [], updateId, outcome, results,
        });
        return;
      }
      const imageOverrides = servicesToUpdate.map((service) => {
        const composeService = service.service.replace(/^multibase-/, '');
        return `  ${composeService}:\n    image: ${this.getTargetImage(service)}`;
      });
      fs.writeFileSync(imageOverridePath, `services:\n${imageOverrides.join('\n')}\n`);
      const updateComposeArgs = [...composeArgs, '-f', path.relative(sharedDir, imageOverridePath)];
      const targetConfig = await this.runCompose([...updateComposeArgs, 'config'], sharedDir, false);
      if (!targetConfig.stdout.includes('services:')) {
        throw new Error('Preflight failed: the target Compose configuration is empty.');
      }

      for (let i = 0; i < orderedServices.length; i++) {
        const service = orderedServices[i];
        const composeService = service.replace(/^multibase-/, '');
        const previousInfo = previous.get(service)!;
        let serviceTouched = false;

        this.emitStep(service, i, orderedServices.length);
        try {
          this.emit('update:log', { line: `[${service}] Pulling target image...` });
          await this.runCompose([...updateComposeArgs, 'pull', composeService], sharedDir);
          this.emit('update:log', { line: `[${service}] Stopping container...` });
          serviceTouched = true;
          await this.runCompose([...updateComposeArgs, 'stop', composeService], sharedDir);
          this.emit('update:log', { line: `[${service}] Starting with new image...` });
          await this.runCompose([...updateComposeArgs, 'up', '-d', '--no-deps', composeService], sharedDir);
          await this.waitForServiceHealthy(service, 60_000);

          const result: ImageUpdateResult = {
            service,
            status: 'updated',
            previousTag: previousInfo.tag,
            targetTag: previousInfo.targetTag ?? previousInfo.tag,
          };
          results.push(result);
          this.emit('update:serviceResult', result);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.emit('update:log', { line: `[${service}] Update failed: ${message}. Starting rollback...` });
          const rolledBack = !serviceTouched || await this.rollbackDockerUpdate(
            [service], previous, composeArgs, sharedDir, updateId
          );
          const result: ImageUpdateResult = {
            service,
            status: rolledBack ? 'rolled_back' : 'rollback_failed',
            previousTag: previousInfo.tag,
            targetTag: previousInfo.targetTag ?? previousInfo.tag,
            error: message,
          };
          results.push(result);
          this.emit('update:serviceResult', result);
          this.emit('update:log', {
            line: `[${service}] ${rolledBack ? 'Rollback completed' : 'Rollback failed'}; continuing with the next service.`,
          });
        }

        this.emitStepDone(service, i);
      }

      const outcome = this.getUpdateOutcome(results);

      await createAuditLogEntry({
        userId: options.requestedBy || null,
        action: AUDIT_ACTIONS.DOCKER_UPDATE_COMPLETED,
        resource: 'shared-services',
        details: {
          services: results,
          updateId,
          outcome,
        },
        success: outcome === 'success',
      });

      this.cachedStatus = null;
      this.emit('update:complete', { type: 'docker', services: orderedServices, updateId, outcome, results });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await createAuditLogEntry({
        userId: options.requestedBy || null,
        action: AUDIT_ACTIONS.DOCKER_UPDATE_COMPLETED,
        resource: 'shared-services',
        details: {
          services: services.map((s) => ({ service: s })),
          error: message,
        },
        success: false,
      });
      this.emit('update:error', { type: 'docker', error: message });
      throw error;
    } finally {
      fs.rmSync(imageOverridePath, { force: true });
      this._isInProgress = false;
      this.cachedStatus = null;
    }
  }

  async performTenantDockerUpdate(
    instanceName: string,
    services: string[],
    options: DockerUpdateOptions = {}
  ): Promise<void> {
    if (this._isInProgress) throw new Error('An update is already in progress');
    services = [...new Set(services)];
    this._isInProgress = true;

    const projectPath = this.getProjectPath(instanceName);
    const composeArgs = ['-f', 'docker-compose.yml'];
    const updateId = `tenant-${instanceName}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const imageOverridePath = path.join(projectPath, `.image-update-${updateId}.yml`);
    const previous = new Map<string, DockerServiceInfo>();
    const results: ImageUpdateResult[] = [];

    this.emit('update:start', { type: 'tenantDocker', instanceName, services });

    try {
      if (process.env.IMAGE_UPDATE_SECURITY_GATE !== 'approved' || options.confirmSafetyGate !== true) {
        throw new Error(
          'Security gate blocked: incident/forensic approval and explicit maintenance confirmation are required.'
        );
      }
      if (!fs.existsSync(path.join(projectPath, 'docker-compose.yml'))) {
        throw new Error('Preflight failed: the instance docker-compose.yml is missing.');
      }

      const currentServices = await this.getTenantDockerServiceInfo(instanceName, true);
      const selected = services.map((service) => {
        const shortService = service.startsWith(`${instanceName}-`)
          ? service.substring(instanceName.length + 1)
          : service;
        const fullService = service.startsWith(`${instanceName}-`)
          ? service
          : `${instanceName}-${service}`;

        return currentServices.find(
          (entry) =>
            entry.service === service ||
            entry.service === shortService ||
            entry.containerName === service ||
            entry.containerName === fullService
        );
      });
      selected.forEach((service, index) => {
        if (service) return;
        const result: ImageUpdateResult = {
          service: services[index], status: 'skipped', error: 'Service not found',
        };
        results.push(result);
        this.emit('update:serviceResult', result);
      });
      const selectedServices = selected.filter(
        (service): service is DockerServiceInfo => Boolean(service)
      );
      const servicesToUpdate = selectedServices.filter(
        (service) => service.updateAvailable || options.force
      );

      if (servicesToUpdate.length === 0) {
        this.emit('update:log', { line: `No selected services for ${instanceName} require an update.` });
        const outcome = this.getUpdateOutcome(results);
        this.emit('update:complete', {
          type: 'tenantDocker', instanceName, services: [], updateId, outcome, results,
        });
        return;
      }

      const blocked = servicesToUpdate.filter(
        (service) =>
          !service.managed ||
          service.updateStatus === 'registry_unreachable' ||
          service.updatePolicy === 'manual'
      );
      if (blocked.length > 0) {
        for (const service of blocked) {
          const result: ImageUpdateResult = {
            service: service.service,
            status: 'skipped',
            error: `Preflight blocked (${service.updateStatus})`,
          };
          results.push(result);
          this.emit('update:serviceResult', result);
        }
      }
      const eligibleServices = servicesToUpdate.filter((service) => !blocked.includes(service));
      eligibleServices.forEach((service) => previous.set(service.service, service));

      if (eligibleServices.length === 0) {
        const outcome = this.getUpdateOutcome(results);
        this.emit('update:complete', {
          type: 'tenantDocker', instanceName, services: [], updateId, outcome, results,
        });
        return;
      }

      const imageOverrides = eligibleServices.map((service) => {
        return `  ${service.service}:\n    image: ${this.getTargetImage(service)}`;
      });
      fs.writeFileSync(imageOverridePath, `services:\n${imageOverrides.join('\n')}\n`);
      const updateComposeArgs = [...composeArgs, '-f', path.basename(imageOverridePath)];

      const config = await this.runCompose([...updateComposeArgs, 'config'], projectPath, false);
      if (!config.stdout.includes('services:')) {
        throw new Error('Preflight failed: the tenant Compose configuration is empty.');
      }

      if (options.createBackup !== false) {
        const backup = await BackupService.createBackup({
          type: options.backupInstanceId ? 'instance' : 'full',
          instanceId: options.backupInstanceId,
          instanceName: options.backupInstanceId ? instanceName : undefined,
          name: `image-update-${instanceName}-${updateId}`,
          createdBy: options.requestedBy || 'system',
        });
        this.emit('update:backup', {
          id: backup.id,
          name: backup.name,
          type: backup.type,
          path: backup.path,
          size: backup.size,
          createdAt: backup.createdAt,
        });
        this.emit('update:log', { line: `[preflight] Instance backup created: ${backup.id}` });
      }

      const orderedServices = eligibleServices.map((s) => s.service);
      for (let i = 0; i < orderedServices.length; i++) {
        const service = orderedServices[i];
        const previousInfo = previous.get(service)!;
        let historySaved = false;
        let serviceTouched = false;
        this.emitStep(`${instanceName}/${service}`, i, orderedServices.length);
        try {
          this.emit('update:log', { line: `[${instanceName}/${service}] Pulling target image...` });
          await this.runCompose([...updateComposeArgs, 'pull', service], projectPath);
          this.emit('update:log', { line: `[${instanceName}/${service}] Stopping container...` });
          serviceTouched = true;
          await this.runCompose([...updateComposeArgs, 'stop', service], projectPath);
          this.emit('update:log', { line: `[${instanceName}/${service}] Starting with new image...` });
          await this.runCompose([...updateComposeArgs, 'up', '-d', '--no-deps', service], projectPath);
          await this.waitForTenantServiceHealthy(instanceName, service, 60_000);

          this.savePreviousImageTags(projectPath, [previousInfo]);
          historySaved = true;
          this.updateTenantComposeFileImages(projectPath, [previousInfo]);
          const result: ImageUpdateResult = {
            service,
            status: 'updated',
            previousTag: previousInfo.tag,
            targetTag: previousInfo.targetTag ?? previousInfo.tag,
          };
          results.push(result);
          this.emit('update:serviceResult', result);
          this.emit('update:log', { line: `[${instanceName}/${service}] Updated successfully.` });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.emit('update:log', {
            line: `[${instanceName}/${service}] Update failed: ${message}. Starting rollback...`,
          });
          if (historySaved) this.removePreviousImageTag(projectPath, service);
          const rolledBack = !serviceTouched || await this.rollbackTenantDockerUpdate(
            [service], previous, projectPath, composeArgs, instanceName
          );
          const result: ImageUpdateResult = {
            service,
            status: rolledBack ? 'rolled_back' : 'rollback_failed',
            previousTag: previousInfo.tag,
            targetTag: previousInfo.targetTag ?? previousInfo.tag,
            error: message,
          };
          results.push(result);
          this.emit('update:serviceResult', result);
          this.emit('update:log', {
            line: `[${instanceName}/${service}] ${rolledBack ? 'Rollback completed' : 'Rollback failed'}; continuing with the next service.`,
          });
        } finally {
          this.emitStepDone(`${instanceName}/${service}`, i);
        }
      }
      const outcome = this.getUpdateOutcome(results);

      await createAuditLogEntry({
        userId: options.requestedBy || null,
        action: AUDIT_ACTIONS.INSTANCE_IMAGE_UPDATE_COMPLETED,
        resource: instanceName,
        details: {
          instanceName,
          services: results,
          updateId,
          outcome,
          backupCreated: options.createBackup !== false,
        },
        success: outcome === 'success',
      });

      this.emit('update:complete', {
        type: 'tenantDocker', instanceName, services: orderedServices, updateId, outcome, results,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await createAuditLogEntry({
        userId: options.requestedBy || null,
        action: AUDIT_ACTIONS.INSTANCE_IMAGE_UPDATE_COMPLETED,
        resource: instanceName,
        details: {
          instanceName,
          services: previous.size > 0
            ? Array.from(previous.values()).map((s) => ({
                service: s.service,
                previousTag: s.tag,
                targetTag: s.targetTag || s.latestApprovedTag || s.tag,
              }))
            : services.map((s) => ({ service: s })),
          error: message,
        },
        success: false,
      });
      this.emit('update:error', { type: 'tenantDocker', instanceName, error: message });
      throw error;
    } finally {
      fs.rmSync(imageOverridePath, { force: true });
      this._isInProgress = false;
      this.cachedStatus = null;
    }
  }

  async performTenantDockerRollback(
    instanceName: string,
    services: string[],
    options: DockerUpdateOptions = {}
  ): Promise<void> {
    if (this._isInProgress) throw new Error('An update is already in progress');
    services = [...new Set(services)];
    this._isInProgress = true;

    const projectPath = this.getProjectPath(instanceName);
    const composeArgs = ['-f', 'docker-compose.yml'];
    const updateId = `tenant-rollback-${instanceName}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const rollbackPath = path.join(projectPath, `.image-rollback-${updateId}.yml`);
    const results: ImageUpdateResult[] = [];
    this.emit('update:start', { type: 'tenantDocker', instanceName, services, mode: 'rollback' });

    try {
      if (process.env.IMAGE_UPDATE_SECURITY_GATE !== 'approved' || options.confirmSafetyGate !== true) {
        throw new Error('Security gate blocked: explicit maintenance confirmation is required.');
      }
      if (!fs.existsSync(path.join(projectPath, 'docker-compose.yml'))) {
        throw new Error('Preflight failed: the instance docker-compose.yml is missing.');
      }

      const history = this.getPreviousImageTags(instanceName);
      const currentServices = await this.getTenantDockerServiceInfo(instanceName, true);
      const selected = services.map((requested) => {
        const shortName = requested.startsWith(`${instanceName}-`)
          ? requested.substring(instanceName.length + 1)
          : requested;
        return currentServices.find((entry) =>
          entry.service === requested || entry.service === shortName || entry.containerName === requested
        );
      });

      if (options.createBackup !== false) {
        const backup = await BackupService.createBackup({
          type: options.backupInstanceId ? 'instance' : 'full',
          instanceId: options.backupInstanceId,
          instanceName: options.backupInstanceId ? instanceName : undefined,
          name: `image-rollback-${instanceName}-${updateId}`,
          createdBy: options.requestedBy || 'system',
        });
        this.emit('update:backup', {
          id: backup.id, name: backup.name, type: backup.type, path: backup.path,
          size: backup.size, createdAt: backup.createdAt,
        });
      }

      for (let index = 0; index < services.length; index += 1) {
        const requested = services[index];
        const current = selected[index];
        const previousTag = current ? history[current.service] : history[requested];
        this.emitStep(`${instanceName}/${requested}`, index, services.length);

        if (!current || !previousTag || previousTag.previousTag === 'unknown') {
          const result: ImageUpdateResult = {
            service: requested,
            status: 'skipped',
            error: current ? 'No rollback image is recorded' : 'Service not found',
          };
          results.push(result);
          this.emit('update:serviceResult', result);
          this.emitStepDone(`${instanceName}/${requested}`, index);
          continue;
        }

        try {
          const previousImage = previousTag.previousImage || `${current.repository}:${previousTag.previousTag}`;
          const parsedPrevious = parseImageReference(previousImage);
          const exactImage = previousTag.previousDigest
            ? `${parsedPrevious.repository}@${previousTag.previousDigest}`
            : previousImage;
          fs.writeFileSync(rollbackPath, `services:\n  ${current.service}:\n    image: ${exactImage}\n`);

          if (previousTag.previousImageId) {
            await this.runCommand(
              'docker', ['image', 'tag', previousTag.previousImageId, previousImage], projectPath
            );
          }
          this.emit('update:log', { line: `[${instanceName}/${current.service}] Restoring ${previousImage}...` });
          await this.runCompose(
            [...composeArgs, '-f', path.basename(rollbackPath), 'up', '-d', '--no-deps', current.service],
            projectPath
          );
          await this.waitForTenantServiceHealthy(instanceName, current.service, 60_000);

          const restoredInfo: DockerServiceInfo = {
            ...current,
            repository: parsedPrevious.repository,
            targetTag: previousTag.previousTag,
          };
          this.updateTenantComposeFileImages(projectPath, [restoredInfo]);
          await this.runCompose(
            [...composeArgs, 'up', '-d', '--no-deps', '--force-recreate', current.service], projectPath
          );
          await this.waitForTenantServiceHealthy(instanceName, current.service, 60_000);
          this.removePreviousImageTag(projectPath, current.service);

          const result: ImageUpdateResult = {
            service: current.service,
            status: 'rolled_back',
            previousTag: current.tag,
            targetTag: previousTag.previousTag,
          };
          results.push(result);
          this.emit('update:serviceResult', result);
        } catch (error) {
          const result: ImageUpdateResult = {
            service: current.service,
            status: 'rollback_failed',
            previousTag: current.tag,
            targetTag: previousTag.previousTag,
            error: error instanceof Error ? error.message : String(error),
          };
          results.push(result);
          this.emit('update:serviceResult', result);
        } finally {
          fs.rmSync(rollbackPath, { force: true });
          this.emitStepDone(`${instanceName}/${requested}`, index);
        }
      }

      const outcome = this.getUpdateOutcome(results, true);
      await createAuditLogEntry({
        userId: options.requestedBy || null,
        action: AUDIT_ACTIONS.INSTANCE_IMAGE_UPDATE_COMPLETED,
        resource: instanceName,
        details: { instanceName, mode: 'rollback', services: results, updateId, outcome },
        success: outcome === 'success',
      });
      this.emit('update:complete', {
        type: 'tenantDocker', instanceName, services, mode: 'rollback', updateId, outcome, results,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await createAuditLogEntry({
        userId: options.requestedBy || null,
        action: AUDIT_ACTIONS.INSTANCE_IMAGE_UPDATE_COMPLETED,
        resource: instanceName,
        details: { instanceName, mode: 'rollback', services, updateId, error: message },
        success: false,
      });
      this.emit('update:error', { type: 'tenantDocker', instanceName, error: message });
      throw error;
    } finally {
      fs.rmSync(rollbackPath, { force: true });
      this._isInProgress = false;
      this.cachedStatus = null;
    }
  }

  private async waitForTenantServiceHealthy(
    instanceName: string,
    serviceName: string,
    timeoutMs: number
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    const shortService = serviceName.startsWith(`${instanceName}-`)
      ? serviceName.substring(instanceName.length + 1)
      : serviceName;
    const fullService = serviceName.startsWith(`${instanceName}-`)
      ? serviceName
      : `${instanceName}-${serviceName}`;

    while (Date.now() < deadline) {
      const containers = await this.dockerManager.listProjectContainers(instanceName);
      const container = containers.find((entry) => {
        const composeService = entry.Labels?.['com.docker.compose.service'];
        const name = entry.Names?.[0]?.replace(/^\//, '');
        return (
          composeService === serviceName ||
          composeService === shortService ||
          name === serviceName ||
          name === fullService ||
          name === `${instanceName}-${shortService}`
        );
      });

      if (container) {
        const inspect = await this.dockerManager.inspectContainer(container.Id);
        const health = inspect.State.Health?.Status;
        if (inspect.State.Running && (!health || health === 'healthy')) return;
        if (health === 'unhealthy') throw new Error(`Healthcheck failed: ${instanceName}/${serviceName}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error(`Healthcheck timeout: ${instanceName}/${serviceName}`);
  }

  private updateTenantComposeFileImages(
    projectPath: string,
    selectedServices: DockerServiceInfo[]
  ): void {
    const composePath = path.join(projectPath, 'docker-compose.yml');
    if (!fs.existsSync(composePath)) return;
    let content = fs.readFileSync(composePath, 'utf8');

    for (const service of selectedServices) {
      const targetImage = this.getTargetImage(service);
      const escapedService = service.service.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(^|\\n)([ \\t]*${escapedService}:[\\s\\S]*?image:[ \\t]*)[^\\s\\n]+`, 'g');
      const updatedContent = content.replace(regex, `$1$2${targetImage}`);
      if (updatedContent === content && service.targetTag !== service.tag) {
        throw new Error(`Could not persist the image tag for Compose service ${service.service}`);
      }
      content = updatedContent;
    }

    fs.writeFileSync(composePath, content, 'utf8');
    logger.info(`Updated docker-compose.yml image tags in ${projectPath}`);
  }

  private savePreviousImageTags(
    projectPath: string,
    selectedServices: DockerServiceInfo[]
  ): void {
    const historyPath = path.join(projectPath, '.image-update-previous.json');
    let history: Record<string, PreviousImageTag> = {};
    try {
      if (fs.existsSync(historyPath)) {
        history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
      }
    } catch { /* ignore parse errors */ }

    for (const service of selectedServices) {
      history[service.service] = {
        previousTag: service.tag,
        previousImage: `${service.repository}:${service.tag}`,
        previousDigest: service.localDigest,
        previousImageId: service.localImageId,
        updatedAt: new Date().toISOString(),
      };
    }

    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf8');
  }

  getPreviousImageTags(instanceName: string): Record<string, PreviousImageTag> {
    const projectPath = this.getProjectPath(instanceName);
    const historyPath = path.join(projectPath, '.image-update-previous.json');
    try {
      if (fs.existsSync(historyPath)) {
        const parsed = JSON.parse(fs.readFileSync(historyPath, 'utf8')) as Record<string, Partial<PreviousImageTag>>;
        return Object.fromEntries(Object.entries(parsed).map(([service, entry]) => [service, {
          previousTag: entry.previousTag ?? 'unknown',
          previousImage: entry.previousImage ?? '',
          previousDigest: entry.previousDigest ?? null,
          previousImageId: entry.previousImageId ?? null,
          updatedAt: entry.updatedAt ?? new Date(0).toISOString(),
        }]));
      }
    } catch { /* ignore */ }
    return {};
  }

  private removePreviousImageTag(projectPath: string, service: string): void {
    const historyPath = path.join(projectPath, '.image-update-previous.json');
    if (!fs.existsSync(historyPath)) return;
    const history = JSON.parse(fs.readFileSync(historyPath, 'utf8')) as Record<string, PreviousImageTag>;
    delete history[service];
    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf8');
  }

  private async rollbackTenantDockerUpdate(
    services: string[],
    previous: Map<string, DockerServiceInfo>,
    projectPath: string,
    composeArgs: string[],
    instanceName: string
  ): Promise<boolean> {
    this.emit('update:log', { line: '[rollback] Restoring previous tenant image digests.' });
    const rollbackPath = path.join(projectPath, '.image-update-rollback.yml');
    const entries = services
      .map((service) => {
        const previousInfo = previous.get(service);
        if (!previousInfo?.localDigest || previousInfo.repository === 'unknown') return null;
        return `  ${service}:\n    image: ${previousInfo.repository}@${previousInfo.localDigest}`;
      })
      .filter((entry): entry is string => Boolean(entry));
    if (entries.length === 0) return false;
    fs.writeFileSync(rollbackPath, `services:\n${entries.join('\n')}\n`);
    let success = true;
    try {
      for (const service of services) {
        const previousInfo = previous.get(service);
        if (!previousInfo?.localDigest) {
          success = false;
          continue;
        }
        try {
          if (previousInfo.localImageId) {
            await this.runCommand(
              'docker', ['image', 'tag', previousInfo.localImageId, `${previousInfo.repository}:${previousInfo.tag}`], projectPath
            );
          }
          await this.runCompose(
            [...composeArgs, '-f', path.basename(rollbackPath), 'up', '-d', '--no-deps', service],
            projectPath
          );
          await this.waitForTenantServiceHealthy(instanceName, service, 60_000);
          // Recreate once from the unchanged base Compose file so Docker records
          // the previous tag instead of the temporary digest override.
          await this.runCompose([...composeArgs, 'up', '-d', '--no-deps', '--force-recreate', service], projectPath);
          await this.waitForTenantServiceHealthy(instanceName, service, 60_000);
        } catch (rollbackError) {
          success = false;
          logger.error(`Rollback failed for ${instanceName}/${service}:`, rollbackError);
        }
      }
    } finally {
      fs.rmSync(rollbackPath, { force: true });
    }
    return success;
  }

  private getTargetImage(service: DockerServiceInfo): string {
    const targetTag = service.targetTag ?? service.tag;
    return `${service.repository}:${targetTag}`;
  }

  private getUpdateOutcome(
    results: ImageUpdateResult[], manualRollback = false
  ): 'success' | 'partial' | 'failed' {
    const updated = results.filter((result) =>
      manualRollback ? result.status === 'rolled_back' : result.status === 'updated'
    ).length;
    const failed = results.filter((result) =>
      result.status === 'rollback_failed' ||
      (!manualRollback && result.status === 'rolled_back') ||
      (result.status === 'skipped' && result.error !== 'Already up to date')
    ).length;
    if (failed === 0) return 'success';
    return updated > 0 ? 'partial' : 'failed';
  }

  private getComposeArgs(sharedDir: string): string[] {
    const args = ['--env-file', '.env.shared', '-f', 'docker-compose.shared.yml'];
    const overridePath = path.join(sharedDir, 'docker-compose.override.yml');
    if (fs.existsSync(overridePath)) args.push('-f', 'docker-compose.override.yml');
    return args;
  }

  private updateOrder(service: string): number {
    const shortName = service.replace(/^multibase-/, '');
    const order: Record<string, number> = {
      vector: 10,
      analytics: 20,
      'nginx-gateway': 30,
      imgproxy: 40,
      pooler: 50,
      meta: 60,
      studio: 70,
      db: 1000,
    };
    return order[shortName] ?? 100;
  }

  private async preflightDockerUpdate(
    services: string[],
    composeArgs: string[],
    sharedDir: string,
    options: DockerUpdateOptions,
    updateId: string
  ): Promise<{ services: DockerServiceInfo[]; skipped: ImageUpdateResult[] }> {
    if (services.some((service) => service === 'multibase-db' || service === 'db')) {
      if (options.allowPostgres !== true) {
        throw new Error('PostgreSQL image updates require separate manual approval.');
      }
    }
    if (process.env.IMAGE_UPDATE_SECURITY_GATE !== 'approved' || options.confirmSafetyGate !== true) {
      throw new Error(
        'Security gate blocked: incident/forensic approval and explicit maintenance confirmation are required.'
      );
    }

    if (!fs.existsSync(path.join(sharedDir, '.env.shared'))) {
      throw new Error('Preflight failed: shared/.env.shared is missing.');
    }
    if (!fs.existsSync(path.join(sharedDir, 'docker-compose.shared.yml'))) {
      throw new Error('Preflight failed: docker-compose.shared.yml is missing.');
    }

    try {
      const fileSystem = fs.statfsSync(sharedDir);
      const freeBytes = Number(fileSystem.bavail) * Number(fileSystem.bsize);
      const minimumFreeBytes = Number(process.env.IMAGE_UPDATE_MIN_FREE_BYTES || 2 * 1024 ** 3);
      if (freeBytes < minimumFreeBytes) {
        throw new Error(
          `Preflight blocked: insufficient free disk space (${Math.round(freeBytes / 1024 ** 3)} GiB available).`
        );
      }
      this.emit('update:log', { line: `[preflight] Free disk space: ${Math.round(freeBytes / 1024 ** 3)} GiB` });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Preflight blocked:')) throw error;
      logger.warn(`Free disk space check unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }

    const status = await this.getDockerServiceInfo(true);
    const selected = services.map((service) => status.find((entry) => entry.service === service));
    const skipped: ImageUpdateResult[] = selected.flatMap((service, index) =>
      service ? [] : [{ service: services[index], status: 'skipped' as const, error: 'Service not found' }]
    );
    const selectedServices = selected.filter((service): service is DockerServiceInfo => Boolean(service));
    const blocked = selectedServices.filter(
      (service) =>
        !service.managed ||
        service.updateStatus === 'registry_unreachable' ||
        (service.updatePolicy === 'manual' && options.allowPostgres !== true)
    );
    skipped.push(...blocked.map((service) => ({
      service: service.service,
      status: 'skipped' as const,
      error: `Preflight blocked (${service.updateStatus})`,
    })));
    const missingDigest = selectedServices.filter(
      (service) => !blocked.includes(service) && !service.targetDigest
    );
    skipped.push(...missingDigest.map((service) => ({
      service: service.service,
      status: 'skipped' as const,
      error: 'Preflight blocked (target digest unavailable)',
    })));
    const eligibleServices = selectedServices.filter(
      (service) => !blocked.includes(service) && !missingDigest.includes(service)
    );

    const config = await this.runCompose([...composeArgs, 'config'], sharedDir, false);
    if (!config.stdout.includes('services:')) throw new Error('Preflight failed: the Compose configuration is empty.');
    const reportDir = path.join(sharedDir, '.update-reports');
    fs.mkdirSync(reportDir, { recursive: true });
    const reportPath = path.join(reportDir, `${updateId}.json`);
    fs.writeFileSync(
      reportPath,
      JSON.stringify(
        {
          updateId,
          createdAt: new Date().toISOString(),
          services: selectedServices,
          skipped,
          compose: this.redactComposeConfig(config.stdout),
          backup: null,
        },
        null,
        2
      )
    );
    this.emit('update:log', { line: `[preflight] Compose configuration validated and report saved: ${reportPath}` });

    if (options.createBackup !== false && eligibleServices.length > 0) {
      const isPostgresUpdate = eligibleServices.some((service) => service.service === 'multibase-db');
      const backup = isPostgresUpdate
        ? await BackupService.createPostgresBackup({
            name: `postgres-image-update-${updateId}`,
            createdBy: options.requestedBy || 'system',
          })
        : await BackupService.createBackup({
            type: 'full',
            name: `image-update-${updateId}`,
            createdBy: options.requestedBy || 'system',
          });
      this.emit('update:backup', {
        id: backup.id,
        name: backup.name,
        type: backup.type,
        path: backup.path,
        size: backup.size,
        createdAt: backup.createdAt,
      });
      this.emit('update:log', { line: `[preflight] Backup created: ${backup.id}` });
      const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as Record<string, unknown>;
      report.backup = { id: backup.id, createdAt: new Date().toISOString() };
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    }

    return { services: eligibleServices, skipped };
  }

  private redactComposeConfig(config: string): string {
    return config
      .split(/\r?\n/)
      .map((line) => (/password|secret|token|api.?key|service.?role/i.test(line) ? line.replace(/(:\s*).+$/, '$1[REDACTED]') : line))
      .join('\n');
  }

  private async runCompose(
    args: string[],
    cwd: string,
    emitOutput = true
  ): Promise<{ stdout: string; stderr: string }> {
    const result = (await execFileAsync('docker', ['compose', ...args], {
      cwd,
      maxBuffer: 16 * 1024 * 1024,
      timeout: 120_000,
      env: { ...process.env, ...this.getMatrixComposeEnvironment() },
    })) as unknown as { stdout: string; stderr: string };
    if (emitOutput) {
      if (result.stdout.trim()) this.emit('update:log', { line: result.stdout.trim() });
      if (result.stderr.trim()) this.emit('update:log', { line: result.stderr.trim() });
    }
    return result;
  }

  private getMatrixComposeEnvironment(): Record<string, string> {
    const matrix = this.loadMatrix();
    const environment: Record<string, string> = {};
    const names: Record<string, string> = {
      'shared-db': 'SHARED_DB_IMAGE',
      'shared-studio': 'SHARED_STUDIO_IMAGE',
      'shared-analytics': 'SHARED_ANALYTICS_IMAGE',
      'shared-vector': 'SHARED_VECTOR_IMAGE',
      'shared-imgproxy': 'SHARED_IMGPROXY_IMAGE',
      'shared-meta': 'SHARED_META_IMAGE',
      'shared-pooler': 'SHARED_POOLER_IMAGE',
      'shared-nginx-gateway': 'SHARED_NGINX_GATEWAY_IMAGE',
    };
    for (const [matrixName, environmentName] of Object.entries(names)) {
      const definition = matrix.images[matrixName];
      if (definition) environment[environmentName] = `${definition.repository}:${definition.tag}`;
    }
    return environment;
  }

  private async waitForServiceHealthy(service: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    const containerName = service.startsWith('multibase-') ? service : `multibase-${service}`;
    while (Date.now() < deadline) {
      const container = (await this.dockerManager.listAllContainers()).find((entry) =>
        entry.Names.some((name) => name.replace(/^\//, '') === containerName)
      );
      if (container) {
        const inspect = await this.dockerManager.inspectContainer(container.Id);
        const health = inspect.State.Health?.Status;
        if (inspect.State.Running && (!health || health === 'healthy')) return;
        if (health === 'unhealthy') throw new Error(`Healthcheck failed: ${service}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error(`Healthcheck timeout: ${service}`);
  }

  private async rollbackDockerUpdate(
    services: string[],
    previous: Map<string, DockerServiceInfo>,
    composeArgs: string[],
    sharedDir: string,
    updateId: string
  ): Promise<boolean> {
    this.emit('update:log', { line: '[rollback] Restoring previous image digests.' });
    const rollbackPath = path.join(sharedDir, '.update-reports', `${updateId}-rollback.yml`);
    const entries = services
      .map((service) => {
        const previousInfo = previous.get(service);
        if (!previousInfo?.localDigest || previousInfo.repository === 'unknown') return null;
        const composeService = service.replace(/^multibase-/, '');
        return `  ${composeService}:\n    image: ${previousInfo.repository}@${previousInfo.localDigest}`;
      })
      .filter((entry): entry is string => Boolean(entry));
    if (entries.length === 0) return false;
    fs.writeFileSync(rollbackPath, `services:\n${entries.join('\n')}\n`);
    let success = true;
    for (const service of services) {
      const previousInfo = previous.get(service);
      if (!previousInfo?.localDigest) {
        success = false;
        continue;
      }
      try {
        const composeService = service.replace(/^multibase-/, '');
        if (previousInfo.localImageId) {
          await this.runCommand(
            'docker', ['image', 'tag', previousInfo.localImageId, `${previousInfo.repository}:${previousInfo.tag}`], sharedDir
          );
        }
        await this.runCompose(
          [...composeArgs, '-f', path.relative(sharedDir, rollbackPath), 'up', '-d', '--no-deps', composeService],
          sharedDir
        );
        await this.waitForServiceHealthy(service, 60_000);
        await this.runCompose([...composeArgs, 'up', '-d', '--no-deps', '--force-recreate', composeService], sharedDir);
        await this.waitForServiceHealthy(service, 60_000);
      } catch (rollbackError) {
        success = false;
        logger.error(`Rollback failed for ${service}:`, rollbackError);
      }
    }
    return success;
  }

  // ──────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────

  private emitStep(step: string, index: number, total: number): void {
    this.emit('update:step', { step, index, total });
    logger.info(`[UpdateService] step ${index + 1}/${total}: ${step}`);
  }

  private emitStepDone(step: string, index: number): void {
    this.emit('update:stepDone', { step, index });
  }

  private runCommand(
    cmd: string,
    args: string[],
    cwd: string,
    detached = false,
    envOverrides: Record<string, string> = {}
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, {
        cwd,
        detached,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        env: { ...process.env, ...envOverrides },
      });

      child.stdout?.on('data', (data: Buffer) => {
        const lines = data
          .toString()
          .split('\n')
          .filter(l => l.trim());
        lines.forEach(line => this.emit('update:log', { line }));
      });

      child.stderr?.on('data', (data: Buffer) => {
        const lines = data
          .toString()
          .split('\n')
          .filter(l => l.trim());
        lines.forEach(line => this.emit('update:log', { line }));
      });

      if (detached) {
        child.unref();
        resolve();
        return;
      }

      child.on('close', code => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`"${cmd} ${args.join(' ')}" exited with code ${code}`));
        }
      });

      child.on('error', reject);
    });
  }
}
