import type { AdapterResponse, AuthError, AuthResult } from '@authia/contracts';

export async function applyResult(result: AuthResult | AuthError): Promise<AdapterResponse | AuthError> {
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
      return { status: result.code === 'DUPLICATE_IDENTITY' ? 409 : result.code === 'POLICY_DENIED' ? 403 : result.code === 'RATE_LIMITED' ? 429 : 400, headers: {} };
    case 'unauthenticated':
      return { status: 401, headers: {} };
    case 'redirect':
      return { status: 303, headers: { location: result.responseMutations.redirectTo } };
  }
}
