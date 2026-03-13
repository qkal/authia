import { describe, it, expect, vi } from 'vitest';
import { createOAuthIdentitiesRepository } from './oauth-identities-repository.js';
import type { DatabaseClient } from '../database.js';

describe('oauth identities repository', () => {
  it('returns duplicate identity error when provider-subject is not unique', async () => {
    const duplicateError = Object.assign(new Error('duplicate key'), { code: '23505' });
    const query = vi.fn().mockRejectedValueOnce(duplicateError);
    const client = { query } as unknown as DatabaseClient;
    const repo = createOAuthIdentitiesRepository(client);
    if (!repo) {
      throw new Error('OAuth identities repository is unavailable.');
    }

    const result = await repo.create({
      userId: 'user-1',
      provider: 'github',
      providerSubject: 'subject-1'
    });

    expect(result).toMatchObject({
      category: 'infrastructure',
      code: 'DUPLICATE_IDENTITY'
    });
  });

  it('finds mapping by provider and subject', async () => {
    const row = {
      id: 'oauth-id-1',
      user_id: 'user-1',
      provider: 'google',
      provider_subject: 'subject-lookup'
    };

    const query = vi.fn().mockResolvedValueOnce({ rows: [row] });
    const client = { query } as unknown as DatabaseClient;
    const repo = createOAuthIdentitiesRepository(client);
    if (!repo) {
      throw new Error('OAuth identities repository is unavailable.');
    }

    const found = await repo.findByProviderSubject('google', 'subject-lookup');

    expect(found).toEqual({
      id: 'oauth-id-1',
      userId: 'user-1',
      provider: 'google',
      providerSubject: 'subject-lookup'
    });
  });
});
