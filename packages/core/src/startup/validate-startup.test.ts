import type { AuthConfig } from '@authia/contracts';
import { describe, expect, it } from 'vitest';

import { validateStartupConfig } from './validate-startup.js';

describe('validateStartupConfig', () => {
  const pluginActions = ['signUpWithPassword', 'signInWithPassword'] as const;
  const oauthActions = ['startOAuth', 'finishOAuth'] as const;
  const baseConfig: AuthConfig = {
    sessionCookieName: 'auth_session',
    cookieOptions: {
      path: '/',
      secure: true,
      sameSite: 'lax',
      httpOnly: true
    },
    publicOrigin: 'https://example.com',
    trustedForwardedHeaders: [],
    sessionTransportMode: 'both',
    entrypointMethods: {
      signUpWithPassword: 'POST',
      signInWithPassword: 'POST',
      getSession: 'GET',
      refreshSession: 'POST',
      logout: 'POST',
      logoutAll: 'POST'
    },
    entrypointPaths: {
      signUpWithPassword: '/auth/signup',
      signInWithPassword: '/auth/signin',
      getSession: '/auth/session',
      refreshSession: '/auth/refresh',
      logout: '/auth/logout',
      logoutAll: '/auth/logout-all'
    },
    entrypointTransport: {
      signUpWithPassword: 'cookie',
      signInWithPassword: 'cookie',
      getSession: 'cookie',
      refreshSession: 'cookie',
      logout: 'cookie',
      logoutAll: 'cookie'
    },
    policies: [],
    runtimeAdapter: 'node',
    storageAdapter: 'postgres',
    cryptoProvider: 'default',
    plugins: []
  };

  it('rejects plugin attempts to own built-in actions', () => {
    const result = validateStartupConfig(baseConfig, ['getSession', ...pluginActions]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('built-in');
    }
  });

  it('rejects any supported action that has no owner', () => {
    const result = validateStartupConfig(baseConfig, ['signUpWithPassword']);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('Missing action owner');
      expect(result.message).toContain('signInWithPassword');
    }
  });

  it('rejects duplicate route pairs', () => {
    const config: AuthConfig = {
      ...baseConfig,
      entrypointMethods: {
        ...baseConfig.entrypointMethods,
        refreshSession: 'GET' as any
      },
      entrypointPaths: {
        ...baseConfig.entrypointPaths,
        refreshSession: '/auth/session'
      }
    };

    const result = validateStartupConfig(config, [...pluginActions]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('unique');
    }
  });

  it('rejects transport mode mismatch when mode is fixed', () => {
    const config: AuthConfig = {
      ...baseConfig,
      sessionTransportMode: 'cookie',
      entrypointTransport: {
        ...baseConfig.entrypointTransport,
        getSession: 'bearer'
      }
    };

    const result = validateStartupConfig(config, [...pluginActions]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('transport');
    }
  });

  it('rejects redirect policies when runtime has no redirect support', () => {
    const config: AuthConfig = {
      ...baseConfig,
      policies: [
        {
          capabilities: { mayRedirect: true },
          evaluate: async () => ({ kind: 'allow' })
        }
      ]
    };

    const result = validateStartupConfig(config, [...pluginActions], { redirects: false });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('Redirect');
    }
  });

  it('validates session cookie invariants', () => {
    const noName = validateStartupConfig({ ...baseConfig, sessionCookieName: '' }, [...pluginActions]);
    const noPath = validateStartupConfig(
      {
        ...baseConfig,
        cookieOptions: {
          ...baseConfig.cookieOptions,
          path: ''
        }
      },
      [...pluginActions]
    );

    expect(noName.ok).toBe(false);
    expect(noPath.ok).toBe(false);
  });

  it('rejects partial OAuth action route configuration', () => {
    const result = validateStartupConfig(
      {
        ...baseConfig,
        entrypointMethods: {
          ...baseConfig.entrypointMethods,
          startOAuth: 'POST'
        }
      } as any,
      [...pluginActions]
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('startOAuth');
    }
  });

  it('passes for valid configuration and complete ownership', () => {
    const result = validateStartupConfig(baseConfig, [...pluginActions], { redirects: false });

    expect(result.ok).toBe(true);
  });

  it('rejects configured OAuth actions when oauthProviders are missing', () => {
    const result = validateStartupConfig(
      createOAuthConfiguredConfig(baseConfig),
      [...pluginActions, ...oauthActions] as any,
      { redirects: true }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('oauthProviders');
    }
  });

  it('rejects oauth provider config when required provider fields are missing', () => {
    const result = validateStartupConfig(
      createOAuthConfiguredConfig(baseConfig, {
        oauthProviders: {
          github: {
            clientId: '',
            authorizationEndpoint: 'https://github.com/login/oauth/authorize',
            tokenEndpoint: 'https://github.com/login/oauth/access_token',
            callbackPath: '/auth/oauth/callback',
            pkceMethod: 'S256'
          }
        }
      }),
      [...pluginActions, ...oauthActions] as any,
      { redirects: true }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('missing required');
    }
  });

  it('rejects oauth provider config when PKCE method is not S256', () => {
    const result = validateStartupConfig(
      createOAuthConfiguredConfig(baseConfig, {
        oauthProviders: {
          github: {
            clientId: 'client-id',
            authorizationEndpoint: 'https://github.com/login/oauth/authorize',
            tokenEndpoint: 'https://github.com/login/oauth/access_token',
            callbackPath: '/auth/oauth/callback',
            pkceMethod: 'plain'
          }
        }
      }),
      [...pluginActions, ...oauthActions] as any,
      { redirects: true }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('S256');
    }
  });

  it('rejects configured OAuth actions when runtime lacks redirect capability', () => {
    const result = validateStartupConfig(
      createOAuthConfiguredConfig(baseConfig, {
        oauthProviders: {
          github: {
            clientId: 'client-id',
            authorizationEndpoint: 'https://github.com/login/oauth/authorize',
            tokenEndpoint: 'https://github.com/login/oauth/access_token',
            callbackPath: '/auth/oauth/callback',
            pkceMethod: 'S256'
          }
        }
      }),
      [...pluginActions, ...oauthActions] as any,
      { redirects: false }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('redirect');
    }
  });
});

function createOAuthConfiguredConfig(baseConfig: AuthConfig, overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    ...baseConfig,
    entrypointMethods: {
      ...baseConfig.entrypointMethods,
      startOAuth: 'POST',
      finishOAuth: 'POST'
    },
    entrypointPaths: {
      ...baseConfig.entrypointPaths,
      startOAuth: '/auth/oauth/start',
      finishOAuth: '/auth/oauth/finish'
    },
    entrypointTransport: {
      ...baseConfig.entrypointTransport,
      startOAuth: 'bearer',
      finishOAuth: 'bearer'
    },
    ...overrides
  };
}
