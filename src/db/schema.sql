-- Emergency Unlock Ops Platform - MVP schema (PostgreSQL)
-- Notes:
-- - No online payments. Only accruals are recorded and invoices are generated later.
-- - Evidence uses object storage; DB stores keys/metadata and access logs.
-- - OTP completion required for COMPLETED status.

BEGIN;

-- Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- Enums
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('customer', 'callcenter', 'tech', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE case_status AS ENUM (
    'SUBMITTED',
    'NEED_APPROVAL',
    'DISPATCHING',
    'ACCEPTED',
    'ASSIGNED',
    'EN_ROUTE',
    'ARRIVED',
    'WORKING',
    'OTP_PENDING',
    'COMPLETED',
    'CANCELLED',
    'EXPIRED',
    'REJECTED',
    'FAILED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE evidence_type AS ENUM ('door', 'lock', 'key', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE dispatch_offer_status AS ENUM ('SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE confidence_level AS ENUM ('high', 'medium', 'low');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE cause_category AS ENUM ('suspected_defect', 'suspected_user_issue', 'unknown');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE accrual_status AS ENUM ('ACCRUED', 'VOIDED', 'INVOICED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE invoice_status AS ENUM ('DRAFT', 'SENT', 'PAID');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Core tables
CREATE TABLE IF NOT EXISTS orgs (
  org_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  user_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role user_role NOT NULL,
  email citext UNIQUE,
  password_hash text,
  phone text,
  phone_verified_at timestamptz,
  email_verified_at timestamptz,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_or_phone CHECK (
    email IS NOT NULL OR phone IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Org membership
CREATE TABLE IF NOT EXISTS org_memberships (
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  scope text NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);

-- Cases
CREATE TABLE IF NOT EXISTS cases (
  case_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status case_status NOT NULL DEFAULT 'SUBMITTED',
  risk_level int NOT NULL DEFAULT 0 CHECK (risk_level BETWEEN 0 AND 5),

  customer_id uuid REFERENCES users(user_id) ON DELETE SET NULL,
  customer_phone text NOT NULL,
  address_text text NOT NULL,
  location_lat double precision NOT NULL CHECK (location_lat BETWEEN -90 AND 90),
  location_lng double precision NOT NULL CHECK (location_lng BETWEEN -180 AND 180),
  place_note text,
  symptom_note text,

  assigned_org_id uuid REFERENCES orgs(org_id) ON DELETE SET NULL,
  assigned_tech_id uuid REFERENCES users(user_id) ON DELETE SET NULL,
  accepted_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cases_org_status_created
  ON cases (assigned_org_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cases_tech_status_created
  ON cases (assigned_tech_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cases_customer_created
  ON cases (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cases_status
  ON cases (status);

-- Dispatch offers
CREATE TABLE IF NOT EXISTS dispatch_offers (
  offer_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
  tech_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  status dispatch_offer_status NOT NULL DEFAULT 'SENT',
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_offers_case_created
  ON dispatch_offers (case_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_offers_tech_status
  ON dispatch_offers (tech_id, status);

-- Tech availability
CREATE TABLE IF NOT EXISTS tech_availability (
  tech_id uuid PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  is_online boolean NOT NULL DEFAULT false,
  is_busy boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Tech GPS pings
CREATE TABLE IF NOT EXISTS tech_location_pings (
  ping_id bigserial PRIMARY KEY,
  tech_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  accuracy double precision,
  ts timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pings_tech_ts
  ON tech_location_pings (tech_id, ts DESC);

-- Case timeline (optional convenience; can be derived from audit_events)
CREATE TABLE IF NOT EXISTS case_timeline (
  timeline_id bigserial PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_user_id uuid REFERENCES users(user_id) ON DELETE SET NULL,
  actor_role user_role,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ts timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_timeline_case_ts
  ON case_timeline (case_id, ts DESC);

-- Evidence (photos/docs)
CREATE TABLE IF NOT EXISTS evidence (
  evidence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
  type evidence_type NOT NULL,
  uploader_role user_role NOT NULL,
  uploader_user_id uuid REFERENCES users(user_id) ON DELETE SET NULL,
  storage_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evidence_case_created
  ON evidence (case_id, created_at DESC);

-- Evidence access log (view audit)
CREATE TABLE IF NOT EXISTS evidence_access_logs (
  log_id bigserial PRIMARY KEY,
  evidence_id uuid NOT NULL REFERENCES evidence(evidence_id) ON DELETE CASCADE,
  viewer_user_id uuid REFERENCES users(user_id) ON DELETE SET NULL,
  viewer_role user_role,
  ts timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evidence_access_evidence_ts
  ON evidence_access_logs (evidence_id, ts DESC);

-- OTP challenge
CREATE TABLE IF NOT EXISTS otp_challenges (
  case_id uuid PRIMARY KEY REFERENCES cases(case_id) ON DELETE CASCADE,
  otp_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempt_count int NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  verified_at timestamptz
);

-- Technical opinion report (non-legal)
CREATE TABLE IF NOT EXISTS tech_opinion_reports (
  case_id uuid PRIMARY KEY REFERENCES cases(case_id) ON DELETE CASCADE,
  cause cause_category NOT NULL,
  basis_text text NOT NULL,
  confidence confidence_level NOT NULL,
  signed_at timestamptz NOT NULL DEFAULT now(),
  disclaimer text NOT NULL DEFAULT 'This is a technical opinion and not a legal determination.'
);

-- Accruals (receivables; created when callcenter accepts)
CREATE TABLE IF NOT EXISTS accruals (
  accrual_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
  amount int NOT NULL CHECK (amount > 0),
  event_type text NOT NULL DEFAULT 'CASE_ACCEPTED',
  status accrual_status NOT NULL DEFAULT 'ACCRUED',
  created_at timestamptz NOT NULL DEFAULT now(),
  void_reason text
);

-- Ensure 1 accrual per case per event_type (idempotency)
CREATE UNIQUE INDEX IF NOT EXISTS uq_accruals_case_event
  ON accruals (case_id, event_type);

CREATE INDEX IF NOT EXISTS idx_accruals_org_created
  ON accruals (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_accruals_org_status
  ON accruals (org_id, status);

-- Invoices (bulk billing later)
CREATE TABLE IF NOT EXISTS invoices (
  invoice_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  total_amount int NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  status invoice_status NOT NULL DEFAULT 'DRAFT',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoices_period CHECK (period_start <= period_end)
);

CREATE INDEX IF NOT EXISTS idx_invoices_org_created
  ON invoices (org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS invoice_lines (
  invoice_line_id bigserial PRIMARY KEY,
  invoice_id uuid NOT NULL REFERENCES invoices(invoice_id) ON DELETE CASCADE,
  accrual_id uuid NOT NULL REFERENCES accruals(accrual_id) ON DELETE RESTRICT,
  amount int NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, accrual_id)
);

-- Audit events (global)
CREATE TABLE IF NOT EXISTS audit_events (
  event_id bigserial PRIMARY KEY,
  ts timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid REFERENCES users(user_id) ON DELETE SET NULL,
  actor_role user_role,
  actor_org_id uuid REFERENCES orgs(org_id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_audit_actor_ts
  ON audit_events (actor_user_id, ts DESC);

CREATE INDEX IF NOT EXISTS idx_audit_target
  ON audit_events (target_type, target_id);

CREATE INDEX IF NOT EXISTS idx_audit_action_ts
  ON audit_events (action, ts DESC);

-- Simple updated_at trigger helper
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_cases_updated_at ON cases;
CREATE TRIGGER trg_cases_updated_at
BEFORE UPDATE ON cases
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
