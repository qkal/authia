import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDefaultCryptoProvider } from '../../packages/crypto-default/src/index.js';
import type { AdapterResponse, AuthError } from '../../packages/contracts/src/index.js';
import { createCycle1ReferenceApp } from '../../examples/cycle1-compose.js';
import { createMemoryResponseClient } from './helpers/memory-response.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const shouldSkip = !TEST_DATABASE_URL;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function isAuthError(value: unknown): value is AuthError {
  return typeof value === 'object' && value !== null && 'category' in value && 'code' in value;
}

function withSearchPath(connectionString: string, schemaName: string): string {
  const url = new URL(connectionString);
  url.searchParams.set('options', `-c search_path=${schemaName},public`);
  return url.toString();
}

describe.skipIf(shouldSkip)('cycle1 reference flow', () => {
  const publicOrigin = 'https://example.com';
  let adminPool: pg.Pool;
  let schemaName: string;
  let connectionString: string;

  beforeAll(async () => {
    schemaName = `it_${randomUUID().replace(/-/g, '')}`;
    connectionString = withSearchPath(TEST_DATABASE_URL!, schemaName);
    adminPool = new pg.Pool({ connectionString: TEST_DATABASE_URL! });

    await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
    const migrationSql = readFileSync(
      resolve(__dirname, '../../packages/storage-postgres/src/migrations/0001_cycle1.sql'),
      'utf-8'
    );
    await adminPool.query(`SET search_path TO "${schemaName}", public`);
    await adminPool.query(migrationSql);
  });

  beforeEach(async () => {
    await adminPool.query(`DELETE FROM "${schemaName}".sessions`);
    await adminPool.query(`DELETE FROM "${schemaName}".local_identities`);
    await adminPool.query(`DELETE FROM "${schemaName}".users`);
  });

  afterAll(async () => {
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await adminPool.end();
  });

  it('supports sign-up, sign-in, session read, refresh, logout and logoutAll flows', async () => {
    const app = await createCycle1ReferenceApp({
      connectionString,
      config: { publicOrigin }
    });
    const client = createMemoryResponseClient(app, publicOrigin);

    const signup = await client.send({
      method: 'POST',
      path: '/auth/signup',
      body: { email: 'user@example.com', password: 'password123' }
    });
    expect(isAuthError(signup)).toBe(false);
    expect((signup as AdapterResponse).status).toBe(200);

    const duplicate = await client.send({
      method: 'POST',
      path: '/auth/signup',
      body: { email: 'user@example.com', password: 'password123' }
    });
    expect(isAuthError(duplicate)).toBe(false);
    expect((duplicate as AdapterResponse).status).toBe(409);

    const wrongPassword = await client.send({
      method: 'POST',
      path: '/auth/signin',
      body: { email: 'user@example.com', password: 'bad-password' }
    });
    expect(isAuthError(wrongPassword)).toBe(false);
    expect((wrongPassword as AdapterResponse).status).toBe(401);

    const signin = await client.send({
      method: 'POST',
      path: '/auth/signin',
      body: { email: 'user@example.com', password: 'password123' }
    });
    expect(isAuthError(signin)).toBe(false);
    expect((signin as AdapterResponse).status).toBe(200);
    const signInBody = (signin as AdapterResponse).body as {
      transport: { kind: 'bearer'; token: string };
    };
    const token = signInBody.transport.token;
    expect(token).toBeTruthy();

    const missingCredential = await client.send({
      method: 'GET',
      path: '/auth/session'
    });
    expect((missingCredential as AdapterResponse).status).toBe(400);

    const getSession = await client.send({
      method: 'GET',
      path: '/auth/session',
      token
    });
    expect((getSession as AdapterResponse).status).toBe(200);

    const refresh = await client.send({
      method: 'POST',
      path: '/auth/refresh',
      token
    });
    expect((refresh as AdapterResponse).status).toBe(200);

    const logout = await client.send({
      method: 'POST',
      path: '/auth/logout',
      token
    });
    expect((logout as AdapterResponse).status).toBe(204);
    expect((logout as AdapterResponse).clearBearer).toBe(true);

    const logoutAllAfterRevoke = await client.send({
      method: 'POST',
      path: '/auth/logout-all',
      token
    });
    expect((logoutAllAfterRevoke as AdapterResponse).status).toBe(401);

    const logoutAllWithoutCredential = await client.send({
      method: 'POST',
      path: '/auth/logout-all'
    });
    expect((logoutAllWithoutCredential as AdapterResponse).status).toBe(400);
  });

  it('enforces CSRF-origin checks for state-changing bearer routes', async () => {
    const app = await createCycle1ReferenceApp({
      connectionString,
      config: { publicOrigin }
    });

    const denied = await app.handleRequest({
      method: 'POST',
      url: `${publicOrigin}/auth/signin`,
      headers: { origin: 'https://attacker.example' },
      cookies: {},
      body: { email: 'user@example.com', password: 'password123' }
    });
    expect(isAuthError(denied)).toBe(false);
    expect((denied as AdapterResponse).status).toBe(403);
  });

  it('returns one refresh success and one refresh race-loser unauthenticated outcome', async () => {
    const app = await createCycle1ReferenceApp({
      connectionString,
      config: { publicOrigin }
    });
    const client = createMemoryResponseClient(app, publicOrigin);
    const crypto = createDefaultCryptoProvider();

    await client.send({
      method: 'POST',
      path: '/auth/signup',
      body: { email: 'race@example.com', password: 'password123' }
    });
    const signin = (await client.send({
      method: 'POST',
      path: '/auth/signin',
      body: { email: 'race@example.com', password: 'password123' }
    })) as AdapterResponse;
    const token = ((signin.body as { transport: { token: string } }).transport.token);

    const tokenId = await crypto.deriveTokenId(token);
    if (typeof tokenId !== 'string') {
      throw new Error('Failed to derive token id for race test.');
    }
    await adminPool.query(`UPDATE "${schemaName}".sessions SET last_rotated_at = NOW() - INTERVAL '2 days' WHERE current_token_id = $1`, [tokenId]);

    const [first, second] = await Promise.all([
      client.send({ method: 'POST', path: '/auth/refresh', token }),
      client.send({ method: 'POST', path: '/auth/refresh', token })
    ]);

    const statuses = [(first as AdapterResponse).status, (second as AdapterResponse).status].sort();
    expect(statuses).toEqual([200, 401]);
  });

  it('fails composition when storage is unavailable', async () => {
    await expect(
      createCycle1ReferenceApp({
        connectionString: 'postgres://invalid:invalid@127.0.0.1:1/invalid',
        config: { publicOrigin }
      })
    ).rejects.toThrow();
  });
});
