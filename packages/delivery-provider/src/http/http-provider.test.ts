import { describe, expect, it, vi } from 'vitest';

import { createHttpProvider } from './http-provider.js';

describe('createHttpProvider', () => {
  const validHttpConfig = {
    endpoint: 'https://api.example.test/send',
    apiKey: 'test-api-key',
    authHeaderName: 'authorization',
    from: 'noreply@example.com'
  } as const;

  it('sends request with configured auth header', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 202 }));
    const provider = createHttpProvider(validHttpConfig, fetcher);

    await provider.deliver({ to: 'user@example.com', subject: 's', text: 't' });

    expect(fetcher).toHaveBeenCalledWith(
      validHttpConfig.endpoint,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'content-type': 'application/json',
          [validHttpConfig.authHeaderName]: validHttpConfig.apiKey
        }),
        body: JSON.stringify({
          from: validHttpConfig.from,
          to: 'user@example.com',
          subject: 's',
          text: 't'
        })
      })
    );
  });

  it('throws status metadata for mapper on non-2xx responses', async () => {
    const fetcher = vi.fn(async () => new Response('bad', { status: 429 }));
    const provider = createHttpProvider(validHttpConfig, fetcher);

    await expect(provider.deliver({ to: 'user@example.com', subject: 's', text: 't' })).rejects.toMatchObject({
      message: 'HTTP provider returned 429',
      status: 429
    });
  });
});
