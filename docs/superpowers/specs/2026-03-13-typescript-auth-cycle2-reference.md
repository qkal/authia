# TypeScript Auth Core Design - Cycle 2+ Reference

This document is reference-only. It is not part of the Cycle 1 normative planning surface.

## Planned later-cycle work

- OAuth plugin with `startOAuth` and `finishOAuth`
- Google and GitHub provider configs
- OAuth state persistence and replay protection
- OAuth account linking modes: `authenticate` and `link`
- Bun and Deno runtime adapters

## Reference contracts

- `Cycle2ActionName = SupportedAction | 'startOAuth' | 'finishOAuth'`
- `Cycle2DeniedCode = DeniedCode | 'OAUTH_STATE_MISMATCH' | 'OAUTH_REPLAY_DETECTED' | 'IDENTITY_CONFLICT' | 'ACCOUNT_LINK_FORBIDDEN'`
- `Cycle2RequestContext` adds `provider`, `oauthIntent`, and callback `code/state`
- `Cycle2ConfigExtensions` adds `plugins: ['emailPassword', 'oauth']`, `providerSet`, and `providerCredentials`

## OAuth rules

- Redirect URIs are derived from the configured callback entrypoint and validated at startup.
- OAuth state is one-time use and burned on successful consumption.
- If a provider email is missing or unverified, the flow must not auto-link to an existing local account.
- `ACCOUNT_LINK_FORBIDDEN` applies only to explicit link intent.
- `IDENTITY_CONFLICT` applies when an OAuth identity already belongs to a different user or a verified provider email collides with an incompatible local identity.
