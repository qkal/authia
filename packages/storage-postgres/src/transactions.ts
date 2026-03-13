import type { AuthError, TransactionalStorage } from '@authia/contracts';

function storageUnavailable(): AuthError {
  return {
    category: 'infrastructure',
    code: 'STORAGE_UNAVAILABLE',
    message: 'Transactional storage is not implemented in the stable base yet.',
    retryable: false
  };
}

export async function beginUnavailableTransaction<T>(_: (tx: TransactionalStorage) => Promise<T>) {
  return storageUnavailable() as T | AuthError;
}
