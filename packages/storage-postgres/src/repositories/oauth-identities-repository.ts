import type {
  AuthValue,
  OAuthIdentityCreateInput,
  OAuthIdentity,
  TransactionalStorage
} from '@authia/contracts';
import type { DatabaseClient } from '../database.js';
import { duplicateIdentity, isDuplicateKeyError, storageUnavailable } from '../database.js';
import { randomUUID } from 'node:crypto';

type OAuthIdentityRow = {
  id: string;
  user_id: string;
  provider: string;
  provider_subject: string;
};

export function createOAuthIdentitiesRepository(
  client: DatabaseClient
): TransactionalStorage['oauthIdentities'] {
  return {
    create: async (input: OAuthIdentityCreateInput): Promise<AuthValue<OAuthIdentity>> => {
      try {
        const id = randomUUID();
        const result = await client.query<OAuthIdentityRow>(
          `INSERT INTO oauth_identities (id, user_id, provider, provider_subject)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [id, input.userId, input.provider, input.providerSubject]
        );

        const row = result.rows[0];
        return {
          id: row.id,
          userId: row.user_id,
          provider: row.provider,
          providerSubject: row.provider_subject
        };
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          return duplicateIdentity();
        }
        return storageUnavailable('Failed to create OAuth identity', error);
      }
    },

    findByProviderSubject: async (provider: string, providerSubject: string) => {
      try {
        const result = await client.query<OAuthIdentityRow>(
          'SELECT * FROM oauth_identities WHERE provider = $1 AND provider_subject = $2',
          [provider, providerSubject]
        );

        if (result.rows.length === 0) {
          return null;
        }

        const row = result.rows[0];
        return {
          id: row.id,
          userId: row.user_id,
          provider: row.provider,
          providerSubject: row.provider_subject
        };
      } catch (error) {
        return storageUnavailable('Failed to find OAuth identity by provider subject', error);
      }
    }
  };
}
