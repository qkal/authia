# Email Delivery Integration Audit (2026-03-13)

## Scope

- Contracts: optional outbound email delivery hooks in `PluginServices`
- Core plugin: delivery dispatch for password reset and email verification request flows
- Tests: delivery success + failure mapping coverage in email-password plugin tests

## Implemented behavior

- Added `emailDelivery` to `PluginServices` with two optional callbacks:
  - `sendPasswordReset({ email, resetToken })`
  - `sendEmailVerification({ email, verificationToken })`
- Request flows now dispatch outbound delivery only after token persistence succeeds:
  - `requestPasswordReset`
  - `requestEmailVerification`
- If delivery hooks are not configured, behavior remains unchanged (no-op delivery path).
- If delivery hook returns an auth error, plugin maps it to `STORAGE_UNAVAILABLE` using existing infrastructure error semantics.

## Security and reliability checks

- Anti-enumeration behavior preserved:
  - request endpoints still return generic success regardless of identity existence.
- Delivery is never attempted without a successfully persisted token.
- Token storage remains hash-only; plaintext token is only used for outbound delivery payload.
- Failure path remains explicit and test-covered; no silent fallback added.

## Verification evidence

- Full repository verification: pass
  - `npm run typecheck`
  - `npm run build`
  - `npm run test` (`396 passed`, `48 skipped`)
- New/updated assertions verified:
  - password-reset request dispatches delivery with expected payload
  - verification request dispatches delivery with expected payload
  - delivery failure is surfaced as infrastructure unavailability

## Residual risks / follow-ups

- Delivery errors currently map through storage-style infrastructure code for consistency. A dedicated delivery failure code may improve observability in future slices.
- End-to-end transport integration tests (provider SDK mock/fake) are still pending and should be added with the next delivery-provider adapter slice.
