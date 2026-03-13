export const defaultCookieName = 'authia_session';

export const defaultSessionConfig = {
  absoluteLifetimeMs: 30 * 24 * 60 * 60 * 1000,
  idleTimeoutMs: 7 * 24 * 60 * 60 * 1000,
  rotationThresholdMs: 24 * 60 * 60 * 1000
} as const;

export type SessionTransport =
  | { kind: 'cookie'; token: string }
  | { kind: 'bearer'; token: string };

export type PresentedCredential = SessionTransport;

export type UserView = {
  id: string;
  createdAt: string;
};

export type SessionView = {
  id: string;
  expiresAt: string;
  idleExpiresAt: string;
};

export type User = {
  id: string;
  createdAt: string;
};

export type LocalIdentity = {
  id: string;
  userId: string;
  normalizedEmail: string;
  passwordHash: string;
};

export type SessionRecord = {
  id: string;
  userId: string;
  currentTokenId: string;
  currentTokenVerifier: string;
  lastRotatedAt: string;
  expiresAt: string;
  idleExpiresAt: string;
  revokedAt?: string | null;
};

export type AuthenticatedSession = {
  user: User;
  session: SessionRecord;
};

export type SessionValidationOutcome =
  | { kind: 'denied'; code: 'INVALID_INPUT' }
  | { kind: 'authenticated'; value: AuthenticatedSession }
  | { kind: 'unauthenticated'; code: 'SESSION_EXPIRED' | 'SESSION_REVOKED' };

export type SessionValidationResult =
  | { kind: 'authenticated'; value: AuthenticatedSession }
  | { kind: 'unauthenticated'; code: 'SESSION_EXPIRED' | 'SESSION_REVOKED' };
