import type { ResponseMutations } from '@authia/contracts';

export function createClearBearerMutation(): ResponseMutations {
  return { clearBearer: true };
}

export function createClearCookieMutation(name: string, path = '/'): ResponseMutations {
  return {
    clearCookies: [
      {
        name,
        value: '',
        options: {
          path,
          expires: new Date(0).toUTCString(),
          httpOnly: true
        }
      }
    ]
  };
}
