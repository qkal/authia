import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { createPostgresStorageAdapter } from './postgres-storage.js';
import type { AuthError } from '@authia/contracts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skipTests = !TEST_DATABASE_URL;
const skipReason = skipTests ? 'TEST_DATABASE_URL not configured' : undefined;

function isAuthError(value: unknown): value is AuthError {
  return typeof value === 'object' && value !== null && 'code' in value && 'category' in value;
}

describe('PostgreSQL Storage Adapter', () => {
  let pool: pg.Pool | undefined;

  beforeAll(async () => {
    if (skipTests) return;
    
    pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
    
    // Apply schema
    const schemaPath = resolve(__dirname, './migrations/0001_cycle1.sql');
    const schema = readFileSync(schemaPath, 'utf-8');
    await pool.query(schema);
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  beforeEach(async () => {
    if (skipTests || !pool) return;
    
    // Clean all tables
    await pool.query('DELETE FROM sessions');
    await pool.query('DELETE FROM local_identities');
    await pool.query('DELETE FROM users');
  });

  describe.skipIf(skipTests)('Schema compatibility', () => {
    it('should return ok for compatible schema', async () => {
      const adapter = createPostgresStorageAdapter(TEST_DATABASE_URL!);
      const result = await adapter.migrations.ensureCompatibleSchema();
      expect(result).toBe('ok');
    });
  });

  describe.skipIf(skipTests)('Users repository', () => {
    it('should create a user with generated ID and timestamp', async () => {
      const adapter = createPostgresStorageAdapter(TEST_DATABASE_URL!);
      const result = await adapter.users.create({});
      
      expect(isAuthError(result)).toBe(false);
      if (isAuthError(result)) return;
      
      expect(result.id).toBeTruthy();
      expect(typeof result.id).toBe('string');
      expect(result.createdAt).toBeTruthy();
      expect(typeof result.createdAt).toBe('string');
    });

    it('should find an existing user by ID', async () => {
      const adapter = createPostgresStorageAdapter(TEST_DATABASE_URL!);
      const created = await adapter.users.create({});
      expect(isAuthError(created)).toBe(false);
      if (isAuthError(created)) return;

      const found = await adapter.users.find(created.id);
      expect(isAuthError(found)).toBe(false);
      if (isAuthError(found)) return;
      
      expect(found).not.toBeNull();
      expect(found?.id).toBe(created.id);
      expect(found?.createdAt).toBe(created.createdAt);
    });

    it('should return null for non-existent user', async () => {
      const adapter = createPostgresStorageAdapter(TEST_DATABASE_URL!);
      const found = await adapter.users.find('nonexistent-id');
      
      expect(isAuthError(found)).toBe(false);
      if (isAuthError(found)) return;
      expect(found).toBeNull();
    });
  });

  describe.skipIf(skipTests)('Identities repository', () => {
    it('should create a local identity', async () => {
      const adapter = createPostgresStorageAdapter(TEST_DATABASE_URL!);
      const user = await adapter.users.create({});
      expect(isAuthError(user)).toBe(false);
      if (isAuthError(user)) return;

      const identity = await adapter.identities.create({
        userId: user.id,
        normalizedEmail: 'test@example.com',
        passwordHash: 'hashed-password'
      });

      expect(isAuthError(identity)).toBe(false);
      if (isAuthError(identity)) return;
      
      expect(identity.id).toBeTruthy();
      expect(identity.userId).toBe(user.id);
      expect(identity.normalizedEmail).toBe('test@example.com');
      expect(identity.passwordHash).toBe('hashed-password');
    });

    it('should return DUPLICATE_IDENTITY for duplicate normalized_email', async () => {
      const adapter = createPostgresStorageAdapter(TEST_DATABASE_URL!);
      const user1 = await adapter.users.create({});
      const user2 = await adapter.users.create({});
      expect(isAuthError(user1)).toBe(false);
      expect(isAuthError(user2)).toBe(false);
      if (isAuthError(user1) || isAuthError(user2)) return;

      await adapter.identities.create({
        userId: user1.id,
        normalizedEmail: 'duplicate@example.com',
        passwordHash: 'hash1'
      });

      const duplicate = await adapter.identities.create({
        userId: user2.id,
        normalizedEmail: 'duplicate@example.com',
        passwordHash: 'hash2'
      });

      expect(isAuthError(duplicate)).toBe(true);
      if (!isAuthError(duplicate)) return;
      expect(duplicate.code).toBe('DUPLICATE_IDENTITY');
    });

    it('should find identity by normalized email', async () => {
      const adapter = createPostgresStorageAdapter(TEST_DATABASE_URL!);
      const user = await adapter.users.create({});
      expect(isAuthError(user)).toBe(false);
      if (isAuthError(user)) return;

      const created = await adapter.identities.create({
        userId: user.id,
        normalizedEmail: 'find@example.com',
        passwordHash: 'hashed'
      });
      expect(isAuthError(created)).toBe(false);
      if (isAuthError(created)) return;

      const found = await adapter.identities.findByNormalizedEmail('find@example.com');
      expect(isAuthError(found)).toBe(false);
      if (isAuthError(found)) return;
      
      expect(found).not.toBeNull();
      expect(found?.id).toBe(created.id);
      expect(found?.userId).toBe(user.id);
    });

    it('should return null for non-existent email', async () => {
      const adapter = createPostgresStorageAdapter(TEST_DATABASE_URL!);
      const found = await adapter.identities.findByNormalizedEmail('nonexistent@example.com');
      
      expect(isAuthError(found)).toBe(false);
      if (isAuthError(found)) return;
      expect(found).toBeNull();
    });

    it('should list identities by user', async () => {
      const adapter = createPostgresStorageAdapter(TEST_DATABASE_URL!);
      const user = await adapter.users.create({});
      expect(isAuthError(user)).toBe(false);
      if (isAuthError(user)) return;

      await adapter.identities.create({
        userId: user.id,
        normalizedEmail: 'email1@example.com',
        passwordHash: 'hash1'
      });

      await adapter.identities.create({
        userId: user.id,
        normalizedEmail: 'email2@example.com',
        passwordHash: 'hash2'
      });

      const list = await adapter.identities.listByUser(user.id);
      expect(isAuthError(list)).toBe(false);
      if (isAuthError(list)) return;
      
      expect(list.length).toBe(2);
      expect(list.map(i => i.normalizedEmail).sort()).toEqual(['email1@example.com', 'email2@example.com']);
    });
  });

  describe.skipIf(skipTests)('Sessions repository', () => {
    it('should create a session', async () => {
      const adapter = createPostgresStorageAdapter(TEST_DATABASE_URL!);
      const user = await adapter.users.create({});
      expect(isAuthError(user)).toBe(false);
      if (isAuthError(user)) return;

      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 86400000).toISOString();
      const idleExpiresAt = new Date(Date.now() + 43200000).toISOString();

      const session = await adapter.sessions.create({
        userId: user.id,
        tokenId: 'token-123',
        tokenVerifier: 'verifier-123',
        expiresAt,
        idleExpiresAt
      });

      expect(isAuthError(session)).toBe(false);
      if (isAuthError(session)) return;
      
      expect(session.id).toBeTruthy();
      expect(session.userId).toBe(user.id);
      expect(session.currentTokenId).toBe('token-123');
      expect(session.currentTokenVerifier).toBe('verifier-123');
      expect(session.expiresAt).toBe(expiresAt);
      expect(session.idleExpiresAt).toBe(idleExpiresAt);
      expect(session.revokedAt).toBeNull();
    });

    it('should find session by current token ID', async () => {
      const adapter = createPostgresStorageAdapter(TEST_DATABASE_URL!);
      const user = await adapter.users.create({});
      expect(isAuthError(user)).toBe(false);
      if (isAuthError(user)) return;

      const created = await adapter.sessions.create({
        userId: user.id,
        tokenId: 'find-token',
        tokenVerifier: 'verifier',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        idleExpiresAt: new Date(Date.now() + 43200000).toISOString()
      });
      expect(isAuthError(created)).toBe(false);
      if (isAuthError(created)) return;

      const found = await adapter.sessions.findByCurrentTokenId('find-token');
      expect(isAuthError(found)).toBe(false);
      if (isAuthError(found)) return;
      
      expect(found).not.toBeNull();
      expect(found?.id).toBe(created.id);
      expect(found?.currentTokenId).toBe('find-token');
    });

    it('should update session fields', async () => {
      const adapter = createPostgresStorageAdapter(TEST_DATABASE_URL!);
      const user = await adapter.users.create({});
      expect(isAuthError(user)).toBe(false);
      if (isAuthError(user)) return;

      const created = await adapter.sessions.create({
        userId: user.id,
        tokenId: 'original-token',
        tokenVerifier: 'original-verifier',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        idleExpiresAt: new Date(Date.now() + 43200000).toISOString()
      });
      expect(isAuthError(created)).toBe(false);
      if (isAuthError(created)) return;

      const newExpiresAt = new Date(Date.now() + 172800000).toISOString();
      const updated = await adapter.sessions.update(created.id, {
        expiresAt: newExpiresAt
      });

      expect(isAuthError(updated)).toBe(false);
      if (isAuthError(updated)) return;
      
      expect(updated.id).toBe(created.id);
      expect(updated.expiresAt).toBe(newExpiresAt);
      expect(updated.currentTokenId).toBe('original-token');
    });

    it('should atomically compare and swap token', async () => {
      const adapter = createPostgresStorageAdapter(TEST_DATABASE_URL!);
      const user = await adapter.users.create({});
      expect(isAuthError(user)).toBe(false);
      if (isAuthError(user)) return;

      const created = await adapter.sessions.create({
        userId: user.id,
        tokenId: 'old-token',
        tokenVerifier: 'old-verifier',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        idleExpiresAt: new Date(Date.now() + 43200000).toISOString()
      });
      expect(isAuthError(created)).toBe(false);
      if (isAuthError(created)) return;

      const nextRotatedAt = new Date().toISOString();
      const nextIdleExpiresAt = new Date(Date.now() + 43200000).toISOString();

      const swapped = await adapter.sessions.compareAndSwapToken({
        sessionId: created.id,
        expectedTokenId: 'old-token',
        nextTokenId: 'new-token',
        nextTokenVerifier: 'new-verifier',
        nextLastRotatedAt: nextRotatedAt,
        nextIdleExpiresAt
      });

      expect(isAuthError(swapped)).toBe(false);
      if (isAuthError(swapped)) return;
      
      expect(swapped).not.toBeNull();
      expect(swapped?.currentTokenId).toBe('new-token');
      expect(swapped?.currentTokenVerifier).toBe('new-verifier');
      expect(swapped?.lastRotatedAt).toBe(nextRotatedAt);
    });

    it('should return null when CAS token ID does not match', async () => {
      const adapter = createPostgresStorageAdapter(TEST_DATABASE_URL!);
      const user = await adapter.users.create({});
      expect(isAuthError(user)).toBe(false);
      if (isAuthError(user)) return;

      const created = await adapter.sessions.create({
        userId: user.id,
        tokenId: 'current-token',
        tokenVerifier: 'verifier',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        idleExpiresAt: new Date(Date.now() + 43200000).toISOString()
      });
      expect(isAuthError(created)).toBe(false);
      if (isAuthError(created)) return;

      const swapped = await adapter.sessions.compareAndSwapToken({
        sessionId: created.id,
        expectedTokenId: 'wrong-token',
        nextTokenId: 'new-token',
        nextTokenVerifier: 'new-verifier',
        nextLastRotatedAt: new Date().toISOString(),
        nextIdleExpiresAt: new Date(Date.now() + 43200000).toISOString()
      });

      expect(isAuthError(swapped)).toBe(false);
      if (isAuthError(swapped)) return;
      expect(swapped).toBeNull();
    });

    it('should revoke a session', async () => {
      const adapter = createPostgresStorageAdapter(TEST_DATABASE_URL!);
      const user = await adapter.users.create({});
      expect(isAuthError(user)).toBe(false);
      if (isAuthError(user)) return;

      const created = await adapter.sessions.create({
        userId: user.id,
        tokenId: 'token',
        tokenVerifier: 'verifier',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        idleExpiresAt: new Date(Date.now() + 43200000).toISOString()
      });
      expect(isAuthError(created)).toBe(false);
      if (isAuthError(created)) return;

      const result = await adapter.sessions.revoke(created.id);
      expect(isAuthError(result)).toBe(false);

      const found = await adapter.sessions.findByCurrentTokenId('token');
      expect(isAuthError(found)).toBe(false);
      if (isAuthError(found)) return;
      
      expect(found).not.toBeNull();
      expect(found?.revokedAt).toBeTruthy();
    });

    it('should revoke all sessions for a user', async () => {
      const adapter = createPostgresStorageAdapter(TEST_DATABASE_URL!);
      const user = await adapter.users.create({});
      expect(isAuthError(user)).toBe(false);
      if (isAuthError(user)) return;

      await adapter.sessions.create({
        userId: user.id,
        tokenId: 'token1',
        tokenVerifier: 'verifier1',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        idleExpiresAt: new Date(Date.now() + 43200000).toISOString()
      });

      await adapter.sessions.create({
        userId: user.id,
        tokenId: 'token2',
        tokenVerifier: 'verifier2',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        idleExpiresAt: new Date(Date.now() + 43200000).toISOString()
      });

      const count = await adapter.sessions.revokeAllForUser(user.id);
      expect(isAuthError(count)).toBe(false);
      if (isAuthError(count)) return;
      
      expect(count).toBe(2);
    });
  });

  describe.skipIf(skipTests)('Transactions', () => {
    it('should commit on successful resolution', async () => {
      const adapter = createPostgresStorageAdapter(TEST_DATABASE_URL!);
      
      const result = await adapter.beginTransaction(async (tx) => {
        const user = await tx.users.create({});
        expect(isAuthError(user)).toBe(false);
        if (isAuthError(user)) return null;
        return user;
      });

      expect(isAuthError(result)).toBe(false);
      if (isAuthError(result)) return;
      expect(result).not.toBeNull();

      // Verify user was committed
      const found = await adapter.users.find(result!.id);
      expect(isAuthError(found)).toBe(false);
      if (isAuthError(found)) return;
      expect(found).not.toBeNull();
    });

    it('should rollback and re-throw rollback signals', async () => {
      const adapter = createPostgresStorageAdapter(TEST_DATABASE_URL!);
      
      const result = await adapter.beginTransaction(async (tx) => {
        await tx.users.create({});
        
        // Throw rollback signal
        throw {
          outcome: {
            kind: 'denied',
            code: 'INVALID_INPUT'
          }
        };
      });

      expect(isAuthError(result)).toBe(false);
      if (isAuthError(result)) return;
      
      // Result should be the rollback outcome
      expect(result).toEqual({
        kind: 'denied',
        code: 'INVALID_INPUT'
      });

      // Verify user was rolled back
      if (pool) {
        const users = await pool.query('SELECT * FROM users');
        expect(users.rows.length).toBe(0);
      }
    });

    it('should rollback and return STORAGE_UNAVAILABLE for non-rollback errors', async () => {
      const adapter = createPostgresStorageAdapter(TEST_DATABASE_URL!);
      
      const result = await adapter.beginTransaction(async (tx) => {
        await tx.users.create({});
        throw new Error('Unexpected database error');
      });

      expect(isAuthError(result)).toBe(true);
      if (!isAuthError(result)) return;
      
      expect(result.code).toBe('STORAGE_UNAVAILABLE');

      // Verify user was rolled back
      if (pool) {
        const users = await pool.query('SELECT * FROM users');
        expect(users.rows.length).toBe(0);
      }
    });

    it('should use one connection for transaction', async () => {
      const adapter = createPostgresStorageAdapter(TEST_DATABASE_URL!);
      
      const result = await adapter.beginTransaction(async (tx) => {
        const user = await tx.users.create({});
        expect(isAuthError(user)).toBe(false);
        if (isAuthError(user)) return null;

        // This should see the user created in the same transaction
        const found = await tx.users.find(user.id);
        expect(isAuthError(found)).toBe(false);
        if (isAuthError(found)) return null;
        
        expect(found).not.toBeNull();
        expect(found?.id).toBe(user.id);
        return user;
      });

      expect(isAuthError(result)).toBe(false);
    });
  });
});
