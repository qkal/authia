# SMTP/API Delivery Provider Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-grade `packages/delivery-provider` package with SMTP and HTTP transports, resilient retry/timeout policy, explicit delivery error mapping, and reference-app wiring through core delivery boundaries.

**Architecture:** Implement a transport/policy split: transport adapters throw native failures, while a resilient provider wrapper handles retries, timeout, telemetry, and `AuthError` mapping. Keep core plugin contracts unchanged by integrating through `createEmailDeliveryFromProvider(...)`. Add deterministic tests with fake transports and update cycle2 composition to validate end-to-end wiring.

**Tech Stack:** TypeScript, Vitest, Node fetch, nodemailer, existing Authia contracts/core composition.

---

## Chunk 1: Package scaffold, contracts, and policy core

### Task 1: Scaffold `packages/delivery-provider` workspace package

**Files:**
- Create: `packages/delivery-provider/package.json`
- Create: `packages/delivery-provider/tsconfig.json`
- Create: `packages/delivery-provider/src/index.ts`
- Create: `packages/delivery-provider/src/index.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing package-import smoke test**

```ts
import { describe, expect, it } from 'vitest';
import { createResilientDeliveryProvider } from '../src/index.js';

describe('delivery-provider exports', () => {
  it('exports resilient provider factory', () => {
    expect(typeof createResilientDeliveryProvider).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- packages/delivery-provider/src/index.test.ts`
Expected: FAIL with module or export-not-found error.

- [ ] **Step 3: Add package scaffold and export stub**

```ts
// package.json (minimum)
{
  "name": "@authia/delivery-provider",
  "version": "0.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run"
  }
}

// root package.json modification (minimum)
// add workspace entry:
// "workspaces": ["packages/*", "packages/delivery-provider"]

// tsconfig.json (minimum)
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*.ts"]
}

// src/index.ts
export function createResilientDeliveryProvider() {
  throw new Error('not implemented');
}
```

- [ ] **Step 4: Run test to verify import passes**

Run: `npm run test -- packages/delivery-provider/src/index.test.ts`
Expected: PASS for export check.

- [ ] **Step 5: Commit**

```bash
git add package.json packages/delivery-provider
git commit -m "feat(delivery-provider): scaffold package and export entry"
```

### Task 2: Define package contracts and canonical error mapper

**Files:**
- Create: `packages/delivery-provider/src/types.ts`
- Create: `packages/delivery-provider/src/errors.ts`
- Create: `packages/delivery-provider/src/errors.test.ts`
- Modify: `packages/delivery-provider/src/index.ts`

- [ ] **Step 1: Write failing tests for error mapping**

```ts
describe('error mapping', () => {
  it('maps HTTP and SMTP failures to delivery codes with correct retryability', () => {
    expect(mapHttpFailure({ status: 429 }).code).toBe('DELIVERY_RATE_LIMITED');
    expect(mapHttpFailure({ status: 401 }).code).toBe('DELIVERY_MISCONFIGURED');
    expect(mapHttpFailure({ status: 500 }).code).toBe('DELIVERY_UNAVAILABLE');
    expect(mapHttpFailure({ status: 400 }).retryable).toBe(false);
    expect(mapHttpFailure({ status: 404 }).retryable).toBe(false);
    expect(mapHttpFailure({ status: 422 }).retryable).toBe(false);
    expect(mapHttpFailure({ message: 'network down' }).retryable).toBe(true);
    expect(mapSmtpFailure({ code: 'EAUTH' }).code).toBe('DELIVERY_MISCONFIGURED');
    expect(mapSmtpFailure({ responseCode: 421 }).code).toBe('DELIVERY_UNAVAILABLE');
    expect(mapSmtpFailure({ responseCode: 550 }).code).toBe('DELIVERY_UNAVAILABLE');
    expect(mapSmtpFailure({ code: 'ETIMEDOUT' }).retryable).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm run test -- packages/delivery-provider/src/errors.test.ts`
Expected: FAIL with missing mapper exports.

- [ ] **Step 3: Implement minimal contracts and mapping helpers**

```ts
export type DeliveryTransport = { deliver: (message: OutboundEmailMessage) => Promise<void> };
export function mapHttpFailure(input: { status?: number; message?: string }): AuthError {
  if (input.status === 429) return { category: 'infrastructure', code: 'DELIVERY_RATE_LIMITED', message: 'Delivery provider rate limited request.', retryable: true };
  if (input.status === 401 || input.status === 403) return { category: 'infrastructure', code: 'DELIVERY_MISCONFIGURED', message: 'Delivery provider credentials are invalid.', retryable: false };
  if (input.status === 400 || input.status === 404 || input.status === 422) {
    return { category: 'infrastructure', code: 'DELIVERY_UNAVAILABLE', message: 'Delivery request was rejected.', retryable: false };
  }
  if (input.status === 500 || input.status === 502 || input.status === 503 || input.status === 504) return { category: 'infrastructure', code: 'DELIVERY_UNAVAILABLE', message: 'Delivery provider is unavailable.', retryable: true };
  return { category: 'infrastructure', code: 'DELIVERY_UNAVAILABLE', message: input.message ?? 'Delivery request failed.', retryable: true };
}
export function mapSmtpFailure(input: { code?: string; responseCode?: number; message?: string }): AuthError {
  if (input.code === 'EAUTH') return { category: 'infrastructure', code: 'DELIVERY_MISCONFIGURED', message: 'SMTP authentication failed.', retryable: false };
  if (input.code === 'ECONNECTION' || input.code === 'ETIMEDOUT') return { category: 'infrastructure', code: 'DELIVERY_UNAVAILABLE', message: 'SMTP transport unavailable.', retryable: true };
  if ((input.responseCode ?? 0) >= 400 && (input.responseCode ?? 0) < 500) return { category: 'infrastructure', code: 'DELIVERY_UNAVAILABLE', message: 'SMTP temporary failure.', retryable: true };
  return { category: 'infrastructure', code: 'DELIVERY_UNAVAILABLE', message: input.message ?? 'SMTP delivery failed.', retryable: false };
}
export function mapTransportFailure(error: unknown): AuthError {
  if (typeof error === 'object' && error !== null && 'status' in error) return mapHttpFailure(error as { status?: number; message?: string });
  return mapSmtpFailure(error as { code?: string; responseCode?: number; message?: string });
}
```

- [ ] **Step 4: Re-run tests**

Run: `npm run test -- packages/delivery-provider/src/errors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/delivery-provider/src/types.ts packages/delivery-provider/src/errors.ts packages/delivery-provider/src/errors.test.ts packages/delivery-provider/src/index.ts
git commit -m "feat(delivery-provider): add contracts and error mapping"
```

### Task 3: Implement resilient policy executor with deterministic retry rules

**Files:**
- Create: `packages/delivery-provider/src/policy/execute-with-policy.ts`
- Create: `packages/delivery-provider/src/policy/execute-with-policy.test.ts`
- Modify: `packages/delivery-provider/src/index.ts`

- [ ] **Step 1: Write failing tests for retry/timeout semantics**

```ts
it('retries with 100,300,700,700 backoff when max retries exceed sequence', async () => {
  const delays: number[] = [];
  await executeWithPolicy({
    run: async ({ attempt }) => {
      if (attempt < 5) throw { type: 'http', status: 503 };
    },
    sleep: async (ms) => delays.push(ms),
    maxRetries: 4,
    backoffMs: [100, 300, 700],
    timeoutMs: 500
  });
  expect(delays).toEqual([100, 300, 700, 700]);
});
it('maps timeout after dispatch attempt to DELIVERY_UNAVAILABLE fail-closed', async () => {
  const result = await executeWithPolicy({
    run: async () => {
      throw { type: 'timeout-after-dispatch', message: 'socket timeout' };
    },
    maxRetries: 0,
    backoffMs: [100, 300, 700],
    timeoutMs: 100
  });
  expect(result).toEqual(
    expect.objectContaining({ code: 'DELIVERY_UNAVAILABLE', retryable: false })
  );
});
it('enforces per-attempt timeout and maps timeout to DELIVERY_UNAVAILABLE', async () => {
  const result = await executeWithPolicy({
    run: async () => new Promise(() => undefined),
    maxRetries: 0,
    backoffMs: [100, 300, 700],
    timeoutMs: 10
  });
  expect(result).toEqual(
    expect.objectContaining({ code: 'DELIVERY_UNAVAILABLE', retryable: true })
  );
});
it('maps timeout-after-dispatch to fail-closed non-retryable result', async () => {
  const result = await executeWithPolicy({
    run: async () => {
      throw { type: 'timeout-after-dispatch', message: 'unknown delivery state' };
    },
    maxRetries: 0,
    backoffMs: [100, 300, 700],
    timeoutMs: 10
  });
  expect(result).toEqual(
    expect.objectContaining({ code: 'DELIVERY_UNAVAILABLE', retryable: false })
  );
});
```

- [ ] **Step 2: Run policy tests**

Run: `npm run test -- packages/delivery-provider/src/policy/execute-with-policy.test.ts`
Expected: FAIL with missing executor.

- [ ] **Step 3: Implement executor**

```ts
export async function executeWithPolicy(input: ExecuteWithPolicyInput): Promise<AuthValue<void>> {
  for (let attempt = 0; attempt <= input.maxRetries; attempt += 1) {
    try {
      await Promise.race([
        input.run({ attempt: attempt + 1 }),
        new Promise((_, reject) => setTimeout(() => reject({ type: 'timeout' }), input.timeoutMs))
      ]);
      return undefined;
    } catch (error) {
      // mapTransportFailure is implemented/exported in src/errors.ts
      const mapped = mapTransportFailure(error);
      if (attempt === input.maxRetries || mapped.retryable === false) {
        return mapped;
      }
      const delay = input.backoffMs[Math.min(attempt, input.backoffMs.length - 1)];
      await input.sleep(delay);
    }
  }
  return { category: 'infrastructure', code: 'DELIVERY_UNAVAILABLE', message: 'Delivery failed.', retryable: false };
}
```

- [ ] **Step 3.1: Run typecheck for chunk sanity**

Run: `npm run typecheck -w @authia/delivery-provider`
Expected: PASS.

- [ ] **Step 4: Re-run tests**

Run: `npm run test -- packages/delivery-provider/src/policy/execute-with-policy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/delivery-provider/src/policy packages/delivery-provider/src/index.ts
git commit -m "feat(delivery-provider): add resilient policy executor"
```

## Chunk 2: SMTP + HTTP adapters and telemetry behavior

### Task 4: Implement SMTP transport adapter

**Files:**
- Create: `packages/delivery-provider/src/smtp/smtp-provider.ts`
- Create: `packages/delivery-provider/src/smtp/smtp-provider.test.ts`
- Modify: `packages/delivery-provider/src/index.ts`

- [ ] **Step 1: Write failing SMTP adapter tests**

```ts
it('sends message through nodemailer transport', async () => {
  const sendMail = vi.fn(async () => ({ messageId: 'm1' }));
  const provider = createSmtpProvider(validSmtpConfig, () => ({ sendMail }));
  await provider.deliver({ to: 'user@example.com', subject: 's', text: 't' });
  expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'user@example.com', subject: 's', text: 't' }));
});
it('throws native auth error for mapper classification', async () => {
  const sendMail = vi.fn(async () => {
    throw Object.assign(new Error('auth failed'), { code: 'EAUTH' });
  });
  const provider = createSmtpProvider(validSmtpConfig, () => ({ sendMail }));
  await expect(provider.deliver({ to: 'user@example.com', subject: 's', text: 't' })).rejects.toMatchObject({ code: 'EAUTH' });
});
```

- [ ] **Step 2: Run SMTP tests**

Run: `npm run test -- packages/delivery-provider/src/smtp/smtp-provider.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement adapter**

```ts
export function createSmtpProvider(config: SmtpConfig, transportFactory = nodemailer.createTransport): DeliveryTransport {
  const transport = transportFactory({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth
  });
  return {
    deliver: async (message) => {
      await transport.sendMail({ from: config.from, to: message.to, subject: message.subject, text: message.text });
    }
  };
}
```

- [ ] **Step 4: Re-run SMTP tests**

Run: `npm run test -- packages/delivery-provider/src/smtp/smtp-provider.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/delivery-provider/src/smtp packages/delivery-provider/src/index.ts
git commit -m "feat(delivery-provider): add smtp transport adapter"
```

### Task 5: Implement HTTP API transport adapter

**Files:**
- Create: `packages/delivery-provider/src/http/http-provider.ts`
- Create: `packages/delivery-provider/src/http/http-provider.test.ts`
- Modify: `packages/delivery-provider/src/index.ts`

- [ ] **Step 1: Write failing HTTP adapter tests**

```ts
it('sends request with configured auth header', async () => {
  const fetcher = vi.fn(async () => new Response(null, { status: 202 }));
  const provider = createHttpProvider(validHttpConfig, fetcher);
  await provider.deliver({ to: 'user@example.com', subject: 's', text: 't' });
  expect(fetcher).toHaveBeenCalledWith(
    validHttpConfig.endpoint,
    expect.objectContaining({ headers: expect.objectContaining({ [validHttpConfig.authHeaderName]: validHttpConfig.apiKey }) })
  );
});
it('throws status metadata for mapper on non-2xx responses', async () => {
  const fetcher = vi.fn(async () => new Response('bad', { status: 429 }));
  const provider = createHttpProvider(validHttpConfig, fetcher);
  await expect(provider.deliver({ to: 'user@example.com', subject: 's', text: 't' })).rejects.toMatchObject({ status: 429 });
});
```

- [ ] **Step 2: Run HTTP tests**

Run: `npm run test -- packages/delivery-provider/src/http/http-provider.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement adapter**

```ts
export function createHttpProvider(config: HttpConfig, fetcher: typeof fetch = fetch): DeliveryTransport {
  return {
    deliver: async (message) => {
      const response = await fetcher(config.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [config.authHeaderName]: config.apiKey
        },
        body: JSON.stringify({ from: config.from, to: message.to, subject: message.subject, text: message.text })
      });
      if (!response.ok) {
        const error = new Error(`HTTP provider returned ${response.status}`);
        Object.assign(error, { status: response.status });
        throw error;
      }
    }
  };
}
```

- [ ] **Step 4: Re-run HTTP tests**

Run: `npm run test -- packages/delivery-provider/src/http/http-provider.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/delivery-provider/src/http packages/delivery-provider/src/index.ts
git commit -m "feat(delivery-provider): add http transport adapter"
```

### Task 6: Implement telemetry emission contract in resilient provider

**Files:**
- Modify: `packages/delivery-provider/src/policy/execute-with-policy.ts`
- Modify: `packages/delivery-provider/src/policy/execute-with-policy.test.ts`

- [ ] **Step 1: Add failing tests for `phase: attempt|final` events**

```ts
expect(events.filter((e) => e.phase === 'attempt')).toHaveLength(2);
expect(events.at(-1)?.phase).toBe('final');
expect(events.at(-1)).toEqual(
  expect.objectContaining({
    channel: 'http',
    operation: 'send',
    retryAttempt: expect.any(Number),
    durationMs: expect.any(Number)
  })
);
expect(JSON.stringify(events)).not.toContain('reset-token');
expect(JSON.stringify(events)).not.toContain('apiKey');
expect(JSON.stringify(events)).not.toContain('authorization');
```

- [ ] **Step 2: Run tests**

Run: `npm run test -- packages/delivery-provider/src/policy/execute-with-policy.test.ts`
Expected: FAIL on missing telemetry fields.

- [ ] **Step 3: Implement telemetry emissions**

```ts
emit({
  channel: input.channel,
  operation: 'send',
  phase: 'attempt',
  outcome: 'retrying',
  retryAttempt: attempt,
  durationMs,
  code: mapped.code
});
emit({
  channel: input.channel,
  operation: 'send',
  phase: 'final',
  outcome: finalOutcome,
  retryAttempt: attempt,
  durationMs: totalDuration,
  code: finalCode
});
```

- [ ] **Step 4.1: Run chunk-level verification gate**

Run: `npm run typecheck && npm run build && npm run test`
Expected: PASS (DB-optional suites may SKIP when env is unset).

- [ ] **Step 4: Re-run tests**

Run: `npm run test -- packages/delivery-provider/src/policy/execute-with-policy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/delivery-provider/src/policy
git commit -m "feat(delivery-provider): add attempt/final telemetry events"
```

## Chunk 3: Composition wiring, integration tests, docs, and release gate

### Task 7: Wire package into cycle2 reference composition

**Files:**
- Modify: `examples/cycle2-compose.ts`
- Modify: `packages/core/src/plugins/email-password/provider-delivery.ts` (only if needed for adapter contract fit)
- Test: `tests/integration/cycle2-account-lifecycle-reference-flow.test.ts`

- [ ] **Step 1: Write failing integration assertions for concrete provider wiring**

```ts
expect(app.getOutboundMessages()[0].subject).toBe('Reset your password');
expect(app.getOutboundMessages()[0].text).toContain('/delivery/password-reset?token=');
```

- [ ] **Step 2: Run targeted integration tests**

Run: `npm run test -- tests/integration/cycle2-account-lifecycle-reference-flow.test.ts`
Expected: FAIL in environments with `TEST_DATABASE_URL` set, or SKIP without DB env.

- [ ] **Step 3: Implement wiring**

```ts
const transport = createHttpTransport(...) // or smtp in example mode
const provider = createResilientDeliveryProvider({ transport, policy, telemetry });
const emailDelivery = createEmailDeliveryFromProvider({ provider, ... });
```

- [ ] **Step 4: Re-run targeted tests**

Run: `npm run test -- tests/integration/cycle2-account-lifecycle-reference-flow.test.ts`
Expected: PASS (or SKIP without DB env).

- [ ] **Step 5: Commit**

```bash
git add examples/cycle2-compose.ts tests/integration/cycle2-account-lifecycle-reference-flow.test.ts packages/core/src/plugins/email-password/provider-delivery.ts
git commit -m "feat(cycle2): wire resilient delivery provider package"
```

### Task 8: Verify full workspace and produce implementation audit

**Files:**
- Create: `audits/2026-03-13-delivery-provider-package-audit.md`
- Modify: `readme.md` (only if delivery package usage docs are added)

- [ ] **Step 1: Run full verification**

Run: `npm run typecheck && npm run build && npm run test`
Expected: all pass; integration DB suites may skip when env is unset.

- [ ] **Step 2: Write audit**

Include:
- scope
- security checks
- mapping table summary
- test evidence
- residual risks

- [ ] **Step 3: Commit verification + audit**

```bash
git add audits/2026-03-13-delivery-provider-package-audit.md readme.md
git commit -m "chore(audit): record delivery-provider package verification"
```

- [ ] **Step 4: Push**

Run: `git push origin main`
Expected: remote updated.

### Task 9: Final handoff verification

**Files:**
- Modify: `C:\Users\Better\.copilot\session-state\0913948c-8357-4305-a726-91b8ed1b464b\plan.md` (execution progress bullet updates)

- [ ] **Step 1: Confirm all planned files are present**

Run: `git --no-pager status --short && git --no-pager log --oneline -n 8`
Expected: clean working tree and clear commit chain.

- [ ] **Step 2: Update execution progress in session plan**

Add completed bullets for:
- delivery-provider package
- transport adapters
- policy and telemetry
- audit path

- [ ] **Step 3: Final commit (if plan-tracked files changed in repo)**

```bash
git add docs/superpowers/plans/2026-03-13-smtp-api-delivery-provider.md
git commit -m "docs(plan): finalize delivery-provider implementation plan"
```
