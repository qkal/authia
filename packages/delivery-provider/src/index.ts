export * from './types.js';
export { mapHttpFailure, mapSmtpFailure, mapTransportFailure } from './errors.js';
export { createHttpProvider } from './http/http-provider.js';
export { createSmtpProvider } from './smtp/smtp-provider.js';
export type { HttpConfig } from './http/http-provider.js';
export type { SmtpConfig } from './smtp/smtp-provider.js';

export function createResilientDeliveryProvider() {
  throw new Error('Not implemented');
}
