import type { AuthConfig, RuntimeAdapter } from '@authia/contracts';
import { applyResult } from './apply-result.js';
import { parseRequest } from './parse-request.js';
import { validateBunConfig } from './validate-bun-config.js';

export function createBunRuntimeAdapter(
  config: Pick<
    AuthConfig,
    'entrypointMethods' | 'entrypointPaths' | 'entrypointTransport' | 'sessionCookieName' | 'publicOrigin' | 'trustedForwardedHeaders'
  >
): RuntimeAdapter {
  const validation = validateBunConfig(config);
  if (!validation.ok) {
    throw new Error(validation.message);
  }

  return {
    parseRequest: (input) => parseRequest(input, config),
    applyResult: (result) => applyResult(result, { redirects: true }),
    capabilities: () => ({
      cookies: true,
      headers: true,
      redirects: true
    })
  };
}

