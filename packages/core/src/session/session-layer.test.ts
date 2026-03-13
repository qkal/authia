import type { AuthError, PluginServices, RequestContext, SessionRecord, TransactionalStorage, User } from '@authia/contracts';
import { defaultSessionConfig } from '@authia/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSessionLayer } from './session-layer.js';

type SessionServices = Pick<PluginServices, 'storage' | 'crypto'>;

describe('createSessionLayer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('issues sessions with derived token fields and transport matching the request context', async () => {
    const tx = createTransactionalStorage();
    const services = createSessionServices();
    const createdSession = createSessionRecord();

    services.crypto.generateOpaqueToken.mockResolvedValue('opaque-token');
    services.crypto.deriveTokenId.mockResolvedValue('token-id');
    services.crypto.deriveTokenVerifier.mockResolvedValue('token-verifier');
    tx.sessions.create.mockResolvedValue(createdSession);

    const layer = createSessionLayer(services as any);
    const result = await layer.issueSession(createUser(), tx as unknown as TransactionalStorage, createContext({ transport: 'bearer' }));

    expect(tx.sessions.create).toHaveBeenCalledWith({
      userId: 'user-1',
      tokenId: 'token-id',
      tokenVerifier: 'token-verifier',
      expiresAt: new Date(Date.now() + defaultSessionConfig.absoluteLifetimeMs).toISOString(),
      idleExpiresAt: new Date(Date.now() + defaultSessionConfig.idleTimeoutMs).toISOString()
    });
    expect(result).toEqual({
      session: createdSession,
      transport: { kind: 'bearer', token: 'opaque-token' }
    });
  });

  it('denies validation when the credential is missing', async () => {
    const layer = createSessionLayer(createSessionServices() as any);

    const result = await layer.validateSession(undefined, createContext());

    expect(result).toEqual({ kind: 'denied', code: 'INVALID_INPUT' });
  });

  it('treats an unknown token as a revoked session', async () => {
    const services = createSessionServices();
    services.crypto.deriveTokenId.mockResolvedValue('missing-token-id');
    services.storage.sessions.findByCurrentTokenId.mockResolvedValue(null);

    const layer = createSessionLayer(services as any);
    const result = await layer.validateSession({ kind: 'cookie', token: 'opaque-token' }, createContext());

    expect(services.storage.sessions.findByCurrentTokenId).toHaveBeenCalledWith('missing-token-id');
    expect(result).toEqual({ kind: 'unauthenticated', code: 'SESSION_REVOKED' });
  });

  it('treats a verifier mismatch as a revoked session', async () => {
    const services = createSessionServices();
    const storedSession = createSessionRecord();

    services.crypto.deriveTokenId.mockResolvedValue(storedSession.currentTokenId);
    services.storage.sessions.findByCurrentTokenId.mockResolvedValue(storedSession);
    services.crypto.verifyOpaqueToken.mockResolvedValue(false);

    const layer = createSessionLayer(services as any);
    const result = await layer.validateSession({ kind: 'cookie', token: 'opaque-token' }, createContext());

    expect(result).toEqual({ kind: 'unauthenticated', code: 'SESSION_REVOKED' });
  });

  it.each([
    ['idle timeout', createSessionRecord({ idleExpiresAt: '2025-01-14T23:59:59.000Z' })],
    ['absolute timeout', createSessionRecord({ expiresAt: '2025-01-14T23:59:59.000Z' })]
  ])('returns SESSION_EXPIRED when validation fails due to %s', async (_label, storedSession) => {
    const services = createSessionServices();

    services.crypto.deriveTokenId.mockResolvedValue(storedSession.currentTokenId);
    services.storage.sessions.findByCurrentTokenId.mockResolvedValue(storedSession);
    services.crypto.verifyOpaqueToken.mockResolvedValue(true);

    const layer = createSessionLayer(services as any);
    const result = await layer.validateSession({ kind: 'cookie', token: 'opaque-token' }, createContext());

    expect(result).toEqual({ kind: 'unauthenticated', code: 'SESSION_EXPIRED' });
  });

  it('returns the authenticated user and session for a valid credential', async () => {
    const services = createSessionServices();
    const storedSession = createSessionRecord();
    const user = createUser();

    services.crypto.deriveTokenId.mockResolvedValue(storedSession.currentTokenId);
    services.storage.sessions.findByCurrentTokenId.mockResolvedValue(storedSession);
    services.crypto.verifyOpaqueToken.mockResolvedValue(true);
    services.storage.users.find.mockResolvedValue(user);

    const layer = createSessionLayer(services as any);
    const result = await layer.validateSession({ kind: 'cookie', token: 'opaque-token' }, createContext());

    expect(result).toEqual({
      kind: 'authenticated',
      value: {
        user,
        session: storedSession
      }
    });
  });

  it('rotates the token through compare-and-swap when the rotation threshold is reached', async () => {
    const tx = createTransactionalStorage();
    const services = createSessionServices();
    const session = createSessionRecord({ lastRotatedAt: '2025-01-13T23:59:59.000Z' });
    const rotatedSession = createSessionRecord({
      currentTokenId: 'rotated-token-id',
      currentTokenVerifier: 'rotated-token-verifier',
      lastRotatedAt: '2025-01-15T00:00:00.000Z',
      idleExpiresAt: new Date(Date.now() + defaultSessionConfig.idleTimeoutMs).toISOString()
    });

    services.crypto.generateOpaqueToken.mockResolvedValue('rotated-token');
    services.crypto.deriveTokenId.mockResolvedValue('rotated-token-id');
    services.crypto.deriveTokenVerifier.mockResolvedValue('rotated-token-verifier');
    tx.sessions.compareAndSwapToken.mockResolvedValue(rotatedSession);

    const layer = createSessionLayer(services as any);
    const result = await layer.refreshSession(
      session,
      tx as unknown as TransactionalStorage,
      createContext({
        transport: 'bearer',
        credential: { kind: 'bearer', token: 'current-token' }
      })
    );

    expect(tx.sessions.compareAndSwapToken).toHaveBeenCalledWith({
      sessionId: session.id,
      expectedTokenId: session.currentTokenId,
      nextTokenId: 'rotated-token-id',
      nextTokenVerifier: 'rotated-token-verifier',
      nextLastRotatedAt: '2025-01-15T00:00:00.000Z',
      nextIdleExpiresAt: new Date(Date.now() + defaultSessionConfig.idleTimeoutMs).toISOString()
    });
    expect(result).toEqual({
      session: rotatedSession,
      transport: { kind: 'bearer', token: 'rotated-token' }
    });
  });

  it('returns SESSION_REVOKED when token rotation compare-and-swap loses the race', async () => {
    const tx = createTransactionalStorage();
    const services = createSessionServices();
    const session = createSessionRecord({ lastRotatedAt: '2025-01-13T23:59:59.000Z' });

    services.crypto.generateOpaqueToken.mockResolvedValue('rotated-token');
    services.crypto.deriveTokenId.mockResolvedValue('rotated-token-id');
    services.crypto.deriveTokenVerifier.mockResolvedValue('rotated-token-verifier');
    tx.sessions.compareAndSwapToken.mockResolvedValue(null);

    const layer = createSessionLayer(services as any);
    const result = await layer.refreshSession(
      session,
      tx as unknown as TransactionalStorage,
      createContext({
        credential: { kind: 'cookie', token: 'current-token' }
      })
    );

    expect(result).toMatchObject({ kind: 'unauthenticated', code: 'SESSION_REVOKED' });
  });

  it('extends idle expiry and reuses the current token when rotation is not due', async () => {
    const tx = createTransactionalStorage();
    const services = createSessionServices();
    const session = createSessionRecord({ lastRotatedAt: '2025-01-14T12:00:00.000Z' });
    const updatedSession = createSessionRecord({
      idleExpiresAt: new Date(Date.now() + defaultSessionConfig.idleTimeoutMs).toISOString(),
      lastRotatedAt: session.lastRotatedAt
    });

    tx.sessions.update.mockResolvedValue(updatedSession);

    const layer = createSessionLayer(services as any);
    const result = await layer.refreshSession(
      session,
      tx as unknown as TransactionalStorage,
      createContext({
        transport: 'cookie',
        credential: { kind: 'cookie', token: 'current-token' }
      })
    );

    expect(tx.sessions.update).toHaveBeenCalledWith(session.id, {
      idleExpiresAt: new Date(Date.now() + defaultSessionConfig.idleTimeoutMs).toISOString()
    });
    expect(services.crypto.generateOpaqueToken).not.toHaveBeenCalled();
    expect(result).toEqual({
      session: updatedSession,
      transport: { kind: 'cookie', token: 'current-token' }
    });
  });

  it('delegates revokeSession and revokeAllSessions with and without an explicit transaction', async () => {
    const tx = createTransactionalStorage();
    const services = createSessionServices();
    services.storage.sessions.revokeAllForUser.mockResolvedValue(2);
    tx.sessions.revokeAllForUser.mockResolvedValue(3);

    const layer = createSessionLayer(services as any);

    await expect(layer.revokeSession('session-default')).resolves.toBeUndefined();
    await expect(layer.revokeSession('session-tx', tx as unknown as TransactionalStorage)).resolves.toBeUndefined();
    await expect(layer.revokeAllSessions('user-default')).resolves.toBe(2);
    await expect(layer.revokeAllSessions('user-tx', tx as unknown as TransactionalStorage)).resolves.toBe(3);

    expect(services.storage.sessions.revoke).toHaveBeenCalledWith('session-default');
    expect(tx.sessions.revoke).toHaveBeenCalledWith('session-tx');
    expect(services.storage.sessions.revokeAllForUser).toHaveBeenCalledWith('user-default');
    expect(tx.sessions.revokeAllForUser).toHaveBeenCalledWith('user-tx');
  });
});

function createContext(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    action: 'getSession',
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

function createSessionRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 'session-1',
    userId: 'user-1',
    currentTokenId: 'current-token-id',
    currentTokenVerifier: 'current-token-verifier',
    lastRotatedAt: '2025-01-14T00:00:01.000Z',
    expiresAt: '2025-02-14T00:00:00.000Z',
    idleExpiresAt: '2025-01-22T00:00:00.000Z',
    revokedAt: null,
    ...overrides
  };
}

function createSessionServices(): {
  storage: SessionServices['storage'] & {
    users: { find: ReturnType<typeof vi.fn> };
    sessions: {
      findByCurrentTokenId: ReturnType<typeof vi.fn>;
      revoke: ReturnType<typeof vi.fn>;
      revokeAllForUser: ReturnType<typeof vi.fn>;
    };
  };
  crypto: {
    hashSecret: ReturnType<typeof vi.fn>;
    verifySecret: ReturnType<typeof vi.fn>;
    generateOpaqueToken: ReturnType<typeof vi.fn>;
    deriveTokenId: ReturnType<typeof vi.fn>;
    deriveTokenVerifier: ReturnType<typeof vi.fn>;
    verifyOpaqueToken: ReturnType<typeof vi.fn>;
  };
} {
  return {
    storage: {
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
        revoke: vi.fn().mockResolvedValue(undefined),
        revokeAllForUser: vi.fn().mockResolvedValue(0)
      },
      beginTransaction: vi.fn()
    },
    crypto: {
      hashSecret: vi.fn(),
      verifySecret: vi.fn(),
      generateOpaqueToken: vi.fn(),
      deriveTokenId: vi.fn(),
      deriveTokenVerifier: vi.fn(),
      verifyOpaqueToken: vi.fn()
    }
  } as unknown as {
    storage: SessionServices['storage'] & {
      users: { find: ReturnType<typeof vi.fn> };
      sessions: {
        findByCurrentTokenId: ReturnType<typeof vi.fn>;
        revoke: ReturnType<typeof vi.fn>;
        revokeAllForUser: ReturnType<typeof vi.fn>;
      };
    };
    crypto: {
      hashSecret: ReturnType<typeof vi.fn>;
      verifySecret: ReturnType<typeof vi.fn>;
      generateOpaqueToken: ReturnType<typeof vi.fn>;
      deriveTokenId: ReturnType<typeof vi.fn>;
      deriveTokenVerifier: ReturnType<typeof vi.fn>;
      verifyOpaqueToken: ReturnType<typeof vi.fn>;
    };
  };
}

function createTransactionalStorage(): {
  sessions: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    compareAndSwapToken: ReturnType<typeof vi.fn>;
    revoke: ReturnType<typeof vi.fn>;
    revokeAllForUser: ReturnType<typeof vi.fn>;
  };
} & TransactionalStorage {
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
      revoke: vi.fn().mockResolvedValue(undefined),
      revokeAllForUser: vi.fn().mockResolvedValue(0)
    }
  } as unknown as {
    sessions: {
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      compareAndSwapToken: ReturnType<typeof vi.fn>;
      revoke: ReturnType<typeof vi.fn>;
      revokeAllForUser: ReturnType<typeof vi.fn>;
    };
  } & TransactionalStorage;
}

function _unused(_value: AuthError): void {
  void _value;
}
