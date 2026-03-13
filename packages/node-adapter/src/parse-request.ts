import type { NotHandled, RuntimeAdapter } from '@authia/contracts';

export async function parseRequest(): Promise<NotHandled> {
  return { kind: 'notHandled' };
}
