import { describe, it, expect, vi } from 'vitest';

import { createSmtpProvider } from './smtp-provider.js';
import type { OutboundEmailMessage } from '../types.js';

describe('createSmtpProvider', () => {
  const validSmtpConfig = {
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    auth: { user: 'test@example.com', pass: 'password' },
    from: 'noreply@example.com'
  } as const;

  it('creates a DeliveryTransport', () => {
    const mockTransport = {
      sendMail: vi.fn().mockResolvedValue({})
    };
    const mockTransportFactory = vi.fn().mockReturnValue(mockTransport);

    const provider = createSmtpProvider(validSmtpConfig, mockTransportFactory);

    expect(provider).toHaveProperty('deliver');
    expect(typeof provider.deliver).toBe('function');
    expect(mockTransportFactory).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: { user: 'test@example.com', pass: 'password' }
    });
  });

  it('delivers message with from field from config', async () => {
    const mockTransport = {
      sendMail: vi.fn().mockResolvedValue({})
    };
    const mockTransportFactory = vi.fn().mockReturnValue(mockTransport);

    const provider = createSmtpProvider(validSmtpConfig, mockTransportFactory);

    const message: OutboundEmailMessage = {
      to: 'user@example.com',
      subject: 'Test Subject',
      text: 'Test Body'
    };

    await provider.deliver(message);

    expect(mockTransport.sendMail).toHaveBeenCalledWith({
      from: 'noreply@example.com',
      to: 'user@example.com',
      subject: 'Test Subject',
      text: 'Test Body'
    });
  });

  it('throws native error when sendMail fails', async () => {
    const nativeError = new Error('SMTP connection failed');
    const mockTransport = {
      sendMail: vi.fn().mockRejectedValue(nativeError)
    };
    const mockTransportFactory = vi.fn().mockReturnValue(mockTransport);

    const provider = createSmtpProvider(validSmtpConfig, mockTransportFactory);

    const message: OutboundEmailMessage = {
      to: 'user@example.com',
      subject: 'Test Subject',
      text: 'Test Body'
    };

    await expect(provider.deliver(message)).rejects.toThrow('SMTP connection failed');
  });

  it('uses nodemailer by default when no transportFactory provided', () => {
    const provider = createSmtpProvider(validSmtpConfig);

    expect(provider).toHaveProperty('deliver');
    expect(typeof provider.deliver).toBe('function');
  });
});
