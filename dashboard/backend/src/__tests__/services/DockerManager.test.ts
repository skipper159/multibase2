import { describe, expect, it } from 'vitest';
import { resolveDockerConnectionConfig } from '../../services/DockerManager';

describe('resolveDockerConnectionConfig', () => {
  it('uses the Linux Unix socket by default', () => {
    expect(resolveDockerConnectionConfig({}, 'linux')).toEqual({
      accessMode: 'socket',
      socketPath: '/var/run/docker.sock',
    });
  });

  it('uses the Docker Desktop named pipe by default on Windows', () => {
    expect(resolveDockerConnectionConfig({}, 'win32')).toEqual({
      accessMode: 'socket',
      socketPath: '//./pipe/docker_engine',
    });
  });

  it('accepts an explicit direct socket path', () => {
    expect(
      resolveDockerConnectionConfig(
        { DOCKER_ACCESS_MODE: 'socket', DOCKER_SOCKET_PATH: '/run/user/1000/docker.sock' },
        'linux'
      )
    ).toEqual({ accessMode: 'socket', socketPath: '/run/user/1000/docker.sock' });
  });

  it('keeps direct unix and npipe DOCKER_HOST values backward compatible', () => {
    expect(
      resolveDockerConnectionConfig({ DOCKER_HOST: 'unix:///var/run/docker.sock' }, 'linux')
        .socketPath
    ).toBe('/var/run/docker.sock');
    expect(
      resolveDockerConnectionConfig({ DOCKER_HOST: 'npipe:////./pipe/docker_engine' }, 'win32')
        .socketPath
    ).toBe('//./pipe/docker_engine');
  });

  it('rejects TCP Docker endpoints', () => {
    expect(() =>
      resolveDockerConnectionConfig({ DOCKER_HOST: 'tcp://127.0.0.1:2378' }, 'linux')
    ).toThrow(/TCP Docker endpoints are disabled/);
  });

  it('rejects unsupported access modes and conflicting direct endpoints', () => {
    expect(() => resolveDockerConnectionConfig({ DOCKER_ACCESS_MODE: 'proxy' }, 'linux')).toThrow(
      /only supports direct socket access/
    );
    expect(() =>
      resolveDockerConnectionConfig(
        {
          DOCKER_SOCKET_PATH: '/var/run/docker.sock',
          DOCKER_HOST: 'unix:///run/user/1000/docker.sock',
        },
        'linux'
      )
    ).toThrow(/conflicts/);
  });
});
