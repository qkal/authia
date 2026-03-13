import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AdapterResponse, AuthError } from '../../packages/contracts/src/index.js';
import { createCycle2ReferenceApp } from '../../examples/cycle2-compose.js';
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

function stateFromLocation(response: AdapterResponse): string {
  const location = response.headers.location;
  if (typeof location !== 'string') {
    throw new Error('Missing OAuth redirect location header.');
  }
  const state = new URL(location).searchParams.get('state');
  if (!state) {
    throw new Error('Missing OAuth state query parameter.');
  }
  return state;
}

describe.skipIf(shouldSkip)('cycle2 oauth reference flow', () => {
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
    await adminPool.query(`DELETE FROM "${schemaName}".oauth_identities`);
    await adminPool.query(`DELETE FROM "${schemaName}".oauth_states`);
    await adminPool.query(`DELETE FROM "${schemaName}".local_identities`);
    await adminPool.query(`DELETE FROM "${schemaName}".users`);
  });

  afterAll(async () => {
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await adminPool.end();
  });

  it('completes startOAuth/finishOAuth and issues a bearer session', async () => {
    const app = await createCycle2ReferenceApp({ connectionString, config: { publicOrigin } });
    const client = createMemoryResponseClient(app, publicOrigin);

    const start = await client.send({
      method: 'POST',
      path: '/auth/oauth/start',
      body: { provider: 'github', redirectTo: '/dashboard' }
    });
    expect(isAuthError(start)).toBe(false);
    expect((start as AdapterResponse).status).toBe(303);
    const state = stateFromLocation(start as AdapterResponse);

    const finish = await client.send({
      method: 'POST',
      path: '/auth/oauth/finish',
      body: { provider: 'github', code: 'oauth-code-success', state }
    });
    expect(isAuthError(finish)).toBe(false);
    expect((finish as AdapterResponse).status).toBe(200);
    const transport = ((finish as AdapterResponse).body as { transport: { token: string } }).transport;
    expect(transport.token).toBeTruthy();
  });

  it('denies replayed OAuth state', async () => {
    const app = await createCycle2ReferenceApp({ connectionString, config: { publicOrigin } });
    const client = createMemoryResponseClient(app, publicOrigin);

    const start = (await client.send({
      method: 'POST',
      path: '/auth/oauth/start',
      body: { provider: 'github' }
    })) as AdapterResponse;
    const state = stateFromLocation(start);

    const firstFinish = await client.send({
      method: 'POST',
      path: '/auth/oauth/finish',
      body: { provider: 'github', code: 'oauth-code-replay', state }
    });
    expect((firstFinish as AdapterResponse).status).toBe(200);

    const replay = await client.send({
      method: 'POST',
      path: '/auth/oauth/finish',
      body: { provider: 'github', code: 'oauth-code-replay', state }
    });
    expect((replay as AdapterResponse).status).toBe(400);
  });

  it('maps provider rejection to 401 and provider transport failures to infrastructure error', async () => {
    const rejectApp = await createCycle2ReferenceApp({
      connectionString,
      config: { publicOrigin },
      providerMode: 'reject'
    });
    const rejectClient = createMemoryResponseClient(rejectApp, publicOrigin);
    const startReject = (await rejectClient.send({
      method: 'POST',
      path: '/auth/oauth/start',
      body: { provider: 'github' }
    })) as AdapterResponse;
    const rejectState = stateFromLocation(startReject);
    const rejected = await rejectClient.send({
      method: 'POST',
      path: '/auth/oauth/finish',
      body: { provider: 'github', code: 'oauth-code', state: rejectState }
    });
    expect((rejected as AdapterResponse).status).toBe(401);

    const failingApp = await createCycle2ReferenceApp({
      connectionString,
      config: { publicOrigin },
      providerMode: 'transport-failure'
    });
    const failingClient = createMemoryResponseClient(failingApp, publicOrigin);
    const startFail = (await failingClient.send({
      method: 'POST',
      path: '/auth/oauth/start',
      body: { provider: 'github' }
    })) as AdapterResponse;
    const failState = stateFromLocation(startFail);
    const failed = await failingClient.send({
      method: 'POST',
      path: '/auth/oauth/finish',
      body: { provider: 'github', code: 'oauth-code', state: failState }
    });
    expect(isAuthError(failed)).toBe(true);
    expect((failed as AuthError).code).toBe('STORAGE_UNAVAILABLE');
  });

  it('denies invalid redirectTo before provider redirect generation', async () => {
    const app = await createCycle2ReferenceApp({ connectionString, config: { publicOrigin } });
    const client = createMemoryResponseClient(app, publicOrigin);

    const result = await client.send({
      method: 'POST',
      path: '/auth/oauth/start',
      body: { provider: 'github', redirectTo: 'https://attacker.example' }
    });

    expect((result as AdapterResponse).status).toBe(400);
  });
});
