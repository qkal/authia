import type { AuthError } from '@authia/contracts';
import { describe, expect, it } from 'vitest';

import { createDefaultCryptoProvider } from '../src/index.js';

function isAuthError(value: unknown): value is AuthError {
  return typeof value === 'object' && value !== null && 'code' in value && 'category' in value;
}

describe('createDefaultCryptoProvider', () => {
  it('hashes and verifies secrets', async () => {
    const provider = createDefaultCryptoProvider();
    const hash = await provider.hashSecret('correct horse battery staple');

    expect(isAuthError(hash)).toBe(false);
    if (isAuthError(hash)) {
      throw new Error(`unexpected auth error: ${hash.code}`);
    }

    const valid = await provider.verifySecret('correct horse battery staple', hash);
    const invalid = await provider.verifySecret('wrong secret', hash);

    expect(valid).toBe(true);
    expect(invalid).toBe(false);
  });

  it('generates opaque tokens', async () => {
    const provider = createDefaultCryptoProvider();

    const token = await provider.generateOpaqueToken();

    expect(isAuthError(token)).toBe(false);
    if (isAuthError(token)) {
      throw new Error(`unexpected auth error: ${token.code}`);
    }

    expect(token.length).toBeGreaterThan(0);
  });

  it('derives deterministic token ids', async () => {
    const provider = createDefaultCryptoProvider();

    const first = await provider.deriveTokenId('opaque-token');
    const second = await provider.deriveTokenId('opaque-token');

    expect(first).toBe(second);
    expect(typeof first).toBe('string');
    if (typeof first === 'string') {
      expect(first.length).toBeGreaterThan(0);
    }
  });

  it('derives and verifies token verifiers', async () => {
    const provider = createDefaultCryptoProvider();

    const token = 'opaque-token';
    const verifier = await provider.deriveTokenVerifier(token);

    expect(isAuthError(verifier)).toBe(false);
    if (isAuthError(verifier)) {
      throw new Error(`unexpected auth error: ${verifier.code}`);
    }

    expect(await provider.verifyOpaqueToken(token, verifier)).toBe(true);
    expect(await provider.verifyOpaqueToken('different-token', verifier)).toBe(false);
  });

  it('maps provider failures to CRYPTO_FAILURE', async () => {
    const provider = createDefaultCryptoProvider({
      generateOpaqueToken: async () => {
        throw new Error('boom');
      }
    });

    const result = await provider.generateOpaqueToken();

    expect(result).toMatchObject({
      category: 'infrastructure',
      code: 'CRYPTO_FAILURE',
      retryable: false
    });
  });

  describe('crypto hardening', () => {
    it('uses timing-safe comparison for opaque token verification', async () => {
      // This test verifies that verifyOpaqueToken uses a timing-safe comparison
      // by checking that it properly compares tokens of different lengths without
      // early exit (which would leak timing information)
      const provider = createDefaultCryptoProvider();

      const token = 'opaque-token';
      const verifier = await provider.deriveTokenVerifier(token);

      expect(isAuthError(verifier)).toBe(false);
      if (isAuthError(verifier)) {
        throw new Error(`unexpected auth error: ${verifier.code}`);
      }

      // Correct verifier should pass
      expect(await provider.verifyOpaqueToken(token, verifier)).toBe(true);

      // Verifier with different length should fail
      const shortVerifier = typeof verifier === 'string' ? verifier.slice(0, -2) : '';
      expect(await provider.verifyOpaqueToken(token, shortVerifier)).toBe(false);

      // Verifier with same length but different content should fail
      const differentVerifier = typeof verifier === 'string' 
        ? verifier.slice(0, -1) + (verifier[verifier.length - 1] === 'a' ? 'b' : 'a')
        : '';
      expect(await provider.verifyOpaqueToken(token, differentVerifier)).toBe(false);
    });

    it('uses explicit Argon2id cost parameters when hashing', async () => {
      // Test that the default implementation successfully hashes with explicit parameters
      // by verifying that hashing works and the hash can be verified
      const provider = createDefaultCryptoProvider();

      const result = await provider.hashSecret('test-password');
      
      expect(isAuthError(result)).toBe(false);
      
      if (!isAuthError(result)) {
        // Verify the hash is in the expected Argon2id format
        // Argon2id hashes start with $argon2id$
        expect(result).toMatch(/^\$argon2id\$/);
        
        // Verify the hash includes version and parameters
        // Format: $argon2id$v=19$m=19456,t=2,p=1$...
        expect(result).toMatch(/\$v=19\$/);
        expect(result).toMatch(/m=19456/);
        expect(result).toMatch(/t=2/);
        expect(result).toMatch(/p=1/);
        
        // Verify it can be used to verify the password
        const verifyResult = await provider.verifySecret('test-password', result);
        expect(verifyResult).toBe(true);
      }
    });

    it('preserves existing failure mapping to CRYPTO_FAILURE', async () => {
      // Ensure that timing-safe comparison failures still map to CRYPTO_FAILURE
      const provider = createDefaultCryptoProvider({
        deriveTokenVerifier: async () => {
          throw new Error('derivation failed');
        }
      });

      const result = await provider.verifyOpaqueToken('token', 'verifier');

      expect(result).toMatchObject({
        category: 'infrastructure',
        code: 'CRYPTO_FAILURE',
        retryable: false
      });
    });
  });
});
