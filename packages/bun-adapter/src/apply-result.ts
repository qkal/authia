import type { AdapterResponse, AuthError, AuthResult } from '@authia/contracts';

export async function applyResult(
  result: AuthResult | AuthError,
  options: { redirects: boolean } = { redirects: true }
): Promise<AdapterResponse | AuthError> {
  try {
    if ('category' in result) {
      return result;
    }

    switch (result.kind) {
      case 'success':
        return {
          status: result.action === 'logout' || result.action === 'logoutAll' ? 204 : 200,
          headers: {},
          clearBearer: result.responseMutations?.clearBearer,
          clearCookies: result.responseMutations?.clearCookies,
          setCookies: result.responseMutations?.setCookies,
          body: result.action === 'logout' || result.action === 'logoutAll' ? undefined : result
        };
      case 'denied':
        return {
          status: result.code === 'DUPLICATE_IDENTITY' ? 409 : result.code === 'POLICY_DENIED' ? 403 : result.code === 'RATE_LIMITED' ? 429 : 400,
          headers: {},
          body: { kind: result.kind, code: result.code }
        };
      case 'unauthenticated':
        return {
          status: 401,
          headers: {},
          body: { kind: result.kind, code: result.code }
        };
      case 'redirect':
        if (!options.redirects) {
          return {
            category: 'infrastructure',
            code: 'RUNTIME_MISCONFIGURED',
            message: 'Runtime adapter does not support redirects.',
            retryable: false
          };
        }
        return { status: 303, headers: { location: result.responseMutations.redirectTo } };
    }
  } catch {
    return {
      category: 'infrastructure',
      code: 'RESPONSE_APPLY_FAILED',
      message: 'Failed to map auth result to runtime response.',
      retryable: false
    };
  }
}
