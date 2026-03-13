import { describe, expect, it } from 'vitest';
import {
  defaultCookieName,
  defaultEntrypointMethods,
  defaultSessionConfig,
  deniedCodes,
  supportedActions,
  unauthenticatedCodes
} from '../src/index';

describe('contracts package', () => {
  it('exports the frozen Cycle 1 actions in order', () => {
    expect(supportedActions).toEqual([
      'signUpWithPassword',
      'signInWithPassword',
      'getSession',
      'refreshSession',
      'logout',
      'logoutAll',
      'startOAuth',
      'finishOAuth'
    ]);
  });

  it('exports the frozen HTTP methods', () => {
    expect(defaultEntrypointMethods).toEqual({
      signUpWithPassword: 'POST',
      signInWithPassword: 'POST',
      getSession: 'GET',
      refreshSession: 'POST',
      logout: 'POST',
      logoutAll: 'POST',
      startOAuth: 'POST',
      finishOAuth: 'POST'
    });
  });

  it('exports the frozen error-code families', () => {
    expect(deniedCodes).toEqual([
      'INVALID_INPUT',
      'AMBIGUOUS_CREDENTIALS',
      'DUPLICATE_IDENTITY',
      'RATE_LIMITED',
      'POLICY_DENIED'
    ]);
    expect(unauthenticatedCodes).toEqual([
      'INVALID_CREDENTIALS',
      'SESSION_EXPIRED',
      'SESSION_REVOKED'
    ]);
  });

  it('exports the runtime constants needed by downstream packages', () => {
    expect(defaultSessionConfig.absoluteLifetimeMs).toBe(30 * 24 * 60 * 60 * 1000);
    expect(defaultSessionConfig.idleTimeoutMs).toBe(7 * 24 * 60 * 60 * 1000);
    expect(defaultSessionConfig.rotationThresholdMs).toBe(24 * 60 * 60 * 1000);
    expect(typeof defaultCookieName).toBe('string');
  });
});
