-- Migration 002: Enhanced Authentication
-- Adds: auth_identities, auth_sessions, phone_otps, oauth_states, case_access_tokens

BEGIN;

-- Ensure extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS citext;
EXCEPTION WHEN insufficient_privilege THEN NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 1) users table enhancement: add email_verified_at (phone_verified_at already exists)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

-- 2) Replace simple UNIQUE constraints with partial unique indexes (verified values only)
DO $$
BEGIN
  -- Drop existing email unique constraint if exists
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_email_key'
  ) THEN
    EXECUTE 'ALTER TABLE users DROP CONSTRAINT users_email_key';
  END IF;

  -- Drop existing phone unique constraint if exists
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_phone_key'
  ) THEN
    EXECUTE 'ALTER TABLE users DROP CONSTRAINT users_phone_key';
  END IF;
END $$;

-- Partial unique indexes (only verified values must be unique)
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_verified
  ON users (email)
  WHERE email IS NOT NULL AND email_verified_at IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_phone_verified
  ON users (phone)
  WHERE phone IS NOT NULL AND phone_verified_at IS NOT NULL;

-- 3) auth_identities: login methods (google/phone/local/kakao)
CREATE TABLE IF NOT EXISTS auth_identities (
  identity_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  provider text NOT NULL, -- google | phone | local | kakao
  provider_subject text NOT NULL, -- google sub, phone E164, etc
  email citext,
  email_verified boolean NOT NULL DEFAULT false,
  phone text,
  profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_subject)
);

CREATE INDEX IF NOT EXISTS idx_auth_identities_user
  ON auth_identities (user_id, created_at DESC);

-- Prevent duplicate verified emails per provider
CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_identities_provider_email_verified
  ON auth_identities (provider, email)
  WHERE email IS NOT NULL AND email_verified = true;

-- 4) auth_sessions: refresh token sessions
CREATE TABLE IF NOT EXISTS auth_sessions (
  session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  refresh_token_hash text NOT NULL,
  user_agent text,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_created
  ON auth_sessions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires
  ON auth_sessions (expires_at);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_hash
  ON auth_sessions (refresh_token_hash);

-- 5) phone_otps: phone OTP for login/link/case_access
CREATE TABLE IF NOT EXISTS phone_otps (
  otp_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  purpose text NOT NULL, -- login | link | case_access | sensitive_view
  code_hash text NOT NULL,
  attempt_count int NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_phone_otps_phone_created
  ON phone_otps (phone, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_phone_otps_expires
  ON phone_otps (expires_at);

-- 6) oauth_states: OAuth state + PKCE verifier hash storage
CREATE TABLE IF NOT EXISTS oauth_states (
  state_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL, -- google | kakao
  state text NOT NULL,
  code_verifier_hash text NOT NULL,
  redirect_uri text NOT NULL,
  flow text NOT NULL DEFAULT 'login', -- login | link
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  UNIQUE (provider, state)
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_expires
  ON oauth_states (expires_at);

-- 7) case_access_tokens: guest access tokens for sensitive data protection
CREATE TABLE IF NOT EXISTS case_access_tokens (
  token_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  scope text NOT NULL, -- progress_only | report_view | evidence_view
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS idx_case_access_tokens_case_created
  ON case_access_tokens (case_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_case_access_tokens_expires
  ON case_access_tokens (expires_at);

COMMIT;
