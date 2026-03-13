import type { AuthConfig, SupportedAction, ValidationResult } from '@authia/contracts';

const builtInActions: SupportedAction[] = ['getSession', 'refreshSession', 'logout', 'logoutAll'];

export function validateStartupConfig(config: AuthConfig, pluginActions: SupportedAction[] = []): ValidationResult {
  if (!config.sessionCookieName) {
    return {
      ok: false,
      code: 'RUNTIME_MISCONFIGURED',
      message: 'sessionCookieName must be configured.'
    };
  }

  if (!config.cookieOptions.path) {
    return {
      ok: false,
      code: 'RUNTIME_MISCONFIGURED',
      message: 'cookieOptions.path must be configured.'
    };
  }

  if (config.sessionTransportMode !== 'both') {
    const mismatched = Object.values(config.entrypointTransport).some((value) => value !== config.sessionTransportMode);
    if (mismatched) {
      return {
        ok: false,
        code: 'RUNTIME_MISCONFIGURED',
        message: 'entrypoint transport must match sessionTransportMode when mode is fixed.'
      };
    }
  }

  const routeKeys = new Set<string>();
  for (const action of Object.keys(config.entrypointMethods) as SupportedAction[]) {
    const routeKey = `${config.entrypointMethods[action]}:${config.entrypointPaths[action]}`;
    if (routeKeys.has(routeKey)) {
      return {
        ok: false,
        code: 'RUNTIME_MISCONFIGURED',
        message: 'Entrypoint method/path pairs must be unique.'
      };
    }
    routeKeys.add(routeKey);
  }

  for (const action of builtInActions) {
    if (pluginActions.includes(action)) {
      return {
        ok: false,
        code: 'RUNTIME_MISCONFIGURED',
        message: `Plugin cannot own built-in action ${action}.`
      };
    }
  }

  return { ok: true };
}
