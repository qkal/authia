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

  it('delegates close to transport when available', async () => {
    const mockTransport = {
      sendMail: vi.fn().mockResolvedValue({}),
      close: vi.fn().mockResolvedValue(undefined)
    };
    const mockTransportFactory = vi.fn().mockReturnValue(mockTransport);

    const provider = createSmtpProvider(validSmtpConfig, mockTransportFactory);

    expect(typeof provider.close).toBe('function');
    await provider.close!();

    expect(mockTransport.close).toHaveBeenCalledTimes(1);
  });

  it('propagates close errors from transport', async () => {
    const closeError = new Error('SMTP close failed');
    const mockTransport = {
      sendMail: vi.fn().mockResolvedValue({}),
      close: vi.fn(() => {
        throw closeError;
      })
    };
    const mockTransportFactory = vi.fn().mockReturnValue(mockTransport);

    const provider = createSmtpProvider(validSmtpConfig, mockTransportFactory);

    expect(typeof provider.close).toBe('function');
    await expect(provider.close!()).rejects.toBe(closeError);
  });

  it('supports synchronous transport close implementations', async () => {
    const mockTransport = {
      sendMail: vi.fn().mockResolvedValue({}),
      close: vi.fn(() => undefined)
    };
    const mockTransportFactory = vi.fn().mockReturnValue(mockTransport);

    const provider = createSmtpProvider(validSmtpConfig, mockTransportFactory);

    expect(typeof provider.close).toBe('function');
    await expect(provider.close!()).resolves.toBeUndefined();
    expect(mockTransport.close).toHaveBeenCalledTimes(1);
  });

  it('exposes close that resolves when transport has no close', async () => {
    const mockTransport = {
      sendMail: vi.fn().mockResolvedValue({})
    };
    const mockTransportFactory = vi.fn().mockReturnValue(mockTransport);

    const provider = createSmtpProvider(validSmtpConfig, mockTransportFactory);

    expect(typeof provider.close).toBe('function');
    await expect(provider.close!()).resolves.toBeUndefined();
  });

  it('delegates multiple close calls when transport exposes close', async () => {
    const mockTransport = {
      sendMail: vi.fn().mockResolvedValue({}),
      close: vi.fn().mockResolvedValue(undefined)
    };
    const mockTransportFactory = vi.fn().mockReturnValue(mockTransport);

    const provider = createSmtpProvider(validSmtpConfig, mockTransportFactory);

    expect(typeof provider.close).toBe('function');
    await provider.close!();
    await provider.close!();

    expect(mockTransport.close).toHaveBeenCalledTimes(2);
  });

  it('allows repeated close calls when transport has no close', async () => {
    const mockTransport = {
      sendMail: vi.fn().mockResolvedValue({})
    };
    const mockTransportFactory = vi.fn().mockReturnValue(mockTransport);

    const provider = createSmtpProvider(validSmtpConfig, mockTransportFactory);

    expect(typeof provider.close).toBe('function');
    await expect(provider.close!()).resolves.toBeUndefined();
    await expect(provider.close!()).resolves.toBeUndefined();
  });

  it('propagates rejected close promises from transport', async () => {
    const closeError = new Error('async SMTP close failed');
    const mockTransport = {
      sendMail: vi.fn().mockResolvedValue({}),
      close: vi.fn().mockRejectedValue(closeError)
    };
    const mockTransportFactory = vi.fn().mockReturnValue(mockTransport);

    const provider = createSmtpProvider(validSmtpConfig, mockTransportFactory);

    expect(typeof provider.close).toBe('function');
    await expect(provider.close!()).rejects.toBe(closeError);
  });

  it('ignores non-function close properties on transport', async () => {
    const mockTransport = {
      sendMail: vi.fn().mockResolvedValue({}),
      close: 'noop'
    } as unknown as {
      sendMail: (options: { from: string; to: string; subject: string; text: string }) => Promise<unknown>;
      close?: () => Promise<void> | void;
    };
    const mockTransportFactory = vi.fn().mockReturnValue(mockTransport);

    const provider = createSmtpProvider(validSmtpConfig, mockTransportFactory);

    expect(typeof provider.close).toBe('function');
    await expect(provider.close!()).resolves.toBeUndefined();
  });
});
