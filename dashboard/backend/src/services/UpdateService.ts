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
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import DockerManager from './DockerManager';
import { logger } from '../utils/logger';
import { SHARED_SERVICES } from '../types';

const execAsync = promisify(exec);

export interface VersionInfo {
  current: string;
  latest: string | null;
  hasUpdate: boolean;
  changelog: string | null;
  checkedAt: Date | null;
}

export interface DockerServiceInfo {
  service: string;
  image: string;
  tag: string;
  status: 'running' | 'stopped' | 'missing';
}

export interface UpdateStatus {
  multibase: VersionInfo;
  docker: DockerServiceInfo[];
  isUpdateInProgress: boolean;
  lastCheckedAt: Date | null;
  /** 'local' = single-server (backend builds frontend). 'split' = frontend deployed via CI. */
  frontendServe: 'local' | 'split';
}

export class UpdateService extends EventEmitter {
  private readonly dockerManager: DockerManager;
  private readonly rootDir: string;
  private readonly frontendServe: 'local' | 'split';
  private _isInProgress = false;
  private cachedStatus: UpdateStatus | null = null;
  private cacheExpiry: Date | null = null;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  get isInProgress(): boolean {
    return this._isInProgress;
  }

  constructor(dockerManager: DockerManager, rootDir: string) {
    super();
    this.dockerManager = dockerManager;
    this.rootDir = rootDir;
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

  private compareVersions(a: string, b: string): number {
    const parse = (v: string) => v.split('.').map(n => parseInt(n, 10) || 0);
    const [am, an, ap] = parse(a);
    const [bm, bn, bp] = parse(b);
    if (am !== bm) return am - bm;
    if (an !== bn) return an - bn;
    return ap - bp;
  }

  private async getDockerServiceInfo(): Promise<DockerServiceInfo[]> {
    const containers = await this.dockerManager.listSharedContainers();

    return (SHARED_SERVICES as readonly string[]).map(serviceName => {
      const container = containers.find(c => c.Names.some(n => n.replace('/', '') === serviceName));

      if (!container) {
        return {
          service: serviceName,
          image: 'unknown',
          tag: 'unknown',
          status: 'missing' as const,
        };
      }

      const imageName = container.Image || 'unknown';
      const colonIdx = imageName.lastIndexOf(':');
      const tag = colonIdx !== -1 ? imageName.slice(colonIdx + 1) : 'latest';
      const status = container.State === 'running' ? ('running' as const) : ('stopped' as const);

      return { service: serviceName, image: imageName, tag, status };
    });
  }

  async getStatus(forceRefresh = false): Promise<UpdateStatus> {
    if (!forceRefresh && this.isCacheValid()) {
      return { ...this.cachedStatus!, isUpdateInProgress: this._isInProgress };
    }

    const current = this.getCurrentVersion();
    const { version: latest, changelog } = await this.fetchLatestGitHubRelease();

    const multibase: VersionInfo = {
      current,
      latest,
      hasUpdate: latest !== null && this.compareVersions(latest, current) > 0,
      changelog,
      checkedAt: new Date(),
    };

    const docker = await this.getDockerServiceInfo();

    const status: UpdateStatus = {
      multibase,
      docker,
      isUpdateInProgress: this._isInProgress,
      lastCheckedAt: new Date(),
      frontendServe: this.frontendServe,
    };

    this.cachedStatus = status;
    this.cacheExpiry = new Date(Date.now() + this.CACHE_TTL_MS);
    return status;
  }

  // ──────────────────────────────────────────────
  // Multibase Update
  // ──────────────────────────────────────────────

  async performMultibaseUpdate(): Promise<void> {
    if (this._isInProgress) throw new Error('An update is already in progress');
    this._isInProgress = true;

    const includeFrontend = this.frontendServe === 'local';
    const steps = includeFrontend
      ? ['git pull', 'backend install', 'frontend build', 'restart']
      : ['git pull', 'backend install', 'restart'];
    this.emit('update:start', { type: 'multibase', steps });

    try {
      // Step 0: git fetch + reset (avoids diverged-branch errors from git pull)
      this.emitStep('git pull', 0, steps.length);
      await this.runCommand('git', ['fetch', 'origin', 'main'], this.rootDir);
      await this.runCommand('git', ['reset', '--hard', 'origin/main'], this.rootDir);
      this.emitStepDone('git pull', 0);

      // Step 1: backend npm install
      // --include=dev: tsc braucht @types/* zum Bauen (wird nach dem Build entfernt)
      // --ignore-scripts: verhindert husky-Fehler aus dem Root-workspace prepare-Script
      this.emitStep('backend install', 1, steps.length);
      const backendDir = path.join(this.rootDir, 'dashboard', 'backend');
      await this.runCommand(
        'npm',
        ['install', '--prefer-offline', '--include=dev', '--ignore-scripts'],
        backendDir
      );
      // Prisma-Client explizit generieren (durch --ignore-scripts übersprungen)
      await this.runCommand('npx', ['prisma', 'generate'], backendDir);
      this.emitStepDone('backend install', 1);

      if (includeFrontend) {
        // Step 2 (local only): frontend npm install + build
        // --include=dev forces devDependencies (tsc, vite) even if NODE_ENV=production
        this.emitStep('frontend build', 2, steps.length);
        this.emit('update:log', { line: 'Installing frontend dependencies...' });
        await this.runCommand(
          'npm',
          ['install', '--prefer-offline', '--include=dev'],
          path.join(this.rootDir, 'dashboard', 'frontend')
        );
        this.emit('update:log', { line: 'Building frontend...' });
        // Pass VITE_API_URL from BACKEND_URL env so the built app points at the correct API.
        const buildEnv: Record<string, string> = {};
        if (process.env.BACKEND_URL) buildEnv['VITE_API_URL'] = process.env.BACKEND_URL;
        await this.runCommand(
          'npm',
          ['run', 'build'],
          path.join(this.rootDir, 'dashboard', 'frontend'),
          false,
          buildEnv
        );
        this.emitStepDone('frontend build', 2);
      } else {
        this.emit('update:log', {
          line: 'Skipping frontend build (FRONTEND_SERVE=split — frontend is deployed via CI).',
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

  async performDockerUpdate(services: string[]): Promise<void> {
    if (this._isInProgress) throw new Error('An update is already in progress');
    this._isInProgress = true;

    const sharedDir = path.join(this.rootDir, 'shared');
    const composePath = path.join(sharedDir, 'docker-compose.shared.yml');

    this.emit('update:start', { type: 'docker', services });

    try {
      for (let i = 0; i < services.length; i++) {
        const service = services[i];
        // Docker Compose uses the short name without "multibase-" prefix
        const composeService = service.replace('multibase-', '');

        this.emitStep(service, i, services.length);

        this.emit('update:log', { line: `[${service}] Stopping container...` });
        await execAsync(`docker compose -f "${composePath}" stop ${composeService}`, {
          cwd: sharedDir,
        }).then(({ stdout, stderr }) => {
          if (stdout.trim()) this.emit('update:log', { line: stdout.trim() });
          if (stderr.trim()) this.emit('update:log', { line: stderr.trim() });
        });

        this.emit('update:log', { line: `[${service}] Pulling latest image...` });
        await execAsync(`docker compose -f "${composePath}" pull ${composeService}`, {
          cwd: sharedDir,
        }).then(({ stdout, stderr }) => {
          if (stdout.trim()) this.emit('update:log', { line: stdout.trim() });
          if (stderr.trim()) this.emit('update:log', { line: stderr.trim() });
        });

        this.emit('update:log', { line: `[${service}] Starting with new image...` });
        await execAsync(`docker compose -f "${composePath}" up -d ${composeService}`, {
          cwd: sharedDir,
        }).then(({ stdout, stderr }) => {
          if (stdout.trim()) this.emit('update:log', { line: stdout.trim() });
          if (stderr.trim()) this.emit('update:log', { line: stderr.trim() });
        });

        this.emit('update:log', { line: `[${service}] ✓ Updated successfully` });
        this.emitStepDone(service, i);
      }

      this.emit('update:complete', { type: 'docker', services });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit('update:error', { type: 'docker', error: message });
      throw error;
    } finally {
      this._isInProgress = false;
      this.cachedStatus = null;
    }
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
