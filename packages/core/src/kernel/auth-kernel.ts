import type { AuthError, AuthResult, Plugin, Policy, RequestContext, SupportedAction } from '@authia/contracts';

export function createAuthKernel() {
  const plugins: Plugin[] = [];
  const policies: Policy[] = [];

  return {
    handle: async (_context: RequestContext): Promise<AuthResult | AuthError> => ({
      kind: 'denied',
      code: 'INVALID_INPUT'
    }),
    registerPlugin: (plugin: Plugin) => {
      plugins.push(plugin);
    },
    registerPolicy: (policy: Policy) => {
      policies.push(policy);
    },
    plugins,
    policies
  };
}
