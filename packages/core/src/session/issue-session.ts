import type { AuthError, PluginServices, SessionRecord, SessionTransport, TransactionalStorage, User } from '@authia/contracts';

function notReady(message: string): AuthError {
  return {
    category: 'infrastructure',
    code: 'STORAGE_UNAVAILABLE',
    message,
    retryable: false
  };
}

export async function issueSession(
  _subject: User,
  _tx: TransactionalStorage,
  _context: Parameters<PluginServices['sessions']['issueSession']>[2]
): Promise<{ session: SessionRecord; transport: SessionTransport } | AuthError> {
  return notReady('Session issuance is not implemented in the stable base yet.');
}
