import { defaultSessionConfig } from '@authia/contracts';
import type { AuthError, PluginServices, SessionRecord, SessionTransport, TransactionalStorage } from '@authia/contracts';

function isAuthError<T>(value: T | AuthError): value is AuthError {
  return typeof value === 'object' && value !== null && 'category' in value && 'code' in value;
}

export async function refreshSession(
  services: {
    crypto: Pick<PluginServices['crypto'], 'generateOpaqueToken' | 'deriveTokenId' | 'deriveTokenVerifier'>;
  },
  session: SessionRecord,
  tx: TransactionalStorage,
  context: Parameters<PluginServices['sessions']['refreshSession']>[2]
): Promise<
  | { session: SessionRecord; transport: SessionTransport }
  | AuthError
  | { kind: 'denied'; code: 'INVALID_INPUT' }
  | { kind: 'unauthenticated'; code: 'SESSION_REVOKED' | 'SESSION_EXPIRED' }
> {
  if (!context.credential) {
    return { kind: 'denied', code: 'INVALID_INPUT' };
  }

  const now = Date.now();
  if (session.revokedAt) {
    return { kind: 'unauthenticated', code: 'SESSION_REVOKED' };
  }
  if (new Date(session.expiresAt).getTime() <= now || new Date(session.idleExpiresAt).getTime() <= now) {
    return { kind: 'unauthenticated', code: 'SESSION_EXPIRED' };
  }

  const idleExpiresAt = new Date(now + defaultSessionConfig.idleTimeoutMs).toISOString();
  const lastRotatedAtMs = new Date(session.lastRotatedAt).getTime();
  const rotationDue = now - lastRotatedAtMs >= defaultSessionConfig.rotationThresholdMs;

  if (!rotationDue) {
    const updated = await tx.sessions.update(session.id, {
      idleExpiresAt
    });
    if (isAuthError(updated)) {
      return updated;
    }

    return {
      session: updated,
      transport: {
        kind: context.credential.kind,
        token: context.credential.token
      }
    };
  }

  const token = await services.crypto.generateOpaqueToken();
  if (isAuthError(token)) {
    return token;
  }

  const tokenId = await services.crypto.deriveTokenId(token);
  if (isAuthError(tokenId)) {
    return tokenId;
  }

  const tokenVerifier = await services.crypto.deriveTokenVerifier(token);
  if (isAuthError(tokenVerifier)) {
    return tokenVerifier;
  }

  const swapped = await tx.sessions.compareAndSwapToken({
    sessionId: session.id,
    expectedTokenId: session.currentTokenId,
    nextTokenId: tokenId,
    nextTokenVerifier: tokenVerifier,
    nextLastRotatedAt: new Date(now).toISOString(),
    nextIdleExpiresAt: idleExpiresAt
  });

  if (isAuthError(swapped)) {
    return swapped;
  }

  if (!swapped) {
    return {
      kind: 'unauthenticated',
      code: 'SESSION_REVOKED'
    };
  }

  return {
    session: swapped,
    transport: {
      kind: context.transport,
      token
    }
  };
}
