# Cycle 2 OAuth Provider Support Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add secure provider-agnostic OAuth login (`startOAuth` + `finishOAuth`) to Authia while preserving Cycle 1 invariants and release gates.

**Architecture:** Implement OAuth as a plugin-owned flow, not kernel built-ins. Add minimal contract and storage extensions for one-time state handling and provider-subject identity mapping. Keep runtime parsing in node-adapter and orchestration in kernel unchanged except ownership/validation extensions.

**Tech Stack:** TypeScript, Vitest, PostgreSQL (`pg`), existing Authia plugin/kernel/runtime contracts.

---

## File structure map

- Modify: `packages/contracts/src/actions.ts` - add OAuth actions and entrypoint map types.
- Modify: `packages/contracts/src/runtime.ts` - OAuth callback request body shape.
- Modify: `packages/contracts/src/storage.ts` - OAuth state/identity repositories.
- Modify: `packages/contracts/src/plugin.ts` - OAuth provider-facing plugin service contracts.
- Modify: `packages/core/src/startup/validate-startup.ts` - OAuth startup invariants.
- Create: `packages/core/src/plugins/oauth/plugin.ts` - OAuth action execution.
- Create: `packages/core/src/plugins/oauth/provider-client.ts` - provider exchange abstraction.
- Create: `packages/core/src/plugins/oauth/state-store.ts` - state persistence abstraction.
- Create: `packages/core/src/plugins/oauth/plugin.test.ts` - OAuth plugin tests.
- Modify: `packages/core/src/index.ts` - export OAuth plugin.
- Modify: `packages/storage-postgres/src/migrations/0001_cycle1.sql` (or add `0002_cycle2_oauth.sql`) - OAuth tables/indexes.
- Create: `packages/storage-postgres/src/repositories/oauth-states-repository.ts` - one-time state create/consume.
- Create: `packages/storage-postgres/src/repositories/oauth-identities-repository.ts` - provider-subject mapping.
- Modify: `packages/storage-postgres/src/postgres-storage.ts` - wire OAuth repositories.
- Modify: `packages/storage-postgres/src/migrations/ensure-compatible-schema.ts` - include OAuth tables/columns.
- Create: `packages/storage-postgres/src/repositories/oauth-states-repository.test.ts` - repository tests.
- Create: `packages/storage-postgres/src/repositories/oauth-identities-repository.test.ts` - repository tests.
- Modify: `packages/node-adapter/src/parse-request.ts` - parse OAuth start/callback payloads.
- Modify: `packages/node-adapter/src/node-runtime-adapter.test.ts` - OAuth route + payload parsing tests.
- Modify: `examples/cycle1-compose.ts` (or create `examples/cycle2-compose.ts`) - register OAuth plugin/provider config.
- Modify: `tests/integration/cycle1-reference-flow.test.ts` (or create `tests/integration/cycle2-oauth-reference-flow.test.ts`) - OAuth flow release gates.
- Modify: `package.json` - add `test:oauth` script.

## Chunk 1: Contracts + startup/kernel-facing surface

### Task 1: Extend contracts for OAuth actions and storage interfaces

**Files:**
- Modify: `packages/contracts/src/actions.ts`
- Modify: `packages/contracts/src/runtime.ts`
- Modify: `packages/contracts/src/storage.ts`
- Modify: `packages/contracts/src/plugin.ts`
- Test: `packages/contracts/test/contracts-smoke.test.ts`

- [ ] **Step 1: Write failing contract smoke assertions**

```ts
expect(supportedActions).toContain('startOAuth');
expect(supportedActions).toContain('finishOAuth');
```

- [ ] **Step 2: Run contract test to verify failure**

Run: `npx vitest run "packages\\contracts\\test\\contracts-smoke.test.ts"`
Expected: FAIL on missing OAuth actions/types.

- [ ] **Step 3: Add minimal contract changes**

Implement:
- `startOAuth`/`finishOAuth` in action unions and route maps
- OAuth body fields in `RequestContext.body`
- storage contracts for `oauthStates` + `oauthIdentities`

- [ ] **Step 4: Re-run contract tests**

Run: `npx vitest run "packages\\contracts\\test\\contracts-smoke.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit contracts**

```bash
git add packages/contracts
git commit -m "feat(contracts): add oauth actions and storage contracts" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 2: Enforce OAuth startup validation invariants

**Files:**
- Modify: `packages/core/src/startup/validate-startup.ts`
- Modify: `packages/core/src/startup/validate-startup.test.ts`

- [ ] **Step 1: Write failing startup tests for OAuth invariants**

Cover:
- missing provider config -> `RUNTIME_MISCONFIGURED`
- OAuth enabled but redirects unsupported -> reject
- callback route collision -> reject
- OAuth actions must have exactly one owner (no missing/duplicate ownership)
- provider PKCE method must be `S256`

- [ ] **Step 2: Run startup tests to verify failure**

Run: `npx vitest run "packages\\core\\src\\startup\\validate-startup.test.ts"`
Expected: FAIL on new OAuth invariant cases.

- [ ] **Step 3: Implement validator changes**

Add checks for:
- provider config shape completeness
- `startOAuth` and `finishOAuth` ownership exactness
- redirect capability requirement when OAuth plugin is active
- PKCE `S256` enforcement

- [ ] **Step 4: Re-run startup tests**

Run: `npx vitest run "packages\\core\\src\\startup\\validate-startup.test.ts"`
Expected: PASS.

- [ ] **Step 5: Run chunk-level verification**

Run: `npm run test --workspace @authia/core && npm run typecheck --workspace @authia/core && npm run build --workspace @authia/core`
Expected: PASS.

- [ ] **Step 6: Commit startup validation**

```bash
git add packages/core/src/startup
git commit -m "feat(core): add oauth startup validation invariants" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Chunk 2: Storage + plugin core flow

### Task 3: Add OAuth state and identity repositories in postgres adapter

**Files:**
- Create: `packages/storage-postgres/src/repositories/oauth-states-repository.ts`
- Create: `packages/storage-postgres/src/repositories/oauth-identities-repository.ts`
- Create: `packages/storage-postgres/src/repositories/oauth-states-repository.test.ts`
- Create: `packages/storage-postgres/src/repositories/oauth-identities-repository.test.ts`
- Modify: `packages/storage-postgres/src/postgres-storage.ts`
- Modify: `packages/storage-postgres/src/migrations/ensure-compatible-schema.ts`
- Modify: `packages/storage-postgres/src/migrations/0001_cycle1.sql` (or add `0002_cycle2_oauth.sql`)

- [ ] **Step 1: Write failing repository tests**

Test cases:
- create + consume state once
- consume expired state returns null
- provider-subject uniqueness enforced
- find mapping by `(provider, providerSubject)`

- [ ] **Step 2: Run repository tests to verify failure**

Run: `npx vitest run "packages\\storage-postgres\\src\\repositories\\oauth-*.test.ts"`
Expected: FAIL due missing repositories/tables.

- [ ] **Step 3: Implement migration and repositories**

Create tables/indexes:

```sql
create table if not exists oauth_states (...);
create table if not exists oauth_identities (...);
create unique index if not exists oauth_states_state_hash_idx on oauth_states(state_hash);
create index if not exists oauth_states_expires_at_idx on oauth_states(expires_at);
create unique index if not exists oauth_identities_provider_subject_idx on oauth_identities(provider, provider_subject);
create index if not exists oauth_identities_user_id_idx on oauth_identities(user_id);
```

Implement atomic consume:

```sql
update oauth_states
set consumed_at = $now
where provider = $provider and state_hash = $hash and consumed_at is null and expires_at > $now
returning code_verifier_ciphertext, redirect_uri_hash;
```

- [ ] **Step 4: Re-run repository tests**

Run: `npx vitest run "packages\\storage-postgres\\src\\repositories\\oauth-*.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit storage slice**

```bash
git add packages/storage-postgres
git commit -m "feat(storage-postgres): add oauth state and identity repositories" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 4: Implement OAuth plugin start/finish flow

**Files:**
- Create: `packages/core/src/plugins/oauth/plugin.ts`
- Create: `packages/core/src/plugins/oauth/state-store.ts`
- Create: `packages/core/src/plugins/oauth/provider-client.ts`
- Create: `packages/core/src/plugins/oauth/plugin.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write failing OAuth plugin tests**

Cover:
- `startOAuth` returns redirect with persisted one-time state
- `finishOAuth` success path issues session
- replayed/expired state denied
- state-provider mismatch denied
- provider rejection returns `unauthenticated(INVALID_CREDENTIALS)`
- provider transport failure maps to `AuthError(STORAGE_UNAVAILABLE)`
- unknown provider and invalid `redirectTo` return `denied(INVALID_INPUT)`
- storage outage mapped to `STORAGE_UNAVAILABLE`

- [ ] **Step 2: Run OAuth plugin tests to verify failure**

Run: `npx vitest run "packages\\core\\src\\plugins\\oauth\\plugin.test.ts"`
Expected: FAIL due missing OAuth plugin implementation.

- [ ] **Step 3: Implement minimal plugin flow**

`startOAuth`:
- validate provider + optional `redirectTo`
- generate state + PKCE verifier/challenge
- persist encrypted verifier in state-store
- return `redirect` to provider URL

`finishOAuth`:
- validate callback input
- atomically consume state
- exchange code through provider client
- resolve/create oauth identity in transaction
- on unique collision, retry lookup once and use canonical mapping
- issue session via existing session layer

- [ ] **Step 4: Re-run OAuth plugin tests**

Run: `npx vitest run "packages\\core\\src\\plugins\\oauth\\plugin.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit OAuth plugin**

```bash
git add packages/core/src/plugins/oauth packages/core/src/index.ts
git commit -m "feat(core): add oauth plugin start and finish flows" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Chunk 3: Runtime + integration release gates

### Task 5: Extend node adapter request parsing for OAuth payloads

**Files:**
- Modify: `packages/node-adapter/src/parse-request.ts`
- Modify: `packages/node-adapter/src/node-runtime-adapter.test.ts`

- [ ] **Step 1: Write failing node adapter tests for OAuth routes**

Cover:
- parse `startOAuth` body (`provider`, optional `redirectTo`)
- parse `finishOAuth` body (`provider`, `code`, `state`)
- malformed body fields return `denied(INVALID_INPUT)`
- invalid `redirectTo` forms (absolute/protocol-relative/non-string) are denied

- [ ] **Step 2: Run adapter tests to verify failure**

Run: `npx vitest run "packages\\node-adapter\\src\\node-runtime-adapter.test.ts"`
Expected: FAIL for OAuth route/body parsing.

- [ ] **Step 3: Implement parser updates**

Add OAuth route matching + strict body validation with existing lowercased header and credential safeguards.

- [ ] **Step 4: Re-run adapter tests**

Run: `npx vitest run "packages\\node-adapter\\src\\node-runtime-adapter.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit adapter updates**

```bash
git add packages/node-adapter
git commit -m "feat(node-adapter): add oauth payload parsing" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 6: Add OAuth integration release-gate suite

**Files:**
- Modify or Create: `examples/cycle2-compose.ts` (preferred) or `examples/cycle1-compose.ts`
- Create: `tests/integration/cycle2-oauth-reference-flow.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing integration tests**

Scenarios:
- start flow returns redirect with provider URL
- finish flow success creates/fetches mapping and issues session
- replayed state denied
- expired state denied
- provider rejection => 401
- provider transport failure => infrastructure error
- invalid redirectTo => denied before provider redirect generation
- storage outage => infrastructure error

- [ ] **Step 2: Run integration test to verify failure**

Run: `npx vitest run "tests\\integration\\cycle2-oauth-reference-flow.test.ts"`
Expected: FAIL before implementation wiring.

- [ ] **Step 3: Wire cycle2 composition**

Compose:
- contracts config with OAuth entrypoints
- startup + node config validation
- plugin registration for email/password + OAuth
- schema compatibility check before exposing handler

- [ ] **Step 4: Add provider mock and failure injection**

Implement deterministic provider mock with three modes:
- success exchange
- rejection exchange
- transport failure/timeout exchange

Inject provider behavior via composition dependencies per test scenario.

- [ ] **Step 5: Re-run integration test**

Run: `npx vitest run "tests\\integration\\cycle2-oauth-reference-flow.test.ts"`
Expected: PASS with `TEST_DATABASE_URL` set (non-skipped release-gate run required).

- [ ] **Step 6: Commit integration slice**

```bash
git add examples tests/integration package.json
git commit -m "test(integration): add cycle2 oauth release gates" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 7: Full verification and audit

**Files:**
- Create: `audits/YYYY-MM-DD-cycle2-oauth-audit.md`

- [ ] **Step 1: Run full verification**

Run: `npm run test && npm run typecheck && npm run build`
Expected: all pass (DB-dependent tests may skip when env missing).

- [ ] **Step 2: Write cycle2 OAuth audit**

Include:
- implemented scope
- security checks (state replay/expiry, redirect safety, ownership)
- unresolved risks and next slice recommendation

- [ ] **Step 3: Commit audit**

```bash
git add audits
git commit -m "docs(audit): add cycle2 oauth readiness audit" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
