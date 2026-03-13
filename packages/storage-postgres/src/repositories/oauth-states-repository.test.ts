import { describe, it, expect, vi } from 'vitest';
import { createOAuthStatesRepository } from './oauth-states-repository.js';
import type { DatabaseClient } from '../database.js';

describe('oauth states repository', () => {
  it('creates and consumes state once with atomic update', async () => {
    const nowIso = new Date().toISOString();
    const createdRow = {
      id: 'state-id',
      provider: 'github',
      state_hash: 'state-hash',
      code_verifier_ciphertext: 'ciphertext',
      redirect_uri_hash: 'redirect-hash',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      consumed_at: null
    };

    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [createdRow] })
      .mockResolvedValueOnce({
        rows: [{ code_verifier_ciphertext: 'ciphertext', redirect_uri_hash: 'redirect-hash' }]
      })
      .mockResolvedValueOnce({ rows: [] });

    const client = { query } as unknown as DatabaseClient;
    const repo = createOAuthStatesRepository(client);

    const created = await repo.create({
      provider: 'github',
      stateHash: 'state-hash',
      codeVerifierCiphertext: 'ciphertext',
      redirectUriHash: 'redirect-hash',
      expiresAt: createdRow.expires_at
    });
    expect(created).toMatchObject({ id: 'state-id', stateHash: 'state-hash' });

    const firstConsume = await repo.consume({
      provider: 'github',
      stateHash: 'state-hash',
      nowIso
    });
    expect(firstConsume).toEqual({
      codeVerifierCiphertext: 'ciphertext',
      redirectUriHash: 'redirect-hash'
    });

    const secondConsume = await repo.consume({
      provider: 'github',
      stateHash: 'state-hash',
      nowIso
    });
    expect(secondConsume).toBeNull();

    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[1][0]).toContain('UPDATE oauth_states');
    expect(query.mock.calls[1][0]).toContain('consumed_at IS NULL');
    expect(query.mock.calls[1][0]).toContain('expires_at > $3');
  });

  it('returns null when state is expired', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });
    const client = { query } as unknown as DatabaseClient;
    const repo = createOAuthStatesRepository(client);

    const consumed = await repo.consume({
      provider: 'github',
      stateHash: 'expired-hash',
      nowIso: new Date().toISOString()
    });

    expect(consumed).toBeNull();
  });
});
