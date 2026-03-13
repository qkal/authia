import type { SupportedAction } from './actions.js';
import type { AuthValue, PolicyDeniedCode, ValidationResult } from './errors.js';
import type { AuthConfig, AuthResult, RequestContext } from './runtime.js';
import type {
  PresentedCredential,
  SessionRecord,
  SessionTransport,
  SessionValidationOutcome,
  User
} from './session.js';
import type { OAuthState, OAuthStateConsumeInput, OAuthStateCreateInput, TransactionalStorage } from './storage.js';

export type PolicyDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; code: PolicyDeniedCode }
  | { kind: 'redirect'; location: string };

export type Policy = {
  capabilities: { mayRedirect: boolean };
  evaluate: (context: RequestContext) => Promise<PolicyDecision>;
};

export type PluginServices = {
  storage: {
    migrations: TransactionalStorage['migrations'];
    users: TransactionalStorage['users'];
    identities: TransactionalStorage['identities'];
    sessions: TransactionalStorage['sessions'];
    oauthStates?: TransactionalStorage['oauthStates'];
    oauthIdentities?: TransactionalStorage['oauthIdentities'];
    passwordResetTokens?: TransactionalStorage['passwordResetTokens'];
    emailVerificationTokens?: TransactionalStorage['emailVerificationTokens'];
    verifiedEmails?: TransactionalStorage['verifiedEmails'];
    beginTransaction: <T>(run: (tx: TransactionalStorage) => Promise<T>) => Promise<AuthValue<T>>;
  };
  crypto: {
    hashSecret: (value: string) => Promise<AuthValue<string>>;
    verifySecret: (value: string, hash: string) => Promise<AuthValue<boolean>>;
    generateOpaqueToken: () => Promise<AuthValue<string>>;
    deriveTokenId: (token: string) => Promise<AuthValue<string>>;
    deriveTokenVerifier: (token: string) => Promise<AuthValue<string>>;
    verifyOpaqueToken: (token: string, verifier: string) => Promise<AuthValue<boolean>>;
  };
  sessions: {
    issueSession: (
      subject: User,
      tx: TransactionalStorage,
      context: RequestContext
    ) => Promise<AuthValue<{ session: SessionRecord; transport: SessionTransport }>>;
    validateSession: (
      credential: PresentedCredential | undefined,
      context: RequestContext
    ) => Promise<AuthValue<SessionValidationOutcome>>;
    refreshSession: (
      session: SessionRecord,
      tx: TransactionalStorage,
      context: RequestContext
    ) => Promise<
      | AuthValue<{ session: SessionRecord; transport: SessionTransport }>
      | { kind: 'denied'; code: 'INVALID_INPUT' }
      | { kind: 'unauthenticated'; code: 'SESSION_EXPIRED' | 'SESSION_REVOKED' }
    >;
    revokeSession: (sessionId: string, tx?: TransactionalStorage) => Promise<AuthValue<void>>;
    revokeAllSessions: (userId: string, tx?: TransactionalStorage) => Promise<AuthValue<number>>;
  };
  oauthStateStore?: {
    create: (input: OAuthStateCreateInput) => Promise<AuthValue<OAuthState>>;
    consume: (
      input: OAuthStateConsumeInput
    ) => Promise<AuthValue<{ codeVerifierCiphertext: string; redirectUriHash: string } | null>>;
  };
  oauthProviderClient?: {
    buildAuthorizationUrl: (input: {
      providerId: string;
      redirectUri: string;
      state: string;
      codeChallenge: string;
    }) => AuthValue<string>;
    exchangeCode: (input: {
      providerId: string;
      code: string;
      redirectUri: string;
      codeVerifier: string;
    }) => Promise<AuthValue<{ providerSubject: string }>>;
  };
  emailDelivery?: {
    sendPasswordReset: (input: { email: string; resetToken: string }) => Promise<AuthValue<void>>;
    sendEmailVerification: (input: { email: string; verificationToken: string }) => Promise<AuthValue<void>>;
  };
};

export type Plugin = {
  id: string;
  actions: () => SupportedAction[];
  validateConfig: (config: AuthConfig) => ValidationResult;
  execute: (
    action: SupportedAction,
    context: RequestContext,
    services: PluginServices
  ) => Promise<AuthResult | import('./errors.js').AuthError>;
};

export type SessionLayer = PluginServices['sessions'];
