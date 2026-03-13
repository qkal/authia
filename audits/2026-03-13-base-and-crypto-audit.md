# Authia Base and Crypto Audit

## Scope

This audit covers the current state of the workspace after:

- building the stable monorepo base
- implementing the split `@authia/contracts` package
- implementing the first real plan slice in `@authia/crypto-default`

## Verification run

The following commands were run successfully:

- `npx vitest run "packages\\crypto-default\\test\\default-crypto.test.ts"`
- `npm run test`
- `npm run typecheck`
- `npm run build`

## Overall assessment

The repository is in a strong contract-first state. The workspace, package boundaries, and build pipeline are stable, and the crypto package is now materially implemented and tested.

The important limitation is that the system is still only partially functional. `contracts` and `crypto-default` are real; `core`, `storage-postgres`, and `node-adapter` are still scaffolds that compile cleanly but do not yet provide the full Cycle 1 runtime behavior.

## Strengths

- Monorepo workspace is stable and green.
- `@authia/contracts` is a clear shared source of truth.
- `@authia/crypto-default` now has real Argon2id hashing and targeted tests.
- Package dependency direction is clean: implementation packages depend on contracts.
- Current scaffolds fail closed instead of pretending to work.

## Risks and gaps

- End-to-end auth behavior is not implemented yet.
- `storage-postgres` is still a compile-safe stub, not a real adapter.
- `core` session lifecycle and kernel orchestration are still placeholders.
- `node-adapter` parsing logic is still skeletal.
- Current green tests prove foundations, not the full auth flow.

## Security notes

- `packages\\core\\src\\policies\\csrf-policy.ts` compares `referer` directly to `publicOrigin`; real referers are usually full URLs, so this fallback should parse and compare the origin.
- `packages\\crypto-default\\src\\default-crypto.ts` uses plain string equality for token verifier comparison; this should move to a timing-safe comparison.
- Argon2id is selected correctly, but cost parameters are not pinned yet.

## Architecture notes

- The contracts split is strong and should scale.
- The repo is in a good base state for incremental upgrades.
- Validation ownership should eventually be tightened so security-critical invariants are not split ambiguously across packages.

## Recommended next steps

1. Finish `storage-postgres` with real repositories and transaction handling.
2. Implement the `core` session layer against real storage and crypto services.
3. Implement kernel orchestration and startup validation.
4. Implement full `node-adapter` request parsing and result mapping.
5. Add integration tests for sign-up, sign-in, get-session, refresh, logout, and logout-all.
6. Fix the CSRF referer handling and timing-safe token verifier comparison while the codebase is still small.
