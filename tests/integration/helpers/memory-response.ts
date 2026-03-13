import type { AdapterResponse, AuthError, NotHandled } from '../../../packages/contracts/src/index.js';

type MemoryRequest = {
  method: string;
  path: string;
  body?: unknown;
  token?: string;
};

type RuntimeResult = AdapterResponse | AuthError | NotHandled;

export function createMemoryResponseClient(
  app: { handleRequest: (input: { method: string; url: string; headers: Record<string, string>; cookies: Record<string, string>; body?: unknown }) => Promise<RuntimeResult> },
  publicOrigin: string
) {
  return {
    send: async (input: MemoryRequest): Promise<RuntimeResult> => {
      const headers: Record<string, string> = {
        origin: publicOrigin
      };
      if (input.token) {
        headers.authorization = `Bearer ${input.token}`;
      }

      return app.handleRequest({
        method: input.method,
        url: `${publicOrigin}${input.path}`,
        headers,
        cookies: {},
        body: input.body
      });
    }
  };
}
