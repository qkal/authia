import type { Policy } from '@authia/contracts';

export function createCsrfPolicy(publicOrigin: string): Policy {
  return {
    capabilities: { mayRedirect: false },
    evaluate: async (context) => {
      const origin = context.headers.origin;
      const referer = context.headers.referer;

      if (origin === publicOrigin) {
        return { kind: 'allow' };
      }

      if (!origin && referer) {
        try {
          const refererUrl = new URL(referer);
          if (refererUrl.origin === publicOrigin) {
            return { kind: 'allow' };
          }
        } catch {
          // Malformed referer URL - fail closed
          return { kind: 'deny', code: 'POLICY_DENIED' };
        }
      }

      return { kind: 'deny', code: 'POLICY_DENIED' };
    }
  };
}
