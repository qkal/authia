import type { AuthValue, TransactionalStorage, UserCreateInput } from '@authia/contracts';
import type { User } from '@authia/contracts';
import type { DatabaseClient } from '../database.js';
import { storageUnavailable } from '../database.js';
import { mapUserRow, type UserRow } from '../mappers.js';
import { randomUUID } from 'node:crypto';

export function createUsersRepository(client: DatabaseClient): TransactionalStorage['users'] {
  return {
    create: async (_input: UserCreateInput): Promise<AuthValue<User>> => {
      try {
        const id = randomUUID();
        const createdAt = new Date().toISOString();
        
        const result = await client.query<UserRow>(
          'INSERT INTO users (id, created_at) VALUES ($1, $2) RETURNING *',
          [id, createdAt]
        );
        
        return mapUserRow(result.rows[0]);
      } catch (error) {
        return storageUnavailable('Failed to create user', error);
      }
    },
    
    find: async (id: string): Promise<AuthValue<User | null>> => {
      try {
        const result = await client.query<UserRow>(
          'SELECT * FROM users WHERE id = $1',
          [id]
        );
        
        if (result.rows.length === 0) {
          return null;
        }
        
        return mapUserRow(result.rows[0]);
      } catch (error) {
        return storageUnavailable('Failed to find user', error);
      }
    }
  };
}

