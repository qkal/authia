import type { AuthConfig, AuthError, AuthResult, Plugin, PluginServices, Policy, RequestContext, SessionLayer, SupportedAction } from '@authia/contracts';
import { createClearBearerMutation, createClearCookieMutation } from '../session/transport-mutations.js';
import { createCsrfPolicy } from '../policies/csrf-policy.js';

const builtInActions: SupportedAction[] = ['getSession', 'refreshSession', 'logout', 'logoutAll'];

type KernelDependencies = {
  config: AuthConfig;
  services: PluginServices;
  sessionLayer: SessionLayer;
  runtimeCapabilities?: { redirects: boolean };
};

function isAuthError(value: unknown): value is AuthError {
  return typeof value === 'object' && value !== null && 'category' in value && 'code' in value;
}

function isRollbackSignal(error: unknown): error is { outcome: AuthResult | AuthError } {
  return typeof error === 'object' && error !== null && 'outcome' in error;
}

function clearCurrentTransport(config: AuthConfig, context: RequestContext): AuthResult['responseMutations'] {
  if (context.transport === 'bearer') {
    return createClearBearerMutation();
  }
  return createClearCookieMutation(config.sessionCookieName, config.cookieOptions.path);
}

export function createAuthKernel(deps: KernelDependencies) {
  const plugins: Plugin[] = [];
  const policies: Policy[] = [];
  const csrfPolicy = createCsrfPolicy(deps.config.publicOrigin);

  const findActionOwner = (action: SupportedAction): Plugin | 'sessionLayer' | null => {
    if (builtInActions.includes(action)) {
      return 'sessionLayer';
    }
    return plugins.find((plugin) => plugin.actions().includes(action)) ?? null;
  };

  const runPolicies = async (context: RequestContext, skipAppPolicies: boolean): Promise<AuthResult | AuthError | null> => {
    const policyList = skipAppPolicies ? [csrfPolicy] : [csrfPolicy, ...policies];
    for (const policy of policyList) {
      try {
        const decision = await policy.evaluate(context);
        if (decision.kind === 'allow') {
          continue;
        }
        if (decision.kind === 'deny') {
          return { kind: 'denied', code: decision.code };
        }
        if (!deps.runtimeCapabilities?.redirects) {
          return {
            category: 'infrastructure',
            code: 'RUNTIME_MISCONFIGURED',
            message: 'Redirect policy requires a runtime adapter with redirect capability.',
            retryable: false
          };
        }
        return {
          kind: 'redirect',
          responseMutations: {
            redirectTo: decision.location
          }
        };
      } catch {
        return {
          category: 'infrastructure',
          code: 'POLICY_FAILURE',
          message: 'Policy evaluation failed.',
          retryable: false
        };
      }
    }
    return null;
  };

  const runTransaction = async <T>(run: Parameters<PluginServices['storage']['beginTransaction']>[0]): Promise<T | AuthError> => {
    try {
      const result = await deps.services.storage.beginTransaction(run);
      return result as T | AuthError;
    } catch (error) {
      if (isRollbackSignal(error)) {
        return error.outcome as T | AuthError;
      }
      return {
        category: 'infrastructure',
        code: 'STORAGE_UNAVAILABLE',
        message: 'Transactional execution failed.',
        retryable: false
      };
    }
  };

  return {
    handle: async (incoming: RequestContext): Promise<AuthResult | AuthError> => {
      const owner = findActionOwner(incoming.action);
      if (!owner) {
        return { kind: 'denied', code: 'INVALID_INPUT' };
      }

      let context: RequestContext = incoming;
      let skipAppPolicies = false;

      if (incoming.action === 'getSession' || incoming.action === 'refreshSession') {
        const validation = await deps.sessionLayer.validateSession(incoming.credential, incoming);
        if (isAuthError(validation)) {
          return validation;
        }
        if (validation.kind !== 'authenticated') {
          return validation;
        }
        context = { ...incoming, session: validation.value };
      }

      if (incoming.action === 'logout') {
        if (incoming.credential) {
          const validation = await deps.sessionLayer.validateSession(incoming.credential, incoming);
          if (isAuthError(validation)) {
            return validation;
          }
          if (validation.kind === 'authenticated') {
            context = { ...incoming, session: validation.value };
          } else if (validation.kind === 'unauthenticated') {
            context = { ...incoming, session: null };
            skipAppPolicies = true;
          } else {
            return validation;
          }
        } else {
          context = { ...incoming, session: null };
          skipAppPolicies = true;
        }
      }

      if (incoming.action === 'logoutAll') {
        if (!incoming.credential) {
          return { kind: 'denied', code: 'INVALID_INPUT' };
        }
        const validation = await deps.sessionLayer.validateSession(incoming.credential, incoming);
        if (isAuthError(validation)) {
          return validation;
        }
        if (validation.kind !== 'authenticated') {
          return validation;
        }
        context = { ...incoming, session: validation.value };
      }

      const policyOutcome = await runPolicies(context, skipAppPolicies);
      if (policyOutcome) {
        return policyOutcome;
      }

      if (owner !== 'sessionLayer') {
        return owner.execute(context.action, context, deps.services);
      }

      if (context.action === 'getSession') {
        if (!context.session) {
          return { kind: 'denied', code: 'INVALID_INPUT' };
        }
        return {
          kind: 'success',
          action: 'getSession',
          subject: context.session.user,
          session: context.session.session
        };
      }

      if (context.action === 'refreshSession') {
        if (!context.session) {
          return { kind: 'denied', code: 'INVALID_INPUT' };
        }
        const refreshed = await runTransaction<
          { session: import('@authia/contracts').SessionRecord; transport: import('@authia/contracts').SessionTransport } | AuthResult
        >(async (tx) => deps.sessionLayer.refreshSession(context.session!.session, tx, context));
        if (isAuthError(refreshed)) {
          return refreshed;
        }
        if ('kind' in refreshed) {
          return refreshed as AuthResult;
        }
        return {
          kind: 'success',
          action: 'refreshSession',
          subject: context.session.user,
          session: refreshed.session,
          transport: refreshed.transport
        };
      }

      if (context.action === 'logout') {
        if (context.session?.session) {
          const revoked = await runTransaction(async (tx) => deps.sessionLayer.revokeSession(context.session!.session.id, tx));
          if (isAuthError(revoked)) {
            return revoked;
          }
        }
        return {
          kind: 'success',
          action: 'logout',
          responseMutations: clearCurrentTransport(deps.config, context)
        };
      }

      if (context.action === 'logoutAll') {
        if (!context.session) {
          return { kind: 'denied', code: 'INVALID_INPUT' };
        }
        const revoked = await runTransaction(async (tx) => deps.sessionLayer.revokeAllSessions(context.session!.user.id, tx));
        if (isAuthError(revoked)) {
          return revoked;
        }
        return {
          kind: 'success',
          action: 'logoutAll',
          responseMutations: clearCurrentTransport(deps.config, context)
        };
      }

      return { kind: 'denied', code: 'INVALID_INPUT' };
    },
    registerPlugin: (plugin: Plugin) => {
      plugins.push(plugin);
    },
    registerPolicy: (policy: Policy) => {
      policies.push(policy);
    },
    plugins,
    policies
  };
}
