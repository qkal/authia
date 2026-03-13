# Authia

Contract-first authentication API with pluggable auth methods, strict runtime boundaries, and PostgreSQL-backed session security.

## Table of contents

- [What this project is](#what-this-project-is)
- [How the auth API works](#how-the-auth-api-works)
- [Supported actions and endpoints](#supported-actions-and-endpoints)
- [Architecture](#architecture)
- [Configuration](#configuration)
- [Local development](#local-development)
- [Testing and verification](#testing-and-verification)
- [Security model](#security-model)
- [Repository layout](#repository-layout)
- [Current status](#current-status)

## What this project is

Authia is a modular auth backend organized as workspace packages:

- `@authia/contracts` — shared types/contracts
- `@authia/core` — kernel, startup validation, plugins, session layer
- `@authia/storage-postgres` — transactional persistence + schema checks
- `@authia/crypto-default` — hashing/token crypto primitives
- `@authia/node-adapter` / `@authia/bun-adapter` / `@authia/deno-adapter` — runtime adapters

## How the auth API works

For every request:

1. A runtime adapter parses transport input into a normalized `RequestContext`.
2. `createAuthKernel(...)` resolves who owns the action (built-in session flow vs plugin).
3. Policies are evaluated (including CSRF policy for state-changing routes).
4. Owner executes business logic (email/password plugin, OAuth plugin, or session layer).
5. Adapter maps `AuthResult | AuthError` into HTTP response shape.

This design keeps runtime concerns, orchestration, and auth-method logic isolated and testable.

## Supported actions and endpoints

Supported actions:

- `signUpWithPassword`
- `signInWithPassword`
- `getSession`
- `refreshSession`
- `logout`
- `logoutAll`
- `startOAuth`
- `finishOAuth`

Default Cycle 2 reference paths (configurable):

- `POST /auth/signup`
- `POST /auth/signin`
- `GET /auth/session`
- `POST /auth/refresh`
- `POST /auth/logout`
- `POST /auth/logout-all`
- `POST /auth/oauth/start`
- `POST /auth/oauth/finish`

## Architecture

```text
Runtime Adapter (node/bun/deno)
  -> parseRequest()
  -> RequestContext
      -> Auth Kernel
         -> Policies (CSRF + app policies)
         -> Built-in session actions OR Plugins
             - Email/Password plugin
             - OAuth plugin
         -> Storage transaction boundaries
  -> AuthResult/AuthError
  -> applyResult()
  -> HTTP response
```

## Configuration

Authia is configured with `AuthConfig` (methods, paths, transport, plugins, public origin, cookies, OAuth providers).

See the reference composition:

- `examples/cycle1-compose.ts`
- `examples/cycle2-compose.ts`

Cycle 2 OAuth config includes provider metadata (`clientId`, auth/token endpoints, callback path, PKCE method `S256`).

## Local development

Install dependencies:

```bash
npm install
```

Build all packages:

```bash
npm run build
```

Typecheck all packages:

```bash
npm run typecheck
```

Run tests:

```bash
npm run test
```

## Testing and verification

Main scripts:

- `npm run test`
- `npm run typecheck`
- `npm run build`
- `npm run test:integration` (Cycle 1 integration suite)
- `npm run test:oauth` (Cycle 2 OAuth integration suite; skips if DB env is missing)
- `npm run test:oauth:required` (fails fast unless `TEST_DATABASE_URL` is set)

Integration suites use `TEST_DATABASE_URL` for disposable-schema PostgreSQL testing.

## Security model

Key protections implemented:

- strict startup misconfiguration checks (ownership, route collisions, transport invariants)
- CSRF origin/referer enforcement for state-changing flows
- strict credential-source handling (cookie vs bearer ambiguity denial)
- refresh race handling with compare-and-swap semantics
- OAuth state one-time consume + expiry checks
- OAuth duplicate-identity race hardening via rollback + retry transaction strategy
- explicit infrastructure/operator error mapping (no silent success fallbacks)

## Repository layout

```text
packages/
  contracts/
  core/
  crypto-default/
  storage-postgres/
  node-adapter/
  bun-adapter/
  deno-adapter/
examples/
tests/
audits/
```

## Current status

- Cycle 1 secure base: complete and verified.
- Cycle 2 OAuth: complete and audited.
- Bun and Deno adapter slices: complete and audited.
- Next planned work: account lifecycle extensions (verification email / password reset).

## Copyright

Copyright (c) 2026 Complexia.org

All rights reserved.

Viewing the source code is permitted for reference only.

Copying, modification, redistribution, or commercial use is prohibited without written permission.
