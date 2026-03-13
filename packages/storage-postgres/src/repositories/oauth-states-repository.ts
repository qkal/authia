import type { AuthValue, OAuthStateCreateInput, OAuthState, TransactionalStorage } from '@authia/contracts';
import type { DatabaseClient } from '../database.js';
import { storageUnavailable } from '../database.js';
import { randomUUID } from 'node:crypto';

type OAuthStateRow = {
  id: string;
  provider: string;
  state_hash: string;
  code_verifier_ciphertext: string;
  redirect_uri_hash: string;
  expires_at: string;
  consumed_at: string | null;
};

export function createOAuthStatesRepository(client: DatabaseClient): TransactionalStorage['oauthStates'] {
  return {
    create: async (input: OAuthStateCreateInput): Promise<AuthValue<OAuthState>> => {
      try {
        const id = randomUUID();
        const result = await client.query<OAuthStateRow>(
          `INSERT INTO oauth_states (id, provider, state_hash, code_verifier_ciphertext, redirect_uri_hash, expires_at, consumed_at)
           VALUES ($1, $2, $3, $4, $5, $6, NULL)
           RETURNING *`,
          [
            id,
            input.provider,
            input.stateHash,
            input.codeVerifierCiphertext,
            input.redirectUriHash,
            input.expiresAt
          ]
        );

        const row = result.rows[0];
        return {
          id: row.id,
          provider: row.provider,
          stateHash: row.state_hash,
          codeVerifierCiphertext: row.code_verifier_ciphertext,
          redirectUriHash: row.redirect_uri_hash,
          expiresAt: row.expires_at,
          consumedAt: row.consumed_at
        };
      } catch (error) {
        return storageUnavailable('Failed to create OAuth state', error);
      }
    },

    consume: async (input) => {
      try {
        const result = await client.query<{
          code_verifier_ciphertext: string;
          redirect_uri_hash: string;
        }>(
          `UPDATE oauth_states
           SET consumed_at = $3
           WHERE provider = $1
             AND state_hash = $2
             AND consumed_at IS NULL
             AND expires_at > $3
           RETURNING code_verifier_ciphertext, redirect_uri_hash`,
          [input.provider, input.stateHash, input.nowIso]
        );

        if (result.rows.length === 0) {
          return null;
        }

        return {
          codeVerifierCiphertext: result.rows[0].code_verifier_ciphertext,
          redirectUriHash: result.rows[0].redirect_uri_hash
        };
      } catch (error) {
        return storageUnavailable('Failed to consume OAuth state', error);
      }
    }
  };
}
