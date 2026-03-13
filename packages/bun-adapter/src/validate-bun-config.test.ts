import type { AuthConfig } from '@authia/contracts';
import { describe, expect, it } from 'vitest';

import { validateBunConfig } from './validate-bun-config.js';

describe('validateBunConfig - validation boundary ownership', () => {
  describe('runtime-specific validations (owned by node adapter)', () => {
    describe('publicOrigin validation', () => {
      it('requires publicOrigin to be an absolute URL with protocol', () => {
        const config: Pick<AuthConfig, 'publicOrigin' | 'trustedForwardedHeaders'> = {
          publicOrigin: 'example.com', // Missing protocol
          trustedForwardedHeaders: []
        };

        const result = validateBunConfig(config);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.message).toContain('publicOrigin');
          expect(result.message).toContain('absolute URL');
        }
      });

      it('requires publicOrigin to have a hostname', () => {
        const config: Pick<AuthConfig, 'publicOrigin' | 'trustedForwardedHeaders'> = {
          publicOrigin: 'https://', // Missing hostname
          trustedForwardedHeaders: []
        };

        const result = validateBunConfig(config);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.message).toContain('publicOrigin');
        }
      });

      it('accepts valid absolute URLs', () => {
        const validOrigins = [
          'https://example.com',
          'https://example.com:8443',
          'http://localhost:3000',
          'https://sub.example.com'
        ];

        for (const origin of validOrigins) {
          const config: Pick<AuthConfig, 'publicOrigin' | 'trustedForwardedHeaders'> = {
            publicOrigin: origin,
            trustedForwardedHeaders: []
          };

          const result = validateBunConfig(config);

          expect(result.ok).toBe(true);
        }
      });
    });

    describe('trustedForwardedHeaders validation', () => {
      it('accepts empty array (no forwarded headers)', () => {
        const config: Pick<AuthConfig, 'publicOrigin' | 'trustedForwardedHeaders'> = {
          publicOrigin: 'https://example.com',
          trustedForwardedHeaders: []
        };

        const result = validateBunConfig(config);

        expect(result.ok).toBe(true);
      });

      it('accepts both required headers together', () => {
        const config: Pick<AuthConfig, 'publicOrigin' | 'trustedForwardedHeaders'> = {
          publicOrigin: 'https://example.com',
          trustedForwardedHeaders: ['x-forwarded-host', 'x-forwarded-proto']
        };

        const result = validateBunConfig(config);

        expect(result.ok).toBe(true);
      });

      it('rejects partial configuration with only x-forwarded-host', () => {
        const config: Pick<AuthConfig, 'publicOrigin' | 'trustedForwardedHeaders'> = {
          publicOrigin: 'https://example.com',
          trustedForwardedHeaders: ['x-forwarded-host']
        };

        const result = validateBunConfig(config);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.message).toContain('trustedForwardedHeaders');
          expect(result.message).toMatch(/both|x-forwarded-host.*x-forwarded-proto/i);
        }
      });

      it('rejects partial configuration with only x-forwarded-proto', () => {
        const config: Pick<AuthConfig, 'publicOrigin' | 'trustedForwardedHeaders'> = {
          publicOrigin: 'https://example.com',
          trustedForwardedHeaders: ['x-forwarded-proto']
        };

        const result = validateBunConfig(config);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.message).toContain('trustedForwardedHeaders');
        }
      });

      it('rejects configuration with extra headers', () => {
        const config: Pick<AuthConfig, 'publicOrigin' | 'trustedForwardedHeaders'> = {
          publicOrigin: 'https://example.com',
          trustedForwardedHeaders: ['x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-for'] as any
        };

        const result = validateBunConfig(config);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.message).toContain('trustedForwardedHeaders');
        }
      });
    });

    describe('combined validation', () => {
      it('validates both publicOrigin and trustedForwardedHeaders', () => {
        const config: Pick<AuthConfig, 'publicOrigin' | 'trustedForwardedHeaders'> = {
          publicOrigin: 'not-a-url',
          trustedForwardedHeaders: ['x-forwarded-host'] // Incomplete
        };

        const result = validateBunConfig(config);

        expect(result.ok).toBe(false);
        // Should fail on first validation (publicOrigin)
        if (!result.ok) {
          expect(result.message).toContain('publicOrigin');
        }
      });

      it('passes validation with all valid runtime-specific config', () => {
        const config: Pick<AuthConfig, 'publicOrigin' | 'trustedForwardedHeaders'> = {
          publicOrigin: 'https://example.com',
          trustedForwardedHeaders: ['x-forwarded-host', 'x-forwarded-proto']
        };

        const result = validateBunConfig(config);

        expect(result.ok).toBe(true);
      });
    });
  });

  describe('validation boundary separation', () => {
    it('only validates runtime-specific concerns, not universal invariants', () => {
      // Node adapter should not validate things like route uniqueness,
      // session cookie config, etc. - those are universal invariants
      // owned by startup validation
      
      const config: Pick<AuthConfig, 'publicOrigin' | 'trustedForwardedHeaders'> = {
        publicOrigin: 'https://example.com',
        trustedForwardedHeaders: []
      };

      const result = validateBunConfig(config);

      // Should only return errors about publicOrigin or trustedForwardedHeaders
      expect(result.ok).toBe(true);
    });
  });
});

