import type { AuthError, PluginServices, SessionValidationOutcome } from '@authia/contracts';

export async function validateSession(
  services: {
    storage: Pick<PluginServices['storage'], 'users' | 'sessions'>;
    crypto: Pick<PluginServices['crypto'], 'deriveTokenId' | 'verifyOpaqueToken'>;
  },
  credential: Parameters<PluginServices['sessions']['validateSession']>[0]
): Promise<SessionValidationOutcome | AuthError> {
  if (!credential) {
    return { kind: 'denied', code: 'INVALID_INPUT' };
  }

  const tokenId = await services.crypto.deriveTokenId(credential.token);
  if (isAuthError(tokenId)) {
    return tokenId;
  }

  const session = await services.storage.sessions.findByCurrentTokenId(tokenId);
  if (isAuthError(session)) {
    return session;
  }

  if (!session || session.revokedAt) {
    return { kind: 'unauthenticated', code: 'SESSION_REVOKED' };
  }

  const verifierMatches = await services.crypto.verifyOpaqueToken(credential.token, session.currentTokenVerifier);
  if (isAuthError(verifierMatches)) {
    return verifierMatches;
  }

  if (!verifierMatches) {
    return { kind: 'unauthenticated', code: 'SESSION_REVOKED' };
  }

  const now = Date.now();
  if (new Date(session.expiresAt).getTime() <= now || new Date(session.idleExpiresAt).getTime() <= now) {
    return { kind: 'unauthenticated', code: 'SESSION_EXPIRED' };
  }

  const user = await services.storage.users.find(session.userId);
  if (isAuthError(user)) {
    return user;
  }

  if (!user) {
    return {
      category: 'infrastructure',
      code: 'STORAGE_UNAVAILABLE',
      message: 'Session subject could not be loaded.',
      retryable: false
    };
  }

  return {
    kind: 'authenticated',
    value: {
      user,
      session
    }
  };
}

function isAuthError<T>(value: T | AuthError): value is AuthError {
  return typeof value === 'object' && value !== null && 'category' in value && 'code' in value;
}
