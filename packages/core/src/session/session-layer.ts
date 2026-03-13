import type { SessionLayer as SessionLayerContract } from '@authia/contracts';
import { issueSession } from './issue-session.js';
import { refreshSession } from './refresh-session.js';
import { validateSession } from './validate-session.js';

export function createSessionLayer(): SessionLayerContract {
  return {
    issueSession,
    validateSession: async (credential) => validateSession(credential),
    refreshSession,
    revokeSession: async () => undefined,
    revokeAllSessions: async () => 0
  };
}
