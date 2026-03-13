import type { AuthValue, TransactionalStorage, LocalIdentityCreateInput } from '@authia/contracts';
import type { LocalIdentity } from '@authia/contracts';
import type { DatabaseClient } from '../database.js';
import { storageUnavailable, isDuplicateKeyError, duplicateIdentity } from '../database.js';
import { mapLocalIdentityRow, type LocalIdentityRow } from '../mappers.js';
import { randomUUID } from 'node:crypto';

export function createIdentitiesRepository(client: DatabaseClient): TransactionalStorage['identities'] {
  return {
    create: async (input: LocalIdentityCreateInput): Promise<AuthValue<LocalIdentity>> => {
      try {
        const id = randomUUID();
        
        const result = await client.query<LocalIdentityRow>(
          'INSERT INTO local_identities (id, user_id, normalized_email, password_hash) VALUES ($1, $2, $3, $4) RETURNING *',
          [id, input.userId, input.normalizedEmail, input.passwordHash]
        );
        
        return mapLocalIdentityRow(result.rows[0]);
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          return duplicateIdentity();
        }
        return storageUnavailable('Failed to create identity', error);
      }
    },
    
    findByNormalizedEmail: async (normalizedEmail: string): Promise<AuthValue<LocalIdentity | null>> => {
      try {
        const result = await client.query<LocalIdentityRow>(
          'SELECT * FROM local_identities WHERE normalized_email = $1',
          [normalizedEmail]
        );
        
        if (result.rows.length === 0) {
          return null;
        }
        
        return mapLocalIdentityRow(result.rows[0]);
      } catch (error) {
        return storageUnavailable('Failed to find identity by email', error);
      }
    },
    
    listByUser: async (userId: string): Promise<AuthValue<LocalIdentity[]>> => {
      try {
        const result = await client.query<LocalIdentityRow>(
          'SELECT * FROM local_identities WHERE user_id = $1',
          [userId]
        );
        
        return result.rows.map(mapLocalIdentityRow);
      } catch (error) {
        return storageUnavailable('Failed to list identities', error);
      }
    }
  };
}

