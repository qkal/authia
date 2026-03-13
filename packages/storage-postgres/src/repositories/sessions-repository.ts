import type {
  AuthValue,
  TransactionalStorage,
  SessionCreateInput,
  SessionUpdateInput,
  SessionCompareAndSwapInput
} from '@authia/contracts';
import type { SessionRecord } from '@authia/contracts';
import type { DatabaseClient } from '../database.js';
import { storageUnavailable } from '../database.js';
import { mapSessionRow, type SessionRow } from '../mappers.js';
import { randomUUID } from 'node:crypto';

export function createSessionsRepository(client: DatabaseClient): TransactionalStorage['sessions'] {
  return {
    create: async (input: SessionCreateInput): Promise<AuthValue<SessionRecord>> => {
      try {
        const id = randomUUID();
        const lastRotatedAt = new Date().toISOString();
        
        const result = await client.query<SessionRow>(
          `INSERT INTO sessions 
           (id, user_id, current_token_id, current_token_verifier, last_rotated_at, expires_at, idle_expires_at, revoked_at) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, NULL) 
           RETURNING *`,
          [id, input.userId, input.tokenId, input.tokenVerifier, lastRotatedAt, input.expiresAt, input.idleExpiresAt]
        );
        
        return mapSessionRow(result.rows[0]);
      } catch (error) {
        return storageUnavailable('Failed to create session', error);
      }
    },
    
    findByCurrentTokenId: async (tokenId: string): Promise<AuthValue<SessionRecord | null>> => {
      try {
        const result = await client.query<SessionRow>(
          'SELECT * FROM sessions WHERE current_token_id = $1',
          [tokenId]
        );
        
        if (result.rows.length === 0) {
          return null;
        }
        
        return mapSessionRow(result.rows[0]);
      } catch (error) {
        return storageUnavailable('Failed to find session by token', error);
      }
    },
    
    update: async (sessionId: string, input: SessionUpdateInput): Promise<AuthValue<SessionRecord>> => {
      try {
        const updates: string[] = [];
        const values: any[] = [];
        let paramIndex = 1;
        
        if (input.tokenId !== undefined) {
          updates.push(`current_token_id = $${paramIndex++}`);
          values.push(input.tokenId);
        }
        if (input.tokenVerifier !== undefined) {
          updates.push(`current_token_verifier = $${paramIndex++}`);
          values.push(input.tokenVerifier);
        }
        if (input.lastRotatedAt !== undefined) {
          updates.push(`last_rotated_at = $${paramIndex++}`);
          values.push(input.lastRotatedAt);
        }
        if (input.expiresAt !== undefined) {
          updates.push(`expires_at = $${paramIndex++}`);
          values.push(input.expiresAt);
        }
        if (input.idleExpiresAt !== undefined) {
          updates.push(`idle_expires_at = $${paramIndex++}`);
          values.push(input.idleExpiresAt);
        }
        if (input.revokedAt !== undefined) {
          updates.push(`revoked_at = $${paramIndex++}`);
          values.push(input.revokedAt);
        }
        
        values.push(sessionId);
        
        const result = await client.query<SessionRow>(
          `UPDATE sessions SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
          values
        );
        
        if (result.rows.length === 0) {
          return storageUnavailable('Session not found for update');
        }
        
        return mapSessionRow(result.rows[0]);
      } catch (error) {
        return storageUnavailable('Failed to update session', error);
      }
    },
    
    compareAndSwapToken: async (input: SessionCompareAndSwapInput): Promise<AuthValue<SessionRecord | null>> => {
      try {
        // Atomic compare-and-swap: only update if current_token_id matches expected
        const result = await client.query<SessionRow>(
          `UPDATE sessions 
           SET current_token_id = $1, 
               current_token_verifier = $2, 
               last_rotated_at = $3, 
               idle_expires_at = $4
           WHERE id = $5 AND current_token_id = $6
           RETURNING *`,
          [
            input.nextTokenId,
            input.nextTokenVerifier,
            input.nextLastRotatedAt,
            input.nextIdleExpiresAt,
            input.sessionId,
            input.expectedTokenId
          ]
        );
        
        if (result.rows.length === 0) {
          // Either session doesn't exist or token ID doesn't match
          // Check if session exists to distinguish
          const check = await client.query(
            'SELECT id FROM sessions WHERE id = $1',
            [input.sessionId]
          );
          
          if (check.rows.length === 0) {
            return storageUnavailable('Session not found for token swap');
          }
          
          // Token ID mismatch - return null to indicate CAS failure
          return null;
        }
        
        return mapSessionRow(result.rows[0]);
      } catch (error) {
        return storageUnavailable('Failed to swap session token', error);
      }
    },
    
    revoke: async (sessionId: string): Promise<AuthValue<void>> => {
      try {
        const revokedAt = new Date().toISOString();
        await client.query(
          'UPDATE sessions SET revoked_at = $1 WHERE id = $2',
          [revokedAt, sessionId]
        );
      } catch (error) {
        return storageUnavailable('Failed to revoke session', error);
      }
    },
    
    revokeAllForUser: async (userId: string): Promise<AuthValue<number>> => {
      try {
        const revokedAt = new Date().toISOString();
        const result = await client.query(
          'UPDATE sessions SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL',
          [revokedAt, userId]
        );
        
        return result.rowCount ?? 0;
      } catch (error) {
        return storageUnavailable('Failed to revoke user sessions', error);
      }
    }
  };
}

