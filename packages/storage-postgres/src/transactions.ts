import type { AuthError, TransactionalStorage, RollbackSignal } from '@authia/contracts';
import type { DatabaseClient } from './database.js';
import { storageUnavailable, createPool } from './database.js';
import { createUsersRepository } from './repositories/users-repository.js';
import { createIdentitiesRepository } from './repositories/identities-repository.js';
import { createSessionsRepository } from './repositories/sessions-repository.js';
import { ensureCompatibleSchema } from './migrations/ensure-compatible-schema.js';

function isRollbackSignal(error: unknown): error is RollbackSignal {
  return (
    typeof error === 'object' &&
    error !== null &&
    'outcome' in error &&
    typeof (error as any).outcome === 'object'
  );
}

function createTransactionalStorage(client: DatabaseClient): TransactionalStorage {
  return {
    migrations: {
      ensureCompatibleSchema: () => ensureCompatibleSchema(client)
    },
    users: createUsersRepository(client),
    identities: createIdentitiesRepository(client),
    sessions: createSessionsRepository(client)
  };
}

export async function beginTransaction<T>(
  connectionString: string,
  run: (tx: TransactionalStorage) => Promise<T>
): Promise<T | AuthError> {
  const pool = createPool(connectionString);
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const tx = createTransactionalStorage(client);
    const result = await run(tx);
    
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    
    if (isRollbackSignal(error)) {
      // Re-throw the outcome from the rollback signal
      return error.outcome as T;
    }
    
    return storageUnavailable('Transaction failed', error);
  } finally {
    client.release();
  }
}

