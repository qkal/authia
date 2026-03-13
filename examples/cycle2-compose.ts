import type { AdapterResponse, AuthConfig, AuthError, AuthResult, NotHandled, RuntimeAdapter } from '../packages/contracts/src/index.js';
import { createDefaultCryptoProvider } from '../packages/crypto-default/src/index.js';
import { createAuthKernel, createEmailPasswordPlugin, createOAuthPlugin, createSessionLayer, validateStartupConfig } from '../packages/core/src/index.js';
import { createNodeRuntimeAdapter, validateNodeConfig } from '../packages/node-adapter/src/index.js';
import { createPostgresStorageAdapter } from '../packages/storage-postgres/src/index.js';

type RuntimeInput = Parameters<RuntimeAdapter['parseRequest']>[0];
type ProviderMode = 'success' | 'reject' | 'transport-failure';
type DeliveryMode = 'success' | 'transport-failure' | 'disabled';
type DeliveryRecord =
  | { kind: 'passwordReset'; email: string; token: string }
  | { kind: 'emailVerification'; email: string; token: string };

export type Cycle2ReferenceApp = {
  config: Readonly<AuthConfig>;
  getDeliveries: () => DeliveryRecord[];
  handleRequest: (input: RuntimeInput) => Promise<AdapterResponse | AuthError | NotHandled>;
};

const defaultConfig: AuthConfig = {
  sessionTransportMode: 'bearer',
  entrypointMethods: {
    signUpWithPassword: 'POST',
    signInWithPassword: 'POST',
    requestPasswordReset: 'POST',
    resetPassword: 'POST',
    requestEmailVerification: 'POST',
    verifyEmail: 'POST',
    getSession: 'GET',
    refreshSession: 'POST',
    logout: 'POST',
    logoutAll: 'POST',
    startOAuth: 'POST',
    finishOAuth: 'POST'
  },
  entrypointPaths: {
    signUpWithPassword: '/auth/signup',
    signInWithPassword: '/auth/signin',
    requestPasswordReset: '/auth/password/request-reset',
    resetPassword: '/auth/password/reset',
    requestEmailVerification: '/auth/email/request-verification',
    verifyEmail: '/auth/email/verify',
    getSession: '/auth/session',
    refreshSession: '/auth/refresh',
    logout: '/auth/logout',
    logoutAll: '/auth/logout-all',
    startOAuth: '/auth/oauth/start',
    finishOAuth: '/auth/oauth/finish'
  },
  entrypointTransport: {
    signUpWithPassword: 'bearer',
    signInWithPassword: 'bearer',
    requestPasswordReset: 'bearer',
    resetPassword: 'bearer',
    requestEmailVerification: 'bearer',
    verifyEmail: 'bearer',
    getSession: 'bearer',
    refreshSession: 'bearer',
    logout: 'bearer',
    logoutAll: 'bearer',
    startOAuth: 'bearer',
    finishOAuth: 'bearer'
  },
  policies: [],
  runtimeAdapter: 'node',
  storageAdapter: 'postgres',
  cryptoProvider: 'default',
  plugins: ['emailPassword', 'oauth'],
  publicOrigin: 'https://example.com',
  trustedForwardedHeaders: [],
  cookieOptions: {
    secure: true,
    sameSite: 'lax',
    path: '/',
    httpOnly: true
  },
  sessionCookieName: 'auth_session',
  oauthProviders: {
    github: {
      clientId: 'github-client-id',
      authorizationEndpoint: 'https://provider.example.com/authorize',
      tokenEndpoint: 'https://provider.example.com/token',
      callbackPath: '/oauth/callback/github',
      pkceMethod: 'S256'
    }
  }
};

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  Object.freeze(value);
  for (const key of Object.getOwnPropertyNames(value)) {
    const child = (value as Record<string, unknown>)[key];
    if (typeof child === 'object' && child !== null && !Object.isFrozen(child)) {
      deepFreeze(child);
    }
  }
  return value;
}

function parseError(message: string): Error {
  return new Error(`Cycle2 composition failed: ${message}`);
}

export async function createCycle2ReferenceApp(input: {
  connectionString: string;
  providerMode?: ProviderMode;
  deliveryMode?: DeliveryMode;
  config?: Partial<AuthConfig>;
}): Promise<Cycle2ReferenceApp> {
  const config = {
    ...defaultConfig,
    ...input.config,
    entrypointMethods: { ...defaultConfig.entrypointMethods, ...input.config?.entrypointMethods },
    entrypointPaths: { ...defaultConfig.entrypointPaths, ...input.config?.entrypointPaths },
    entrypointTransport: { ...defaultConfig.entrypointTransport, ...input.config?.entrypointTransport },
    cookieOptions: { ...defaultConfig.cookieOptions, ...input.config?.cookieOptions },
    policies: input.config?.policies ?? defaultConfig.policies,
    oauthProviders: { ...defaultConfig.oauthProviders, ...input.config?.oauthProviders }
  } satisfies AuthConfig;

  const storage = createPostgresStorageAdapter(input.connectionString);
  const crypto = createDefaultCryptoProvider();
  const sessionLayer = createSessionLayer({ storage, crypto });

  const mode = input.providerMode ?? 'success';
  const deliveryMode = input.deliveryMode ?? 'success';
  const deliveries: DeliveryRecord[] = [];
  const oauthProviderClient = {
    buildAuthorizationUrl: ({ providerId, redirectUri, state, codeChallenge }: {
      providerId: string;
      redirectUri: string;
      state: string;
      codeChallenge: string;
    }) => {
      const provider = config.oauthProviders?.[providerId];
      if (!provider) {
        return {
          category: 'operator',
          code: 'INVALID_CONFIGURATION',
          message: `OAuth provider ${providerId} is not configured.`,
          retryable: false
        } as const;
      }
      const url = new URL(provider.authorizationEndpoint);
      url.searchParams.set('state', state);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('code_challenge', codeChallenge);
      return url.toString();
    },
    exchangeCode: async ({ code }: { code: string }) => {
      if (mode === 'reject' || code === 'reject') {
        return {
          category: 'operator',
          code: 'INVALID_CONFIGURATION',
          message: 'Provider rejected authorization code.',
          retryable: false
        } as const;
      }
      if (mode === 'transport-failure' || code === 'transport-failure') {
        return {
          category: 'infrastructure',
          code: 'STORAGE_UNAVAILABLE',
          message: 'Provider transport failed.',
          retryable: true
        } as const;
      }
      return { providerSubject: `subject:${code}` };
    }
  };
  const emailDelivery = {
    sendPasswordReset: async ({ email, resetToken }: { email: string; resetToken: string }) => {
      if (deliveryMode === 'disabled') {
        return undefined;
      }
      if (deliveryMode === 'transport-failure') {
        return {
          category: 'infrastructure',
          code: 'STORAGE_UNAVAILABLE',
          message: 'Delivery provider transport failed.',
          retryable: true
        } as const;
      }
      deliveries.push({ kind: 'passwordReset', email, token: resetToken });
      return undefined;
    },
    sendEmailVerification: async ({ email, verificationToken }: { email: string; verificationToken: string }) => {
      if (deliveryMode === 'disabled') {
        return undefined;
      }
      if (deliveryMode === 'transport-failure') {
        return {
          category: 'infrastructure',
          code: 'STORAGE_UNAVAILABLE',
          message: 'Delivery provider transport failed.',
          retryable: true
        } as const;
      }
      deliveries.push({ kind: 'emailVerification', email, token: verificationToken });
      return undefined;
    }
  };

  const services = {
    storage,
    crypto,
    sessions: sessionLayer,
    oauthStateStore: storage.oauthStates,
    oauthProviderClient,
    emailDelivery
  };

  const emailPlugin = createEmailPasswordPlugin();
  const oauthPlugin = createOAuthPlugin();
  for (const plugin of [emailPlugin, oauthPlugin]) {
    const validation = plugin.validateConfig(config);
    if (!validation.ok) {
      throw parseError(validation.message);
    }
  }

  const nodeValidation = validateNodeConfig(config);
  if (!nodeValidation.ok) {
    throw parseError(nodeValidation.message);
  }

  const runtime = createNodeRuntimeAdapter(config);
  const startupValidation = validateStartupConfig(
    config,
    [...emailPlugin.actions(), ...oauthPlugin.actions()],
    runtime.capabilities()
  );
  if (!startupValidation.ok) {
    throw parseError(startupValidation.message);
  }

  const schemaStatus = await storage.migrations.ensureCompatibleSchema();
  if (schemaStatus === 'MIGRATION_MISMATCH') {
    throw parseError('Storage schema is incompatible with Cycle 2 requirements.');
  }
  if (typeof schemaStatus === 'object' && schemaStatus !== null && 'category' in schemaStatus) {
    throw parseError(schemaStatus.message);
  }

  const kernel = createAuthKernel({
    config,
    services,
    sessionLayer,
    runtimeCapabilities: runtime.capabilities()
  });
  kernel.registerPlugin(emailPlugin);
  kernel.registerPlugin(oauthPlugin);
  for (const policy of config.policies) {
    kernel.registerPolicy(policy);
  }

  const frozenConfig = deepFreeze({
    ...config,
    entrypointMethods: { ...config.entrypointMethods },
    entrypointPaths: { ...config.entrypointPaths },
    entrypointTransport: { ...config.entrypointTransport },
    cookieOptions: { ...config.cookieOptions },
    policies: [...config.policies],
    oauthProviders: { ...config.oauthProviders }
  });

  return {
    config: frozenConfig,
    getDeliveries: () => [...deliveries],
    handleRequest: async (requestInput) => {
      const parsed = await runtime.parseRequest(requestInput);
      if ('kind' in parsed && parsed.kind === 'notHandled') {
        return parsed;
      }
      if ('category' in parsed || ('kind' in parsed && parsed.kind !== 'notHandled')) {
        return runtime.applyResult(parsed as AuthResult | AuthError);
      }
      const result = await kernel.handle(parsed);
      return runtime.applyResult(result);
    }
  };
}
