import { defaultSessionConfig } from '@authia/contracts';
import type { AuthError, PluginServices, SessionRecord, SessionTransport, TransactionalStorage, User } from '@authia/contracts';

function isAuthError<T>(value: T | AuthError): value is AuthError {
  return typeof value === 'object' && value !== null && 'category' in value && 'code' in value;
}

export async function issueSession(
  services: {
    crypto: Pick<PluginServices['crypto'], 'generateOpaqueToken' | 'deriveTokenId' | 'deriveTokenVerifier'>;
  },
  subject: User,
  tx: TransactionalStorage,
  context: Parameters<PluginServices['sessions']['issueSession']>[2]
): Promise<{ session: SessionRecord; transport: SessionTransport } | AuthError> {
  const token = await services.crypto.generateOpaqueToken();
  if (isAuthError(token)) {
    return token;
  }

  const [tokenId, tokenVerifier] = await Promise.all([
    services.crypto.deriveTokenId(token),
    services.crypto.deriveTokenVerifier(token)
  ]);

  if (isAuthError(tokenId)) {
    return tokenId;
  }

  if (isAuthError(tokenVerifier)) {
    return tokenVerifier;
  }

  const now = Date.now();
  const expiresAt = new Date(now + defaultSessionConfig.absoluteLifetimeMs).toISOString();
  const idleExpiresAt = new Date(now + defaultSessionConfig.idleTimeoutMs).toISOString();

  const session = await tx.sessions.create({
    userId: subject.id,
    tokenId,
    tokenVerifier,
    expiresAt,
    idleExpiresAt
  });

  if (isAuthError(session)) {
    return session;
  }

  return {
    session,
    transport: {
      kind: context.transport,
      token
    }
  };
}
