import type {
  AuthConfig,
  AuthError,
  PluginServices,
  RequestContext,
  SessionRecord,
  TransactionalStorage,
  User
} from '@authia/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createOAuthPlugin } from './plugin.js';

describe('createOAuthPlugin', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a provider redirect and persists one-time state from startOAuth', async () => {
    const plugin = createConfiguredPlugin();
    const services = createPluginServices();

    services.crypto.generateOpaqueToken.mockResolvedValueOnce('state-token').mockResolvedValueOnce('pkce-verifier');
    services.crypto.deriveTokenVerifier.mockResolvedValue('pkce-challenge');
    services.crypto.deriveTokenId.mockImplementation(async (value: string) =>
      value === 'state-token' ? 'state-hash' : 'redirect-hash'
    );
    services.oauthStateStore.create.mockResolvedValue({
      id: 'state-1',
      provider: 'github',
      stateHash: 'state-hash',
      codeVerifierCiphertext: 'pkce-verifier',
      redirectUriHash: 'redirect-hash',
      expiresAt: '2025-01-01T00:05:00.000Z',
      consumedAt: null
    });
    services.oauthProviderClient.buildAuthorizationUrl.mockReturnValue('https://provider.example.com/authorize');

    const result = await plugin.execute(
      'startOAuth',
      createContext({
        action: 'startOAuth',
        body: { provider: 'github', redirectTo: '/dashboard' }
      }),
      services as unknown as PluginServices
    );

    expect(result).toEqual({
      kind: 'redirect',
      responseMutations: {
        redirectTo: 'https://provider.example.com/authorize'
      }
    });
    expect(services.oauthStateStore.create).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'github',
        stateHash: 'state-hash',
        codeVerifierCiphertext: 'pkce-verifier',
        redirectUriHash: 'redirect-hash'
      })
    );
  });

  it('issues a session for finishOAuth when provider exchange and identity resolution succeed', async () => {
    const plugin = createConfiguredPlugin();
    const services = createPluginServices();
    const user = createUser();
    const session = createSession({ userId: user.id });

    services.crypto.deriveTokenId.mockResolvedValue('state-hash');
    services.oauthStateStore.consume.mockResolvedValue({
      codeVerifierCiphertext: 'pkce-verifier',
      redirectUriHash: 'redirect-hash'
    });
    services.oauthProviderClient.exchangeCode.mockResolvedValue({ providerSubject: 'provider-subject-1' });

    const tx = services.tx;
    tx.oauthIdentities.findByProviderSubject.mockResolvedValue({
      id: 'oauth-identity-1',
      userId: user.id,
      provider: 'github',
      providerSubject: 'provider-subject-1'
    });
    tx.users.find.mockResolvedValue(user);
    services.sessions.issueSession.mockResolvedValue({
      session,
      transport: { kind: 'cookie', token: 'session-token' }
    });

    const result = await plugin.execute(
      'finishOAuth',
      createContext({
        action: 'finishOAuth',
        body: {
          provider: 'github',
          code: 'oauth-code',
          state: 'state-token'
        }
      }),
      services as unknown as PluginServices
    );

    expect(result).toEqual({
      kind: 'success',
      action: 'finishOAuth',
      subject: user,
      session,
      transport: { kind: 'cookie', token: 'session-token' }
    });
  });

  it('denies finishOAuth when state is replayed or expired', async () => {
    const plugin = createConfiguredPlugin();
    const services = createPluginServices();

    services.crypto.deriveTokenId.mockResolvedValue('state-hash');
    services.oauthStateStore.consume.mockResolvedValue(null);

    const result = await plugin.execute(
      'finishOAuth',
      createContext({
        action: 'finishOAuth',
        body: {
          provider: 'github',
          code: 'oauth-code',
          state: 'already-used'
        }
      }),
      services as unknown as PluginServices
    );

    expect(result).toEqual({ kind: 'denied', code: 'INVALID_INPUT' });
  });

  it('denies finishOAuth when the callback state does not match provider context', async () => {
    const plugin = createConfiguredPlugin();
    const services = createPluginServices();

    services.crypto.deriveTokenId.mockResolvedValue('state-hash');
    services.oauthStateStore.consume.mockResolvedValue(null);

    const result = await plugin.execute(
      'finishOAuth',
      createContext({
        action: 'finishOAuth',
        body: {
          provider: 'google',
          code: 'oauth-code',
          state: 'state-token'
        }
      }),
      services as unknown as PluginServices
    );

    expect(result).toEqual({ kind: 'denied', code: 'INVALID_INPUT' });
    expect(services.oauthStateStore.consume).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'google' })
    );
  });

  it('maps provider rejection to unauthenticated INVALID_CREDENTIALS', async () => {
    const plugin = createConfiguredPlugin();
    const services = createPluginServices();

    services.crypto.deriveTokenId.mockResolvedValue('state-hash');
    services.oauthStateStore.consume.mockResolvedValue({
      codeVerifierCiphertext: 'pkce-verifier',
      redirectUriHash: 'redirect-hash'
    });
    services.oauthProviderClient.exchangeCode.mockResolvedValue({
      category: 'operator',
      code: 'CRYPTO_FAILURE',
      message: 'invalid_grant',
      retryable: false
    } satisfies AuthError);

    const result = await plugin.execute(
      'finishOAuth',
      createContext({
        action: 'finishOAuth',
        body: { provider: 'github', code: 'bad-code', state: 'state-token' }
      }),
      services as unknown as PluginServices
    );

    expect(result).toEqual({ kind: 'unauthenticated', code: 'INVALID_CREDENTIALS' });
  });

  it('maps provider transport failures to STORAGE_UNAVAILABLE', async () => {
    const plugin = createConfiguredPlugin();
    const services = createPluginServices();

    services.crypto.deriveTokenId.mockResolvedValue('state-hash');
    services.oauthStateStore.consume.mockResolvedValue({
      codeVerifierCiphertext: 'pkce-verifier',
      redirectUriHash: 'redirect-hash'
    });
    services.oauthProviderClient.exchangeCode.mockResolvedValue({
      category: 'infrastructure',
      code: 'STORAGE_UNAVAILABLE',
      message: 'oauth provider timeout',
      retryable: true
    } satisfies AuthError);

    const result = await plugin.execute(
      'finishOAuth',
      createContext({
        action: 'finishOAuth',
        body: { provider: 'github', code: 'oauth-code', state: 'state-token' }
      }),
      services as unknown as PluginServices
    );

    expect(result).toEqual({
      category: 'infrastructure',
      code: 'STORAGE_UNAVAILABLE',
      message: 'oauth provider timeout',
      retryable: false
    });
  });

  it('denies unknown providers and invalid redirectTo', async () => {
    const plugin = createConfiguredPlugin();
    const services = createPluginServices();

    const unknownProvider = await plugin.execute(
      'startOAuth',
      createContext({ action: 'startOAuth', body: { provider: 'unknown' } }),
      services as unknown as PluginServices
    );

    const invalidRedirect = await plugin.execute(
      'startOAuth',
      createContext({ action: 'startOAuth', body: { provider: 'github', redirectTo: 'https://evil.example.com' } }),
      services as unknown as PluginServices
    );

    expect(unknownProvider).toEqual({ kind: 'denied', code: 'INVALID_INPUT' });
    expect(invalidRedirect).toEqual({ kind: 'denied', code: 'INVALID_INPUT' });
  });

  it('maps oauth state store outages to STORAGE_UNAVAILABLE', async () => {
    const plugin = createConfiguredPlugin();
    const services = createPluginServices();

    services.crypto.generateOpaqueToken.mockResolvedValueOnce('state-token').mockResolvedValueOnce('pkce-verifier');
    services.crypto.deriveTokenVerifier.mockResolvedValue('pkce-challenge');
    services.crypto.deriveTokenId.mockResolvedValue('derived-hash');
    services.oauthStateStore.create.mockResolvedValue({
      category: 'infrastructure',
      code: 'STORAGE_UNAVAILABLE',
      message: 'database unavailable',
      retryable: true
    } satisfies AuthError);

    const startResult = await plugin.execute(
      'startOAuth',
      createContext({ action: 'startOAuth', body: { provider: 'github' } }),
      services as unknown as PluginServices
    );

    services.oauthStateStore.consume.mockResolvedValue({
      category: 'infrastructure',
      code: 'STORAGE_UNAVAILABLE',
      message: 'database unavailable',
      retryable: true
    } satisfies AuthError);

    const finishResult = await plugin.execute(
      'finishOAuth',
      createContext({
        action: 'finishOAuth',
        body: { provider: 'github', code: 'oauth-code', state: 'state-token' }
      }),
      services as unknown as PluginServices
    );

    expect(startResult).toEqual({
      category: 'infrastructure',
      code: 'STORAGE_UNAVAILABLE',
      message: 'database unavailable',
      retryable: false
    });
    expect(finishResult).toEqual({
      category: 'infrastructure',
      code: 'STORAGE_UNAVAILABLE',
      message: 'database unavailable',
      retryable: false
    });
  });

  it('retries identity lookup once after duplicate identity collision', async () => {
    const plugin = createConfiguredPlugin();
    const services = createPluginServices();
    const canonicalUser = createUser({ id: 'user-existing' });
    const session = createSession({ userId: canonicalUser.id });

    services.crypto.deriveTokenId.mockResolvedValue('state-hash');
    services.oauthStateStore.consume.mockResolvedValue({
      codeVerifierCiphertext: 'pkce-verifier',
      redirectUriHash: 'redirect-hash'
    });
    services.oauthProviderClient.exchangeCode.mockResolvedValue({ providerSubject: 'provider-subject-1' });

    const tx = services.tx;
    tx.oauthIdentities.findByProviderSubject
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'oauth-identity-existing',
        userId: canonicalUser.id,
        provider: 'github',
        providerSubject: 'provider-subject-1'
      });
    tx.users.create.mockResolvedValue(createUser({ id: 'user-new' }));
    tx.oauthIdentities.create.mockResolvedValue({
      category: 'operator',
      code: 'DUPLICATE_IDENTITY',
      message: 'duplicate provider subject',
      retryable: false
    } satisfies AuthError);
    tx.users.find.mockResolvedValue(canonicalUser);
    services.sessions.issueSession.mockResolvedValue({
      session,
      transport: { kind: 'cookie', token: 'session-token' }
    });

    const result = await plugin.execute(
      'finishOAuth',
      createContext({
        action: 'finishOAuth',
        body: { provider: 'github', code: 'oauth-code', state: 'state-token' }
      }),
      services as unknown as PluginServices
    );

    expect(result).toEqual({
      kind: 'success',
      action: 'finishOAuth',
      subject: canonicalUser,
      session,
      transport: { kind: 'cookie', token: 'session-token' }
    });
    expect(services.storage.beginTransaction).toHaveBeenCalledTimes(2);
    expect(tx.oauthIdentities.findByProviderSubject).toHaveBeenCalledTimes(2);
    expect(tx.users.create).toHaveBeenCalledTimes(1);
  });
});

function createConfig(overrides: Record<string, unknown> = {}): AuthConfig {
  return {
    sessionCookieName: 'authia_session',
    cookieOptions: {
      secure: true,
      sameSite: 'lax',
      path: '/',
      httpOnly: true
    },
    publicOrigin: 'https://app.example.com',
    trustedForwardedHeaders: [],
    sessionTransportMode: 'both',
    entrypointMethods: {
      signUpWithPassword: 'POST',
      signInWithPassword: 'POST',
      getSession: 'GET',
      refreshSession: 'POST',
      logout: 'POST',
      logoutAll: 'POST',
      startOAuth: 'POST',
      finishOAuth: 'POST'
    },
    entrypointPaths: {
      signUpWithPassword: '/auth/signup',
      signInWithPassword: '/auth/signin',
      getSession: '/auth/session',
      refreshSession: '/auth/refresh',
      logout: '/auth/logout',
      logoutAll: '/auth/logout-all',
      startOAuth: '/auth/oauth/start',
      finishOAuth: '/auth/oauth/callback'
    },
    entrypointTransport: {
      signUpWithPassword: 'cookie',
      signInWithPassword: 'cookie',
      getSession: 'cookie',
      refreshSession: 'cookie',
      logout: 'cookie',
      logoutAll: 'cookie',
      startOAuth: 'cookie',
      finishOAuth: 'cookie'
    },
    policies: [],
    runtimeAdapter: 'node',
    storageAdapter: 'postgres',
    cryptoProvider: 'default',
    plugins: ['emailPassword'],
    oauthProviders: {
      github: {
        clientId: 'github-client-id',
        clientSecret: 'github-client-secret',
        authorizationEndpoint: 'https://provider.example.com/oauth/authorize',
        tokenEndpoint: 'https://provider.example.com/oauth/token',
        callbackPath: '/auth/oauth/callback',
        pkceMethod: 'S256'
      },
      google: {
        clientId: 'google-client-id',
        clientSecret: 'google-client-secret',
        authorizationEndpoint: 'https://accounts.example.com/oauth/authorize',
        tokenEndpoint: 'https://accounts.example.com/oauth/token',
        callbackPath: '/auth/oauth/google/callback',
        pkceMethod: 'S256'
      }
    },
    ...overrides
  } as unknown as AuthConfig;
}

function createConfiguredPlugin(config: AuthConfig = createConfig()): ReturnType<typeof createOAuthPlugin> {
  const plugin = createOAuthPlugin();
  expect(plugin.validateConfig(config)).toEqual({ ok: true });
  return plugin;
}

function createContext(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    action: 'startOAuth',
    runtime: 'node',
    method: 'POST',
    url: 'https://app.example.com/auth',
    transport: 'cookie',
    headers: {},
    cookies: {},
    ...overrides
  };
}

function createUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    createdAt: '2025-01-01T00:00:00.000Z',
    ...overrides
  };
}

function createSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 'session-1',
    userId: 'user-1',
    currentTokenId: 'token-id',
    currentTokenVerifier: 'token-verifier',
    lastRotatedAt: '2025-01-01T00:00:00.000Z',
    expiresAt: '2025-02-01T00:00:00.000Z',
    idleExpiresAt: '2025-01-08T00:00:00.000Z',
    revokedAt: null,
    ...overrides
  };
}

function createPluginServices() {
  const tx = createTransactionalStorage();

  const storage = {
    migrations: { ensureCompatibleSchema: vi.fn() },
    users: {
      create: vi.fn(),
      find: vi.fn()
    },
    identities: {
      create: vi.fn(),
      findByNormalizedEmail: vi.fn(),
      listByUser: vi.fn()
    },
    sessions: {
      create: vi.fn(),
      findByCurrentTokenId: vi.fn(),
      update: vi.fn(),
      compareAndSwapToken: vi.fn(),
      revoke: vi.fn(),
      revokeAllForUser: vi.fn()
    },
    oauthStates: {
      create: vi.fn(),
      consume: vi.fn()
    },
    oauthIdentities: {
      create: vi.fn(),
      findByProviderSubject: vi.fn()
    },
    beginTransaction: vi.fn(async (run: (txArg: TransactionalStorage) => Promise<unknown>) =>
      run(tx as unknown as TransactionalStorage)
    )
  };

  const crypto = {
    hashSecret: vi.fn(),
    verifySecret: vi.fn(),
    generateOpaqueToken: vi.fn(),
    deriveTokenId: vi.fn(),
    deriveTokenVerifier: vi.fn(),
    verifyOpaqueToken: vi.fn()
  };

  const sessions = {
    issueSession: vi.fn(),
    validateSession: vi.fn(),
    refreshSession: vi.fn(),
    revokeSession: vi.fn(),
    revokeAllSessions: vi.fn()
  };

  const oauthStateStore = {
    create: vi.fn(),
    consume: vi.fn()
  };

  const oauthProviderClient = {
    buildAuthorizationUrl: vi.fn(),
    exchangeCode: vi.fn()
  };

  return {
    tx,
    storage,
    crypto,
    sessions,
    oauthStateStore,
    oauthProviderClient
  };
}

function createTransactionalStorage() {
  return {
    migrations: { ensureCompatibleSchema: vi.fn() },
    users: {
      create: vi.fn(),
      find: vi.fn()
    },
    identities: {
      create: vi.fn(),
      findByNormalizedEmail: vi.fn(),
      listByUser: vi.fn()
    },
    sessions: {
      create: vi.fn(),
      findByCurrentTokenId: vi.fn(),
      update: vi.fn(),
      compareAndSwapToken: vi.fn(),
      revoke: vi.fn(),
      revokeAllForUser: vi.fn()
    },
    oauthStates: {
      create: vi.fn(),
      consume: vi.fn()
    },
    oauthIdentities: {
      create: vi.fn(),
      findByProviderSubject: vi.fn()
    }
  };
}
