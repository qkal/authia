import type { AuthConfig, RuntimeAdapter } from '@authia/contracts';
import { describe, expect, it } from 'vitest';
import { parseRequest } from './parse-request.js';

type Config = Pick<AuthConfig, 'entrypointMethods' | 'entrypointPaths' | 'entrypointTransport' | 'sessionCookieName' | 'publicOrigin' | 'trustedForwardedHeaders'>;
type ParseInput = Parameters<RuntimeAdapter['parseRequest']>[0];

function createConfig(overrides?: Partial<Config>): Config {
  return {
    publicOrigin: 'https://example.com',
    sessionCookieName: 'auth_session',
    trustedForwardedHeaders: [],
    entrypointMethods: {
      signInWithPassword: 'POST',
      signUpWithPassword: 'POST',
      logout: 'POST',
      logoutAll: 'POST',
      refreshSession: 'POST',
      getSession: 'GET',
      startOAuth: 'POST',
      finishOAuth: 'POST',
      requestPasswordReset: 'POST',
      resetPassword: 'POST',
      requestEmailVerification: 'POST',
      verifyEmail: 'POST'
    },
    entrypointPaths: {
      signInWithPassword: '/auth/signin',
      signUpWithPassword: '/auth/signup',
      logout: '/auth/signout',
      logoutAll: '/auth/signoutAll',
      refreshSession: '/auth/refresh',
      getSession: '/auth/user',
      startOAuth: '/auth/oauth/start',
      finishOAuth: '/auth/oauth/finish',
      requestPasswordReset: '/auth/password/request-reset',
      resetPassword: '/auth/password/reset',
      requestEmailVerification: '/auth/email/request-verification',
      verifyEmail: '/auth/email/verify'
    },
    entrypointTransport: {
      signInWithPassword: 'cookie',
      signUpWithPassword: 'cookie',
      logout: 'cookie',
      logoutAll: 'cookie',
      refreshSession: 'cookie',
      getSession: 'cookie',
      startOAuth: 'cookie',
      finishOAuth: 'cookie',
      requestPasswordReset: 'cookie',
      resetPassword: 'cookie',
      requestEmailVerification: 'cookie',
      verifyEmail: 'cookie'
    },
    ...overrides
  };
}

describe('parseRequest', () => {
  it('returns notHandled for unknown routes', async () => {
    const config = createConfig();
    const result = await parseRequest({
      method: 'GET',
      url: 'https://example.com/unknown',
      headers: {},
      cookies: {}
    }, config);
    expect(result).toEqual({ kind: 'notHandled' });
  });

  it('rejects duplicate sensitive headers', async () => {
    const config = createConfig();
    const result = await parseRequest({
      method: 'POST',
      url: 'https://example.com/auth/signin',
      headers: {
        authorization: ['Bearer a', 'Bearer b']
      },
      cookies: {}
    }, config);
    expect(result).toEqual({ kind: 'denied', code: 'INVALID_INPUT' });
  });

  it('rejects duplicate trusted forwarded headers if configured', async () => {
    const config = createConfig({ trustedForwardedHeaders: ['x-forwarded-host', 'x-forwarded-proto'] });
    const result = await parseRequest({
      method: 'POST',
      url: 'https://example.com/auth/signin',
      headers: {
        'x-forwarded-host': ['example.com', 'example.org']
      },
      cookies: {}
    }, config);
    expect(result).toEqual({ kind: 'denied', code: 'INVALID_INPUT' });
  });

  it('returns RUNTIME_MISCONFIGURED when only one trusted forwarded header is present', async () => {
    const config = createConfig({
      trustedForwardedHeaders: ['x-forwarded-host', 'x-forwarded-proto']
    });
    const result = await parseRequest({
      method: 'POST',
      url: 'https://example.com/auth/signin',
      headers: {
        'x-forwarded-host': 'example.com'
      },
      cookies: {}
    }, config);
    expect(result).toEqual({
      category: 'infrastructure',
      code: 'RUNTIME_MISCONFIGURED',
      message: 'Both x-forwarded-host and x-forwarded-proto must be present together.',
      retryable: false
    });
  });

  it('returns RUNTIME_MISCONFIGURED when forwarded origin mismatches publicOrigin', async () => {
    const config = createConfig({
      publicOrigin: 'https://example.com',
      trustedForwardedHeaders: ['x-forwarded-host', 'x-forwarded-proto']
    });
    const result = await parseRequest({
      method: 'POST',
      url: 'https://example.com/auth/signin',
      headers: {
        'x-forwarded-host': 'evil.com',
        'x-forwarded-proto': 'https'
      },
      cookies: {}
    }, config);
    expect(result).toEqual({
      category: 'infrastructure',
      code: 'RUNTIME_MISCONFIGURED',
      message: 'Forwarded host/proto must match publicOrigin.',
      retryable: false
    });
  });

  it('rejects malformed authorization headers', async () => {
    const config = createConfig();
    const result = await parseRequest({
      method: 'GET',
      url: 'https://example.com/auth/user',
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
      cookies: {}
    }, config);
    expect(result).toEqual({ kind: 'denied', code: 'INVALID_INPUT' });

    const result2 = await parseRequest({
      method: 'GET',
      url: 'https://example.com/auth/user',
      headers: { authorization: 'Bearer   ' },
      cookies: {}
    }, config);
    expect(result2).toEqual({ kind: 'denied', code: 'INVALID_INPUT' });

    const result3 = await parseRequest({
      method: 'GET',
      url: 'https://example.com/auth/user',
      headers: { authorization: 'Bearer token with spaces' },
      cookies: {}
    }, config);
    expect(result3).toEqual({ kind: 'denied', code: 'INVALID_INPUT' });
  });

  it('rejects ambiguous credential sources', async () => {
    const config = createConfig();
    const result = await parseRequest({
      method: 'GET',
      url: 'https://example.com/auth/user',
      headers: { authorization: 'Bearer token123' },
      cookies: { auth_session: 'session123' }
    }, config);
    expect(result).toEqual({ kind: 'denied', code: 'AMBIGUOUS_CREDENTIALS' });
  });

  it('rejects missing expected transport', async () => {
    const config = createConfig({
      entrypointTransport: { getSession: 'bearer' } as any // Not complete, just to trigger missing transport for signInWithPassword
    });
    const result = await parseRequest({
      method: 'POST',
      url: 'https://example.com/auth/signin', // signInWithPassword not in entrypointTransport
      headers: {},
      cookies: {}
    }, config);
    expect(result).toEqual({ kind: 'denied', code: 'INVALID_INPUT' });
  });

  it('rejects credential-kind mismatch with entrypoint transport', async () => {
    const config = createConfig({
      entrypointTransport: { getSession: 'bearer' } as any
    });
    const result = await parseRequest({
      method: 'GET',
      url: 'https://example.com/auth/user',
      headers: {},
      cookies: { auth_session: 'session123' } // provide cookie when bearer is expected
    }, config);
    expect(result).toEqual({ kind: 'denied', code: 'INVALID_INPUT' });
  });

  it('rejects invalid JSON body payloads', async () => {
    const config = createConfig();

    // Invalid JSON string
    const result = await parseRequest({
      method: 'POST',
      url: 'https://example.com/auth/signin',
      headers: {},
      cookies: {},
      body: '{ invalid: json }'
    }, config);
    expect(result).toEqual({ kind: 'denied', code: 'INVALID_INPUT' });

    // Valid JSON but primitive (null)
    const result2 = await parseRequest({
      method: 'POST',
      url: 'https://example.com/auth/signin',
      headers: {},
      cookies: {},
      body: 'null'
    }, config);
    expect(result2).toEqual({ kind: 'denied', code: 'INVALID_INPUT' });
  });

  it('rejects non-string non-object body', async () => {
    const config = createConfig();
    const result = await parseRequest({
      method: 'POST',
      url: 'https://example.com/auth/signin',
      headers: {},
      cookies: {},
      body: 123
    }, config);
    expect(result).toEqual({ kind: 'denied', code: 'INVALID_INPUT' });
  });

  it('parses startOAuth body with provider and relative redirect', async () => {
    const config = createConfig();
    const result = await parseRequest({
      method: 'POST',
      url: 'https://example.com/auth/oauth/start',
      headers: {},
      cookies: {},
      body: { provider: 'github', redirectTo: '/dashboard' }
    }, config);
    expect(result).toMatchObject({
      action: 'startOAuth',
      body: { provider: 'github', redirectTo: '/dashboard' }
    });
  });

  it('rejects invalid startOAuth redirectTo values', async () => {
    const config = createConfig();
    const result = await parseRequest({
      method: 'POST',
      url: 'https://example.com/auth/oauth/start',
      headers: {},
      cookies: {},
      body: { provider: 'github', redirectTo: 'https://evil.com/dashboard' }
    }, config);
    expect(result).toEqual({ kind: 'denied', code: 'INVALID_INPUT' });

    const result2 = await parseRequest({
      method: 'POST',
      url: 'https://example.com/auth/oauth/start',
      headers: {},
      cookies: {},
      body: { provider: 'github', redirectTo: 123 }
    }, config);
    expect(result2).toEqual({ kind: 'denied', code: 'INVALID_INPUT' });
  });

  it('rejects startOAuth without provider', async () => {
    const config = createConfig();
    const result = await parseRequest({
      method: 'POST',
      url: 'https://example.com/auth/oauth/start',
      headers: {},
      cookies: {},
      body: { redirectTo: '/dashboard' }
    }, config);
    expect(result).toEqual({ kind: 'denied', code: 'INVALID_INPUT' });
  });

  it('parses finishOAuth body with provider code and state', async () => {
    const config = createConfig();
    const result = await parseRequest({
      method: 'POST',
      url: 'https://example.com/auth/oauth/finish',
      headers: {},
      cookies: {},
      body: { provider: 'github', code: 'abc', state: 'xyz' }
    }, config);
    expect(result).toMatchObject({
      action: 'finishOAuth',
      body: { provider: 'github', code: 'abc', state: 'xyz' }
    });
  });

  it('rejects malformed finishOAuth payload fields', async () => {
    const config = createConfig();
    const result = await parseRequest({
      method: 'POST',
      url: 'https://example.com/auth/oauth/finish',
      headers: {},
      cookies: {},
      body: { provider: 'github', code: 'abc' } // missing state
    }, config);
    expect(result).toEqual({ kind: 'denied', code: 'INVALID_INPUT' });
  });

  it('parses requestPasswordReset body with email', async () => {
    const config = createConfig();
    const result = await parseRequest({
      method: 'POST',
      url: 'https://example.com/auth/password/request-reset',
      headers: {},
      cookies: {},
      body: { email: 'user@example.com' }
    }, config);
    expect(result).toMatchObject({ action: 'requestPasswordReset' });
  });

  it('rejects malformed requestPasswordReset body', async () => {
    const config = createConfig();
    const result = await parseRequest({
      method: 'POST',
      url: 'https://example.com/auth/password/request-reset',
      headers: {},
      cookies: {},
      body: { email: '' }
    }, config);
    expect(result).toEqual({ kind: 'denied', code: 'INVALID_INPUT' });
  });

  it('parses resetPassword body with resetToken and password', async () => {
    const config = createConfig();
    const result = await parseRequest({
      method: 'POST',
      url: 'https://example.com/auth/password/reset',
      headers: {},
      cookies: {},
      body: { resetToken: 'token123', password: 'newpassword' }
    }, config);
    expect(result).toMatchObject({ action: 'resetPassword' });
  });

  it('rejects malformed resetPassword payload fields', async () => {
    const config = createConfig();
    const result = await parseRequest({
      method: 'POST',
      url: 'https://example.com/auth/password/reset',
      headers: {},
      cookies: {},
      body: { resetToken: 'token123' } // missing password
    }, config);
    expect(result).toEqual({ kind: 'denied', code: 'INVALID_INPUT' });
  });

  it('parses requestEmailVerification body with email', async () => {
    const config = createConfig();
    const result = await parseRequest({
      method: 'POST',
      url: 'https://example.com/auth/email/request-verification',
      headers: {},
      cookies: {},
      body: { email: 'user@example.com' }
    }, config);
    expect(result).toMatchObject({ action: 'requestEmailVerification' });
  });

  it('rejects malformed requestEmailVerification body', async () => {
    const config = createConfig();
    const result = await parseRequest({
      method: 'POST',
      url: 'https://example.com/auth/email/request-verification',
      headers: {},
      cookies: {},
      body: {}
    }, config);
    expect(result).toEqual({ kind: 'denied', code: 'INVALID_INPUT' });
  });

  it('parses verifyEmail body with verificationToken', async () => {
    const config = createConfig();
    const result = await parseRequest({
      method: 'POST',
      url: 'https://example.com/auth/email/verify',
      headers: {},
      cookies: {},
      body: { verificationToken: 'token123' }
    }, config);
    expect(result).toMatchObject({ action: 'verifyEmail' });
  });

  it('rejects malformed verifyEmail payload fields', async () => {
    const config = createConfig();
    const result = await parseRequest({
      method: 'POST',
      url: 'https://example.com/auth/email/verify',
      headers: {},
      cookies: {},
      body: {}
    }, config);
    expect(result).toEqual({ kind: 'denied', code: 'INVALID_INPUT' });
  });

  it('returns valid RequestContext for valid requests', async () => {
    const config = createConfig();
    const result = await parseRequest({
      method: 'POST',
      url: 'https://example.com/auth/signin',
      headers: {
        'content-type': 'application/json'
      },
      cookies: {
        auth_session: 'session_token'
      },
      body: {
        email: 'user@example.com',
        password: 'password123'
      }
    }, config);

    expect(result).toEqual({
      action: 'signInWithPassword',
      runtime: 'node',
      method: 'POST',
      url: 'https://example.com/auth/signin',
      transport: 'cookie',
      headers: { 'content-type': 'application/json' },
      cookies: { auth_session: 'session_token' },
      credential: { kind: 'cookie', token: 'session_token' },
      body: { email: 'user@example.com', password: 'password123' }
    });
  });
});

  it('parses valid JSON string body', async () => {
    const config = createConfig();
    const result = await parseRequest({
      method: 'POST',
      url: 'https://example.com/auth/signin',
      headers: {},
      cookies: {},
      body: '{"email":"user@example.com","password":"password123"}'
    }, config);

    expect(result).toMatchObject({
      action: 'signInWithPassword',
      body: { email: 'user@example.com', password: 'password123' }
    });
});
