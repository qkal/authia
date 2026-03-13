# TypeScript Auth Core Cycle 1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first production-ready Node.js + Postgres + email/password + sessions implementation of the auth core defined in `docs\superpowers\specs\2026-03-13-typescript-auth-core-design.md`.

**Architecture:** Use an `npm` workspace with five focused packages: `contracts`, `crypto-default`, `storage-postgres`, `core`, and `node-adapter`. Keep all frozen public types in `contracts`, make every runtime/storage/crypto package compile against those contracts, and prove the Cycle 1 path with targeted unit tests plus a composed integration flow.

**Tech Stack:** TypeScript 5, Node.js, npm workspaces, Vitest, `pg`, `argon2`

---

Use `@superpowers:test-driven-development` for Tasks 2-8. Use `@superpowers:verification-before-completion` before the final handoff. Because this repo is currently doc-only, this plan assumes a fresh code scaffold in a dedicated worktree.

## Chunk 1: Workspace and contracts foundation

### Planned file structure

This file map covers all three chunks, not just Chunk 1.

**Workspace scaffolding**

- Create: `package.json` - workspace root scripts, shared dev dependencies, workspace declarations
- Create: `tsconfig.base.json` - shared TypeScript compiler settings for every package
- Create: `vitest.workspace.ts` - root Vitest workspace configuration
- Create: `.gitignore` - ignore `node_modules`, `dist`, coverage output, local env files

**Public contracts**

- Create: `packages\contracts\package.json` - package metadata and build/typecheck scripts
- Create: `packages\contracts\tsconfig.json` - package-specific TS config
- Create: `packages\contracts\tsconfig.typecheck.json` - package-specific typecheck config that includes the compile-only fixture
- Create: `packages\contracts\src\actions.ts` - action names and HTTP method defaults
- Create: `packages\contracts\src\errors.ts` - denied/unauthenticated/infrastructure result shapes
- Create: `packages\contracts\src\runtime.ts` - request, response, adapter, and config contracts
- Create: `packages\contracts\src\session.ts` - session, credential, and transport contracts
- Create: `packages\contracts\src\storage.ts` - storage inputs and repository contracts
- Create: `packages\contracts\src\plugin.ts` - plugin, policy, and service contracts
- Create: `packages\contracts\src\index.ts` - public export surface
- Test: `packages\contracts\test\contracts-smoke.test.ts` - runtime smoke checks for exported constants/helpers
- Test: `packages\contracts\test\contracts-typecheck.ts` - compile-time fixture imported by `tsc --noEmit`

**Domain services**

- Create: `packages\crypto-default\package.json` - crypto package metadata and dependency ownership
- Create: `packages\crypto-default\tsconfig.json` - crypto package TS config
- Create: `packages\crypto-default\src\default-crypto.ts` - Argon2id + SHA-256 implementation
- Create: `packages\storage-postgres\package.json` - Postgres package metadata and dependency ownership
- Create: `packages\storage-postgres\tsconfig.json` - Postgres package TS config
- Create: `packages\storage-postgres\src\postgres-storage.ts` - top-level adapter composition only
- Create: `packages\storage-postgres\src\migrations\ensure-compatible-schema.ts` - schema compatibility checks and `MIGRATION_MISMATCH` mapping
- Create: `packages\storage-postgres\src\repositories\users-repository.ts` - user persistence only
- Create: `packages\storage-postgres\src\repositories\identities-repository.ts` - local-identity persistence only
- Create: `packages\storage-postgres\src\repositories\sessions-repository.ts` - session persistence and CAS refresh only
- Create: `packages\storage-postgres\src\transactions.ts` - transaction wrapper and `RollbackSignal` rollback behavior
- Create: `packages\storage-postgres\src\migrations\0001_cycle1.sql` - Cycle 1 schema
- Create: `packages\core\package.json` - core package metadata and dependency ownership
- Create: `packages\core\tsconfig.json` - core package TS config
- Create: `packages\core\src\kernel\auth-kernel.ts` - lifecycle orchestration and action dispatch
- Create: `packages\core\src\kernel\rollback-signal.ts` - typed rollback helper
- Create: `packages\core\src\policies\csrf-policy.ts` - built-in cookie CSRF policy
- Create: `packages\core\src\startup\validate-startup.ts` - cross-package startup validation
- Create: `packages\core\src\session\session-layer.ts` - session issuance, validation, refresh, revoke behavior
- Create: `packages\core\src\plugins\email-password\plugin.ts` - sign-up/sign-in plugin
- Create: `packages\node-adapter\package.json` - Node adapter package metadata and dependency ownership
- Create: `packages\node-adapter\tsconfig.json` - Node adapter package TS config
- Create: `packages\node-adapter\src\node-runtime-adapter.ts` - Node request parsing and response application
- Create: `packages\node-adapter\src\parse-request.ts` - route match, header normalization, and credential extraction
- Create: `packages\node-adapter\src\apply-result.ts` - HTTP status/body/cookie mapping
- Create: `packages\node-adapter\src\validate-node-config.ts` - `publicOrigin` and forwarded-header startup validation

**Composed verification**

- Create: `tests\integration\cycle1-reference-flow.test.ts` - end-to-end reference-path tests
- Create: `tests\integration\helpers\memory-response.ts` - fake Node response capture for adapter assertions
- Create: `tests\integration\helpers\postgres-test-harness.ts` - disposable schema setup/teardown for Postgres tests
- Create: `examples\cycle1-compose.ts` - reference composition for the Node + Postgres path

### Task 1: Scaffold the workspace

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `vitest.workspace.ts`
- Create: `.gitignore`

- [ ] **Step 1: Create the root workspace files**

Add an `npm` workspace rooted at `packages\*` with root scripts:

```json
{
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "test": "vitest run"
  }
}
```

Set `.gitignore` to ignore at minimum:

```gitignore
node_modules/
dist/
coverage/
.env
.env.*
```

- [ ] **Step 2: Install the baseline dependencies**

Run: `npm install -D typescript vitest @types/node @types/pg`

Expected: `package-lock.json` is created and install exits with code `0`.

- [ ] **Step 3: Add shared compiler and test config**

Use these defaults so every later package config is a tiny wrapper:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "declarationMap": true,
    "composite": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

Every package `tsconfig.json` must extend this base config and set `rootDir: "./src"` plus `outDir: "./dist"` explicitly so each package emits `packages\<name>\dist\...`. If a package needs compile-only fixtures outside `src`, create a sibling `tsconfig.typecheck.json` that extends the build config and widens `include` without changing the build output contract.

Set `vitest.workspace.ts` to run `packages/**/*.test.ts` and `tests/integration/*.test.ts`, with `environment: 'node'` and `globals: false`.

- [ ] **Step 4: Verify the empty workspace boots**

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))" && npx tsc -p tsconfig.base.json --showConfig > $null && npx vitest --config vitest.workspace.ts --help`

Expected: the root config files parse successfully and the command exits `0`.

- [ ] **Step 5: Commit the scaffold**

```bash
git add package.json package-lock.json tsconfig.base.json vitest.workspace.ts .gitignore
git commit -m "chore: scaffold auth core workspace" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 2: Publish the contracts package

**Files:**
- Create: `packages\contracts\package.json`
- Create: `packages\contracts\tsconfig.json`
- Create: `packages\contracts\tsconfig.typecheck.json`
- Create: `packages\contracts\src\actions.ts`
- Create: `packages\contracts\src\errors.ts`
- Create: `packages\contracts\src\runtime.ts`
- Create: `packages\contracts\src\session.ts`
- Create: `packages\contracts\src\storage.ts`
- Create: `packages\contracts\src\plugin.ts`
- Create: `packages\contracts\src\index.ts`
- Test: `packages\contracts\test\contracts-smoke.test.ts`
- Test: `packages\contracts\test\contracts-typecheck.ts`

- [ ] **Step 1: Write the failing contract smoke tests**

Cover these frozen surfaces:

```ts
import { describe, expect, it } from 'vitest';
import {
  defaultCookieName,
  defaultEntrypointMethods,
  defaultSessionConfig,
  deniedCodes,
  supportedActions,
  unauthenticatedCodes
} from '../src/index';

describe('contracts package', () => {
  it('exports the frozen Cycle 1 actions in order', () => {
    expect(supportedActions).toEqual([
      'signUpWithPassword',
      'signInWithPassword',
      'getSession',
      'refreshSession',
      'logout',
      'logoutAll'
    ]);
  });

  it('exports the frozen HTTP methods', () => {
    expect(defaultEntrypointMethods).toEqual({
      signUpWithPassword: 'POST',
      signInWithPassword: 'POST',
      getSession: 'GET',
      refreshSession: 'POST',
      logout: 'POST',
      logoutAll: 'POST'
    });
  });

  it('exports the frozen error-code families', () => {
    expect(deniedCodes).toEqual([
      'INVALID_INPUT',
      'AMBIGUOUS_CREDENTIALS',
      'DUPLICATE_IDENTITY',
      'RATE_LIMITED',
      'POLICY_DENIED'
    ]);
    expect(unauthenticatedCodes).toEqual([
      'INVALID_CREDENTIALS',
      'SESSION_EXPIRED',
      'SESSION_REVOKED'
    ]);
  });

  it('exports the runtime constants needed by downstream packages', () => {
    expect(defaultSessionConfig.absoluteLifetimeMs).toBe(30 * 24 * 60 * 60 * 1000);
    expect(defaultSessionConfig.idleTimeoutMs).toBe(7 * 24 * 60 * 60 * 1000);
    expect(defaultSessionConfig.rotationThresholdMs).toBe(24 * 60 * 60 * 1000);
    expect(typeof defaultCookieName).toBe('string');
  });
});
```

- [ ] **Step 2: Run the contracts tests to verify they fail**

Run: `npx vitest run "packages\\contracts\\test\\contracts-smoke.test.ts"`

Expected: FAIL with missing module/export errors.

- [ ] **Step 3: Create contracts package metadata and build configs**

Create:

- `packages\contracts\package.json` with `name: "@authia/contracts"`, `type: "module"`, `main: "./dist/index.js"`, `types: "./dist/index.d.ts"`, `build: "tsc -p tsconfig.json"`, and `typecheck: "tsc --noEmit -p tsconfig.typecheck.json"`
- `packages\contracts\tsconfig.json` extending the root config and including only `src/**/*.ts`
- `packages\contracts\tsconfig.typecheck.json` extending `tsconfig.json` and including `src/**/*.ts` plus `test/contracts-typecheck.ts`

- [ ] **Step 4: Add the compile-only public API fixture and verify it fails**

Create `packages\contracts\test\contracts-typecheck.ts` that imports only from `../src/index` and instantiates one `RuntimeAdapter`, one `Policy`, one `Plugin`, one `SessionLayer`, one `PluginServices['crypto']` stub, and one `StorageAdapter` stub.

Run: `npm run typecheck --workspace @authia/contracts`

Expected: FAIL because the public contracts are not implemented yet.

- [ ] **Step 5: Implement `actions.ts` and `errors.ts`**

Use these file boundaries:

- `actions.ts` - `SupportedAction`, `EntrypointMethodMap`, `supportedActions`, `defaultEntrypointMethods`
- `errors.ts` - denied/unauthenticated codes, `AuthError`, `AuthValue`, and `RollbackSignal` because it wraps final outcomes

- [ ] **Step 6: Implement `runtime.ts` and `session.ts`**

Use these file boundaries:

- `runtime.ts` - request/response, runtime adapter, config, cookie/response mutation types, and `AuthResult`
- `session.ts` - user/session records, transports, validation outcomes, frozen session defaults

- [ ] **Step 7: Implement `storage.ts`, `plugin.ts`, and `index.ts`**

Use these file boundaries:

- `storage.ts` - create/update/CAS inputs plus `TransactionalStorage` and `StorageAdapter`
- `plugin.ts` - `PolicyDecision`, `Policy`, `Plugin`, `PluginServices`, `SessionLayer`
- `index.ts` - the only public barrel, exporting every public type from the spec’s `Public Type Sketches`, including `SessionTransportMode`, `AuthConfig`, `RuntimeAdapter`, `RequestContext`, `AuthResult`, `TransactionalStorage`, `UserCreateInput`, `LocalIdentityCreateInput`, `SessionCreateInput`, `SessionUpdateInput`, and `SessionCompareAndSwapInput`

- [ ] **Step 8: Run the contracts package verification**

Run: `npx vitest run "packages\\contracts\\test\\contracts-smoke.test.ts" && npm run typecheck --workspace @authia/contracts && npm run build --workspace @authia/contracts`

Expected: the smoke test passes, the compile-only fixture typechecks, and `packages\contracts\dist\index.js` plus `index.d.ts` are emitted.

- [ ] **Step 9: Commit the contracts package**

```bash
git add packages\contracts package.json package-lock.json tsconfig.base.json vitest.workspace.ts
git commit -m "feat: add cycle1 auth contracts package" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Chunk 2: Storage, crypto, and auth domain services

### Task 3: Build the default crypto provider

**Files:**
- Create: `packages\crypto-default\package.json`
- Create: `packages\crypto-default\tsconfig.json`
- Create: `packages\crypto-default\src\index.ts`
- Create: `packages\crypto-default\src\default-crypto.ts`
- Test: `packages\crypto-default\test\default-crypto.test.ts`

- [ ] **Step 1: Write the failing crypto tests**

Test:

- Argon2id hashing and verification round-trip
- `generateOpaqueToken()` returns a non-empty opaque token string
- token-id derivation is deterministic and non-empty
- token-verifier derivation matches token verification
- provider failures surface as `AuthError { code: 'CRYPTO_FAILURE', retryable: false }`

- [ ] **Step 2: Run the crypto tests to verify they fail**

Run: `npx vitest run "packages\\crypto-default\\test\\default-crypto.test.ts"`

Expected: FAIL with missing package implementation.

- [ ] **Step 3: Implement `default-crypto.ts`**

Create these files together:

- `packages\crypto-default\package.json` with `name: "@authia/crypto-default"`, `type: "module"`, `main: "./dist/index.js"`, `types: "./dist/index.d.ts"`, dependency on `@authia/contracts`, dependency on `argon2`, and local `build`/`typecheck` scripts
- `packages\crypto-default\tsconfig.json` extending the root config
- `packages\crypto-default\src\index.ts` exporting a single `createDefaultCryptoProvider`
- `packages\crypto-default\src\default-crypto.ts` implementing the `PluginServices['crypto']` shape from `@authia/contracts`

Wrap `argon2` and Node `crypto` usage and convert provider exceptions into `CRYPTO_FAILURE`.

- [ ] **Step 4: Refresh the workspace lockfile**

Run: `npm install`

Expected: root `package-lock.json` updates to include the crypto workspace package and dependencies.

- [ ] **Step 5: Run the crypto tests**

Run: `npx vitest run "packages\\crypto-default\\test\\default-crypto.test.ts" && npm run typecheck && npm run build`

Expected: targeted crypto tests pass and workspace `typecheck` exits `0`.

- [ ] **Step 6: Commit the crypto provider**

```bash
git add packages\crypto-default package.json package-lock.json
git commit -m "feat: add default crypto provider" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 4: Build the Postgres storage adapter and migration

**Files:**
- Create: `packages\storage-postgres\package.json`
- Create: `packages\storage-postgres\tsconfig.json`
- Create: `packages\storage-postgres\src\index.ts`
- Create: `packages\storage-postgres\src\postgres-storage.ts`
- Create: `packages\storage-postgres\src\migrations\0001_cycle1.sql`
- Create: `packages\storage-postgres\src\migrations\ensure-compatible-schema.ts`
- Create: `packages\storage-postgres\src\repositories\users-repository.ts`
- Create: `packages\storage-postgres\src\repositories\identities-repository.ts`
- Create: `packages\storage-postgres\src\repositories\sessions-repository.ts`
- Create: `packages\storage-postgres\src\transactions.ts`
- Test: `packages\storage-postgres\test\postgres-storage.test.ts`
- Test: `tests\integration\helpers\postgres-test-harness.ts`

- [ ] **Step 1: Write the failing storage tests**

Cover:

- schema compatibility success and mismatch paths
- `migrations.ensureCompatibleSchema()` returning `MIGRATION_MISMATCH`
- duplicate normalized-email race mapped to `denied(DUPLICATE_IDENTITY)`
- `compareAndSwapToken(...)` returning `null` for the refresh-race loser path
- `beginTransaction(run)` committing on success
- `beginTransaction(run)` committing on redirect
- `beginTransaction(run)` rolling back on `RollbackSignal`
- `beginTransaction(run)` rolling back on non-`RollbackSignal` exceptions
- `compareAndSwapToken(...)` atomically updating token id, verifier, `lastRotatedAt`, and `idleExpiresAt`
- storage driver failures mapped to `AuthError(STORAGE_UNAVAILABLE)`

- [ ] **Step 2: Run the storage tests to verify they fail**

Run: `npx vitest run "packages\\storage-postgres\\test\\postgres-storage.test.ts"`

Expected: FAIL with missing migration/adapter files.

- [ ] **Step 3: Implement the migration and storage adapter**

Create these files together:

- `packages\storage-postgres\package.json` with `name: "@authia/storage-postgres"`, build/typecheck scripts, and dependencies on `@authia/contracts` plus `pg`
- `packages\storage-postgres\tsconfig.json` extending the root config
- `packages\storage-postgres\src\index.ts` exporting a `createPostgresStorageAdapter`
- `packages\storage-postgres\src\migrations\0001_cycle1.sql`
- `packages\storage-postgres\src\migrations\ensure-compatible-schema.ts`
- `packages\storage-postgres\src\repositories\users-repository.ts` implementing `users.create` and `users.find`
- `packages\storage-postgres\src\repositories\identities-repository.ts` implementing `identities.create`, `findByNormalizedEmail`, and `listByUser`
- `packages\storage-postgres\src\repositories\sessions-repository.ts` implementing `sessions.create`, `findByCurrentTokenId`, `update`, `compareAndSwapToken`, `revoke`, and `revokeAllForUser`
- `packages\storage-postgres\src\transactions.ts`
- `packages\storage-postgres\src\postgres-storage.ts` as a thin composition layer only
- `tests\integration\helpers\postgres-test-harness.ts` exporting disposable-schema setup/teardown helpers used by storage and integration tests

Create tables for `users`, `local_identities`, and `sessions` with:

- unique index on `local_identities.normalized_email`
- `sessions.current_token_id` uniqueness
- columns for `current_token_verifier`, `last_rotated_at`, `expires_at`, `idle_expires_at`, `revoked_at`

Implement `beginTransaction(run)` with commit-on-resolve and rollback-on-throw semantics exactly matching the spec.

- [ ] **Step 4: Refresh the workspace lockfile**

Run: `npm install`

Expected: root `package-lock.json` updates to include the storage workspace package and dependencies.

- [ ] **Step 5: Run the targeted storage tests**

Run: `npx vitest run "packages\\storage-postgres\\test\\postgres-storage.test.ts" && npm run typecheck && npm run build`

Expected: targeted storage tests pass and workspace `typecheck` exits `0`.

- [ ] **Step 6: Commit the Postgres adapter**

```bash
git add packages\storage-postgres tests\integration\helpers\postgres-test-harness.ts package.json package-lock.json
git commit -m "feat: add postgres storage adapter" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 5: Build the session layer and email/password plugin

**Files:**
- Create: `packages\core\package.json`
- Create: `packages\core\tsconfig.json`
- Create: `packages\core\src\index.ts`
- Create: `packages\core\src\session\session-layer.ts`
- Create: `packages\core\src\session\issue-session.ts`
- Create: `packages\core\src\session\validate-session.ts`
- Create: `packages\core\src\session\refresh-session.ts`
- Create: `packages\core\src\session\transport-mutations.ts`
- Create: `packages\core\src\plugins\email-password\plugin.ts`
- Test: `packages\core\test\session-layer.test.ts`
- Test: `packages\core\test\email-password-plugin.test.ts`

- [ ] **Step 1: Write the failing session and plugin tests**

Cover:

- email normalization: `trim -> lowercase -> NFC`
- password length `8..128`
- normalized email must be non-empty after normalization
- normalized email must contain exactly one `@`
- sign-up creates user + identity + session
- duplicate sign-up returns `denied(DUPLICATE_IDENTITY)`
- sign-in success
- plugin `id` is stable
- plugin `actions()` returns only `signUpWithPassword` and `signInWithPassword`
- plugin `validateConfig(config)` rejects missing sign-up/sign-in entrypoint mappings or unsupported plugin-owned routing config and accepts valid Cycle 1 config
- valid presented credential returns authenticated session data for `getSession`
- unknown token id returns `unauthenticated(SESSION_REVOKED)`
- wrong password returns `unauthenticated(INVALID_CREDENTIALS)`
- expired session returns `unauthenticated(SESSION_EXPIRED)`
- missing/malformed credential returns `denied(INVALID_INPUT)`
- verifier mismatch returns `unauthenticated(SESSION_REVOKED)`
- issued sessions use a 30-day absolute lifetime and 7-day idle timeout
- rotation becomes due after 24 hours and refresh preserves the original absolute expiry
- refresh with rotation due rotates token id/verifier and updates `lastRotatedAt`
- refresh without rotation extends `idleExpiresAt` and reuses the current transport
- refresh race loser returns `unauthenticated(SESSION_REVOKED)` without extending idle expiry
- `getSession` success does not emit a new transport
- logout is idempotent and still emits transport-clearing mutations
- logoutAll requires a valid current credential
- logoutAll success clears the current transport the same way as logout
- cookie transport uses `sessionCookieName` and clears with the same name/domain/path plus immediate expiry
- bearer transport uses `clearBearer` on logout/logoutAll success

- [ ] **Step 2: Run the session/plugin tests to verify they fail**

Run: `npx vitest run "packages\core\test\session-layer.test.ts" "packages\core\test\email-password-plugin.test.ts"`

Expected: FAIL with missing module errors.

- [ ] **Step 3: Create the core package scaffold**

Create these files first:

- `packages\core\package.json` must use `name: "@authia/core"` and depend on `@authia/contracts`
- `packages\core\package.json` must also define `main: "./dist/index.js"`, `types: "./dist/index.d.ts"`, and local `build`/`typecheck` scripts
- `packages\core\package.json`, `packages\core\tsconfig.json`, and `packages\core\src\index.ts` must be created in the same step so the package builds as soon as the service files exist
- In Chunk 2, `packages\core\src\index.ts` should export only the session-layer and email-password plugin surfaces; expand the barrel in Chunk 3 once kernel/policy/startup modules exist

- [ ] **Step 4: Implement the session layer**

- `session-layer.ts` should stay as the orchestration surface only
- `issue-session.ts`, `validate-session.ts`, and `refresh-session.ts` should hold the lifecycle-specific logic
- `transport-mutations.ts` should build `clearBearer` and cookie-clearing mutations
- do not let the plugin reach into storage directly for session semantics

- [ ] **Step 5: Implement the email-password plugin**

Keep the plugin limited to input validation, identity lookup/creation, password hash verification, and calling `sessionLayer.issueSession(...)`. Implement and verify the full plugin contract surface: `id`, `actions()`, `validateConfig(config)`, and `execute(...)`.

- [ ] **Step 6: Refresh the workspace lockfile**

Run: `npm install`

Expected: root `package-lock.json` updates to include the core workspace package and dependencies.

- [ ] **Step 7: Run the targeted core tests**

Run: `npx vitest run "packages\core\test\session-layer.test.ts" "packages\core\test\email-password-plugin.test.ts" && npm run typecheck && npm run build`

Expected: targeted core tests pass and workspace `typecheck` exits `0`.

- [ ] **Step 8: Commit the domain services**

```bash
git add packages\core package.json package-lock.json
git commit -m "feat: add session layer and email password plugin" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Chunk 3: Runtime orchestration and end-to-end verification

### Task 6: Build the auth kernel and built-in policies

**Files:**
- Modify: `packages\core\src\index.ts`
- Create: `packages\core\src\kernel\auth-kernel.ts`
- Create: `packages\core\src\kernel\rollback-signal.ts`
- Create: `packages\core\src\policies\csrf-policy.ts`
- Create: `packages\core\src\startup\validate-startup.ts`
- Test: `packages\core\test\auth-kernel.test.ts`
- Test: `packages\core\test\validate-startup.test.ts`

- [ ] **Step 1: Write the failing kernel tests**

Cover:

- frozen action ownership
- lifecycle order for `getSession`, `refreshSession`, `logout`, and `logoutAll`
- authenticated `logout` and `logoutAll` hydrate `context.session` before policy evaluation
- CSRF allows `Origin == publicOrigin` for cookie state-changing actions
- CSRF allows `Referer == publicOrigin` when `Origin` is absent
- CSRF rejects mismatched `Origin`/`Referer` with `denied(POLICY_DENIED)`
- startup validation rejects plugin ownership conflicts
- startup validation rejects any frozen action that has no owner
- startup validation rejects duplicate route pairs
- startup validation rejects session-mode/entrypoint transport mismatches
- startup validation rejects redirect-capability mismatches
- startup validation rejects invalid `cookieOptions` and `sessionCookieName`
- policy deny vs redirect behavior
- policy exceptions become `AuthError(POLICY_FAILURE)` with `retryable = false`
- `RollbackSignal` conversion back into `AuthResult`
- idempotent logout bypassing app policies when `context.session === null`

- [ ] **Step 2: Run the kernel tests to verify they fail**

Run: `npx vitest run "packages\\core\\test\\auth-kernel.test.ts" "packages\\core\\test\\validate-startup.test.ts"`

Expected: FAIL with missing kernel implementation.

- [ ] **Step 3: Implement the kernel and CSRF policy**

Keep the file split:

- `auth-kernel.ts` - orchestration only
- `rollback-signal.ts` - tiny typed helper
- `csrf-policy.ts` - cookie-origin checks only
- `startup\validate-startup.ts` - cross-package startup validation for plugin action ownership, route uniqueness, transport config, session mode consistency, redirect capability, and `cookieOptions` / `sessionCookieName` invariants before runtime serving begins

Do not mix request parsing or SQL details into the kernel package.

- [ ] **Step 4: Run the kernel tests**

Run: `npx vitest run "packages\\core\\test\\auth-kernel.test.ts" "packages\\core\\test\\validate-startup.test.ts"`

Expected: PASS.

- [ ] **Step 5: Commit the kernel layer**

```bash
git add packages\core
git commit -m "feat: add auth kernel orchestration" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 7: Build the Node runtime adapter

**Files:**
- Create: `packages\node-adapter\package.json`
- Create: `packages\node-adapter\tsconfig.json`
- Create: `packages\node-adapter\src\index.ts`
- Create: `packages\node-adapter\src\node-runtime-adapter.ts`
- Create: `packages\node-adapter\src\parse-request.ts`
- Create: `packages\node-adapter\src\apply-result.ts`
- Create: `packages\node-adapter\src\validate-node-config.ts`
- Test: `packages\node-adapter\test\node-runtime-adapter.test.ts`

- [ ] **Step 1: Write the failing adapter tests**

Cover:

- exact `(method, path)` matching and `notHandled`
- startup validation rejects invalid `publicOrigin` / `trustedForwardedHeaders` config before serving
- duplicate `authorization`, `origin`, `referer`, and forwarded-header rejection
- partial `x-forwarded-host` / `x-forwarded-proto` presence returns `AuthError(RUNTIME_MISCONFIGURED)`
- both cookie and bearer credentials produce `denied(AMBIGUOUS_CREDENTIALS)`
- malformed `Authorization` values return `denied(INVALID_INPUT)`
- credential-kind mismatch vs `entrypointTransport` returns `denied(INVALID_INPUT)`
- `publicOrigin` / forwarded-header tuple mismatch returning `AuthError(RUNTIME_MISCONFIGURED)`
- accepted headers are normalized into lowercased `RequestContext.headers`
- cookie vs bearer credential extraction
- malformed JSON body returning `denied(INVALID_INPUT)`
- redirect result handling only when `capabilities().redirects === true`
- status/body/cookie mapping for all success and error outcomes
- `applyResult(...)` returning `AuthError(RESPONSE_APPLY_FAILED)` on response mutation failure

- [ ] **Step 2: Run the adapter tests to verify they fail**

Run: `npx vitest run "packages\\node-adapter\\test\\node-runtime-adapter.test.ts"`

Expected: FAIL with missing adapter implementation.

- [ ] **Step 3: Implement the adapter**

Create a single factory, `createNodeRuntimeAdapter(config)`, that owns:

- `packages\node-adapter\package.json` must use `name: "@authia/node-adapter"`, define `main: "./dist/index.js"`, `types: "./dist/index.d.ts"`, and depend on `@authia/contracts`
- `validate-node-config.ts` - adapter-specific startup validation for `publicOrigin` and forwarded headers
- `parse-request.ts` - route lookup from `entrypointMethods` + `entrypointPaths`, duplicate-header rejection, body parsing, and credential extraction
- `apply-result.ts` - status/body/cookie/redirect mapping
- `node-runtime-adapter.ts` - a thin public factory that composes those helpers
- `index.ts` - the public barrel exporting `createNodeRuntimeAdapter`

- [ ] **Step 4: Refresh the workspace lockfile**

Run: `npm install`

Expected: root `package-lock.json` updates to include the node-adapter workspace package and dependencies.

- [ ] **Step 5: Run the adapter tests**

Run: `npx vitest run "packages\\node-adapter\\test\\node-runtime-adapter.test.ts"`

Expected: PASS.

- [ ] **Step 6: Commit the Node adapter**

```bash
git add packages\node-adapter package.json package-lock.json
git commit -m "feat: add node runtime adapter" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 8: Wire the reference composition and prove the Cycle 1 flow

**Files:**
- Create: `examples\cycle1-compose.ts`
- Create: `tests\integration\cycle1-reference-flow.test.ts`
- Create: `tests\integration\helpers\memory-response.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing integration tests**

Cover the approved critical scenarios:

- sign-up success
- duplicate identity on sign-up
- sign-in success
- sign-in wrong password
- invalid input on sign-up or sign-in
- get-session success
- get-session missing credential
- get-session expired session
- get-session revoked/verifier-mismatch session
- refresh missing credential
- refresh success
- refresh race loser
- storage outage during sign-up
- storage outage during refresh
- origin mismatch on cookie state-changing action
- logout success
- logout idempotency
- logoutAll requiring a current valid credential
- logoutAll expired/revoked credential path
- logoutAll success with transport clearing and session revocation effects

- [ ] **Step 2: Run the integration tests to verify they fail**

Run: `npx vitest run "tests\\integration\\cycle1-reference-flow.test.ts"`

Expected: FAIL with missing composition/helpers.

- [ ] **Step 3: Build the reference composition**

Create `examples\cycle1-compose.ts` that wires:

- contracts config
- default crypto provider
- Postgres storage adapter
- core kernel + email/password plugin + built-in session layer
- Node runtime adapter
- `validateStartupConfig(...)`, `validateNodeConfig(...)`, and `migrations.ensureCompatibleSchema()` before the request handler is exposed
- freeze the validated configuration before the request handler is exposed
- update root `package.json` to add `test:integration` and `example:cycle1` scripts
- use `TEST_DATABASE_URL` with a disposable schema per run inside the integration harness

The example must be composition-only; no framework-specific server code in this file.

- [ ] **Step 4: Make the integration suite pass**

Run: `npx vitest run "tests\\integration\\cycle1-reference-flow.test.ts"`

Expected: integration suite passes.

- [ ] **Step 5: Run the full verification stack**

Run: `npm run test && npm run typecheck && npm run build`

Expected: all tests pass, `typecheck` exits `0`, and `build` emits each package `dist` folder.

- [ ] **Step 6: Commit the reference path**

```bash
git add examples tests package.json package-lock.json
git commit -m "feat: ship cycle1 auth core reference path" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Execution notes

- Keep files small and responsibility-focused; if `auth-kernel.ts`, `session-layer.ts`, or `node-runtime-adapter.ts` grows past comfortable review size, split helper modules immediately rather than pushing complexity forward.
- Prefer constructor/factory injection from `contracts` over importing package internals across boundaries.
- Do not add OAuth, Bun, Deno, verification emails, password reset, or dashboard code in this cycle.
- If integration tests need a database URL, use a disposable `TEST_DATABASE_URL` and create/drop a dedicated schema per test run rather than sharing a global schema.
- Before the final handoff, run the full verification stack again and compare behavior back to `docs\superpowers\specs\2026-03-13-typescript-auth-core-design.md`.
