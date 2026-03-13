import type { AuthError, TransactionalStorage } from '@authia/contracts';

function storageUnavailable(message: string): AuthError {
  return {
    category: 'infrastructure',
    code: 'STORAGE_UNAVAILABLE',
    message,
    retryable: false
  };
}

export function createUsersRepository(): TransactionalStorage['users'] {
  return {
    create: async () => storageUnavailable('User persistence is not implemented in the stable base yet.'),
    find: async () => storageUnavailable('User lookup is not implemented in the stable base yet.')
  };
}
