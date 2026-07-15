CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE org_role AS ENUM ('owner', 'admin', 'scout', 'viewer');
CREATE TYPE invite_status AS ENUM ('pending', 'accepted', 'revoked', 'expired');
CREATE TYPE billing_tier AS ENUM ('free', 'starter', 'team', 'enterprise');
CREATE TYPE key_source AS ENUM ('platform', 'byo');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL,
  email_verified boolean NOT NULL DEFAULT false, name text NOT NULL, avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), expires_at timestamptz NOT NULL,
  token text UNIQUE NOT NULL, ip_address text, user_agent text,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id text NOT NULL, provider_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, access_token text, refresh_token text,
  id_token text, access_token_expires_at timestamptz, refresh_token_expires_at timestamptz,
  scope text, password text, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(provider_id, account_id)
);
CREATE INDEX accounts_user_idx ON accounts(user_id);
CREATE TABLE verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), identifier text NOT NULL, value text NOT NULL,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verifications_identifier_idx ON verifications(identifier);
CREATE TABLE profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name text, notification_prefs jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE platform_admins (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(), granted_by uuid REFERENCES users(id)
);
CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
  slug text UNIQUE NOT NULL, team_number integer CHECK (team_number BETWEEN 1 AND 99999),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, role org_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(org_id, user_id)
);
CREATE TABLE invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email text NOT NULL, role org_role NOT NULL, token_hash text UNIQUE NOT NULL,
  status invite_status NOT NULL DEFAULT 'pending', invited_by uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id uuid REFERENCES organizations(id) ON DELETE CASCADE, type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb, read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE events_ref (
  event_key text PRIMARY KEY, year integer NOT NULL, name text NOT NULL,
  start_date date, end_date date, event_type integer
);
CREATE TABLE org_active_context (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  active_event_key text REFERENCES events_ref(event_key), active_location text,
  set_by_user_id uuid REFERENCES users(id), set_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE admin_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_user_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL, target_org_id uuid REFERENCES organizations(id),
  target_user_id uuid REFERENCES users(id), payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE org_billing (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  tier billing_tier NOT NULL DEFAULT 'free', stripe_customer_id text UNIQUE,
  stripe_subscription_id text UNIQUE, credit_cap_usd numeric(12,6) NOT NULL DEFAULT 0,
  period_start timestamptz NOT NULL, period_end timestamptz NOT NULL,
  kill_switch boolean NOT NULL DEFAULT false, manual_override_notes text,
  CHECK (period_end > period_start), CHECK (credit_cap_usd >= 0)
);
CREATE TABLE org_llm_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider text NOT NULL, key_ciphertext text NOT NULL, key_nonce text NOT NULL,
  key_auth_tag text NOT NULL, encrypted_dek text NOT NULL, kms_key_id text NOT NULL,
  label text NOT NULL, created_by uuid NOT NULL REFERENCES users(id), last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX org_llm_keys_org_idx ON org_llm_keys(org_id);
CREATE TABLE ai_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id), feature text NOT NULL, model text NOT NULL,
  provider text NOT NULL, key_source key_source NOT NULL, prompt_tokens integer NOT NULL,
  completion_tokens integer NOT NULL, total_tokens integer NOT NULL, cost_usd numeric(12,6) NOT NULL,
  request_id text UNIQUE NOT NULL, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (prompt_tokens >= 0 AND completion_tokens >= 0 AND total_tokens >= 0 AND cost_usd >= 0)
);
CREATE INDEX ai_usage_org_created_idx ON ai_usage_events(org_id, created_at);
CREATE INDEX ai_usage_org_user_created_idx ON ai_usage_events(org_id, user_id, created_at);
CREATE TABLE ai_credit_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  amount_usd numeric(12,6) NOT NULL, granted_by uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE season_windows (
  year integer PRIMARY KEY, search_start_date date NOT NULL, search_end_date date NOT NULL,
  is_active boolean NOT NULL DEFAULT false, CHECK (search_end_date >= search_start_date)
);
CREATE TABLE waitlist_signups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email_normalized text UNIQUE NOT NULL,
  team_number integer NOT NULL CHECK (team_number BETWEEN 1 AND 99999), phone_e164 text,
  email_consent_at timestamptz, sms_consent_at timestamptz,
  consent_disclosure_version text NOT NULL, source text NOT NULL,
  launch_invited_at timestamptz, converted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (phone_e164 IS NOT NULL OR sms_consent_at IS NULL)
);

COMMENT ON TABLE waitlist_signups IS
  'Prelaunch interest only. Rows must never create product identities or memberships.';
