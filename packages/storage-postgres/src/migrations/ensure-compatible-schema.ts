import type { AuthError } from '@authia/contracts';

export async function ensureCompatibleSchema(): Promise<'ok' | 'MIGRATION_MISMATCH' | AuthError> {
  return 'MIGRATION_MISMATCH';
}
