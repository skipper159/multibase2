import { describe, expect, it } from 'vitest';
import {
  authForceRecreateArgs,
  authProviderEnvironmentKeys,
  authServiceName,
  mergeAuthProviderOverride,
} from '../../utils/authCompose';

describe('auth compose provider passthrough', () => {
  it('selects Auth and limits passthrough to OAuth provider values', () => {
    expect(authServiceName({ services: { auth: {} } })).toBe('auth');
    expect(
      authProviderEnvironmentKeys({
        GOTRUE_EXTERNAL_GOOGLE_ENABLED: 'true',
        GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID: 'client',
        GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true',
        SITE_URL: 'https://example.com',
      })
    ).toEqual(['GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID', 'GOTRUE_EXTERNAL_GOOGLE_ENABLED']);
  });

  it('recreates only the selected Auth service', () => {
    expect(authForceRecreateArgs('auth')).toEqual([
      'compose',
      'up',
      '-d',
      '--no-deps',
      '--force-recreate',
      'auth',
    ]);
  });

  it('adds provider references without removing an existing override', () => {
    const updated = mergeAuthProviderOverride(
      { services: { auth: { environment: { EXISTING_SETTING: 'kept' } } } },
      'auth',
      ['GOTRUE_EXTERNAL_GOOGLE_ENABLED', 'GOTRUE_EXTERNAL_GOOGLE_SECRET']
    );
    expect(updated.services?.auth?.environment).toEqual({
      EXISTING_SETTING: 'kept',
      GOTRUE_EXTERNAL_GOOGLE_ENABLED: '${GOTRUE_EXTERNAL_GOOGLE_ENABLED}',
      GOTRUE_EXTERNAL_GOOGLE_SECRET: '${GOTRUE_EXTERNAL_GOOGLE_SECRET}',
    });
  });
});
