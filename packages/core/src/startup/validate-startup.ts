import { supportedActions, type AuthConfig, type SupportedAction, type ValidationResult } from '@authia/contracts';

const builtInActions: SupportedAction[] = ['getSession', 'refreshSession', 'logout', 'logoutAll'];

export function validateStartupConfig(
  config: AuthConfig,
  pluginActions: SupportedAction[] = [],
  runtimeCapabilities: { redirects: boolean } = { redirects: false }
): ValidationResult {
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

  const ownedActions = new Set<SupportedAction>(builtInActions);
  for (const action of pluginActions) {
    if (ownedActions.has(action)) {
      return {
        ok: false,
        code: 'RUNTIME_MISCONFIGURED',
        message: `Action ownership conflict detected for ${action}.`
      };
    }
    ownedActions.add(action);
  }

  for (const action of supportedActions) {
    if (!ownedActions.has(action)) {
      return {
        ok: false,
        code: 'RUNTIME_MISCONFIGURED',
        message: `Missing action owner for ${action}.`
      };
    }
  }

  const needsRedirects = config.policies.some((policy) => policy.capabilities.mayRedirect);
  if (needsRedirects && !runtimeCapabilities.redirects) {
    return {
      ok: false,
      code: 'RUNTIME_MISCONFIGURED',
      message: 'Redirect policies require runtime redirect capability.'
    };
  }

  return { ok: true };
}
