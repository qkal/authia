import type {
  Plugin,
  PluginServices,
  Policy,
  RuntimeAdapter,
  SessionLayer,
  StorageAdapter
} from '../src/index.js';

const runtimeAdapter: RuntimeAdapter = {
  parseRequest: async () => ({ kind: 'notHandled' }),
  applyResult: async () => ({
    status: 200,
    headers: {}
  }),
  capabilities: () => ({
    cookies: true,
    headers: true,
    redirects: false
  })
};

const policy: Policy = {
  capabilities: { mayRedirect: false },
  evaluate: async () => ({ kind: 'allow' })
};

const crypto: PluginServices['crypto'] = {
  hashSecret: async () => '',
  verifySecret: async () => true,
  generateOpaqueToken: async () => '',
  deriveTokenId: async () => '',
  deriveTokenVerifier: async () => '',
  verifyOpaqueToken: async () => true
};

const storageAdapter: StorageAdapter = {
  migrations: {
    ensureCompatibleSchema: async () => 'ok'
  },
  users: {
    create: async () => ({ id: 'user', createdAt: '' }),
    find: async () => null
  },
  identities: {
    create: async () => ({ id: 'identity', userId: 'user', normalizedEmail: '', passwordHash: '' }),
    findByNormalizedEmail: async () => null,
    listByUser: async () => []
  },
  sessions: {
    create: async () => ({
      id: 'session',
      userId: 'user',
      currentTokenId: '',
      currentTokenVerifier: '',
      lastRotatedAt: '',
      expiresAt: '',
      idleExpiresAt: ''
    }),
    findByCurrentTokenId: async () => null,
    update: async () => ({
      id: 'session',
      userId: 'user',
      currentTokenId: '',
      currentTokenVerifier: '',
      lastRotatedAt: '',
      expiresAt: '',
      idleExpiresAt: ''
    }),
    compareAndSwapToken: async () => null,
    revoke: async () => undefined,
    revokeAllForUser: async () => 0
  },
  oauthStates: {
    create: async () => ({
      id: 'state',
      provider: 'github',
      stateHash: 'hash',
      codeVerifierCiphertext: 'ciphertext',
      redirectUriHash: 'redirect-hash',
      expiresAt: '',
      consumedAt: null
    }),
    consume: async () => null
  },
  oauthIdentities: {
    create: async () => ({
      id: 'oauth-identity',
      userId: 'user',
      provider: 'github',
      providerSubject: 'provider-subject'
    }),
    findByProviderSubject: async () => null
  },
  beginTransaction: async <T>(run: (tx: never) => Promise<T>) => run({} as never)
};

const sessionLayer: SessionLayer = {
  issueSession: async () => ({
    session: {
      id: 'session',
      userId: 'user',
      currentTokenId: '',
      currentTokenVerifier: '',
      lastRotatedAt: '',
      expiresAt: '',
      idleExpiresAt: ''
    },
    transport: { kind: 'cookie', token: '' }
  }),
  validateSession: async () => ({ kind: 'denied', code: 'INVALID_INPUT' }),
  refreshSession: async () => ({
    session: {
      id: 'session',
      userId: 'user',
      currentTokenId: '',
      currentTokenVerifier: '',
      lastRotatedAt: '',
      expiresAt: '',
      idleExpiresAt: ''
    },
    transport: { kind: 'cookie', token: '' }
  }),
  revokeSession: async () => undefined,
  revokeAllSessions: async () => 0
};

const oauthStateStore: PluginServices['oauthStateStore'] = {
  create: async () => ({
    id: 'state',
    provider: 'github',
    stateHash: 'hash',
    codeVerifierCiphertext: 'ciphertext',
    redirectUriHash: 'redirect-hash',
    expiresAt: '',
    consumedAt: null
  }),
  consume: async () => null
};

const oauthProviderClient: PluginServices['oauthProviderClient'] = {
  buildAuthorizationUrl: () => 'https://provider.example/authorize',
  exchangeCode: async () => ({ providerSubject: 'provider-subject' })
};

const plugin: Plugin = {
  id: 'plugin',
  actions: () => ['signUpWithPassword'],
  validateConfig: () => ({ ok: true }),
  execute: async () => ({
    kind: 'denied',
    code: 'INVALID_INPUT'
  })
};

void runtimeAdapter;
void policy;
void crypto;
void storageAdapter;
void sessionLayer;
void oauthStateStore;
void oauthProviderClient;
void plugin;
