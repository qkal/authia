import type { AuthResult, AuthError, RollbackSignal } from '@authia/contracts';

export function createRollbackSignal(outcome: AuthResult | AuthError): RollbackSignal {
  return { outcome };
}
