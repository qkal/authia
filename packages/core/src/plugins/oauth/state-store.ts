import type { PluginServices } from '@authia/contracts';

export function createOAuthStateStore(
  services: { oauthStateStore: NonNullable<PluginServices['oauthStateStore']> }
): NonNullable<PluginServices['oauthStateStore']> {
  return {
    create: (input) => services.oauthStateStore.create(input),
    consume: (input) => services.oauthStateStore.consume(input)
  };
}
