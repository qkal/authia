import type { AuthConfig } from '@authia/contracts';
import { describe, expect, it } from 'vitest';

import { applyResult } from './apply-result.js';
import { createBunRuntimeAdapter } from './bun-runtime-adapter.js';

describe('createBunRuntimeAdapter', () => {
  it('returns notHandled when method/path do not match any configured route', async () => {
    const adapter = createBunRuntimeAdapter(createConfig());

    const result = await adapter.parseRequest({
      method: 'GET',
      url: 'https://example.com/unknown',
      headers: {},
      cookies: {}
    });

    expect(result).toEqual({ kind: 'notHandled' });
  });

  it('rejects duplicate sensitive headers', async () => {
    const adapter = createBunRuntimeAdapter(createConfig());

    const result = await adapter.parseRequest({
      method: 'POST',
      url: 'https://example.com/auth/signin',
      headers: {
        authorization: ['Bearer a', 'Bearer b']
      },
      cookies: {}
    });

    expect(result).toEqual({ kind: 'denied', code: 'INVALID_INPUT' });
  });

  it('returns RUNTIME_MISCONFIGURED when only one trusted forwarded header is present', async () => {
    const adapter = createBunRuntimeAdapter(createConfig({ trustedForwardedHeaders: ['x-forwarded-host', 'x-forwarded-proto'] }));

    const result = await adapter.parseRequest({
      method: 'POST',
      url: 'https://example.com/auth/signin',
      headers: {
        'x-forwarded-host': 'example.com'
      },
      cookies: {}
    });

    expect(result).toMatchObject({ category: 'infrastructure', code: 'RUNTIME_MISCONFIGURED' });
  });

  it('rejects ambiguous credential sources', async () => {
    const adapter = createBunRuntimeAdapter(createConfig());

    const result = await adapter.parseRequest({
      method: 'POST',
      url: 'https://example.com/auth/signin',
      headers: {
        authorization: 'Bearer bearer-token'
      },
      cookies: {
        auth_session: 'cookie-token'
      }
    });

    expect(result).toEqual({ kind: 'denied', code: 'AMBIGUOUS_CREDENTIALS' });
  });

  it('rejects malformed authorization headers', async () => {
    const adapter = createBunRuntimeAdapter(createConfig());

    const result = await adapter.parseRequest({
      method: 'POST',
      url: 'https://example.com/auth/signin',
      headers: {
        authorization: 'Token abc'
      },
      cookies: {}
    });

    expect(result).toEqual({ kind: 'denied', code: 'INVALID_INPUT' });
  });

  it('rejects credential-kind mismatch with entrypoint transport', async () => {
    const adapter = createBunRuntimeAdapter(
      createConfig({
        entrypointTransport: {
          ...createConfig().entrypointTransport,
          signInWithPassword: 'cookie'
        }
      })
    );

    const result = await adapter.parseRequest({
      method: 'POST',
      url: 'https://example.com/auth/signin',
      headers: {
        authorization: 'Bearer bearer-token'
      },
      cookies: {}
    });

    expect(result).toEqual({ kind: 'denied', code: 'INVALID_INPUT' });
  });

  it('normalizes accepted headers to lowercase', async () => {
    const adapter = createBunRuntimeAdapter(createConfig());

    const result = await adapter.parseRequest({
      method: 'GET',
      url: 'https://example.com/auth/session',
      headers: {
        Origin: 'https://example.com',
        Referer: 'https://example.com/app',
        'X-Custom': 'x'
      },
      cookies: {}
    });

    if ('runtime' in result) {
      expect(result.headers.origin).toBe('https://example.com');
      expect(result.headers.referer).toBe('https://example.com/app');
      expect(result.headers['x-custom']).toBe('x');
      return;
    }
    throw new Error('Expected parseRequest to return RequestContext.');
  });

  it('rejects malformed JSON body payloads', async () => {
    const adapter = createBunRuntimeAdapter(createConfig());

    const result = await adapter.parseRequest({
      method: 'POST',
      url: 'https://example.com/auth/signin',
      headers: {},
      cookies: {},
      body: '{bad json'
    });

    expect(result).toEqual({ kind: 'denied', code: 'INVALID_INPUT' });
  });

  it('parses startOAuth body with provider and relative redirect', async () => {
    const adapter = createBunRuntimeAdapter(createOAuthConfig());

    const result = await adapter.parseRequest({
      method: 'POST',
      url: 'https://example.com/auth/oauth/start',
      headers: {},
      cookies: {},
      body: {
        provider: 'github',
        redirectTo: '/dashboard'
      }
    });

    if ('runtime' in result) {
      expect(result.action).toBe('startOAuth');
      expect(result.body).toEqual({
        provider: 'github',
        redirectTo: '/dashboard'
      });
      return;
    }
    throw new Error('Expected parseRequest to return RequestContext.');
  });

  it('parses finishOAuth body with provider code and state', async () => {
    const adapter = createBunRuntimeAdapter(createOAuthConfig());

    const result = await adapter.parseRequest({
      method: 'POST',
      url: 'https://example.com/auth/oauth/finish',
      headers: {},
      cookies: {},
      body: {
        provider: 'github',
        code: 'oauth-code',
        state: 'oauth-state'
      }
    });

    if ('runtime' in result) {
      expect(result.action).toBe('finishOAuth');
      expect(result.body).toEqual({
        provider: 'github',
        code: 'oauth-code',
        state: 'oauth-state'
      });
      return;
    }
    throw new Error('Expected parseRequest to return RequestContext.');
  });

  it('rejects malformed finishOAuth payload fields', async () => {
    const adapter = createBunRuntimeAdapter(createOAuthConfig());

    const result = await adapter.parseRequest({
      method: 'POST',
      url: 'https://example.com/auth/oauth/finish',
      headers: {},
      cookies: {},
      body: {
        provider: 'github',
        code: '',
        state: 'oauth-state'
      }
    });

    expect(result).toEqual({ kind: 'denied', code: 'INVALID_INPUT' });
  });

  it('rejects invalid startOAuth redirectTo values', async () => {
    const adapter = createBunRuntimeAdapter(createOAuthConfig());

    const result = await adapter.parseRequest({
      method: 'POST',
      url: 'https://example.com/auth/oauth/start',
      headers: {},
      cookies: {},
      body: {
        provider: 'github',
        redirectTo: 'https://evil.example'
      }
    });

    expect(result).toEqual({ kind: 'denied', code: 'INVALID_INPUT' });
  });

  it('maps result objects into runtime responses', async () => {
    const success = await applyResult({
      kind: 'success',
      action: 'getSession',
      subject: { id: 'u1', createdAt: '2025-01-01T00:00:00.000Z' },
      session: {
        id: 's1',
        userId: 'u1',
        currentTokenId: 't1',
        currentTokenVerifier: 'v1',
        lastRotatedAt: '2025-01-01T00:00:00.000Z',
        expiresAt: '2025-02-01T00:00:00.000Z',
        idleExpiresAt: '2025-01-02T00:00:00.000Z'
      }
    });
    const redirectUnsupported = await applyResult(
      {
        kind: 'redirect',
        responseMutations: { redirectTo: '/signin' }
      },
      { redirects: false }
    );

    expect(success).toMatchObject({ status: 200 });
    expect(redirectUnsupported).toMatchObject({ category: 'infrastructure', code: 'RUNTIME_MISCONFIGURED' });
  });
});

function createConfig(overrides?: Partial<AuthConfig>): AuthConfig {
  const config: AuthConfig = {
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
      signInWithPassword: 'bearer',
      getSession: 'cookie',
      refreshSession: 'cookie',
      logout: 'cookie',
      logoutAll: 'cookie'
    },
    policies: [],
    runtimeAdapter: 'node',
    storageAdapter: 'postgres',
    cryptoProvider: 'default',
    plugins: ['emailPassword'],
    publicOrigin: 'https://example.com',
    trustedForwardedHeaders: [],
    cookieOptions: {
      secure: true,
      sameSite: 'lax',
      path: '/',
      httpOnly: true
    },
    sessionCookieName: 'auth_session'
  };

  return { ...config, ...overrides };
}

function createOAuthConfig(): AuthConfig {
  const config = createConfig();
  return {
    ...config,
    plugins: ['emailPassword', 'oauth'],
    entrypointMethods: {
      ...config.entrypointMethods,
      startOAuth: 'POST',
      finishOAuth: 'POST'
    },
    entrypointPaths: {
      ...config.entrypointPaths,
      startOAuth: '/auth/oauth/start',
      finishOAuth: '/auth/oauth/finish'
    },
    entrypointTransport: {
      ...config.entrypointTransport,
      startOAuth: 'cookie',
      finishOAuth: 'cookie'
    }
  };
}

