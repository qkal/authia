# Bun Adapter Slice Audit (2026-03-13)

## Scope

- New package: `packages/bun-adapter`
- Files added:
  - `src/apply-result.ts`
  - `src/parse-request.ts`
  - `src/bun-runtime-adapter.ts`
  - `src/validate-bun-config.ts`
  - `src/bun-runtime-adapter.test.ts`
  - `src/validate-bun-config.test.ts`
  - `src/index.ts`
  - `package.json`
  - `tsconfig.json`

## What was delivered

- Added `@authia/bun-adapter` as a first-class workspace package.
- Mirrored hardened runtime behavior already used by the node adapter:
  - strict route/action resolution
  - duplicate-sensitive-header rejection
  - forwarded-header consistency checks
  - ambiguous credential rejection
  - strict OAuth payload validation
  - adapter response mapping with redirect capability checks
- Added validation boundary tests to ensure runtime-only concerns remain in adapter validation.

## Verification evidence

- Targeted bun-adapter checks:
  - `npx vitest run "packages\\bun-adapter\\src\\bun-runtime-adapter.test.ts" "packages\\bun-adapter\\src\\validate-bun-config.test.ts"`: **pass**
  - `npm run typecheck --workspace @authia/bun-adapter`: **pass**
  - `npm run build --workspace @authia/bun-adapter`: **pass**
- Full repository checks:
  - `npm run test`: **pass** (`288 passed`, `48 skipped` DB-gated suites)
  - `npm run typecheck`: **pass**
  - `npm run build`: **pass**

## Security notes

- No new broad error swallowing was introduced; error mapping remains explicit.
- OAuth input hardening and redirect safety checks are preserved in bun adapter parsing.
- Runtime config validation preserves trusted forwarded header invariants.

## Residual risk

- Bun-specific HTTP request/response interop is not yet wired to real Bun server primitives in this slice; current adapter surface is contract-level parity.

## Recommended next step

- Implement Deno adapter with the same invariant/test matrix, then add runtime-specific integration harnesses for Bun and Deno transport boundaries.
