import fs from 'fs';
import path from 'path';

/**
 * Return the complete Compose project definition for the shared stack.
 *
 * Tenant gateway ports are maintained in the optional override file. Every
 * Compose operation must use this same list so that `up`, `down`, `config`,
 * and image updates target the identical project definition.
 */
export function getSharedComposeArgs(sharedDir: string): string[] {
  const args = ['-f', 'docker-compose.shared.yml'];
  if (fs.existsSync(path.join(sharedDir, 'docker-compose.override.yml'))) {
    args.push('-f', 'docker-compose.override.yml');
  }
  args.push('--env-file', '.env.shared');
  return args;
}
