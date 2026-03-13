import type { AuthError, PluginServices, SessionLayer as SessionLayerContract } from '@authia/contracts';
import { issueSession } from './issue-session.js';
import { refreshSession } from './refresh-session.js';
import { validateSession } from './validate-session.js';

type SessionLayerDependencies = {
  storage: Pick<PluginServices['storage'], 'users' | 'sessions'>;
  crypto: {
    generateOpaqueToken: (...args: unknown[]) => unknown;
    deriveTokenId: (...args: unknown[]) => unknown;
    deriveTokenVerifier: (...args: unknown[]) => unknown;
    verifyOpaqueToken: (...args: unknown[]) => unknown;
  };
};

function isAuthError<T>(value: T | AuthError): value is AuthError {
  return typeof value === 'object' && value !== null && 'category' in value && 'code' in value;
}

export function createSessionLayer(services: SessionLayerDependencies): SessionLayerContract {
  return {
    issueSession: async (subject, tx, context) => issueSession(services as never, subject, tx, context),
    validateSession: async (credential) => validateSession(services as never, credential),
    refreshSession: async (session, tx, context) => refreshSession(services as never, session, tx, context),
    revokeSession: async (sessionId, tx) => {
      if (tx) {
        return tx.sessions.revoke(sessionId);
      }
      return services.storage.sessions.revoke(sessionId);
    },
    revokeAllSessions: async (userId, tx) => {
      const result = tx
        ? await tx.sessions.revokeAllForUser(userId)
        : await services.storage.sessions.revokeAllForUser(userId);
      if (isAuthError(result)) {
        return result;
      }
      return result;
    }
  };
}
