import type { AuthError } from '@authia/contracts';
import type { DatabaseClient } from '../database.js';
import { storageUnavailable } from '../database.js';

const EXPECTED_TABLES = ['users', 'local_identities', 'sessions'];
const EXPECTED_COLUMNS = {
  users: ['id', 'created_at'],
  local_identities: ['id', 'user_id', 'normalized_email', 'password_hash'],
  sessions: [
    'id',
    'user_id',
    'current_token_id',
    'current_token_verifier',
    'last_rotated_at',
    'expires_at',
    'idle_expires_at',
    'revoked_at'
  ]
};

export async function ensureCompatibleSchema(
  client: DatabaseClient
): Promise<'ok' | 'MIGRATION_MISMATCH' | AuthError> {
  try {
    // Check if all expected tables exist
    const tableResult = await client.query<{ table_name: string }>(
      `SELECT table_name 
       FROM information_schema.tables 
       WHERE table_schema = 'public' 
       AND table_name = ANY($1::text[])`,
      [EXPECTED_TABLES]
    );

    const existingTables = new Set(tableResult.rows.map((r) => r.table_name));

    for (const table of EXPECTED_TABLES) {
      if (!existingTables.has(table)) {
        return 'MIGRATION_MISMATCH';
      }
    }

    // Check if all expected columns exist for each table
    for (const [table, expectedColumns] of Object.entries(EXPECTED_COLUMNS)) {
      const columnResult = await client.query<{ column_name: string }>(
        `SELECT column_name 
         FROM information_schema.columns 
         WHERE table_schema = 'public' 
         AND table_name = $1`,
        [table]
      );

      const existingColumns = new Set(columnResult.rows.map((r) => r.column_name));

      for (const column of expectedColumns) {
        if (!existingColumns.has(column)) {
          return 'MIGRATION_MISMATCH';
        }
      }
    }

    return 'ok';
  } catch (error) {
    return storageUnavailable('Failed to check schema compatibility', error);
  }
}

