import { describe, expect, it, vi } from 'vitest';

import { createResilientDeliveryProvider } from './index.js';
import type { OutboundEmailMessage } from './types.js';

describe('delivery-provider exports', () => {
  it('exports resilient provider factory', () => {
    expect(typeof createResilientDeliveryProvider).toBe('function');
  });

  it('delegates successful sends to the configured transport', async () => {
    const message: OutboundEmailMessage = {
      to: 'user@example.com',
      subject: 'Reset your password',
      text: 'Reset your password using this link: https://example.com/reset?token=test-token'
    };
    const transport = {
      deliver: vi.fn(async () => undefined)
    };
    const provider = createResilientDeliveryProvider({
      channel: 'http',
      transport,
      policy: {
        maxRetries: 2,
        backoffMs: [10, 20],
        timeoutMs: 25
      }
    });

    const result = await provider.send(message);

    expect(result).toBeUndefined();
    expect(transport.deliver).toHaveBeenCalledTimes(1);
    expect(transport.deliver).toHaveBeenCalledWith(message);
  });

  it('retries mapped transport failures before returning the canonical delivery error', async () => {
    const delays: number[] = [];
    const message: OutboundEmailMessage = {
      to: 'user@example.com',
      subject: 'Verify your email address',
      text: 'Verify your email address using this link: https://example.com/verify?token=test-token'
    };
    const transport = {
      deliver: vi.fn(async () => {
        throw { status: 503, message: 'authorization failed for apiKey=secret-value' };
      })
    };
    const provider = createResilientDeliveryProvider({
      channel: 'http',
      transport,
      policy: {
        maxRetries: 2,
        backoffMs: [100, 300],
        timeoutMs: 25
      },
      sleep: async (ms) => {
        delays.push(ms);
      }
    });

    const result = await provider.send(message);

    expect(result).toMatchObject({
      code: 'DELIVERY_UNAVAILABLE',
      retryable: true
    });
    expect(transport.deliver).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([100, 300]);
  });

  it('does not leak secrets in timeout-after-dispatch failures', async () => {
    const message: OutboundEmailMessage = {
      to: 'user@example.com',
      subject: 'Complete your sign in',
      text: 'Use the one-time link to complete sign in.'
    };
    const transport = {
      deliver: vi.fn(async () => {
        throw {
          type: 'timeout-after-dispatch',
          message: 'provider secret=delivery-secret'
        };
      })
    };
    const provider = createResilientDeliveryProvider({
      channel: 'smtp',
      transport,
      policy: {
        maxRetries: 0,
        backoffMs: [10],
        timeoutMs: 25
      }
    });

    const result = await provider.send(message);

    expect(result).toMatchObject({
      code: 'DELIVERY_UNAVAILABLE',
      retryable: false,
      message: 'Delivery status unknown after dispatch.'
    });
    expect(result?.message).not.toContain('secret=delivery-secret');
  });
});
