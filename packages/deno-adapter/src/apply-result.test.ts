import { describe, expect, it } from 'vitest';
import { applyResult } from './apply-result.js';
import type { AuthError, AuthResult } from '@authia/contracts';

describe('applyResult', () => {
  it('returns the input directly if it is an AuthError', async () => {
    const error: AuthError = {
      category: 'infrastructure',
      code: 'RESPONSE_APPLY_FAILED',
      message: 'Database is down',
      retryable: true
    };
    const result = await applyResult(error);
    expect(result).toBe(error);
  });

  describe('success results', () => {
    const noContentActions = ['logout', 'logoutAll', 'requestPasswordReset', 'resetPassword', 'requestEmailVerification', 'verifyEmail'] as const;

    noContentActions.forEach((action) => {
      it(`returns 204 No Content with empty body for action: ${action}`, async () => {
        const result: AuthResult = {
          kind: 'success',
          action: action as any,
          responseMutations: {
            clearCookies: [{ name: 'auth_session' }]
          }
        } as AuthResult; // cast because these actions have specific shapes in the discriminated union

        const response = await applyResult(result);

        expect(response).toEqual({
          status: 204,
          headers: {},
          clearBearer: undefined,
          clearCookies: [{ name: 'auth_session' }],
          setCookies: undefined,
          body: undefined
        });
      });
    });

    it('returns 200 OK with body for other success actions', async () => {
      const result: AuthResult = {
        kind: 'success',
        action: 'getSession',
        subject: { id: 'user-123', email: 'test@example.com' },
        session: { id: 'sess-123', subjectId: 'user-123', issuedAt: new Date(), expiresAt: new Date() },
        transport: { type: 'cookie' },
        responseMutations: {
          setCookies: [{ name: 'auth_session', value: 'token' }]
        }
      } as unknown as AuthResult; // simplified shape

      const response = await applyResult(result);

      expect(response).toEqual({
        status: 200,
        headers: {},
        clearBearer: undefined,
        clearCookies: undefined,
        setCookies: [{ name: 'auth_session', value: 'token' }],
        body: result
      });
    });
  });

  describe('denied results', () => {
    it('returns 409 for DUPLICATE_IDENTITY', async () => {
      const result: AuthResult = {
        kind: 'denied',
        code: 'DUPLICATE_IDENTITY'
      };

      const response = await applyResult(result);

      expect(response).toEqual({
        status: 409,
        headers: {},
        body: { kind: 'denied', code: 'DUPLICATE_IDENTITY' }
      });
    });

    it('returns 403 for POLICY_DENIED', async () => {
      const result: AuthResult = {
        kind: 'denied',
        code: 'POLICY_DENIED'
      };

      const response = await applyResult(result);

      expect(response).toEqual({
        status: 403,
        headers: {},
        body: { kind: 'denied', code: 'POLICY_DENIED' }
      });
    });

    it('returns 429 for RATE_LIMITED', async () => {
      const result: AuthResult = {
        kind: 'denied',
        code: 'RATE_LIMITED'
      };

      const response = await applyResult(result);

      expect(response).toEqual({
        status: 429,
        headers: {},
        body: { kind: 'denied', code: 'RATE_LIMITED' }
      });
    });

    it('returns 400 for other denied codes', async () => {
      const result: AuthResult = {
        kind: 'denied',
        code: 'INVALID_INPUT'
      };

      const response = await applyResult(result);

      expect(response).toEqual({
        status: 400,
        headers: {},
        body: { kind: 'denied', code: 'INVALID_INPUT' }
      });
    });
  });

  describe('unauthenticated results', () => {
    it('returns 401 and correctly maps the body', async () => {
      const result: AuthResult = {
        kind: 'unauthenticated',
        code: 'SESSION_EXPIRED'
      };

      const response = await applyResult(result);

      expect(response).toEqual({
        status: 401,
        headers: {},
        body: { kind: 'unauthenticated', code: 'SESSION_EXPIRED' }
      });
    });
  });

  describe('redirect results', () => {
    it('returns 303 with location header when redirects are enabled (default)', async () => {
      const result: AuthResult = {
        kind: 'redirect',
        responseMutations: {
          redirectTo: 'https://example.com/login'
        }
      };

      const response = await applyResult(result);

      expect(response).toEqual({
        status: 303,
        headers: { location: 'https://example.com/login' }
      });
    });

    it('returns 303 with location header when redirects are explicitly enabled', async () => {
      const result: AuthResult = {
        kind: 'redirect',
        responseMutations: {
          redirectTo: 'https://example.com/login'
        }
      };

      const response = await applyResult(result, { redirects: true });

      expect(response).toEqual({
        status: 303,
        headers: { location: 'https://example.com/login' }
      });
    });

    it('returns RUNTIME_MISCONFIGURED error when redirects are disabled', async () => {
      const result: AuthResult = {
        kind: 'redirect',
        responseMutations: {
          redirectTo: 'https://example.com/login'
        }
      };

      const response = await applyResult(result, { redirects: false });

      expect(response).toEqual({
        category: 'infrastructure',
        code: 'RUNTIME_MISCONFIGURED',
        message: 'Runtime adapter does not support redirects.',
        retryable: false
      });
    });
  });

  describe('unexpected errors', () => {
    it('catches exceptions during processing and returns RESPONSE_APPLY_FAILED error', async () => {
      const result = new Proxy({}, {
        get() {
          throw new Error('Unexpected error');
        }
      }) as any;

      const response = await applyResult(result);

      expect(response).toEqual({
        category: 'infrastructure',
        code: 'RESPONSE_APPLY_FAILED',
        message: 'Failed to map auth result to runtime response.',
        retryable: false
      });
    });
  });
});
