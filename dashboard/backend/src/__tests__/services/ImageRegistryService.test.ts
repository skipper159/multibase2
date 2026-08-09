import { describe, expect, it } from 'vitest';
import {
  compareImageTags,
  isStableImageTag,
  parseImageReference,
  DockerRegistryClient,
  getImageUpdateDecision,
  resolveImageTargetTag,
} from '../../services/ImageRegistryService';

describe('ImageRegistryService', () => {
  it('parses tags, registry ports and digests safely', () => {
    expect(parseImageReference('registry.example:5000/team/studio:v1.2.3@sha256:abc')).toEqual({
      repository: 'registry.example:5000/team/studio',
      tag: 'v1.2.3',
      digest: 'sha256:abc',
    });
    expect(parseImageReference('supabase/studio')).toEqual({
      repository: 'supabase/studio',
      tag: 'latest',
      digest: null,
    });
  });

  it('accepts only stable release tags', () => {
    expect(isStableImageTag('v0.95.2')).toBe(true);
    expect(isStableImageTag('v0.96.0-rc.1')).toBe(false);
    expect(isStableImageTag('2026.01.31-arm64')).toBe(false);
    expect(isStableImageTag('latest')).toBe(false);
  });

  it('orders semantic and date-like image tags numerically', () => {
    expect(compareImageTags('v0.96.0', 'v0.95.2')).toBeGreaterThan(0);
    expect(compareImageTags('2026.02.01', '2026.01.31')).toBeGreaterThan(0);
  });

  it('uses only the explicitly approved matrix tag', () => {
    expect(resolveImageTargetTag('v2.1.0', 'v2.1.0', 'v2.2.0')).toBe('v2.1.0');
    expect(resolveImageTargetTag('v2.1.0', 'v2.2.0', 'v2.3.0')).toBe('v2.2.0');
    expect(resolveImageTargetTag('latest', 'v2.2.0', 'v2.3.0')).toBe('v2.2.0');
  });

  it('detects mutable-tag updates by digest and ignores identical images', () => {
    expect(getImageUpdateDecision('latest', 'latest', 'sha256:old', 'sha256:new')).toEqual({
      tagOutdated: false,
      digestOutdated: true,
      updateAvailable: true,
    });
    expect(getImageUpdateDecision('v2.2.0', 'v2.2.0', 'sha256:same', 'sha256:same').updateAvailable)
      .toBe(false);
  });

  it('reads the manifest digest and handles registry failures', async () => {
    const client = new DockerRegistryClient({
      fetchImpl: async () =>
        new Response('', {
          status: 200,
          headers: { 'docker-content-digest': 'sha256:approved' },
        }),
    });
    await expect(client.getManifestDigest('supabase/studio', 'latest')).resolves.toBe('sha256:approved');

    const failingClient = new DockerRegistryClient({
      fetchImpl: async () => new Response('', { status: 503 }),
    });
    await expect(failingClient.getManifestDigest('supabase/studio', 'latest')).rejects.toThrow('503');
  });
});
