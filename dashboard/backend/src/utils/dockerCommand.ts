import { execFile, spawn } from 'child_process';
import { resolveDockerConnectionConfig } from '../services/DockerManager';

export interface DockerCommandOptions {
  cwd?: string;
  timeout?: number;
  maxBuffer?: number;
  env?: NodeJS.ProcessEnv;
}

export interface DockerCommandResult {
  stdout: string;
  stderr: string;
}

function validateArguments(args: string[]): void {
  if (args.some(arg => typeof arg !== 'string' || arg.includes('\0'))) {
    throw new Error('Docker command arguments must be strings without NUL bytes');
  }
}

/** Build a Docker CLI environment that can only target the configured direct socket. */
export function getDockerCliEnvironment(
  baseEnv: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv {
  const connection = resolveDockerConnectionConfig(baseEnv, platform);
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    DOCKER_ACCESS_MODE: 'socket',
    DOCKER_SOCKET_PATH: connection.socketPath,
  };

  // The Docker CLI does not understand DOCKER_SOCKET_PATH itself. Set its
  // standard endpoint variable to a direct local endpoint, never to TCP.
  env.DOCKER_HOST =
    platform === 'win32' ? `npipe://${connection.socketPath}` : `unix://${connection.socketPath}`;
  return env;
}

export function runDockerCommand(
  args: string[],
  options: DockerCommandOptions = {}
): Promise<DockerCommandResult> {
  validateArguments(args);

  return new Promise((resolve, reject) => {
    execFile(
      'docker',
      args,
      {
        cwd: options.cwd,
        timeout: options.timeout,
        maxBuffer: options.maxBuffer,
        windowsHide: true,
        encoding: 'utf8',
        env: getDockerCliEnvironment(options.env),
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

export function runDockerCommandWithInput(
  args: string[],
  input: string | Buffer,
  options: DockerCommandOptions = {}
): Promise<DockerCommandResult> {
  validateArguments(args);

  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, {
      cwd: options.cwd,
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: getDockerCliEnvironment(options.env),
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const maxBuffer = options.maxBuffer ?? 200 * 1024 * 1024;
    let outputBytes = 0;
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      child.kill();
      reject(error);
    };

    const collect = (target: Buffer[], chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > maxBuffer) {
        fail(new Error(`Docker command output exceeded ${maxBuffer} bytes`));
        return;
      }
      target.push(chunk);
    };

    child.stdout.on('data', (chunk: Buffer) => collect(stdoutChunks, chunk));
    child.stderr.on('data', (chunk: Buffer) => collect(stderrChunks, chunk));
    child.on('error', fail);
    child.on('close', code => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `docker exited with code ${code}`));
        return;
      }
      resolve({ stdout, stderr });
    });

    if (options.timeout) {
      timeout = setTimeout(
        () => fail(new Error(`Docker command timed out after ${options.timeout}ms`)),
        options.timeout
      );
    }

    child.stdin.on('error', fail);
    child.stdin.end(input);
  });
}
