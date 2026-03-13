import type { AuthResult } from './runtime.js';

export type ValidationResult =
  | { ok: true }
  | { ok: false; code: 'RUNTIME_MISCONFIGURED'; message: string };

export const deniedCodes = [
  'INVALID_INPUT',
  'AMBIGUOUS_CREDENTIALS',
  'DUPLICATE_IDENTITY',
  'RATE_LIMITED',
  'POLICY_DENIED'
] as const;

export type DeniedCode = (typeof deniedCodes)[number];

export type PolicyDeniedCode = 'RATE_LIMITED' | 'POLICY_DENIED';

export const unauthenticatedCodes = [
  'INVALID_CREDENTIALS',
  'SESSION_EXPIRED',
  'SESSION_REVOKED'
] as const;

export type UnauthenticatedCode = (typeof unauthenticatedCodes)[number];

export type AuthErrorCode =
  | 'RUNTIME_MISCONFIGURED'
  | 'MIGRATION_MISMATCH'
  | 'STORAGE_UNAVAILABLE'
  | 'CRYPTO_FAILURE'
  | 'POLICY_FAILURE'
  | 'RESPONSE_APPLY_FAILED';

export type AuthError = {
  category: 'operator' | 'infrastructure';
  code: AuthErrorCode;
  message: string;
  retryable: boolean;
};

export type AuthValue<T> = T | AuthError;

export type RollbackSignal = {
  outcome: AuthResult | AuthError;
};
