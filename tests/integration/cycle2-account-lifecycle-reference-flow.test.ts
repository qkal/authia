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

describe.skipIf(shouldSkip)('cycle2 account lifecycle delivery flow', () => {
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
    await adminPool.query(`DELETE FROM "${schemaName}".email_verification_tokens`);
    await adminPool.query(`DELETE FROM "${schemaName}".verified_emails`);
    await adminPool.query(`DELETE FROM "${schemaName}".password_reset_tokens`);
    await adminPool.query(`DELETE FROM "${schemaName}".local_identities`);
    await adminPool.query(`DELETE FROM "${schemaName}".users`);
  });

  afterAll(async () => {
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await adminPool.end();
  });

  it('delivers password reset tokens for existing users, then accepts token-based reset', async () => {
    const app = await createCycle2ReferenceApp({ connectionString, config: { publicOrigin } });
    const client = createMemoryResponseClient(app, publicOrigin);

    await client.send({
      method: 'POST',
      path: '/auth/signup',
      body: { email: 'user@example.com', password: 'password123' }
    });

    const requestReset = await client.send({
      method: 'POST',
      path: '/auth/password/request-reset',
      body: { email: 'user@example.com' }
    });
    expect((requestReset as AdapterResponse).status).toBe(200);

    const [resetDelivery] = app.getDeliveries().filter((item) => item.kind === 'passwordReset');
    expect(resetDelivery).toBeTruthy();
    if (!resetDelivery || resetDelivery.kind !== 'passwordReset') {
      throw new Error('Expected password reset delivery');
    }

    const missingIdentityRequest = await client.send({
      method: 'POST',
      path: '/auth/password/request-reset',
      body: { email: 'missing@example.com' }
    });
    expect((missingIdentityRequest as AdapterResponse).status).toBe(200);
    expect(app.getDeliveries().filter((item) => item.kind === 'passwordReset')).toHaveLength(1);

    const reset = await client.send({
      method: 'POST',
      path: '/auth/password/reset',
      body: { resetToken: resetDelivery.token, password: 'new-password123' }
    });
    expect((reset as AdapterResponse).status).toBe(200);

    const oldPassword = await client.send({
      method: 'POST',
      path: '/auth/signin',
      body: { email: 'user@example.com', password: 'password123' }
    });
    expect((oldPassword as AdapterResponse).status).toBe(401);

    const newPassword = await client.send({
      method: 'POST',
      path: '/auth/signin',
      body: { email: 'user@example.com', password: 'new-password123' }
    });
    expect((newPassword as AdapterResponse).status).toBe(200);
  });

  it('delivers verification tokens and marks email as verified once consumed', async () => {
    const app = await createCycle2ReferenceApp({ connectionString, config: { publicOrigin } });
    const client = createMemoryResponseClient(app, publicOrigin);

    await client.send({
      method: 'POST',
      path: '/auth/signup',
      body: { email: 'verify@example.com', password: 'password123' }
    });

    const requestVerification = await client.send({
      method: 'POST',
      path: '/auth/email/request-verification',
      body: { email: 'verify@example.com' }
    });
    expect((requestVerification as AdapterResponse).status).toBe(200);

    const [delivery] = app.getDeliveries().filter((item) => item.kind === 'emailVerification');
    expect(delivery).toBeTruthy();
    if (!delivery || delivery.kind !== 'emailVerification') {
      throw new Error('Expected email verification delivery');
    }

    const verify = await client.send({
      method: 'POST',
      path: '/auth/email/verify',
      body: { verificationToken: delivery.token }
    });
    expect((verify as AdapterResponse).status).toBe(200);

    const secondRequest = await client.send({
      method: 'POST',
      path: '/auth/email/request-verification',
      body: { email: 'verify@example.com' }
    });
    expect((secondRequest as AdapterResponse).status).toBe(200);
    expect(app.getDeliveries().filter((item) => item.kind === 'emailVerification')).toHaveLength(1);
  });

  it('surfaces delivery transport failures as infrastructure errors', async () => {
    const app = await createCycle2ReferenceApp({
      connectionString,
      config: { publicOrigin },
      deliveryMode: 'transport-failure'
    });
    const client = createMemoryResponseClient(app, publicOrigin);

    await client.send({
      method: 'POST',
      path: '/auth/signup',
      body: { email: 'failure@example.com', password: 'password123' }
    });

    const result = await client.send({
      method: 'POST',
      path: '/auth/password/request-reset',
      body: { email: 'failure@example.com' }
    });

    expect(isAuthError(result)).toBe(true);
    expect((result as AuthError).code).toBe('STORAGE_UNAVAILABLE');
  });
});
