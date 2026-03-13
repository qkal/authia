import type { PluginServices } from '@authia/contracts';
import { describe, expect, it, vi } from 'vitest';

import { createEmailDeliveryClient } from './delivery-client.js';

describe('createEmailDeliveryClient', () => {
  it('forwards password reset and verification payloads to configured delivery hooks', async () => {
    const emailDelivery: NonNullable<PluginServices['emailDelivery']> = {
      sendPasswordReset: vi.fn(async () => undefined),
      sendEmailVerification: vi.fn(async () => undefined)
    };
    const client = createEmailDeliveryClient({ emailDelivery });

    await client.sendPasswordReset({ email: 'user@example.com', resetToken: 'reset-token' });
    await client.sendEmailVerification({
      email: 'user@example.com',
      verificationToken: 'verify-token'
    });

    expect(emailDelivery.sendPasswordReset).toHaveBeenCalledWith({
      email: 'user@example.com',
      resetToken: 'reset-token'
    });
    expect(emailDelivery.sendEmailVerification).toHaveBeenCalledWith({
      email: 'user@example.com',
      verificationToken: 'verify-token'
    });
  });
});
