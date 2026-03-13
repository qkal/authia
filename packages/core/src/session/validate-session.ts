import type { PluginServices, SessionValidationOutcome } from '@authia/contracts';

export async function validateSession(
  credential: Parameters<PluginServices['sessions']['validateSession']>[0]
): Promise<SessionValidationOutcome> {
  if (!credential) {
    return { kind: 'denied', code: 'INVALID_INPUT' };
  }

  return { kind: 'unauthenticated', code: 'SESSION_REVOKED' };
}
