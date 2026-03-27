import type { AuthConfig, AuthError, AuthResult, Plugin, PluginServices, RequestContext } from '@authia/contracts';
import { createRollbackSignal } from '../../kernel/rollback-signal.js';
import { createOAuthProviderClient } from './provider-client.js';
import { createOAuthStateStore } from './state-store.js';

type OAuthProviderConfig = {
  clientId?: string;
  clientSecret?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  callbackPath?: string;
  pkceMethod?: string;
};

type OAuthRuntimeConfig = {
  publicOrigin: string;
  providers: Record<string, OAuthProviderConfig>;
};

const STATE_TTL_MS = 5 * 60 * 1000;
const OAUTH_IDENTITY_RACE_RETRY = 'OAUTH_IDENTITY_RACE_RETRY';

function isAuthError<T>(value: T | AuthError): value is AuthError {
  return typeof value === 'object' && value !== null && 'category' in value && 'code' in value;
}

function isRollbackSignal(error: unknown): error is { outcome: AuthResult | AuthError } {
  return typeof error === 'object' && error !== null && 'outcome' in error;
}

function invalidInput() {
  return { kind: 'denied' as const, code: 'INVALID_INPUT' as const };
}

function storageUnavailable(message: string): AuthError {
  return {
    category: 'infrastructure',
    code: 'STORAGE_UNAVAILABLE',
    message,
    retryable: false
  };
}

function runtimeMisconfigured(message: string): AuthError {
  return {
    category: 'infrastructure',
    code: 'RUNTIME_MISCONFIGURED',
    message,
    retryable: false
  };
}

function isRelativeRedirect(redirectTo: string): boolean {
  return redirectTo.startsWith('/') && !redirectTo.startsWith('//');
}

function providerFromBody(context: RequestContext): string | null {
  const provider = context.body?.provider;
  if (typeof provider !== 'string') {
    return null;
  }

  const normalized = provider.trim();
  return normalized.length > 0 ? normalized : null;
}

function callbackUrl(publicOrigin: string, callbackPath: string): string {
  return new URL(callbackPath, publicOrigin).toString();
}

async function executeStartOAuth(
  context: RequestContext,
  services: PluginServices,
  runtimeConfig: OAuthRuntimeConfig
): Promise<AuthResult | AuthError> {
  if (!services.oauthStateStore || !services.oauthProviderClient) {
    return runtimeMisconfigured('OAuth runtime services are not configured.');
  }

  const provider = providerFromBody(context);
  if (!provider) {
    return invalidInput();
  }

  const providerConfig = runtimeConfig.providers[provider];
  if (!providerConfig?.callbackPath) {
    return invalidInput();
  }

  const redirectTo = context.body?.redirectTo;
  if (redirectTo !== undefined && (typeof redirectTo !== 'string' || !isRelativeRedirect(redirectTo))) {
    return invalidInput();
  }

  const [stateResult, codeVerifierResult, redirectUriHash] = await Promise.all([
    (async () => {
      const state = await services.crypto.generateOpaqueToken();
      if (isAuthError(state)) return state;
      const stateHash = await services.crypto.deriveTokenId(state);
      if (isAuthError(stateHash)) return stateHash;
      return { state, stateHash };
    })(),
    (async () => {
      const codeVerifier = await services.crypto.generateOpaqueToken();
      if (isAuthError(codeVerifier)) return codeVerifier;
      const codeChallenge = await services.crypto.deriveTokenVerifier(codeVerifier);
      if (isAuthError(codeChallenge)) return codeChallenge;
      return { codeVerifier, codeChallenge };
    })(),
    services.crypto.deriveTokenId(redirectTo ?? '/')
  ]);

  if (isAuthError(stateResult)) {
    return stateResult;
  }
  if (isAuthError(codeVerifierResult)) {
    return codeVerifierResult;
  }
  if (isAuthError(redirectUriHash)) {
    return redirectUriHash;
  }

  const { state, stateHash } = stateResult;
  const { codeVerifier, codeChallenge } = codeVerifierResult;

  const oauthStateStore = createOAuthStateStore({ oauthStateStore: services.oauthStateStore });
  const created = await oauthStateStore.create({
    provider,
    stateHash,
    codeVerifierCiphertext: codeVerifier,
    redirectUriHash,
    expiresAt: new Date(Date.now() + STATE_TTL_MS).toISOString()
  });
  if (isAuthError(created)) {
    return storageUnavailable(created.message);
  }

  const oauthProviderClient = createOAuthProviderClient({ oauthProviderClient: services.oauthProviderClient });
  const redirectUri = callbackUrl(runtimeConfig.publicOrigin, providerConfig.callbackPath);
  const authorizationUrl = oauthProviderClient.buildAuthorizationUrl({
    providerId: provider,
    redirectUri,
    state,
    codeChallenge
  });
  if (isAuthError(authorizationUrl)) {
    return authorizationUrl;
  }

  return {
    kind: 'redirect',
    responseMutations: {
      redirectTo: authorizationUrl
    }
  };
}

async function executeFinishOAuth(
  context: RequestContext,
  services: PluginServices,
  runtimeConfig: OAuthRuntimeConfig
): Promise<AuthResult | AuthError> {
  if (!services.oauthStateStore || !services.oauthProviderClient) {
    return runtimeMisconfigured('OAuth runtime services are not configured.');
  }

  const provider = providerFromBody(context);
  const code = context.body?.code;
  const state = context.body?.state;

  if (!provider || typeof code !== 'string' || code.length === 0 || typeof state !== 'string' || state.length === 0) {
    return invalidInput();
  }

  const providerConfig = runtimeConfig.providers[provider];
  if (!providerConfig?.callbackPath) {
    return invalidInput();
  }

  const stateHash = await services.crypto.deriveTokenId(state);
  if (isAuthError(stateHash)) {
    return stateHash;
  }

  const oauthStateStore = createOAuthStateStore({ oauthStateStore: services.oauthStateStore });
  const consumed = await oauthStateStore.consume({
    provider,
    stateHash,
    nowIso: new Date().toISOString()
  });
  if (isAuthError(consumed)) {
    return storageUnavailable(consumed.message);
  }
  if (!consumed) {
    return invalidInput();
  }

  const oauthProviderClient = createOAuthProviderClient({ oauthProviderClient: services.oauthProviderClient });
  const exchanged = await oauthProviderClient.exchangeCode({
    providerId: provider,
    code,
    redirectUri: callbackUrl(runtimeConfig.publicOrigin, providerConfig.callbackPath),
    codeVerifier: consumed.codeVerifierCiphertext
  });
  if (isAuthError(exchanged)) {
    if (exchanged.category === 'operator') {
      return { kind: 'unauthenticated', code: 'INVALID_CREDENTIALS' };
    }
    return storageUnavailable(exchanged.message);
  }

  const issueSessionForUser = async (
    tx: Parameters<PluginServices['storage']['beginTransaction']>[0] extends (tx: infer T) => Promise<unknown> ? T : never,
    userId: string
  ): Promise<AuthResult> => {
    const user = await tx.users.find(userId);
    if (isAuthError(user)) {
      throw createRollbackSignal(user);
    }
    if (!user) {
      throw createRollbackSignal(storageUnavailable('OAuth identity user could not be loaded.'));
    }

    const issued = await services.sessions.issueSession(user, tx, context);
    if (isAuthError(issued)) {
      throw createRollbackSignal(issued);
    }

    return {
      kind: 'success' as const,
      action: 'finishOAuth' as const,
      subject: user,
      session: issued.session,
      transport: issued.transport
    };
  };

  try {
    return await services.storage.beginTransaction(async (tx) => {
      if (!tx.oauthIdentities) {
        throw createRollbackSignal(runtimeMisconfigured('OAuth identity storage is not configured.'));
      }
      let oauthIdentity = await tx.oauthIdentities.findByProviderSubject(provider, exchanged.providerSubject);
      if (isAuthError(oauthIdentity)) {
        throw createRollbackSignal(oauthIdentity);
      }

      let userId = oauthIdentity?.userId;
      if (!userId) {
        const createdUser = await tx.users.create({});
        if (isAuthError(createdUser)) {
          throw createRollbackSignal(createdUser);
        }

        const createdIdentity = await tx.oauthIdentities.create({
          userId: createdUser.id,
          provider,
          providerSubject: exchanged.providerSubject
        });

        if (isAuthError(createdIdentity)) {
          if (createdIdentity.code === 'DUPLICATE_IDENTITY') {
            throw createRollbackSignal(storageUnavailable(OAUTH_IDENTITY_RACE_RETRY));
          } else {
            throw createRollbackSignal(createdIdentity);
          }
        } else {
          userId = createdIdentity.userId;
        }
      }

      return issueSessionForUser(tx, userId);
    });
  } catch (error) {
    if (isRollbackSignal(error)) {
      if (
        isAuthError(error.outcome) &&
        error.outcome.code === 'STORAGE_UNAVAILABLE' &&
        error.outcome.message === OAUTH_IDENTITY_RACE_RETRY
      ) {
        try {
          return await services.storage.beginTransaction(async (tx) => {
            if (!tx.oauthIdentities) {
              throw createRollbackSignal(runtimeMisconfigured('OAuth identity storage is not configured.'));
            }
            const oauthIdentity = await tx.oauthIdentities.findByProviderSubject(provider, exchanged.providerSubject);
            if (isAuthError(oauthIdentity)) {
              throw createRollbackSignal(oauthIdentity);
            }
            if (!oauthIdentity) {
              throw createRollbackSignal(storageUnavailable('OAuth identity collision could not be resolved.'));
            }
            return issueSessionForUser(tx, oauthIdentity.userId);
          });
        } catch (retryError) {
          if (isRollbackSignal(retryError)) {
            return retryError.outcome;
          }
          return storageUnavailable('OAuth callback retry transaction failed unexpectedly.');
        }
      }
      return error.outcome;
    }
    return storageUnavailable('OAuth callback transaction failed unexpectedly.');
  }
}

export function createOAuthPlugin(): Plugin {
  let runtimeConfig: OAuthRuntimeConfig | null = null;

  return {
    id: 'oauth',
    actions: () => ['startOAuth', 'finishOAuth'],
    validateConfig: (config: AuthConfig) => {
      const oauthConfig = config as AuthConfig & { oauthProviders?: Record<string, OAuthProviderConfig> };
      const providers = oauthConfig.oauthProviders;

      if (!config.entrypointPaths.startOAuth || !config.entrypointPaths.finishOAuth) {
        return {
          ok: false,
          code: 'RUNTIME_MISCONFIGURED' as const,
          message: 'OAuth entrypoint paths are required.'
        };
      }

      if (!providers || Object.keys(providers).length === 0) {
        return {
          ok: false,
          code: 'RUNTIME_MISCONFIGURED' as const,
          message: 'At least one OAuth provider configuration is required.'
        };
      }

      runtimeConfig = {
        publicOrigin: config.publicOrigin,
        providers
      };

      return { ok: true };
    },
    execute: async (action, context, services) => {
      if (!runtimeConfig) {
        return {
          category: 'infrastructure',
          code: 'RUNTIME_MISCONFIGURED',
          message: 'OAuth plugin configuration was not validated.',
          retryable: false
        };
      }

      if (action === 'startOAuth') {
        return executeStartOAuth(context, services, runtimeConfig);
      }
      if (action === 'finishOAuth') {
        return executeFinishOAuth(context, services, runtimeConfig);
      }
      return invalidInput();
    }
  };
}
