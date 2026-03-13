import type { AuthError, AuthValue } from './errors.js';
import type { LocalIdentity, SessionRecord, User } from './session.js';

export type UserCreateInput = {};

export type LocalIdentityCreateInput = {
  userId: string;
  normalizedEmail: string;
  passwordHash: string;
};

export type SessionCreateInput = {
  userId: string;
  tokenId: string;
  tokenVerifier: string;
  expiresAt: string;
  idleExpiresAt: string;
};

export type SessionUpdateInput = {
  tokenId?: string;
  tokenVerifier?: string;
  lastRotatedAt?: string;
  expiresAt?: string;
  idleExpiresAt?: string;
  revokedAt?: string | null;
};

export type SessionCompareAndSwapInput = {
  sessionId: string;
  expectedTokenId: string;
  nextTokenId: string;
  nextTokenVerifier: string;
  nextLastRotatedAt: string;
  nextIdleExpiresAt: string;
};

export type OAuthStateCreateInput = {
  provider: string;
  stateHash: string;
  codeVerifierCiphertext: string;
  redirectUriHash: string;
  expiresAt: string;
};

export type OAuthStateConsumeInput = {
  provider: string;
  stateHash: string;
  nowIso: string;
};

export type OAuthState = {
  id: string;
  provider: string;
  stateHash: string;
  codeVerifierCiphertext: string;
  redirectUriHash: string;
  expiresAt: string;
  consumedAt: string | null;
};

export type OAuthIdentityCreateInput = {
  userId: string;
  provider: string;
  providerSubject: string;
};

export type OAuthIdentity = {
  id: string;
  userId: string;
  provider: string;
  providerSubject: string;
};

export type TransactionalStorage = {
  migrations: {
    ensureCompatibleSchema: () => Promise<'ok' | 'MIGRATION_MISMATCH' | AuthError>;
  };
  users: {
    create: (input: UserCreateInput) => Promise<AuthValue<User>>;
    find: (id: string) => Promise<AuthValue<User | null>>;
  };
  identities: {
    create: (input: LocalIdentityCreateInput) => Promise<AuthValue<LocalIdentity>>;
    findByNormalizedEmail: (normalizedEmail: string) => Promise<AuthValue<LocalIdentity | null>>;
    listByUser: (userId: string) => Promise<AuthValue<LocalIdentity[]>>;
  };
  sessions: {
    create: (input: SessionCreateInput) => Promise<AuthValue<SessionRecord>>;
    findByCurrentTokenId: (tokenId: string) => Promise<AuthValue<SessionRecord | null>>;
    update: (sessionId: string, input: SessionUpdateInput) => Promise<AuthValue<SessionRecord>>;
    compareAndSwapToken: (input: SessionCompareAndSwapInput) => Promise<AuthValue<SessionRecord | null>>;
    revoke: (sessionId: string) => Promise<AuthValue<void>>;
    revokeAllForUser: (userId: string) => Promise<AuthValue<number>>;
  };
  oauthStates?: {
    create: (input: OAuthStateCreateInput) => Promise<AuthValue<OAuthState>>;
    consume: (
      input: OAuthStateConsumeInput
    ) => Promise<AuthValue<{ codeVerifierCiphertext: string; redirectUriHash: string } | null>>;
  };
  oauthIdentities?: {
    create: (input: OAuthIdentityCreateInput) => Promise<AuthValue<OAuthIdentity>>;
    findByProviderSubject: (
      provider: string,
      providerSubject: string
    ) => Promise<AuthValue<OAuthIdentity | null>>;
  };
};

export type StorageAdapter = {
  migrations: TransactionalStorage['migrations'];
  users: TransactionalStorage['users'];
  identities: TransactionalStorage['identities'];
  sessions: TransactionalStorage['sessions'];
  oauthStates?: TransactionalStorage['oauthStates'];
  oauthIdentities?: TransactionalStorage['oauthIdentities'];
  beginTransaction: <T>(run: (tx: TransactionalStorage) => Promise<T>) => Promise<AuthValue<T>>;
};
