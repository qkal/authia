import type { AuthError, TransactionalStorage, RollbackSignal } from '@authia/contracts';
import type { DatabaseClient } from './database.js';
import { storageUnavailable, createPool } from './database.js';
import { createUsersRepository } from './repositories/users-repository.js';
import { createIdentitiesRepository } from './repositories/identities-repository.js';
import { createSessionsRepository } from './repositories/sessions-repository.js';
import { createOAuthStatesRepository } from './repositories/oauth-states-repository.js';
import { createOAuthIdentitiesRepository } from './repositories/oauth-identities-repository.js';
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
    sessions: createSessionsRepository(client),
    oauthStates: createOAuthStatesRepository(client),
    oauthIdentities: createOAuthIdentitiesRepository(client)
  };
}

export async function beginTransaction<T>(
  connectionString: string,
  run: (tx: TransactionalStorage) => Promise<T>
): Promise<T | AuthError> {
  const pool = createPool(connectionString);
  
  let client;
  try {
    client = await pool.connect();
  } catch (error) {
    return storageUnavailable('Failed to acquire database connection', error);
  }
  
  let clientReleased = false;
  
  try {
    await client.query('BEGIN');
    
    const tx = createTransactionalStorage(client);
    const result = await run(tx);
    
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      // Rollback failed - transaction boundary is compromised
      // Release client with destroy flag to prevent reuse of poisoned connection
      client.release(true);
      clientReleased = true;
      return storageUnavailable('Transaction rollback failed', rollbackError);
    }
    
    if (isRollbackSignal(error)) {
      throw error;
    }
    
    return storageUnavailable('Transaction failed', error);
  } finally {
    if (!clientReleased) {
      client.release();
    }
  }
}

