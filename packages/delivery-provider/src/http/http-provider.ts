import type { DeliveryTransport, OutboundEmailMessage } from '../types.js';

export type HttpConfig = {
  endpoint: string;
  apiKey: string;
  authHeaderName: string;
  from: string;
};

type Fetcher = typeof fetch;

export function createHttpProvider(config: HttpConfig, fetcher: Fetcher = fetch): DeliveryTransport {
  return {
    deliver: async (message: OutboundEmailMessage): Promise<void> => {
      const response = await fetcher(config.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [config.authHeaderName]: config.apiKey
        },
        body: JSON.stringify({
          from: config.from,
          to: message.to,
          subject: message.subject,
          text: message.text
        })
      });

      if (!response.ok) {
        const error = Object.assign(new Error(`HTTP provider returned ${response.status}`), {
          status: response.status
        });
        throw error;
      }
    }
  };
}
