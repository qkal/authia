import type { AuthError, TransactionalStorage } from '@authia/contracts';

function storageUnavailable(message: string): AuthError {
  return {
    category: 'infrastructure',
    code: 'STORAGE_UNAVAILABLE',
    message,
    retryable: false
  };
}

export function createIdentitiesRepository(): TransactionalStorage['identities'] {
  return {
    create: async () => storageUnavailable('Identity creation is not implemented in the stable base yet.'),
    findByNormalizedEmail: async () => storageUnavailable('Identity lookup is not implemented in the stable base yet.'),
    listByUser: async () => storageUnavailable('Identity listing is not implemented in the stable base yet.')
  };
}
