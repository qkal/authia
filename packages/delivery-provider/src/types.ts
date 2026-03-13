import type { AuthValue } from '@authia/contracts';

export type DeliveryErrorCode = 'DELIVERY_UNAVAILABLE' | 'DELIVERY_RATE_LIMITED' | 'DELIVERY_MISCONFIGURED';

export type OutboundEmailMessage = {
  to: string;
  subject: string;
  text: string;
};

export type DeliveryTransport = {
  deliver: (message: OutboundEmailMessage) => Promise<void>;
};

export type DeliveryProvider = {
  send: (message: OutboundEmailMessage) => Promise<AuthValue<void>>;
};

export type DeliveryTelemetryEvent = {
  channel: 'smtp' | 'http';
  operation: 'send';
  outcome: 'success' | 'failure' | 'retrying';
  phase: 'attempt' | 'final';
  retryAttempt: number;
  durationMs: number;
  code?: string;
};

export type DeliveryTelemetry = {
  onEvent?: (event: DeliveryTelemetryEvent) => void;
};

export type PolicyConfig = {
  timeoutMs: number;
  maxRetries: number;
  backoffMs: readonly number[];
};

export type ExecuteWithPolicyInput = {
  channel: DeliveryTelemetryEvent['channel'];
  run: (context: { attempt: number }) => Promise<void>;
  telemetry?: DeliveryTelemetry;
  sleep?: (ms: number) => Promise<void>;
  maxRetries: number;
  backoffMs: readonly number[];
  timeoutMs: number;
};
