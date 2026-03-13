import type { AuthError, StorageAdapter } from '@authia/contracts';
import { ensureCompatibleSchema } from './migrations/ensure-compatible-schema.js';
import { createUsersRepository } from './repositories/users-repository.js';
import { createIdentitiesRepository } from './repositories/identities-repository.js';
import { createSessionsRepository } from './repositories/sessions-repository.js';
import { beginUnavailableTransaction } from './transactions.js';

function storageUnavailable(message: string): AuthError {
  return {
    category: 'infrastructure',
    code: 'STORAGE_UNAVAILABLE',
    message,
    retryable: false
  };
}

export function createPostgresStorageAdapter(): StorageAdapter {
  return {
    migrations: {
      ensureCompatibleSchema
    },
    users: createUsersRepository(),
    identities: createIdentitiesRepository(),
    sessions: createSessionsRepository(),
    beginTransaction: async (run) => beginUnavailableTransaction(run)
  };
}

export { storageUnavailable };
