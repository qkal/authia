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
});
