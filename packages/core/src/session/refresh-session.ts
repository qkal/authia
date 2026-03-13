import type { AuthError, PluginServices, SessionRecord, SessionTransport, TransactionalStorage } from '@authia/contracts';

function notReady(message: string): AuthError {
  return {
    category: 'infrastructure',
    code: 'STORAGE_UNAVAILABLE',
    message,
    retryable: false
  };
}

export async function refreshSession(
  _session: SessionRecord,
  _tx: TransactionalStorage,
  _context: Parameters<PluginServices['sessions']['refreshSession']>[2]
): Promise<{ session: SessionRecord; transport: SessionTransport } | AuthError> {
  return notReady('Session refresh is not implemented in the stable base yet.');
}
