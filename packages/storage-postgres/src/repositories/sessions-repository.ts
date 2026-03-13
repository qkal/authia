import type { AuthError, TransactionalStorage } from '@authia/contracts';

function storageUnavailable(message: string): AuthError {
  return {
    category: 'infrastructure',
    code: 'STORAGE_UNAVAILABLE',
    message,
    retryable: false
  };
}

export function createSessionsRepository(): TransactionalStorage['sessions'] {
  return {
    create: async () => storageUnavailable('Session creation is not implemented in the stable base yet.'),
    findByCurrentTokenId: async () => storageUnavailable('Session lookup is not implemented in the stable base yet.'),
    update: async () => storageUnavailable('Session updates are not implemented in the stable base yet.'),
    compareAndSwapToken: async () => storageUnavailable('Session rotation is not implemented in the stable base yet.'),
    revoke: async () => storageUnavailable('Session revocation is not implemented in the stable base yet.'),
    revokeAllForUser: async () => storageUnavailable('Bulk session revocation is not implemented in the stable base yet.')
  };
}
