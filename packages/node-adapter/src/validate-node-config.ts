import type { AuthConfig, ValidationResult } from '@authia/contracts';

export function validateNodeConfig(config: Pick<AuthConfig, 'publicOrigin' | 'trustedForwardedHeaders'>): ValidationResult {
  try {
    const url = new URL(config.publicOrigin);
    if (!url.protocol || !url.hostname) {
      return {
        ok: false,
        code: 'RUNTIME_MISCONFIGURED',
        message: 'publicOrigin must be an absolute URL.'
      };
    }
  } catch {
    return {
      ok: false,
      code: 'RUNTIME_MISCONFIGURED',
      message: 'publicOrigin must be an absolute URL.'
    };
  }

  const headers = config.trustedForwardedHeaders;
  const valid =
    headers.length === 0 ||
    (headers.length === 2 && headers.includes('x-forwarded-host') && headers.includes('x-forwarded-proto'));

  if (!valid) {
    return {
      ok: false,
      code: 'RUNTIME_MISCONFIGURED',
      message: 'trustedForwardedHeaders must be empty or include x-forwarded-host and x-forwarded-proto.'
    };
  }

  return { ok: true };
}
