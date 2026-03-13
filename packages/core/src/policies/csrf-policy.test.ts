import type { RequestContext } from '@authia/contracts';
import { describe, expect, it } from 'vitest';

import { createCsrfPolicy } from './csrf-policy.js';

function createMockContext(headers: { origin?: string; referer?: string }): RequestContext {
  return {
    action: 'getSession',
    runtime: 'node',
    method: 'POST',
    url: 'http://example.com/auth/login',
    transport: 'cookie',
    headers,
    cookies: {}
  };
}

describe('createCsrfPolicy', () => {
  const publicOrigin = 'https://example.com';

  describe('Origin header validation', () => {
    it('allows requests with matching Origin header', async () => {
      const policy = createCsrfPolicy(publicOrigin);
      const context = createMockContext({ origin: publicOrigin });

      const result = await policy.evaluate(context);

      expect(result.kind).toBe('allow');
    });

    it('denies requests with mismatched Origin header', async () => {
      const policy = createCsrfPolicy(publicOrigin);
      const context = createMockContext({ origin: 'https://evil.com' });

      const result = await policy.evaluate(context);

      expect(result.kind).toBe('deny');
      if (result.kind === 'deny') {
        expect(result.code).toBe('POLICY_DENIED');
      }
    });
  });

  describe('Referer fallback validation', () => {
    it('allows requests with full Referer URL matching origin when Origin is absent', async () => {
      const policy = createCsrfPolicy(publicOrigin);
      
      // Full Referer URL with matching origin
      const context = createMockContext({ referer: 'https://example.com/some/page' });

      const result = await policy.evaluate(context);

      expect(result.kind).toBe('allow');
    });

    it('allows requests with Referer URL matching origin with trailing slash', async () => {
      const policy = createCsrfPolicy(publicOrigin);
      
      const context = createMockContext({ referer: 'https://example.com/' });

      const result = await policy.evaluate(context);

      expect(result.kind).toBe('allow');
    });

    it('allows requests with exact origin as Referer when Origin is absent', async () => {
      const policy = createCsrfPolicy(publicOrigin);
      
      // Exact origin match (no path)
      const context = createMockContext({ referer: 'https://example.com' });

      const result = await policy.evaluate(context);

      expect(result.kind).toBe('allow');
    });

    it('denies requests with mismatched Referer origin when Origin is absent', async () => {
      const policy = createCsrfPolicy(publicOrigin);
      
      // Full URL with different origin
      const context = createMockContext({ referer: 'https://evil.com/some/page' });

      const result = await policy.evaluate(context);

      expect(result.kind).toBe('deny');
      if (result.kind === 'deny') {
        expect(result.code).toBe('POLICY_DENIED');
      }
    });

    it('denies requests with subdomain mismatch in Referer', async () => {
      const policy = createCsrfPolicy(publicOrigin);
      
      // Subdomain should not match
      const context = createMockContext({ referer: 'https://sub.example.com/page' });

      const result = await policy.evaluate(context);

      expect(result.kind).toBe('deny');
    });

    it('denies requests with malformed Referer URL when Origin is absent', async () => {
      const policy = createCsrfPolicy(publicOrigin);
      
      // Malformed URL should fail-closed
      const context = createMockContext({ referer: 'not-a-valid-url' });

      const result = await policy.evaluate(context);

      expect(result.kind).toBe('deny');
      if (result.kind === 'deny') {
        expect(result.code).toBe('POLICY_DENIED');
      }
    });

    it('denies requests with relative Referer URL when Origin is absent', async () => {
      const policy = createCsrfPolicy(publicOrigin);
      
      // Relative URL should fail-closed
      const context = createMockContext({ referer: '/some/path' });

      const result = await policy.evaluate(context);

      expect(result.kind).toBe('deny');
    });

    it('denies requests with empty Referer when Origin is absent', async () => {
      const policy = createCsrfPolicy(publicOrigin);
      
      const context = createMockContext({ referer: '' });

      const result = await policy.evaluate(context);

      expect(result.kind).toBe('deny');
    });
  });

  describe('Origin precedence', () => {
    it('uses Origin header when both Origin and Referer are present', async () => {
      const policy = createCsrfPolicy(publicOrigin);
      
      // Origin matches, Referer doesn't - should allow because Origin takes precedence
      const context = createMockContext({ 
        origin: publicOrigin,
        referer: 'https://evil.com/page'
      });

      const result = await policy.evaluate(context);

      expect(result.kind).toBe('allow');
    });
  });

  describe('Missing headers', () => {
    it('denies requests with neither Origin nor Referer', async () => {
      const policy = createCsrfPolicy(publicOrigin);
      
      const context = createMockContext({});

      const result = await policy.evaluate(context);

      expect(result.kind).toBe('deny');
    });
  });

  it('sets mayRedirect capability to false', () => {
    const policy = createCsrfPolicy(publicOrigin);
    
    expect(policy.capabilities.mayRedirect).toBe(false);
  });
});
