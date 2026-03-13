import nodemailer from 'nodemailer';
import type { DeliveryTransport, OutboundEmailMessage } from '../types.js';

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
  from: string;
};

type NodemailerTransport = {
  sendMail: (options: {
    from: string;
    to: string;
    subject: string;
    text: string;
  }) => Promise<unknown>;
};

type SmtpTransportOptions = Pick<SmtpConfig, 'host' | 'port' | 'secure' | 'auth'>;

type TransportFactory = (config: SmtpTransportOptions) => NodemailerTransport;

export function createSmtpProvider(
  config: SmtpConfig,
  transportFactory?: TransportFactory
): DeliveryTransport {
  const transportOptions: SmtpTransportOptions = {
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth
  };
  const transport =
    transportFactory?.(transportOptions) ??
    nodemailer.createTransport(transportOptions);

  return {
    deliver: async (message: OutboundEmailMessage): Promise<void> => {
      await transport.sendMail({
        from: config.from,
        to: message.to,
        subject: message.subject,
        text: message.text
      });
    }
  };
}
