import type { AuthConfig, AuthError, Plugin, PluginServices, Policy, RequestContext, SessionLayer, SessionRecord, User } from '@authia/contracts';
import { describe, expect, it, vi } from 'vitest';

import { createAuthKernel } from './auth-kernel.js';
import { createRollbackSignal } from './rollback-signal.js';

describe('createAuthKernel', () => {
  it('dispatches plugin-owned actions', async () => {
    const deps = createDeps();
    const pluginExecute = vi.fn(async () => ({ kind: 'denied' as const, code: 'INVALID_INPUT' as const }));
    const plugin: Plugin = {
      id: 'email-password',
      actions: () => ['signInWithPassword'],
      validateConfig: () => ({ ok: true }),
      execute: pluginExecute
    };
    const kernel = createAuthKernel(deps);
    kernel.registerPlugin(plugin);

    const result = await kernel.handle(createContext({ action: 'signInWithPassword' }));

    expect(pluginExecute).toHaveBeenCalledOnce();
    expect(result).toEqual({ kind: 'denied', code: 'INVALID_INPUT' });
  });

  it('hydrates context.session for authenticated getSession before policy evaluation', async () => {
    const deps = createDeps();
    const kernel = createAuthKernel(deps);
    const policyEvaluate = vi.fn(async () => ({ kind: 'allow' as const }));
    kernel.registerPolicy({
      capabilities: { mayRedirect: false },
      evaluate: policyEvaluate
    });

    const result = await kernel.handle(createContext({ action: 'getSession' }));

    expect(policyEvaluate).toHaveBeenCalledWith(expect.objectContaining({ session: createAuthenticatedSession() }));
    expect(result).toEqual({
      kind: 'success',
      action: 'getSession',
      subject: createUser(),
      session: createSession()
    });
  });

  it('bypasses app policies for idempotent logout when credential is revoked/expired', async () => {
    const revokedValidate: SessionLayer['validateSession'] = async () => ({
      kind: 'unauthenticated',
      code: 'SESSION_REVOKED'
    });
    const deps = createDeps({
      validateSession: revokedValidate
    });
    const kernel = createAuthKernel(deps);
    const appPolicy = vi.fn(async () => ({ kind: 'deny' as const, code: 'POLICY_DENIED' as const }));
    kernel.registerPolicy({
      capabilities: { mayRedirect: false },
      evaluate: appPolicy
    });

    const result = await kernel.handle(createContext({ action: 'logout' }));

    expect(appPolicy).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      kind: 'success',
      action: 'logout',
      responseMutations: { clearCookies: expect.any(Array) }
    });
  });

  it('denies when a policy denies', async () => {
    const deps = createDeps();
    const kernel = createAuthKernel(deps);
    kernel.registerPolicy({
      capabilities: { mayRedirect: false },
      evaluate: async () => ({ kind: 'deny', code: 'POLICY_DENIED' })
    });

    const result = await kernel.handle(createContext({ action: 'getSession' }));

    expect(result).toEqual({ kind: 'denied', code: 'POLICY_DENIED' });
  });

  it('returns POLICY_FAILURE when policy throws', async () => {
    const deps = createDeps();
    const kernel = createAuthKernel(deps);
    kernel.registerPolicy({
      capabilities: { mayRedirect: false },
      evaluate: async () => {
        throw new Error('boom');
      }
    });

    const result = await kernel.handle(createContext({ action: 'getSession' }));

    expect(result).toEqual({
      category: 'infrastructure',
      code: 'POLICY_FAILURE',
      message: 'Policy evaluation failed.',
      retryable: false
    });
  });

  it('supports redirects when runtime adapter can redirect', async () => {
    const deps = createDeps();
    const kernel = createAuthKernel({ ...deps, runtimeCapabilities: { redirects: true } });
    const redirectPolicy: Policy = {
      capabilities: { mayRedirect: true },
      evaluate: async () => ({ kind: 'redirect', location: '/signin' })
    };
    kernel.registerPolicy(redirectPolicy);

    const result = await kernel.handle(createContext({ action: 'getSession' }));

    expect(result).toEqual({
      kind: 'redirect',
      responseMutations: { redirectTo: '/signin' }
    });
  });

  it('returns RUNTIME_MISCONFIGURED when redirect policy is used without redirect support', async () => {
    const deps = createDeps();
    const kernel = createAuthKernel({ ...deps, runtimeCapabilities: { redirects: false } });
    kernel.registerPolicy({
      capabilities: { mayRedirect: true },
      evaluate: async () => ({ kind: 'redirect', location: '/signin' })
    });

    const result = await kernel.handle(createContext({ action: 'getSession' }));

    expect(result).toEqual({
      category: 'infrastructure',
      code: 'RUNTIME_MISCONFIGURED',
      message: 'Redirect policy requires a runtime adapter with redirect capability.',
      retryable: false
    });
  });

  it('converts rollback signals to auth outcomes', async () => {
    const rollbackOutcome = { kind: 'denied' as const, code: 'INVALID_INPUT' as const };
    const deps = createDeps({
      beginTransaction: vi.fn(async () => {
        throw createRollbackSignal(rollbackOutcome);
      })
    });
    const kernel = createAuthKernel(deps);

    const result = await kernel.handle(createContext({ action: 'refreshSession' }));

    expect(result).toEqual(rollbackOutcome);
  });
});

function createDeps(overrides?: {
  validateSession?: SessionLayer['validateSession'];
  beginTransaction?: PluginServices['storage']['beginTransaction'];
}): {
  config: AuthConfig;
  services: PluginServices;
  sessionLayer: SessionLayer;
  runtimeCapabilities: { redirects: boolean };
} {
  const user = createUser();
  const session = createSession();
  const authenticated = createAuthenticatedSession();
  const validateSession =
    overrides?.validateSession ??
    vi.fn(async () => ({
      kind: 'authenticated' as const,
      value: authenticated
    }));
  const beginTransaction =
    overrides?.beginTransaction ??
    vi.fn(async (run: Parameters<PluginServices['storage']['beginTransaction']>[0]) => run(createTxStorage()));
  const services = {
    storage: {
      migrations: {},
      users: {},
      identities: {},
      sessions: {},
      beginTransaction
    },
    crypto: {
      hashSecret: vi.fn(),
      verifySecret: vi.fn(),
      generateOpaqueToken: vi.fn(),
      deriveTokenId: vi.fn(),
      deriveTokenVerifier: vi.fn(),
      verifyOpaqueToken: vi.fn()
    },
    sessions: {
      issueSession: vi.fn(),
      validateSession,
      refreshSession: vi.fn(async () => ({ session, transport: { kind: 'cookie' as const, token: 'next' } })),
      revokeSession: vi.fn(async () => undefined),
      revokeAllSessions: vi.fn(async () => 1)
    }
  } as unknown as PluginServices;

  return {
    config: createConfig(),
    services,
    sessionLayer: services.sessions,
    runtimeCapabilities: { redirects: false }
  };
}

function createTxStorage() {
  return {
    migrations: {},
    users: {},
    identities: {},
    sessions: {}
  } as any;
}

function createConfig(): AuthConfig {
  return {
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
}

function createUser(): User {
  return {
    id: 'user-1',
    createdAt: '2025-01-01T00:00:00.000Z'
  };
}

function createSession(): SessionRecord {
  return {
    id: 'session-1',
    userId: 'user-1',
    currentTokenId: 'token-id',
    currentTokenVerifier: 'token-verifier',
    expiresAt: '2025-02-01T00:00:00.000Z',
    idleExpiresAt: '2025-01-02T00:00:00.000Z',
    lastRotatedAt: '2025-01-01T00:00:00.000Z',
    revokedAt: null
  };
}

function createAuthenticatedSession() {
  return {
    user: createUser(),
    session: createSession()
  };
}

function createContext(partial?: Partial<RequestContext>): RequestContext {
  return {
    action: 'getSession',
    runtime: 'node',
    method: 'GET',
    url: 'https://example.com/auth/session',
    transport: 'cookie',
    headers: { origin: 'https://example.com' },
    cookies: {},
    credential: { kind: 'cookie', token: 'opaque-token' },
    ...partial
  };
}
