import type { AuthValue } from '@authia/contracts';

import { mapTransportFailure } from '../errors.js';
import type { DeliveryTelemetryEvent, ExecuteWithPolicyInput } from '../types.js';

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export async function executeWithPolicy(input: ExecuteWithPolicyInput): Promise<AuthValue<void>> {
  const sleep = input.sleep ?? defaultSleep;
  const backoffSequence = input.backoffMs.length > 0 ? input.backoffMs : [0];
  const emit = input.telemetry?.onEvent;
  const totalStart = Date.now();

  for (let attemptIndex = 0; attemptIndex <= input.maxRetries; attemptIndex += 1) {
    const attemptNumber = attemptIndex + 1;
    const attemptStart = Date.now();
    try {
      await runWithTimeout(input.run({ attempt: attemptNumber }), input.timeoutMs);

      emitTelemetryEvent(emit, {
        channel: input.channel,
        operation: 'send',
        outcome: 'success',
        phase: 'final',
        retryAttempt: attemptNumber,
        durationMs: Date.now() - totalStart
      });

      return undefined;
    } catch (error) {
      const mapped = mapTransportFailure(error);
      const hasRetriesRemaining = attemptIndex < input.maxRetries;
      const durationMs = Date.now() - attemptStart;

      if (!mapped.retryable || !hasRetriesRemaining) {
        emitTelemetryEvent(emit, {
          channel: input.channel,
          operation: 'send',
          outcome: 'failure',
          phase: 'final',
          retryAttempt: attemptNumber,
          durationMs: Date.now() - totalStart,
          code: mapped.code
        });
        return mapped;
      }

      emitTelemetryEvent(emit, {
        channel: input.channel,
        operation: 'send',
        outcome: 'retrying',
        phase: 'attempt',
        retryAttempt: attemptNumber,
        durationMs,
        code: mapped.code
      });

      const backoffIndex = Math.min(attemptIndex, backoffSequence.length - 1);
      await sleep(backoffSequence[backoffIndex]);
    }
  }

  return mapTransportFailure({ type: 'timeout-after-dispatch' });
}

function emitTelemetryEvent(
  emit: ((event: DeliveryTelemetryEvent) => void) | undefined,
  event: DeliveryTelemetryEvent
): void {
  emit?.(event);
}

function runWithTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  if (timeoutMs <= 0) {
    return operation;
  }

  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject({ type: 'timeout' });
    }, timeoutMs);

    operation.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
}
