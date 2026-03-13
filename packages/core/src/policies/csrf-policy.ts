import type { Policy } from '@authia/contracts';

export function createCsrfPolicy(publicOrigin: string): Policy {
  return {
    capabilities: { mayRedirect: false },
    evaluate: async (context) => {
      const origin = context.headers.origin;
      const referer = context.headers.referer;

      if (origin === publicOrigin || (!origin && referer === publicOrigin)) {
        return { kind: 'allow' };
      }

      return { kind: 'deny', code: 'POLICY_DENIED' };
    }
  };
}
