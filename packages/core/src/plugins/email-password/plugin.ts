import type { AuthConfig, Plugin } from '@authia/contracts';

export function createEmailPasswordPlugin(): Plugin {
  return {
    id: 'emailPassword',
    actions: () => ['signUpWithPassword', 'signInWithPassword'],
    validateConfig: (config: AuthConfig) => {
      if (!config.entrypointPaths.signUpWithPassword || !config.entrypointPaths.signInWithPassword) {
        return {
          ok: false,
          code: 'RUNTIME_MISCONFIGURED',
          message: 'Email/password entrypoint paths are required.'
        };
      }

      return { ok: true };
    },
    execute: async () => ({
      kind: 'denied',
      code: 'INVALID_INPUT'
    })
  };
}
