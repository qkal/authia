import { describe, expect, it } from 'vitest';

import { executeWithPolicy } from './execute-with-policy.js';

describe('executeWithPolicy', () => {
  it('retries with deterministic backoff sequence', async () => {
    const delays: number[] = [];
    const events: unknown[] = [];
    let attempts = 0;

    await executeWithPolicy({
      channel: 'http',
      run: async ({ attempt }) => {
        attempts = attempt;
        if (attempt < 5) {
          throw { status: 503, message: 'authorization failed for apiKey=secret-value' };
        }
      },
      telemetry: {
        onEvent: (event) => {
          events.push(event);
        }
      },
      sleep: async (ms) => {
        delays.push(ms);
      },
      maxRetries: 4,
      backoffMs: [100, 300, 700],
      timeoutMs: 50
    });

    expect(attempts).toBe(5);
    expect(delays).toEqual([100, 300, 700, 700]);
    expect(events.filter((event) => (event as { phase: string }).phase === 'attempt')).toHaveLength(4);
    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        channel: 'http',
        operation: 'send',
        outcome: 'success',
        phase: 'final',
        retryAttempt: 5,
        durationMs: expect.any(Number)
      })
    );
    expect(JSON.stringify(events)).not.toContain('apiKey=secret-value');
    expect(JSON.stringify(events)).not.toContain('authorization');
  });

  it('maps timeout-after-dispatch failures to non-retryable delivery errors', async () => {
    const events: unknown[] = [];
    const result = await executeWithPolicy({
      channel: 'smtp',
      run: async () => {
        throw { type: 'timeout-after-dispatch', message: 'reset-token should stay private' };
      },
      telemetry: {
        onEvent: (event) => {
          events.push(event);
        }
      },
      sleep: async () => {},
      maxRetries: 0,
      backoffMs: [100, 300, 700],
      timeoutMs: 25
    });

    expect(result).toMatchObject({
      code: 'DELIVERY_UNAVAILABLE',
      retryable: false
    });
    expect(events).toEqual([
      expect.objectContaining({
        channel: 'smtp',
        operation: 'send',
        outcome: 'failure',
        phase: 'final',
        retryAttempt: 1,
        durationMs: expect.any(Number),
        code: 'DELIVERY_UNAVAILABLE'
      })
    ]);
    expect(JSON.stringify(events)).not.toContain('reset-token');
  });

  it('enforces per-attempt timeout and surfaces retryable timeout failures', async () => {
    const result = await executeWithPolicy({
      channel: 'smtp',
      run: async () => new Promise(() => undefined),
      sleep: async () => {},
      maxRetries: 0,
      backoffMs: [100, 300, 700],
      timeoutMs: 5
    });

    expect(result).toMatchObject({
      code: 'DELIVERY_UNAVAILABLE',
      retryable: true
    });
  });
});
