import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  extractDockerPortBindings,
  getExpectedSharedPorts,
  resolveSharedServicePorts,
} from '../../utils/sharedPorts';

const temporaryDirs: string[] = [];

function createSharedDir(override?: string): string {
  const sharedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multibase-shared-ports-'));
  temporaryDirs.push(sharedDir);
  if (override) fs.writeFileSync(path.join(sharedDir, 'docker-compose.override.yml'), override);
  return sharedDir;
}

afterEach(() => {
  temporaryDirs.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true }));
});

describe('Docker shared port bindings', () => {
  it('reads a loopback-bound tenant gateway port from Docker Inspect', () => {
    const bindings = extractDockerPortBindings({
      HostConfig: { PortBindings: { '3666/tcp': [{ HostIp: '127.0.0.1', HostPort: '3666' }] } },
      NetworkSettings: { Ports: { '3666/tcp': [{ HostIp: '127.0.0.1', HostPort: '3666' }] } },
    });

    expect(bindings).toEqual([{ container: 3666, transport: 'tcp', host: 3666, hostAddress: '127.0.0.1' }]);
  });

  it('marks 0.0.0.0 bindings as publicly reachable', () => {
    const sharedDir = createSharedDir();
    const expected = getExpectedSharedPorts({}, sharedDir);
    const ports = resolveSharedServicePorts(
      'nginx-gateway',
      extractDockerPortBindings({
        NetworkSettings: { Ports: { '8000/tcp': [{ HostIp: '0.0.0.0', HostPort: '8000' }] } },
      }),
      expected
    );

    expect(ports).toContainEqual(expect.objectContaining({ host: 8000, hostAddress: '0.0.0.0', public: true, actual: true }));
  });

  it('keeps Docker-internal ports non-public', () => {
    const bindings = extractDockerPortBindings({
      NetworkSettings: { Ports: { '8080/tcp': null } },
    });
    const sharedDir = createSharedDir();
    const ports = resolveSharedServicePorts('meta', bindings, getExpectedSharedPorts({}, sharedDir));

    expect(ports).toContainEqual(expect.objectContaining({ container: 8080, public: false, actual: true }));
    expect(ports.find((port) => port.container === 8080)?.host).toBeUndefined();
  });

  it('preserves multiple bindings for the same container port', () => {
    const bindings = extractDockerPortBindings({
      NetworkSettings: {
        Ports: {
          '8000/tcp': [
            { HostIp: '127.0.0.1', HostPort: '8000' },
            { HostIp: '::1', HostPort: '8000' },
          ],
        },
      },
    });

    expect(bindings).toHaveLength(2);
    expect(bindings.map((binding) => binding.hostAddress)).toEqual(expect.arrayContaining(['127.0.0.1', '::1']));
  });

  it('reports expected gateway bindings that are missing at runtime', () => {
    const sharedDir = createSharedDir(`services:\n  nginx-gateway:\n    ports:\n      - "127.0.0.1:3666:3666/tcp"\n`);
    const expected = getExpectedSharedPorts({}, sharedDir);
    const ports = resolveSharedServicePorts('nginx-gateway', [], expected);

    expect(ports).toContainEqual(expect.objectContaining({ host: 3666, container: 3666, actual: false, public: false }));
  });
});
