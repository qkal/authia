import type { RuntimeAdapter } from '@authia/contracts';
import { applyResult } from './apply-result.js';
import { parseRequest } from './parse-request.js';

export function createNodeRuntimeAdapter(): RuntimeAdapter {
  return {
    parseRequest,
    applyResult,
    capabilities: () => ({
      cookies: true,
      headers: true,
      redirects: false
    })
  };
}
