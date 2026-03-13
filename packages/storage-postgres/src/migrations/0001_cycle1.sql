create table if not exists users (
  id text primary key,
  created_at timestamptz not null
);

create table if not exists local_identities (
  id text primary key,
  user_id text not null references users(id),
  normalized_email text not null unique,
  password_hash text not null
);

create table if not exists sessions (
  id text primary key,
  user_id text not null references users(id),
  current_token_id text not null unique,
  current_token_verifier text not null,
  last_rotated_at timestamptz not null,
  expires_at timestamptz not null,
  idle_expires_at timestamptz not null,
  revoked_at timestamptz null
);
