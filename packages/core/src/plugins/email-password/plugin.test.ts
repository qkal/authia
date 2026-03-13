import type { AuthConfig, AuthError, PluginServices, RequestContext, SessionRecord, TransactionalStorage, User } from '@authia/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createEmailPasswordPlugin } from './plugin.js';

describe('createEmailPasswordPlugin', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects configuration when either email/password entrypoint path is missing', () => {
    const plugin = createEmailPasswordPlugin();
    const config = createConfig({
      entrypointPaths: {
        ...createConfig().entrypointPaths,
        signInWithPassword: ''
      }
    });

    expect(plugin.validateConfig(config)).toEqual({
      ok: false,
      code: 'RUNTIME_MISCONFIGURED',
      message: 'Email/password entrypoint paths are required.'
    });
  });

  it.each([
    { body: { email: '', password: 'password123' } },
    { body: { email: 'missing-at.example.com', password: 'password123' } },
    { body: { email: 'too@@many@example.com', password: 'password123' } },
    { body: { email: 'user@example.com', password: 'short' } },
    { body: { email: 'user@example.com', password: 'a'.repeat(129) } }
  ])('denies sign-up when the input is invalid: %j', async ({ body }) => {
    const plugin = createEmailPasswordPlugin();
    const services = createPluginServices();

    const result = await plugin.execute(
      'signUpWithPassword',
      createContext({ body }),
      services as unknown as PluginServices
    );

    expect(result).toEqual({ kind: 'denied', code: 'INVALID_INPUT' });
    expect(services.storage.beginTransaction).not.toHaveBeenCalled();
  });

  it('creates the user, identity, and session inside a transaction on successful sign-up', async () => {
    const plugin = createEmailPasswordPlugin();
    const services = createPluginServices();
    const tx = services.tx;
    const user = createUser();
    const session = createSession();
    const context = createContext({
      transport: 'bearer',
      body: {
        email: ' Te\u0301st@Example.com ',
        password: 'password123'
      }
    });

    services.crypto.hashSecret.mockResolvedValue('password-hash');
    tx.users.create.mockResolvedValue(user);
    tx.identities.create.mockResolvedValue({
      id: 'identity-1',
      userId: user.id,
      normalizedEmail: 'tést@example.com',
      passwordHash: 'password-hash'
    });
    services.sessions.issueSession.mockResolvedValue({
      session,
      transport: { kind: 'bearer', token: 'issued-token' }
    });

    const result = await plugin.execute('signUpWithPassword', context, services as unknown as PluginServices);

    expect(services.storage.beginTransaction).toHaveBeenCalledOnce();
    expect(services.crypto.hashSecret).toHaveBeenCalledWith('password123');
    expect(tx.users.create).toHaveBeenCalledWith({});
    expect(tx.identities.create).toHaveBeenCalledWith({
      userId: user.id,
      normalizedEmail: 'tést@example.com',
      passwordHash: 'password-hash'
    });
    expect(services.sessions.issueSession).toHaveBeenCalledWith(user, tx as unknown as TransactionalStorage, context);
    expect(result).toEqual({
      kind: 'success',
      action: 'signUpWithPassword',
      subject: user,
      session,
      transport: { kind: 'bearer', token: 'issued-token' }
    });
  });

  it('maps duplicate identities to denied DUPLICATE_IDENTITY through rollback flow', async () => {
    const plugin = createEmailPasswordPlugin();
    const services = createPluginServices();
    const tx = services.tx;

    services.crypto.hashSecret.mockResolvedValue('password-hash');
    tx.users.create.mockResolvedValue(createUser());
    tx.identities.create.mockResolvedValue({
      category: 'operator',
      code: 'DUPLICATE_IDENTITY',
      message: 'duplicate',
      retryable: false
    } satisfies AuthError);

    const result = await plugin.execute(
      'signUpWithPassword',
      createContext({
        body: {
          email: 'User@example.com',
          password: 'password123'
        }
      }),
      services as unknown as PluginServices
    );

    expect(result).toEqual({ kind: 'denied', code: 'DUPLICATE_IDENTITY' });
  });

  it('rolls back sign-up when a non-duplicate infrastructure error occurs mid-transaction', async () => {
    const plugin = createEmailPasswordPlugin();
    const services = createPluginServices();
    const tx = services.tx;
    let rollbackThrown = false;

    services.storage.beginTransaction.mockImplementationOnce(async (run: (txArg: TransactionalStorage) => Promise<unknown>) => {
      try {
        return await run(tx as unknown as TransactionalStorage);
      } catch (error) {
        rollbackThrown = true;
        if (error && typeof error === 'object' && 'outcome' in error) {
          return (error as { outcome: unknown }).outcome;
        }
        throw error;
      }
    });

    services.crypto.hashSecret.mockResolvedValue('password-hash');
    tx.users.create.mockResolvedValue(createUser());
    tx.identities.create.mockResolvedValue({
      category: 'infrastructure',
      code: 'STORAGE_UNAVAILABLE',
      message: 'db down',
      retryable: false
    } satisfies AuthError);

    const result = await plugin.execute(
      'signUpWithPassword',
      createContext({
        body: {
          email: 'user@example.com',
          password: 'password123'
        }
      }),
      services as unknown as PluginServices
    );

    expect(rollbackThrown).toBe(true);
    expect(result).toEqual({
      category: 'infrastructure',
      code: 'STORAGE_UNAVAILABLE',
      message: 'db down',
      retryable: false
    });
  });

  it('returns INVALID_CREDENTIALS when sign-in cannot find the email identity', async () => {
    const plugin = createEmailPasswordPlugin();
    const services = createPluginServices();

    services.storage.identities.findByNormalizedEmail.mockResolvedValue(null);

    const result = await plugin.execute(
      'signInWithPassword',
      createContext({
        body: {
          email: ' User@Example.com ',
          password: 'password123'
        }
      }),
      services as unknown as PluginServices
    );

    expect(services.storage.identities.findByNormalizedEmail).toHaveBeenCalledWith('user@example.com');
    expect(result).toEqual({ kind: 'unauthenticated', code: 'INVALID_CREDENTIALS' });
  });

  it('returns INVALID_CREDENTIALS when the password does not verify', async () => {
    const plugin = createEmailPasswordPlugin();
    const services = createPluginServices();

    services.storage.identities.findByNormalizedEmail.mockResolvedValue({
      id: 'identity-1',
      userId: 'user-1',
      normalizedEmail: 'user@example.com',
      passwordHash: 'stored-hash'
    });
    services.crypto.verifySecret.mockResolvedValue(false);

    const result = await plugin.execute(
      'signInWithPassword',
      createContext({
        body: {
          email: 'user@example.com',
          password: 'wrong-password'
        }
      }),
      services as unknown as PluginServices
    );

    expect(result).toEqual({ kind: 'unauthenticated', code: 'INVALID_CREDENTIALS' });
    expect(services.storage.beginTransaction).not.toHaveBeenCalled();
  });

  it('issues a session inside a transaction on successful sign-in', async () => {
    const plugin = createEmailPasswordPlugin();
    const services = createPluginServices();
    const user = createUser();
    const session = createSession();
    const context = createContext({
      body: {
        email: ' Te\u0301st@Example.com ',
        password: 'password123'
      }
    });

    services.storage.identities.findByNormalizedEmail.mockResolvedValue({
      id: 'identity-1',
      userId: user.id,
      normalizedEmail: 'tést@example.com',
      passwordHash: 'stored-hash'
    });
    services.crypto.verifySecret.mockResolvedValue(true);
    services.storage.users.find.mockResolvedValue(user);
    services.sessions.issueSession.mockResolvedValue({
      session,
      transport: { kind: 'cookie', token: 'issued-token' }
    });

    const result = await plugin.execute('signInWithPassword', context, services as unknown as PluginServices);

    expect(services.storage.identities.findByNormalizedEmail).toHaveBeenCalledWith('tést@example.com');
    expect(services.storage.beginTransaction).toHaveBeenCalledOnce();
    expect(services.sessions.issueSession).toHaveBeenCalledWith(
      user,
      services.tx as unknown as TransactionalStorage,
      context
    );
    expect(result).toEqual({
      kind: 'success',
      action: 'signInWithPassword',
      subject: user,
      session,
      transport: { kind: 'cookie', token: 'issued-token' }
    });
  });

  it('returns an infrastructure error when an identity exists but the user record is missing', async () => {
    const plugin = createEmailPasswordPlugin();
    const services = createPluginServices();

    services.storage.identities.findByNormalizedEmail.mockResolvedValue({
      id: 'identity-1',
      userId: 'user-1',
      normalizedEmail: 'user@example.com',
      passwordHash: 'stored-hash'
    });
    services.crypto.verifySecret.mockResolvedValue(true);
    services.storage.users.find.mockResolvedValue(null);

    const result = await plugin.execute(
      'signInWithPassword',
      createContext({
        body: {
          email: 'user@example.com',
          password: 'password123'
        }
      }),
      services as unknown as PluginServices
    );

    expect(result).toEqual({
      category: 'infrastructure',
      code: 'STORAGE_UNAVAILABLE',
      message: 'Identity user could not be loaded.',
      retryable: false
    });
    expect(services.storage.beginTransaction).not.toHaveBeenCalled();
  });

  it('returns generic success for requestPasswordReset when email identity does not exist', async () => {
    const plugin = createEmailPasswordPlugin();
    const services = createPluginServices();

    services.storage.identities.findByNormalizedEmail.mockResolvedValue(null);

    const result = await plugin.execute(
      'requestPasswordReset',
      createContext({
        body: {
          email: 'missing@example.com'
        }
      }),
      services as unknown as PluginServices
    );

    expect(result).toEqual({ kind: 'success', action: 'requestPasswordReset' });
    expect(services.storage.passwordResetTokens.create).not.toHaveBeenCalled();
  });

  it('stores reset token for requestPasswordReset when identity exists', async () => {
    const plugin = createEmailPasswordPlugin();
    const services = createPluginServices();

    services.storage.identities.findByNormalizedEmail.mockResolvedValue({
      id: 'identity-1',
      userId: 'user-1',
      normalizedEmail: 'user@example.com',
      passwordHash: 'stored-hash'
    });
    services.crypto.generateOpaqueToken.mockResolvedValue('reset-token');
    services.crypto.deriveTokenId.mockResolvedValue('reset-token-hash');
    services.storage.passwordResetTokens.create.mockResolvedValue({
      id: 'reset-id',
      tokenHash: 'reset-token-hash',
      normalizedEmail: 'user@example.com',
      expiresAt: '2025-01-01T00:15:00.000Z',
      consumedAt: null
    });

    const result = await plugin.execute(
      'requestPasswordReset',
      createContext({
        body: {
          email: 'User@example.com'
        }
      }),
      services as unknown as PluginServices
    );

    expect(result).toEqual({ kind: 'success', action: 'requestPasswordReset' });
    expect(services.storage.passwordResetTokens.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenHash: 'reset-token-hash',
        normalizedEmail: 'user@example.com'
      })
    );
    expect(services.emailDelivery.sendPasswordReset).toHaveBeenCalledWith({
      email: 'user@example.com',
      resetToken: 'reset-token'
    });
  });

  it('maps password reset delivery failures to STORAGE_UNAVAILABLE', async () => {
    const plugin = createEmailPasswordPlugin();
    const services = createPluginServices();

    services.storage.identities.findByNormalizedEmail.mockResolvedValue({
      id: 'identity-1',
      userId: 'user-1',
      normalizedEmail: 'user@example.com',
      passwordHash: 'stored-hash'
    });
    services.crypto.generateOpaqueToken.mockResolvedValue('reset-token');
    services.crypto.deriveTokenId.mockResolvedValue('reset-token-hash');
    services.storage.passwordResetTokens.create.mockResolvedValue({
      id: 'reset-id',
      tokenHash: 'reset-token-hash',
      normalizedEmail: 'user@example.com',
      expiresAt: '2025-01-01T00:15:00.000Z',
      consumedAt: null
    });
    services.emailDelivery.sendPasswordReset.mockResolvedValue({
      category: 'infrastructure',
      code: 'STORAGE_UNAVAILABLE',
      message: 'Email provider unavailable',
      retryable: true
    });

    const result = await plugin.execute(
      'requestPasswordReset',
      createContext({ body: { email: 'user@example.com' } }),
      services as unknown as PluginServices
    );

    expect(result).toEqual({
      category: 'infrastructure',
      code: 'STORAGE_UNAVAILABLE',
      message: 'Email provider unavailable',
      retryable: false
    });
  });

  it('consumes reset token, updates password hash, and revokes sessions on resetPassword', async () => {
    const plugin = createEmailPasswordPlugin();
    const services = createPluginServices();

    services.crypto.deriveTokenId.mockResolvedValue('reset-token-hash');
    services.tx.passwordResetTokens.consume.mockResolvedValue({ normalizedEmail: 'user@example.com' });
    services.crypto.hashSecret.mockResolvedValue('next-password-hash');
    services.tx.identities.updatePasswordHashByNormalizedEmail.mockResolvedValue({
      id: 'identity-1',
      userId: 'user-1',
      normalizedEmail: 'user@example.com',
      passwordHash: 'next-password-hash'
    });
    services.sessions.revokeAllSessions.mockResolvedValue(2);

    const result = await plugin.execute(
      'resetPassword',
      createContext({
        body: {
          resetToken: 'reset-token',
          password: 'password123'
        }
      }),
      services as unknown as PluginServices
    );

    expect(result).toEqual({ kind: 'success', action: 'resetPassword' });
    expect(services.tx.passwordResetTokens.consume).toHaveBeenCalledWith(
      expect.objectContaining({ tokenHash: 'reset-token-hash' })
    );
    expect(services.tx.identities.updatePasswordHashByNormalizedEmail).toHaveBeenCalledWith(
      'user@example.com',
      'next-password-hash'
    );
    expect(services.sessions.revokeAllSessions).toHaveBeenCalledWith(
      'user-1',
      services.tx as unknown as TransactionalStorage
    );
  });

  it('returns generic success for requestEmailVerification when email identity does not exist', async () => {
    const plugin = createEmailPasswordPlugin();
    const services = createPluginServices();

    services.storage.identities.findByNormalizedEmail.mockResolvedValue(null);

    const result = await plugin.execute(
      'requestEmailVerification',
      createContext({ body: { email: 'missing@example.com' } }),
      services as unknown as PluginServices
    );

    expect(result).toEqual({ kind: 'success', action: 'requestEmailVerification' });
    expect(services.storage.emailVerificationTokens.create).not.toHaveBeenCalled();
  });

  it('creates verification token when requestEmailVerification identity exists and is not verified', async () => {
    const plugin = createEmailPasswordPlugin();
    const services = createPluginServices();

    services.storage.identities.findByNormalizedEmail.mockResolvedValue({
      id: 'identity-1',
      userId: 'user-1',
      normalizedEmail: 'user@example.com',
      passwordHash: 'stored-hash'
    });
    services.storage.verifiedEmails.find.mockResolvedValue(null);
    services.crypto.generateOpaqueToken.mockResolvedValue('verify-token');
    services.crypto.deriveTokenId.mockResolvedValue('verify-token-hash');
    services.storage.emailVerificationTokens.create.mockResolvedValue({
      id: 'verification-id',
      tokenHash: 'verify-token-hash',
      normalizedEmail: 'user@example.com',
      expiresAt: '2025-01-02T00:00:00.000Z',
      consumedAt: null
    });

    const result = await plugin.execute(
      'requestEmailVerification',
      createContext({ body: { email: 'user@example.com' } }),
      services as unknown as PluginServices
    );

    expect(result).toEqual({ kind: 'success', action: 'requestEmailVerification' });
    expect(services.storage.emailVerificationTokens.create).toHaveBeenCalledWith(
      expect.objectContaining({ tokenHash: 'verify-token-hash', normalizedEmail: 'user@example.com' })
    );
    expect(services.emailDelivery.sendEmailVerification).toHaveBeenCalledWith({
      email: 'user@example.com',
      verificationToken: 'verify-token'
    });
  });

  it('consumes verification token and marks email as verified', async () => {
    const plugin = createEmailPasswordPlugin();
    const services = createPluginServices();

    services.crypto.deriveTokenId.mockResolvedValue('verify-token-hash');
    services.tx.emailVerificationTokens.consume.mockResolvedValue({ normalizedEmail: 'user@example.com' });
    services.tx.verifiedEmails.markVerified.mockResolvedValue({
      normalizedEmail: 'user@example.com',
      verifiedAt: '2025-01-01T00:00:00.000Z'
    });

    const result = await plugin.execute(
      'verifyEmail',
      createContext({ body: { verificationToken: 'verify-token' } }),
      services as unknown as PluginServices
    );

    expect(result).toEqual({ kind: 'success', action: 'verifyEmail' });
    expect(services.tx.emailVerificationTokens.consume).toHaveBeenCalledWith(
      expect.objectContaining({ tokenHash: 'verify-token-hash' })
    );
    expect(services.tx.verifiedEmails.markVerified).toHaveBeenCalled();
  });
});

function createConfig(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    sessionCookieName: 'authia_session',
    cookieOptions: {
      secure: true,
      sameSite: 'lax',
      path: '/',
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
    plugins: ['emailPassword'],
    ...overrides
  };
}

function createContext(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    action: 'signInWithPassword',
    runtime: 'node',
    method: 'POST',
    url: 'https://example.com/auth',
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
      listByUser: vi.fn(),
      updatePasswordHashByNormalizedEmail: vi.fn()
    },
    sessions: {
      create: vi.fn(),
      findByCurrentTokenId: vi.fn(),
      update: vi.fn(),
      compareAndSwapToken: vi.fn(),
      revoke: vi.fn(),
      revokeAllForUser: vi.fn()
    },
    passwordResetTokens: {
      create: vi.fn(),
      consume: vi.fn()
    },
    emailVerificationTokens: {
      create: vi.fn(),
      consume: vi.fn()
    },
    verifiedEmails: {
      markVerified: vi.fn(),
      find: vi.fn()
    },
    beginTransaction: vi.fn(async (run: (txArg: TransactionalStorage) => Promise<unknown>) => run(tx as unknown as TransactionalStorage))
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

  const emailDelivery = {
    sendPasswordReset: vi.fn<NonNullable<PluginServices['emailDelivery']>['sendPasswordReset']>(
      async () => undefined
    ),
    sendEmailVerification: vi.fn<NonNullable<PluginServices['emailDelivery']>['sendEmailVerification']>(
      async () => undefined
    )
  };

  return {
    tx,
    storage,
    crypto,
    sessions,
    emailDelivery
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
      listByUser: vi.fn(),
      updatePasswordHashByNormalizedEmail: vi.fn()
    },
    sessions: {
      create: vi.fn(),
      findByCurrentTokenId: vi.fn(),
      update: vi.fn(),
      compareAndSwapToken: vi.fn(),
      revoke: vi.fn(),
      revokeAllForUser: vi.fn()
    },
    passwordResetTokens: {
      create: vi.fn(),
      consume: vi.fn()
    },
    emailVerificationTokens: {
      create: vi.fn(),
      consume: vi.fn()
    },
    verifiedEmails: {
      markVerified: vi.fn(),
      find: vi.fn()
    }
  };
}
