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

create table if not exists oauth_states (
  id text primary key,
  provider text not null,
  state_hash text not null,
  code_verifier_ciphertext text not null,
  redirect_uri_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz null
);

create table if not exists oauth_identities (
  id text primary key,
  user_id text not null references users(id),
  provider text not null,
  provider_subject text not null
);

create unique index if not exists oauth_states_state_hash_idx on oauth_states(state_hash);
create index if not exists oauth_states_expires_at_idx on oauth_states(expires_at);
create unique index if not exists oauth_identities_provider_subject_idx on oauth_identities(provider, provider_subject);
create index if not exists oauth_identities_user_id_idx on oauth_identities(user_id);
