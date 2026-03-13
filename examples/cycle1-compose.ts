import type { AdapterResponse, AuthConfig, AuthError, AuthResult, NotHandled, RuntimeAdapter } from '../packages/contracts/src/index.js';
import { createDefaultCryptoProvider } from '../packages/crypto-default/src/index.js';
import { createAuthKernel, createEmailPasswordPlugin, createSessionLayer, validateStartupConfig } from '../packages/core/src/index.js';
import { createNodeRuntimeAdapter, validateNodeConfig } from '../packages/node-adapter/src/index.js';
import { createPostgresStorageAdapter } from '../packages/storage-postgres/src/index.js';

type RuntimeInput = Parameters<RuntimeAdapter['parseRequest']>[0];

export type Cycle1ReferenceApp = {
  config: Readonly<AuthConfig>;
  handleRequest: (input: RuntimeInput) => Promise<AdapterResponse | AuthError | NotHandled>;
};

const defaultConfig: AuthConfig = {
  sessionTransportMode: 'bearer',
  entrypointMethods: {
    signUpWithPassword: 'POST',
    signInWithPassword: 'POST',
    getSession: 'GET',
    refreshSession: 'POST',
    logout: 'POST',
    logoutAll: 'POST'
  },
  entrypointPaths: {
    signUpWithPassword: '/auth/signup',
    signInWithPassword: '/auth/signin',
    getSession: '/auth/session',
    refreshSession: '/auth/refresh',
    logout: '/auth/logout',
    logoutAll: '/auth/logout-all'
  },
  entrypointTransport: {
    signUpWithPassword: 'bearer',
    signInWithPassword: 'bearer',
    getSession: 'bearer',
    refreshSession: 'bearer',
    logout: 'bearer',
    logoutAll: 'bearer'
  },
  policies: [],
  runtimeAdapter: 'node',
  storageAdapter: 'postgres',
  cryptoProvider: 'default',
  plugins: ['emailPassword'],
  publicOrigin: 'https://example.com',
  trustedForwardedHeaders: [],
  cookieOptions: {
    secure: true,
    sameSite: 'lax',
    path: '/',
    httpOnly: true
  },
  sessionCookieName: 'auth_session'
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
  return new Error(`Cycle1 composition failed: ${message}`);
}

export async function createCycle1ReferenceApp(input: {
  connectionString: string;
  config?: Partial<AuthConfig>;
}): Promise<Cycle1ReferenceApp> {
  const config = {
    ...defaultConfig,
    ...input.config,
    entrypointMethods: { ...defaultConfig.entrypointMethods, ...input.config?.entrypointMethods },
    entrypointPaths: { ...defaultConfig.entrypointPaths, ...input.config?.entrypointPaths },
    entrypointTransport: { ...defaultConfig.entrypointTransport, ...input.config?.entrypointTransport },
    cookieOptions: { ...defaultConfig.cookieOptions, ...input.config?.cookieOptions },
    policies: input.config?.policies ?? defaultConfig.policies
  } satisfies AuthConfig;

  const storage = createPostgresStorageAdapter(input.connectionString);
  const crypto = createDefaultCryptoProvider();
  const sessionLayer = createSessionLayer({ storage, crypto });
  const services = {
    storage,
    crypto,
    sessions: sessionLayer
  };

  const plugin = createEmailPasswordPlugin();
  const pluginValidation = plugin.validateConfig(config);
  if (!pluginValidation.ok) {
    throw parseError(pluginValidation.message);
  }

  const nodeValidation = validateNodeConfig(config);
  if (!nodeValidation.ok) {
    throw parseError(nodeValidation.message);
  }

  const runtime = createNodeRuntimeAdapter(config);
  const startupValidation = validateStartupConfig(config, plugin.actions(), runtime.capabilities());
  if (!startupValidation.ok) {
    throw parseError(startupValidation.message);
  }

  const schemaStatus = await storage.migrations.ensureCompatibleSchema();
  if (schemaStatus === 'MIGRATION_MISMATCH') {
    throw parseError('Storage schema is incompatible with Cycle 1 requirements.');
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
  kernel.registerPlugin(plugin);
  for (const policy of config.policies) {
    kernel.registerPolicy(policy);
  }

  const frozenConfig = deepFreeze({
    ...config,
    entrypointMethods: { ...config.entrypointMethods },
    entrypointPaths: { ...config.entrypointPaths },
    entrypointTransport: { ...config.entrypointTransport },
    cookieOptions: { ...config.cookieOptions },
    policies: [...config.policies]
  });

  return {
    config: frozenConfig,
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
