import type { User, LocalIdentity, SessionRecord } from '@authia/contracts';

export type UserRow = {
  id: string;
  created_at: string;
};

export type LocalIdentityRow = {
  id: string;
  user_id: string;
  normalized_email: string;
  password_hash: string;
};

export type SessionRow = {
  id: string;
  user_id: string;
  current_token_id: string;
  current_token_verifier: string;
  last_rotated_at: string;
  expires_at: string;
  idle_expires_at: string;
  revoked_at: string | null;
};

export function mapUserRow(row: UserRow): User {
  return {
    id: row.id,
    createdAt: row.created_at
  };
}

export function mapLocalIdentityRow(row: LocalIdentityRow): LocalIdentity {
  return {
    id: row.id,
    userId: row.user_id,
    normalizedEmail: row.normalized_email,
    passwordHash: row.password_hash
  };
}

export function mapSessionRow(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    currentTokenId: row.current_token_id,
    currentTokenVerifier: row.current_token_verifier,
    lastRotatedAt: row.last_rotated_at,
    expiresAt: row.expires_at,
    idleExpiresAt: row.idle_expires_at,
    revokedAt: row.revoked_at
  };
}
