import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractDockerPortBindings } from '../../utils/sharedPorts';

const runDockerCommandMock = vi.hoisted(() => vi.fn());

vi.mock('../../utils/dockerCommand', () => ({ runDockerCommand: runDockerCommandMock }));
vi.mock('../../middleware/authMiddleware', () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../../middleware/auditLog', () => ({
  auditLog: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../../middleware/requireScope', () => ({
  requireScope: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { createSharedRoutes } from '../../routes/shared';

const temporaryRoots: string[] = [];
const originalProjectsPath = process.env.PROJECTS_PATH;

function prepareSharedDir(withOverride: boolean): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'multibase-shared-route-'));
  temporaryRoots.push(root);
  const sharedDir = path.join(root, 'shared');
  fs.mkdirSync(path.join(root, 'projects'), { recursive: true });
  fs.mkdirSync(sharedDir, { recursive: true });
  fs.writeFileSync(path.join(sharedDir, 'docker-compose.shared.yml'), 'services: {}\n');
  fs.writeFileSync(path.join(sharedDir, '.env.shared'), 'SHARED_GATEWAY_PORT=8000\n');
  if (withOverride) {
    fs.writeFileSync(
      path.join(sharedDir, 'docker-compose.override.yml'),
      'services:\n  nginx-gateway:\n    ports:\n      - "127.0.0.1:3666:3666/tcp"\n'
    );
  }
  process.env.PROJECTS_PATH = path.join(root, 'projects');
  return sharedDir;
}

function createApp(
  portBindings = extractDockerPortBindings({
    NetworkSettings: { Ports: { '3666/tcp': [{ HostIp: '127.0.0.1', HostPort: '3666' }] } },
  })
) {
  const dockerManager = {
    getSharedServiceStatus: vi.fn().mockResolvedValue([
      {
        name: 'nginx-gateway',
        containerName: 'multibase-nginx-gateway',
        status: 'running',
        health: 'healthy',
        uptime: 1,
        cpu: 0,
        memory: 0,
        portBindings,
      },
    ]),
  };
  const app = express();
  app.use(createSharedRoutes(dockerManager as never));
  return app;
}

beforeEach(() => {
  runDockerCommandMock.mockReset();
  runDockerCommandMock.mockResolvedValue({ stdout: 'done', stderr: '' });
});

afterEach(() => {
  temporaryRoots
    .splice(0)
    .forEach(directory => fs.rmSync(directory, { recursive: true, force: true }));
  if (originalProjectsPath === undefined) delete process.env.PROJECTS_PATH;
  else process.env.PROJECTS_PATH = originalProjectsPath;
});

describe('shared infrastructure routes', () => {
  it('uses the override for start when tenant ports exist', async () => {
    const sharedDir = prepareSharedDir(true);
    const response = await request(createApp()).post('/start');

    expect(response.status).toBe(200);
    expect(runDockerCommandMock).toHaveBeenCalledWith(
      [
        'compose',
        '-f',
        'docker-compose.shared.yml',
        '-f',
        'docker-compose.override.yml',
        '--env-file',
        '.env.shared',
        'up',
        '-d',
      ],
      { cwd: sharedDir }
    );
  });

  it('starts with only the base compose file when no override exists', async () => {
    const sharedDir = prepareSharedDir(false);
    const response = await request(createApp()).post('/start');

    expect(response.status).toBe(200);
    expect(runDockerCommandMock).toHaveBeenCalledWith(
      ['compose', '-f', 'docker-compose.shared.yml', '--env-file', '.env.shared', 'up', '-d'],
      { cwd: sharedDir }
    );
  });

  it('uses the same override definition for stop', async () => {
    const sharedDir = prepareSharedDir(true);
    const response = await request(createApp()).post('/stop');

    expect(response.status).toBe(200);
    expect(runDockerCommandMock).toHaveBeenCalledWith(
      [
        'compose',
        '-f',
        'docker-compose.shared.yml',
        '-f',
        'docker-compose.override.yml',
        '--env-file',
        '.env.shared',
        'down',
      ],
      { cwd: sharedDir }
    );
  });

  it('stops with only the base compose file when no override exists', async () => {
    const sharedDir = prepareSharedDir(false);
    const response = await request(createApp()).post('/stop');

    expect(response.status).toBe(200);
    expect(runDockerCommandMock).toHaveBeenCalledWith(
      ['compose', '-f', 'docker-compose.shared.yml', '--env-file', '.env.shared', 'down'],
      { cwd: sharedDir }
    );
  });

  it('returns runtime Docker bindings and flags missing expected tenant bindings', async () => {
    prepareSharedDir(true);
    const response = await request(createApp()).get('/status');

    expect(response.status).toBe(200);
    const ports = response.body.services[0].ports;
    expect(ports).toContainEqual(
      expect.objectContaining({ host: 3666, hostAddress: '127.0.0.1', public: false, actual: true })
    );
    expect(ports).toContainEqual(
      expect.objectContaining({ host: 8000, container: 8000, actual: false })
    );
  });

  it('lists project databases from the shared PostgreSQL container', async () => {
    prepareSharedDir(false);
    runDockerCommandMock.mockResolvedValueOnce({
      stdout: 'project_alpha|1024\nproject_beta|2048\n',
      stderr: '',
    });

    const response = await request(createApp()).get('/databases');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      databases: [
        {
          name: 'project_alpha',
          projectName: 'alpha',
          sizeBytes: 1024,
          sizeFormatted: '1 KB',
        },
        {
          name: 'project_beta',
          projectName: 'beta',
          sizeBytes: 2048,
          sizeFormatted: '2 KB',
        },
      ],
      count: 2,
    });
    expect(runDockerCommandMock).toHaveBeenCalledWith([
      'exec',
      'multibase-db',
      'psql',
      '-U',
      'supabase_admin',
      '-d',
      'postgres',
      '-A',
      '-t',
      '-c',
      "SELECT datname, pg_database_size(datname) FROM pg_database WHERE datname LIKE 'project_%' ORDER BY datname;",
    ]);
  });
});
