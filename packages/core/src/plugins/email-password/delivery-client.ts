import type { PluginServices } from '@authia/contracts';

export function createEmailDeliveryClient(
  services: { emailDelivery: NonNullable<PluginServices['emailDelivery']> }
): NonNullable<PluginServices['emailDelivery']> {
  return {
    sendPasswordReset: (input) => services.emailDelivery.sendPasswordReset(input),
    sendEmailVerification: (input) => services.emailDelivery.sendEmailVerification(input)
  };
}
