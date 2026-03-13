# TypeScript Auth Core Design - Cycle 1 Normative Spec

## Problem

Design the first implementation-planning slice of a modular TypeScript auth core aimed at framework authors. This Cycle 1 spec freezes the contracts needed to build a production-ready Node.js + Postgres + email/password + sessions path.

## Scope

### In scope for this planning cycle

- Node.js runtime adapter
- Postgres storage adapter
- Email/password plugin
- Built-in session layer
- Contracts package for runtime, kernel, session, storage, policy, and plugin boundaries

### Out of scope for this planning cycle

- OAuth providers and OAuth state handling
- Bun and Deno adapters
- Hosted control plane, enterprise features, analytics, billing, dashboard
- Verification emails, password reset, passkeys, MFA, SAML, SCIM

## Product Direction

The product remains a modular kernel with official batteries, but this document freezes only the first implementation slice. The kernel owns orchestration and result semantics. The runtime adapter owns request parsing and response application. The email/password plugin owns credential logic. The session layer owns session issuance, validation, refresh, and revocation. The Postgres adapter owns persistence and schema compatibility.

## Architecture Overview

### Runtime Adapter Layer

Purpose: normalize Node.js request and response behavior.

Responsibilities:

- Parse incoming requests into a stable request context
- Extract session credentials from the frozen cookie or bearer sources
- Derive trusted public origin information
- Detect ambiguous credentials before kernel dispatch
- Decline non-auth routes without mutating the response
- Apply success, denied, unauthenticated, redirect, and operator/infrastructure results to runtime-native responses

Public contract:

- `parseRequest(input) -> Promise<RequestContext | NotHandled | AuthResult | AuthError>` where `input = { method, url, headers, cookies, body }` and `headers` preserves duplicate values as `string | string[]`
- `applyResult(result) -> Promise<AdapterResponse | AuthError>`
- `capabilities() -> { cookies: true, headers: true, redirects: boolean }`

Rules:

- If no configured `(method, path)` pair matches, parsing returns `notHandled` and the host framework continues routing.
- `RequestContext.action` is derived by uppercasing the request method, extracting the URL pathname, and exact-matching the `(method, path)` pair against `entrypointMethods` and `entrypointPaths`.
- Path matching is exact. Wildcards, parameterized segments, and trailing-slash normalization are out of scope for Cycle 1.
- The runtime adapter lowercases header names, rejects duplicate values for `authorization`, `origin`, `referer`, `x-forwarded-host`, and `x-forwarded-proto`, and only then normalizes accepted single values into `RequestContext.headers`.
- `RequestContext.transport` is chosen from `entrypointTransport[RequestContext.action]`.
- Cookie credentials are read only from the cookie named `sessionCookieName`.
- Bearer credentials are read only from the `Authorization` header using exactly one value in the form `Bearer <token>`. Query-string and request-body tokens are out of scope.
- Malformed `Authorization` values return `denied(INVALID_INPUT)`.
- Malformed JSON request bodies on `signUpWithPassword` and `signInWithPassword` return `denied(INVALID_INPUT)`.
- If both cookie and bearer credentials are present, parsing returns `denied(AMBIGUOUS_CREDENTIALS)` without invoking the kernel.
- If `sessionTransportMode` is `cookie` or `bearer`, startup validation requires every `entrypointTransport` value to match that mode.
- If a presented credential kind does not match `entrypointTransport[RequestContext.action]`, parsing returns `denied(INVALID_INPUT)`.
- Startup validation parses `publicOrigin` as an absolute origin-only URL and freezes its normalized `(scheme, host, port)` tuple.
- On each request, parsing derives the effective external origin from trusted forwarded headers when configured, otherwise from the request URL, then compares the normalized `(scheme, host, port)` tuple to `publicOrigin`.
- If trusted forwarded headers are enabled, `x-forwarded-host` and `x-forwarded-proto` must both be present as single values; duplicates, partial presence, or tuple mismatches return `AuthError(RUNTIME_MISCONFIGURED)`.
- Public-origin mismatches return `AuthError(RUNTIME_MISCONFIGURED)`.
- HTTP mapping is frozen as:
  - `success` for `signUpWithPassword`, `signInWithPassword`, `getSession`, and `refreshSession`: `200`
  - `success` for `logout` and `logoutAll`: `204`
  - `denied(INVALID_INPUT | AMBIGUOUS_CREDENTIALS)`: `400`
  - `denied(DUPLICATE_IDENTITY)`: `409`
  - `denied(RATE_LIMITED)`: `429`
  - `denied(POLICY_DENIED)`: `403`
  - `unauthenticated(...)`: `401`
  - `redirect`: `303`
  - `AuthError(STORAGE_UNAVAILABLE)`: `503`
  - all other `AuthError`: `500`
- On success with `transport.kind = 'cookie'`, `applyResult` emits `Set-Cookie` for `sessionCookieName`.
- `signUpWithPassword`, `signInWithPassword`, `getSession`, and `refreshSession` return JSON body `{ user, session }` where `user` is `UserView` and `session` is `SessionView`.
- On success with `transport.kind = 'bearer'`, `applyResult` returns JSON body `{ user, session, token, tokenType: 'Bearer' }`.
- `logout` and `logoutAll` return no body.
- If response serialization or header/cookie mutation fails, `applyResult` returns `AuthError(RESPONSE_APPLY_FAILED)`. When the underlying auth result was already committed, this error is operator-facing and must not trigger a second auth mutation attempt.

### Auth Kernel

Purpose: orchestrate lifecycle, policies, and action dispatch.

Responsibilities:

- Resolve the action owner from `RequestContext.action`
- Hydrate session context when the action requires an already-present session
- Run built-in and app-registered policies
- Invoke the resolved plugin or built-in session handler
- Convert rollback signals into final auth results

Frozen action ownership:

- Built-in session layer owns `getSession`, `refreshSession`, `logout`, and `logoutAll`
- Email/password plugin owns `signUpWithPassword` and `signInWithPassword`
- Startup validation fails if a plugin claims any built-in session action, if two plugins claim the same action, or if any frozen action has no owner

Public contract:

- `handle(context) -> Promise<AuthResult | AuthError>`
- `registerPlugin(plugin) -> void`
- `registerPolicy(policy) -> void`

Lifecycle order:

1. Normalize request context.
2. Resolve action owner.
3. For `logout` and `logoutAll`, hydrate session context when a credential is present.
4. For `getSession` and `refreshSession`, the built-in session layer validates the presented credential first; on authenticated validation it populates `context.session`, on missing credential it returns `denied(INVALID_INPUT)`, and on expired or revoked credential it returns `unauthenticated(...)` without continuing.
5. Run built-in CSRF policy and app policies. Policies see `context.session` for authenticated `getSession`, `refreshSession`, `logout`, and `logoutAll` requests.
6. Execute the resolved plugin or built-in session handler.
7. Commit success paths or roll back typed failures.
8. Return the final result.

Logout exception:

- `logout` is intentionally idempotent. Missing, expired, or revoked credentials produce `success` with transport-clearing mutations rather than `unauthenticated`.

`RequestContext.session` semantics:

- `undefined`: session validation has not run, or the action is unauthenticated by design (`signUpWithPassword`, `signInWithPassword`).
- `AuthenticatedSession`: session validation succeeded and policies/handlers may rely on `context.session.user` and `context.session.session`.
- `null`: session validation ran for `logout`, the presented credential was expired or revoked, and the kernel is continuing only to preserve logout idempotency.
- App policies do not run for idempotent `logout` requests where `context.session` is `null`; the kernel proceeds directly to transport clearing.

### Email/Password Plugin

Purpose: implement local sign-up and sign-in.

Responsibilities:

- Validate required email/password input
- Normalize email
- Verify password hashes
- Request session issuance on successful auth

Public contract:

- `id`
- `actions() -> SupportedAction[]`
- `validateConfig(config) -> ValidationResult`
- `execute(action, context, services) -> Promise<AuthResult | AuthError>`

Validation rules:

- Email normalization is: trim whitespace, convert to lowercase, then normalize to Unicode NFC.
- Normalized email must be non-empty and contain exactly one `@`
- Password length must be between 8 and 128 characters
- Missing or malformed fields return `denied(INVALID_INPUT)`
- Duplicate normalized email on sign-up returns `denied(DUPLICATE_IDENTITY)`
- Wrong password returns `unauthenticated(INVALID_CREDENTIALS)`

### Session Layer

Purpose: provide server-side session lifecycle behavior.

Responsibilities:

- Issue sessions
- Validate presented credentials
- Refresh sessions
- Revoke one or all sessions

Public contract:

- `issueSession(subject, tx, context) -> Promise<AuthValue<{ session: SessionRecord; transport: SessionTransport }>>`
- `validateSession(credential, context) -> Promise<AuthValue<SessionValidationOutcome>>`
- `refreshSession(session, tx, context) -> Promise<AuthValue<{ session: SessionRecord; transport: SessionTransport }>>`
- `revokeSession(sessionId, tx?) -> Promise<AuthValue<void>>`
- `revokeAllSessions(userId, tx?) -> Promise<AuthValue<number>>`

Rules:

- Sessions are server-side and Postgres-backed.
- Absolute session lifetime: 30 days.
- Idle timeout: 7 days.
- Rotation is due when more than 24 hours have elapsed since `lastRotatedAt`.
- Refresh extends `idleExpiresAt`.
- If rotation is due, refresh atomically swaps token id and verifier.
- If rotation is not due, refresh returns the existing transport and an updated session record with the extended idle lifetime.
- The session layer maps a `compareAndSwapToken(...) = null` result to `unauthenticated(SESSION_REVOKED)` because the presented credential is no longer the current valid session transport.
- The losing request in a refresh race does not extend idle lifetime, does not emit a new transport, and returns `unauthenticated(SESSION_REVOKED)`.
- Missing credential or malformed credential values return `denied(INVALID_INPUT)`.
- Unknown token ids or verifier mismatches return `unauthenticated(SESSION_REVOKED)`.
- `logout` is idempotent for missing, expired, or revoked credentials and still clears transport state.
- `logoutAll` requires a presented valid credential; missing credentials return `denied(INVALID_INPUT)`.
- `logoutAll` success clears the current transport in the same way as `logout`.

Cookie transport:

- The session layer owns `sessionCookieName`.
- The runtime adapter applies `cookieOptions`.
- Cookie sessions are always `HttpOnly`.
- Cookie clearing uses the same cookie name, domain, and path as issuance, with an empty value and immediate expiry.
- Cookie-based `signUpWithPassword`, `signInWithPassword`, `refreshSession`, `logout`, and `logoutAll` must pass the built-in same-origin CSRF policy before execution.
- CSRF validation succeeds only when `Origin` matches `publicOrigin`, or when `Origin` is absent and `Referer` matches `publicOrigin`.
- CSRF validation failure returns `denied(POLICY_DENIED)`.

Bearer transport:

- Bearer tokens are client-managed.
- `clearBearer` signals that the client or SDK must discard the token locally.

### Storage Adapter Layer

Purpose: isolate persistence and schema management.

Responsibilities:

- Persist users, local identities, and sessions
- Enforce uniqueness and transactional guarantees
- Validate schema compatibility at startup

Public contract:

- `users.create/find`
- `identities.create/findByNormalizedEmail/listByUser`
- `sessions.create/findByCurrentTokenId/update/compareAndSwapToken/revoke/revokeAllForUser`
- `migrations.ensureCompatibleSchema`
- `beginTransaction(run)`

Rules:

- Sign-up, refresh, and logout-all are transactional.
- Transactions commit only on `success` or `redirect`.
- Transactions roll back on `denied`, `unauthenticated`, or `AuthError` by raising `RollbackSignal`.
- `beginTransaction(run)` commits only when `run` resolves successfully and rolls back on thrown `RollbackSignal` or any other exception.
- Plugins and built-in session handlers may throw `RollbackSignal { outcome }` inside `beginTransaction(run)`; the storage adapter rolls back and rethrows it, and the kernel catches it and returns `outcome`.
- `compareAndSwapToken(...)` atomically updates `currentTokenId`, `currentTokenVerifier`, `lastRotatedAt`, and `idleExpiresAt`.
- `compareAndSwapToken(...)` returns `null` only when another refresh already rotated the token.
- Storage driver, connectivity, or query-execution failures are converted at the storage boundary into `AuthError(STORAGE_UNAVAILABLE)` before crossing into plugins or the session layer.
- Raw tokens are never stored; storage keeps `currentTokenId` and `currentTokenVerifier`.
- `MIGRATION_MISMATCH` is raised before serving requests if schema compatibility fails.
- A unique-constraint violation on normalized email during sign-up must be converted into `denied(DUPLICATE_IDENTITY)`.

### Crypto Interface

Purpose: isolate password hashing and session-token derivation.

Public contract:

- `hashSecret(value) -> Promise<AuthValue<string>>`
- `verifySecret(value, hash) -> Promise<AuthValue<boolean>>`
- `generateOpaqueToken() -> Promise<AuthValue<string>>`
- `deriveTokenId(token) -> Promise<AuthValue<string>>`
- `deriveTokenVerifier(token) -> Promise<AuthValue<string>>`
- `verifyOpaqueToken(token, verifier) -> Promise<AuthValue<boolean>>`

Frozen defaults:

- Password hashing: Argon2id
- Session verifier derivation: SHA-256 over the opaque token
- Crypto-provider implementation failures are converted at the crypto boundary into `AuthError(CRYPTO_FAILURE)`.

### Contracts Package

Purpose: export the stable in-scope interfaces that adapters, plugins, and apps compile against.

Responsibilities:

- Export request, result, error, policy, runtime adapter, plugin, session, and storage contract types
- Exclude runtime helpers, migrations, provider integrations, and implementation code

## Action Contract Summary

- `signUpWithPassword`: method `POST`; input body `{ email, password }`; results `success | denied(INVALID_INPUT | DUPLICATE_IDENTITY)`
- `signInWithPassword`: method `POST`; input body `{ email, password }`; results `success | denied(INVALID_INPUT) | unauthenticated(INVALID_CREDENTIALS)`
- `getSession`: method `GET`; input current credential from `sessionCookieName` or `Authorization: Bearer <token>` according to `entrypointTransport`; results `success | denied(INVALID_INPUT) | unauthenticated(SESSION_EXPIRED | SESSION_REVOKED)`
- `refreshSession`: method `POST`; input current credential from `sessionCookieName` or `Authorization: Bearer <token>` according to `entrypointTransport`; results `success | denied(INVALID_INPUT) | unauthenticated(SESSION_EXPIRED | SESSION_REVOKED)`
- `logout`: method `POST`; input optional current credential from `sessionCookieName` or `Authorization: Bearer <token>` according to `entrypointTransport`; results `success`
- `logoutAll`: method `POST`; input current credential from `sessionCookieName` or `Authorization: Bearer <token>` according to `entrypointTransport`; results `success | denied(INVALID_INPUT) | unauthenticated(SESSION_EXPIRED | SESSION_REVOKED)`
- Any action may additionally return `denied(RATE_LIMITED | POLICY_DENIED)` from policy evaluation.
- Any action may additionally return `redirect` if a configured policy requests it and the runtime adapter advertises redirect support.

Success payload invariants:

- `signUpWithPassword` and `signInWithPassword` success include `subject`, `session`, and `transport`
- `getSession` success includes `subject` and `session`, and does not include a new `transport`
- `refreshSession` success includes `subject`, `session`, and `transport`
- `logout` and `logoutAll` success include only transport-clearing `responseMutations`
- The Node.js runtime adapter converts success payloads into the exact HTTP bodies defined in the runtime-adapter rules above.

## Startup Sequence

1. Load static configuration.
2. Validate `publicOrigin` as an absolute origin-only URL, normalize its `(scheme, host, port)` tuple, require `trustedForwardedHeaders` to be either empty or exactly `['x-forwarded-host', 'x-forwarded-proto']`, validate cookie config and transport config, and ensure every `(entrypointMethods[action], entrypointPaths[action])` pair is unique.
3. Validate plugin action ownership.
4. Validate redirect requirements: if any enabled policy has `mayRedirect = true` while `capabilities().redirects = false`, fail startup with `RUNTIME_MISCONFIGURED`.
5. Run storage schema compatibility checks.
6. Freeze configuration.
7. Begin serving requests.

## Error Handling

### Denied outcomes

- `INVALID_INPUT`
- `AMBIGUOUS_CREDENTIALS`
- `DUPLICATE_IDENTITY`
- `RATE_LIMITED`
- `POLICY_DENIED`

### Unauthenticated outcomes

- `INVALID_CREDENTIALS`
- `SESSION_EXPIRED`
- `SESSION_REVOKED`

### Operator/infrastructure errors

- `RUNTIME_MISCONFIGURED`
- `MIGRATION_MISMATCH`
- `STORAGE_UNAVAILABLE`
- `CRYPTO_FAILURE`
- `POLICY_FAILURE`
- `RESPONSE_APPLY_FAILED`

Rules:

- App policies may deny only with `RATE_LIMITED` or `POLICY_DENIED`.
- Policy exceptions are converted into `AuthError(POLICY_FAILURE)` with `retryable = false`.
- Adapter response failures after a commit surface as `AuthError(RESPONSE_APPLY_FAILED)` with `retryable = false`; committed session state remains authoritative.

## Public Type Sketches

```ts
type SupportedAction =
  | 'signUpWithPassword'
  | 'signInWithPassword'
  | 'getSession'
  | 'refreshSession'
  | 'logout'
  | 'logoutAll';

type ValidationResult =
  | { ok: true }
  | { ok: false; code: 'RUNTIME_MISCONFIGURED'; message: string };

type AuthValue<T> = T | AuthError;

type DeniedCode =
  | 'INVALID_INPUT'
  | 'AMBIGUOUS_CREDENTIALS'
  | 'DUPLICATE_IDENTITY'
  | 'RATE_LIMITED'
  | 'POLICY_DENIED';

type PolicyDeniedCode = 'RATE_LIMITED' | 'POLICY_DENIED';

type SessionTransportMode = 'cookie' | 'bearer' | 'both';

type EntrypointMethodMap = {
  signUpWithPassword: 'POST';
  signInWithPassword: 'POST';
  getSession: 'GET';
  refreshSession: 'POST';
  logout: 'POST';
  logoutAll: 'POST';
};

type EntrypointTransportMap = {
  signUpWithPassword: 'cookie' | 'bearer';
  signInWithPassword: 'cookie' | 'bearer';
  getSession: 'cookie' | 'bearer';
  refreshSession: 'cookie' | 'bearer';
  logout: 'cookie' | 'bearer';
  logoutAll: 'cookie' | 'bearer';
};

type EntrypointPathMap = {
  signUpWithPassword: string;
  signInWithPassword: string;
  getSession: string;
  refreshSession: string;
  logout: string;
  logoutAll: string;
};

type CookieMutation = {
  name: string;
  value?: string;
  options?: {
    secure?: boolean;
    sameSite?: 'lax' | 'strict' | 'none';
    domain?: string;
    path?: string;
    httpOnly?: true;
    expires?: string;
    maxAge?: number;
  };
};

type ResponseMutations = {
  headers?: Record<string, string | string[]>;
  setCookies?: CookieMutation[];
  clearCookies?: CookieMutation[];
  clearBearer?: boolean;
  redirectTo?: string;
};

type AdapterResponse = {
  status: number;
  headers: Record<string, string | string[]>;
  setCookies?: CookieMutation[];
  clearCookies?: CookieMutation[];
  clearBearer?: boolean;
  body?: unknown;
};

type NotHandled = {
  kind: 'notHandled';
};

type SessionTransport =
  | { kind: 'cookie'; token: string }
  | { kind: 'bearer'; token: string };

type PresentedCredential = SessionTransport;

type UserView = {
  id: string;
  createdAt: string;
};

type SessionView = {
  id: string;
  expiresAt: string;
  idleExpiresAt: string;
};

type User = {
  id: string;
  createdAt: string;
};

type LocalIdentity = {
  id: string;
  userId: string;
  normalizedEmail: string;
  passwordHash: string;
};

type SessionRecord = {
  id: string;
  userId: string;
  currentTokenId: string;
  currentTokenVerifier: string;
  lastRotatedAt: string;
  expiresAt: string;
  idleExpiresAt: string;
  revokedAt?: string | null;
};

type AuthenticatedSession = {
  user: User;
  session: SessionRecord;
};

type SessionValidationOutcome =
  | { kind: 'denied'; code: 'INVALID_INPUT' }
  | { kind: 'authenticated'; value: AuthenticatedSession }
  | { kind: 'unauthenticated'; code: 'SESSION_EXPIRED' | 'SESSION_REVOKED' };

type SessionValidationResult =
  | { kind: 'authenticated'; value: AuthenticatedSession }
  | { kind: 'unauthenticated'; code: 'SESSION_EXPIRED' | 'SESSION_REVOKED' };

type RequestContext = {
  action: SupportedAction;
  runtime: 'node';
  method: string;
  url: string;
  transport: 'cookie' | 'bearer';
  headers: Record<string, string>;
  cookies: Record<string, string>;
  credential?: PresentedCredential;
  body?: {
    email?: string;
    password?: string;
  };
  session?: AuthenticatedSession | null;
};

type PolicyDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; code: PolicyDeniedCode }
  | { kind: 'redirect'; location: string };

type Policy = {
  capabilities: { mayRedirect: boolean };
  evaluate: (context: RequestContext) => Promise<PolicyDecision>;
};

type AuthResult =
  | {
      kind: 'success';
      action: 'signUpWithPassword' | 'signInWithPassword' | 'refreshSession';
      subject: User;
      session: SessionRecord;
      transport: SessionTransport;
      responseMutations?: ResponseMutations;
    }
  | {
      kind: 'success';
      action: 'getSession';
      subject: User;
      session: SessionRecord;
      responseMutations?: ResponseMutations;
    }
  | {
      kind: 'success';
      action: 'logout' | 'logoutAll';
      responseMutations?: ResponseMutations;
    }
  | {
      kind: 'denied';
      code: DeniedCode;
      responseMutations?: ResponseMutations;
    }
  | {
      kind: 'redirect';
      responseMutations: ResponseMutations & { redirectTo: string };
    }
  | {
      kind: 'unauthenticated';
      code: 'INVALID_CREDENTIALS' | 'SESSION_EXPIRED' | 'SESSION_REVOKED';
      responseMutations?: ResponseMutations;
    };

type AuthError = {
  category: 'operator' | 'infrastructure';
  code:
    | 'RUNTIME_MISCONFIGURED'
    | 'MIGRATION_MISMATCH'
    | 'STORAGE_UNAVAILABLE'
    | 'CRYPTO_FAILURE'
    | 'POLICY_FAILURE'
    | 'RESPONSE_APPLY_FAILED';
  message: string;
  retryable: boolean;
};

type RollbackSignal = {
  outcome: AuthResult | AuthError;
};

type UserCreateInput = {};

type LocalIdentityCreateInput = {
  userId: string;
  normalizedEmail: string;
  passwordHash: string;
};

type SessionCreateInput = {
  userId: string;
  tokenId: string;
  tokenVerifier: string;
  expiresAt: string;
  idleExpiresAt: string;
};

type SessionUpdateInput = {
  tokenId?: string;
  tokenVerifier?: string;
  lastRotatedAt?: string;
  expiresAt?: string;
  idleExpiresAt?: string;
  revokedAt?: string | null;
};

type SessionCompareAndSwapInput = {
  sessionId: string;
  expectedTokenId: string;
  nextTokenId: string;
  nextTokenVerifier: string;
  nextLastRotatedAt: string;
  nextIdleExpiresAt: string;
};

type TransactionalStorage = {
  migrations: {
    ensureCompatibleSchema: () => Promise<'ok' | 'MIGRATION_MISMATCH' | AuthError>;
  };
  users: {
    create: (input: UserCreateInput) => Promise<AuthValue<User>>;
    find: (id: string) => Promise<AuthValue<User | null>>;
  };
  identities: {
    create: (input: LocalIdentityCreateInput) => Promise<AuthValue<LocalIdentity>>;
    findByNormalizedEmail: (normalizedEmail: string) => Promise<AuthValue<LocalIdentity | null>>;
    listByUser: (userId: string) => Promise<AuthValue<LocalIdentity[]>>;
  };
  sessions: {
    create: (input: SessionCreateInput) => Promise<AuthValue<SessionRecord>>;
    findByCurrentTokenId: (tokenId: string) => Promise<AuthValue<SessionRecord | null>>;
    update: (sessionId: string, input: SessionUpdateInput) => Promise<AuthValue<SessionRecord>>;
    compareAndSwapToken: (input: SessionCompareAndSwapInput) => Promise<AuthValue<SessionRecord | null>>;
    revoke: (sessionId: string) => Promise<AuthValue<void>>;
    revokeAllForUser: (userId: string) => Promise<AuthValue<number>>;
  };
};

type PluginServices = {
  storage: {
    migrations: TransactionalStorage['migrations'];
    users: TransactionalStorage['users'];
    identities: TransactionalStorage['identities'];
    sessions: TransactionalStorage['sessions'];
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
    issueSession: (subject: User, tx: TransactionalStorage, context: RequestContext) => Promise<AuthValue<{ session: SessionRecord; transport: SessionTransport }>>;
    validateSession: (credential: PresentedCredential | undefined, context: RequestContext) => Promise<AuthValue<SessionValidationOutcome>>;
    refreshSession: (session: SessionRecord, tx: TransactionalStorage, context: RequestContext) => Promise<AuthValue<{ session: SessionRecord; transport: SessionTransport }>>;
    revokeSession: (sessionId: string, tx?: TransactionalStorage) => Promise<AuthValue<void>>;
    revokeAllSessions: (userId: string, tx?: TransactionalStorage) => Promise<AuthValue<number>>;
  };
};

type AuthConfig = {
  sessionTransportMode: SessionTransportMode;
  entrypointMethods: EntrypointMethodMap;
  entrypointTransport: EntrypointTransportMap;
  entrypointPaths: EntrypointPathMap;
  policies: Policy[];
  runtimeAdapter: 'node';
  storageAdapter: 'postgres';
  cryptoProvider: 'default';
  plugins: Array<'emailPassword'>;
  publicOrigin: string;
  trustedForwardedHeaders: Array<'x-forwarded-host' | 'x-forwarded-proto'>;
  cookieOptions: {
    secure: boolean;
    sameSite: 'lax' | 'strict' | 'none';
    domain?: string;
    path: string;
    httpOnly: true;
  };
  sessionCookieName: string;
};

type RuntimeAdapter = {
  parseRequest: (input: {
    method: string;
    url: string;
    headers: Record<string, string | string[]>;
    cookies: Record<string, string>;
    body?: unknown;
  }) => Promise<RequestContext | NotHandled | AuthResult | AuthError>;
  applyResult: (result: AuthResult | AuthError) => Promise<AdapterResponse | AuthError>;
  capabilities: () => { cookies: true; headers: true; redirects: boolean };
};

type Plugin = {
  id: string;
  actions: () => SupportedAction[];
  validateConfig: (config: AuthConfig) => ValidationResult;
  execute: (action: SupportedAction, context: RequestContext, services: PluginServices) => Promise<AuthResult | AuthError>;
};

type SessionLayer = PluginServices['sessions'];

type StorageAdapter = {
  migrations: TransactionalStorage['migrations'];
  users: TransactionalStorage['users'];
  identities: TransactionalStorage['identities'];
  sessions: TransactionalStorage['sessions'];
  beginTransaction: <T>(run: (tx: TransactionalStorage) => Promise<T>) => Promise<AuthValue<T>>;
};
```

## Testing Strategy

- Kernel unit tests for orchestration, policy evaluation, and error mapping
- Email/password plugin conformance tests
- Node.js runtime adapter tests
- Postgres integration tests for local identity and session flows
- End-to-end tests for sign-up, sign-in, logout, get-session, and refresh-session

Critical scenarios:

- Invalid input
- Invalid credentials
- Duplicate identity on sign-up
- Expired session
- Revoked session
- Missing credential on get-session or refresh-session
- Refresh race loser
- Storage outage during sign-up or refresh
- Origin mismatch on cookie-based state-changing requests

## Success Criteria

- A framework author can implement sign-up, sign-in, session read, refresh, logout, and logout-all using only the frozen contracts in this document.
- The Node.js + Postgres reference path is fully specified for implementation planning.
- All later-cycle OAuth and multi-runtime work can be layered on without changing these Cycle 1 boundaries.
