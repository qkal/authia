import argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import type { AuthError, PluginServices } from '@authia/contracts';

function cryptoFailure(message: string): AuthError {
  return {
    category: 'infrastructure',
    code: 'CRYPTO_FAILURE',
    message,
    retryable: false
  };
}

type CryptoDependencies = {
  hashSecret: (value: string) => Promise<string>;
  verifySecret: (value: string, hash: string) => Promise<boolean>;
  generateOpaqueToken: () => string | Promise<string>;
  deriveTokenId: (token: string) => string | Promise<string>;
  deriveTokenVerifier: (token: string) => string | Promise<string>;
};

const defaultDependencies: CryptoDependencies = {
  hashSecret: async (value) =>
    argon2.hash(value, {
      type: argon2.argon2id
    }),
  verifySecret: async (value, hash) => argon2.verify(hash, value),
  generateOpaqueToken: () => randomBytes(32).toString('hex'),
  deriveTokenId: (token) => createHash('sha256').update(`id:${token}`).digest('hex'),
  deriveTokenVerifier: (token) => createHash('sha256').update(token).digest('hex')
};

export function createDefaultCryptoProvider(
  overrides: Partial<CryptoDependencies> = {}
): PluginServices['crypto'] {
  const dependencies: CryptoDependencies = {
    ...defaultDependencies,
    ...overrides
  };

  return {
    hashSecret: async (value) => {
      try {
        return await dependencies.hashSecret(value);
      } catch {
        return cryptoFailure('Failed to hash secret.');
      }
    },
    verifySecret: async (value, hash) => {
      try {
        return await dependencies.verifySecret(value, hash);
      } catch {
        return cryptoFailure('Failed to verify secret.');
      }
    },
    generateOpaqueToken: async () => {
      try {
        return await dependencies.generateOpaqueToken();
      } catch {
        return cryptoFailure('Failed to generate opaque token.');
      }
    },
    deriveTokenId: async (token) => {
      try {
        return await dependencies.deriveTokenId(token);
      } catch {
        return cryptoFailure('Failed to derive token id.');
      }
    },
    deriveTokenVerifier: async (token) => {
      try {
        return await dependencies.deriveTokenVerifier(token);
      } catch {
        return cryptoFailure('Failed to derive token verifier.');
      }
    },
    verifyOpaqueToken: async (token, verifier) => {
      try {
        return (await dependencies.deriveTokenVerifier(token)) === verifier;
      } catch {
        return cryptoFailure('Failed to verify opaque token.');
      }
    }
  };
}
