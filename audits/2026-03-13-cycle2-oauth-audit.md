# Cycle 2 OAuth Readiness Audit (2026-03-13)

## Scope audited

- OAuth plugin flow (`startOAuth`, `finishOAuth`) in `packages/core/src/plugins/oauth/*`
- OAuth startup invariants in `packages/core/src/startup/validate-startup.ts`
- Node adapter OAuth payload parsing in `packages/node-adapter/src/parse-request.ts`
- Cycle 2 reference composition and integration gates:
  - `examples/cycle2-compose.ts`
  - `tests/integration/cycle2-oauth-reference-flow.test.ts`

## Verification evidence

- `npm run test`: **pass** (`236 passed`, `48 skipped` DB-gated suites)
- `npm run typecheck`: **pass**
- `npm run build`: **pass**
- Targeted checks:
  - `npx vitest run "packages/core/src/plugins/oauth/plugin.test.ts"`: **pass**
  - `npx vitest run "packages/node-adapter/src/node-runtime-adapter.test.ts"`: **pass**
  - `npm run test:oauth`: **skips when `TEST_DATABASE_URL` is unset** (expected)

## Security and correctness findings

### Fixed in this wave

- **Duplicate identity race handling hardened** in `finishOAuth`:
  - duplicate provider-subject collision now triggers rollback and retry in a fresh transaction
  - avoids proceeding in the same transaction after provisional-user creation risk
- **OAuth runtime dependency guards added**:
  - explicit `RUNTIME_MISCONFIGURED` when OAuth provider/state services are not wired
  - explicit guard when transactional OAuth identity repository is unavailable
- **Node adapter strict OAuth payload validation added**:
  - requires non-empty `provider` for `startOAuth`
  - requires non-empty `provider`, `code`, and `state` for `finishOAuth`
  - rejects non-relative or protocol-relative/absolute `redirectTo`

### Release-gate coverage now present

- Start flow redirect response and state issuance
- Finish flow session issuance
- Replayed state denial
- Provider rejection mapping to `401`
- Provider transport failure mapping to infrastructure error
- Invalid redirect pre-validation denial

## Residual risks / deferred items

- Integration OAuth suite is currently environment-gated; in CI, `TEST_DATABASE_URL` must be present to enforce non-skipped release-gate execution.
- Provider mock in reference composition is deterministic and minimal by design; real provider transport adapters should still be fuzzed for timeout/jitter/retry behavior in a later reliability slice.

## Recommended next slice

1. Enable mandatory CI execution of `test:oauth` with a live test database.
2. Add callback `redirectUriHash` enforcement in `finishOAuth` if redirect binding is expanded in external callback flow.
3. Add explicit observability hooks (structured auth event metrics for `startOAuth`, `finishOAuth`, replay denials, provider transport failures).
