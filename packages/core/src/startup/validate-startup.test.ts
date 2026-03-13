import type { AuthConfig, EntrypointMethodMap, EntrypointPathMap, EntrypointTransportMap } from '@authia/contracts';
import { describe, expect, it } from 'vitest';

import { validateStartupConfig } from './validate-startup.js';

describe('validateStartupConfig - validation boundary ownership', () => {
  const baseConfig: AuthConfig = {
    sessionCookieName: 'auth_session',
    cookieOptions: { 
      path: '/',
      secure: true,
      sameSite: 'lax',
      httpOnly: true
    },
    publicOrigin: 'https://example.com',
    trustedForwardedHeaders: [],
    sessionTransportMode: 'both',
    entrypointMethods: {
      signUpWithPassword: 'POST',
      signInWithPassword: 'POST',
      getSession: 'GET',
      refreshSession: 'POST',
      logout: 'POST',
      logoutAll: 'POST'
    },
    entrypointPaths: {
      signUpWithPassword: '/auth/signup',
      signInWithPassword: '/auth/signin',
      getSession: '/auth/session',
      refreshSession: '/auth/refresh',
      logout: '/auth/logout',
      logoutAll: '/auth/logout-all'
    },
    entrypointTransport: {
      signUpWithPassword: 'cookie',
      signInWithPassword: 'cookie',
      getSession: 'cookie',
      refreshSession: 'cookie',
      logout: 'cookie',
      logoutAll: 'cookie'
    },
    policies: [],
    runtimeAdapter: 'node',
    storageAdapter: 'postgres',
    cryptoProvider: 'default',
    plugins: []
  };

  describe('universal invariants (owned by startup validation)', () => {
    it('validates route uniqueness across entrypoints', () => {
      const config: AuthConfig = {
        ...baseConfig,
        entrypointMethods: {
          ...baseConfig.entrypointMethods,
          refreshSession: 'GET' as any // Force duplicate with getSession
        },
        entrypointPaths: {
          ...baseConfig.entrypointPaths,
          refreshSession: '/auth/session' // Same path as getSession
        }
      };

      const result = validateStartupConfig(config);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toContain('unique');
      }
    });

    it('prevents plugins from overriding built-in action getSession', () => {
      const config: AuthConfig = {
        ...baseConfig
      };

      const result = validateStartupConfig(config, ['getSession']);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toContain('getSession');
        expect(result.message).toContain('built-in');
      }
    });

    it('prevents plugins from overriding built-in action refreshSession', () => {
      const result = validateStartupConfig(baseConfig, ['refreshSession']);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toContain('refreshSession');
      }
    });

    it('prevents plugins from overriding built-in action logout', () => {
      const result = validateStartupConfig(baseConfig, ['logout']);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toContain('logout');
      }
    });

    it('prevents plugins from overriding built-in action logoutAll', () => {
      const result = validateStartupConfig(baseConfig, ['logoutAll']);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toContain('logoutAll');
      }
    });

    it('allows plugins with non-conflicting action names', () => {
      const config: AuthConfig = {
        ...baseConfig
      };

      const result = validateStartupConfig(config, ['customAction', 'anotherAction'] as any);

      expect(result.ok).toBe(true);
    });

    it('validates transport mode consistency', () => {
      const config: AuthConfig = {
        ...baseConfig,
        sessionTransportMode: 'cookie',
        entrypointTransport: {
          ...baseConfig.entrypointTransport,
          getSession: 'bearer' // Mismatch!
        }
      };

      const result = validateStartupConfig(config);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toContain('transport');
      }
    });

    it('validates session cookie configuration presence', () => {
      const config: AuthConfig = {
        ...baseConfig,
        sessionCookieName: '' // Invalid
      };

      const result = validateStartupConfig(config);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toContain('sessionCookieName');
      }
    });

    it('validates cookie path configuration presence', () => {
      const config: AuthConfig = {
        ...baseConfig,
        cookieOptions: { 
          ...baseConfig.cookieOptions,
          path: '' // Invalid
        }
      };

      const result = validateStartupConfig(config);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toContain('cookieOptions.path');
      }
    });
  });

  describe('runtime-specific validations (NOT owned by startup validation)', () => {
    it('does not validate publicOrigin format - that is runtime-specific', () => {
      // publicOrigin validation is owned by runtime adapters (e.g., node-adapter)
      // Startup validation should not enforce URL format
      const config: AuthConfig = {
        ...baseConfig,
        publicOrigin: 'not-a-url' // Would be caught by node adapter, not here
      };

      // Startup validation should not fail on this
      const result = validateStartupConfig(config);

      // Should pass startup validation (or fail for other reasons, not publicOrigin format)
      if (!result.ok) {
        expect(result.message).not.toContain('publicOrigin');
      }
    });

    it('does not validate trustedForwardedHeaders completeness - that is runtime-specific', () => {
      // trustedForwardedHeaders validation is owned by runtime adapters
      const config: AuthConfig = {
        ...baseConfig,
        trustedForwardedHeaders: ['x-forwarded-host'] // Incomplete - would be caught by node adapter
      };

      const result = validateStartupConfig(config);

      // Should pass startup validation
      if (!result.ok) {
        expect(result.message).not.toContain('trustedForwardedHeaders');
      }
    });
  });

  describe('valid configurations', () => {
    it('passes validation for valid base config', () => {
      const result = validateStartupConfig(baseConfig);

      expect(result.ok).toBe(true);
    });

    it('passes validation with unique routes', () => {
      const config: AuthConfig = {
        ...baseConfig,
        entrypointPaths: {
          ...baseConfig.entrypointPaths,
          getSession: '/api/session',
          logout: '/api/logout'
        }
      };

      const result = validateStartupConfig(config);

      expect(result.ok).toBe(true);
    });
  });
});
