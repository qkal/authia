import type { StorageAdapter } from '@authia/contracts';
import { createPool } from './database.js';
import { ensureCompatibleSchema } from './migrations/ensure-compatible-schema.js';
import { createUsersRepository } from './repositories/users-repository.js';
import { createIdentitiesRepository } from './repositories/identities-repository.js';
import { createSessionsRepository } from './repositories/sessions-repository.js';
import { beginTransaction } from './transactions.js';

export function createPostgresStorageAdapter(connectionString: string): StorageAdapter {
  const pool = createPool(connectionString);
  
  return {
    migrations: {
      ensureCompatibleSchema: () => ensureCompatibleSchema(pool)
    },
    users: createUsersRepository(pool),
    identities: createIdentitiesRepository(pool),
    sessions: createSessionsRepository(pool),
    beginTransaction: async (run) => beginTransaction(connectionString, run)
  };
}

export { storageUnavailable } from './database.js';

