-- OpenNow AI Database Schema
-- Emergency Locksmith Matching Service

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- Seoul Districts Enum
CREATE TYPE seoul_district AS ENUM (
  'gangnam', 'gangdong', 'gangbuk', 'gangseo',
  'gwanak', 'gwangjin', 'guro', 'geumcheon',
  'nowon', 'dobong', 'dongdaemun', 'dongjak',
  'mapo', 'seodaemun', 'seocho', 'seongdong',
  'seongbuk', 'songpa', 'yangcheon', 'yeongdeungpo',
  'yongsan', 'eunpyeong', 'jongno', 'jung', 'jungnang'
);

-- Lock Type Enum
CREATE TYPE lock_type AS ENUM ('digital', 'mechanical', 'smart', 'padlock', 'unknown');

-- Lock Difficulty Enum
CREATE TYPE lock_difficulty AS ENUM ('easy', 'medium', 'hard', 'expert');

-- Match Status Enum
CREATE TYPE match_status AS ENUM ('pending', 'matching', 'matched', 'cancelled', 'expired', 'completed');

-- Notification Status Enum
CREATE TYPE notification_status AS ENUM ('pending', 'sent', 'delivered', 'failed');

-- =====================================================
-- TECHNICIANS (Affiliates)
-- =====================================================
CREATE TABLE technicians (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  phone VARCHAR(20) NOT NULL UNIQUE,
  district seoul_district NOT NULL,
  rating DECIMAL(2,1) DEFAULT 5.0,
  completed_jobs INTEGER DEFAULT 0,
  is_available BOOLEAN DEFAULT true,
  specialties lock_type[] DEFAULT ARRAY['digital', 'mechanical']::lock_type[],
  profile_image_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_active_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_technicians_district ON technicians(district);
CREATE INDEX idx_technicians_available ON technicians(is_available) WHERE is_available = true;
CREATE INDEX idx_technicians_rating ON technicians(rating DESC);

-- =====================================================
-- USERS (Customers)
-- =====================================================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone VARCHAR(20),
  chatgpt_user_id VARCHAR(255),
  name VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_chatgpt_id ON users(chatgpt_user_id);

-- =====================================================
-- LOCK ANALYSIS RESULTS
-- =====================================================
CREATE TABLE lock_analyses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  image_url TEXT,
  lock_type lock_type NOT NULL DEFAULT 'unknown',
  brand VARCHAR(100),
  model VARCHAR(100),
  difficulty lock_difficulty NOT NULL DEFAULT 'medium',
  estimated_time_minutes INTEGER DEFAULT 30,
  confidence INTEGER DEFAULT 50,
  raw_analysis JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- MATCH REQUESTS
-- =====================================================
CREATE TABLE match_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  district seoul_district NOT NULL,
  address_text TEXT,
  location_lat DECIMAL(10, 8),
  location_lng DECIMAL(11, 8),
  lock_analysis_id UUID REFERENCES lock_analyses(id),

  -- Pricing
  base_price INTEGER NOT NULL DEFAULT 80000,
  surcharge_approved BOOLEAN DEFAULT false,
  surcharge_amount INTEGER DEFAULT 5000,
  final_price INTEGER,

  -- Matching state
  current_level INTEGER DEFAULT 1 CHECK (current_level BETWEEN 1 AND 3),
  status match_status DEFAULT 'pending',
  matched_tech_id UUID REFERENCES technicians(id),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  level1_started_at TIMESTAMPTZ,
  level2_started_at TIMESTAMPTZ,
  level3_started_at TIMESTAMPTZ,
  matched_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,

  -- Metadata
  notes TEXT,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_match_requests_status ON match_requests(status);
CREATE INDEX idx_match_requests_district ON match_requests(district);
CREATE INDEX idx_match_requests_created ON match_requests(created_at DESC);

-- =====================================================
-- TECH NOTIFICATIONS (Dispatch Offers)
-- =====================================================
CREATE TABLE tech_notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_request_id UUID NOT NULL REFERENCES match_requests(id) ON DELETE CASCADE,
  tech_id UUID NOT NULL REFERENCES technicians(id),
  level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 3),

  -- Notification status
  status notification_status DEFAULT 'pending',
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  response VARCHAR(20), -- 'accepted', 'declined', 'expired'
  responded_at TIMESTAMPTZ,

  -- Solapi tracking
  solapi_message_id VARCHAR(100),
  solapi_group_id VARCHAR(100),

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tech_notifications_request ON tech_notifications(match_request_id);
CREATE INDEX idx_tech_notifications_tech ON tech_notifications(tech_id);
CREATE UNIQUE INDEX idx_tech_notifications_unique ON tech_notifications(match_request_id, tech_id);

-- =====================================================
-- PAYMENTS (Toss Payments)
-- =====================================================
CREATE TYPE payment_type AS ENUM ('callout', 'balance', 'surcharge');
CREATE TYPE payment_status AS ENUM ('pending', 'ready', 'completed', 'failed', 'cancelled', 'refunded');

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_request_id UUID REFERENCES match_requests(id) ON DELETE SET NULL,
  type payment_type NOT NULL,
  amount INTEGER NOT NULL,
  status payment_status DEFAULT 'pending',
  order_id VARCHAR(100) NOT NULL UNIQUE,
  payment_key VARCHAR(200),

  -- Fee breakdown
  platform_fee INTEGER DEFAULT 0,
  tech_share INTEGER DEFAULT 0,

  -- Toss payment details
  method VARCHAR(50),
  card_company VARCHAR(50),
  card_number VARCHAR(20),
  receipt_url TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,

  -- Metadata
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_payments_match_request ON payments(match_request_id);
CREATE INDEX idx_payments_order_id ON payments(order_id);
CREATE INDEX idx_payments_status ON payments(status);

-- =====================================================
-- SETTLEMENTS (정산)
-- =====================================================
CREATE TYPE settlement_status AS ENUM ('pending', 'processing', 'completed', 'failed');

CREATE TABLE settlements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tech_id UUID NOT NULL REFERENCES technicians(id),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,

  -- Amounts
  callout_total INTEGER DEFAULT 0,
  balance_total INTEGER DEFAULT 0,
  platform_fee_total INTEGER DEFAULT 0,
  net_amount INTEGER DEFAULT 0,

  -- Settlement details
  status settlement_status DEFAULT 'pending',
  bank_name VARCHAR(50),
  account_number VARCHAR(50),
  account_holder VARCHAR(100),

  -- Timestamps
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Metadata
  job_count INTEGER DEFAULT 0,
  payment_ids UUID[] DEFAULT '{}'
);

CREATE INDEX idx_settlements_tech ON settlements(tech_id);
CREATE INDEX idx_settlements_period ON settlements(period_start, period_end);

-- =====================================================
-- COMPLETED JOBS
-- =====================================================
CREATE TABLE completed_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_request_id UUID NOT NULL REFERENCES match_requests(id),
  tech_id UUID NOT NULL REFERENCES technicians(id),
  user_id UUID REFERENCES users(id),

  -- Job details
  actual_price INTEGER NOT NULL,
  arrival_time_minutes INTEGER,
  work_time_minutes INTEGER,

  -- Rating
  user_rating INTEGER CHECK (user_rating BETWEEN 1 AND 5),
  user_review TEXT,

  -- Timestamps
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ DEFAULT NOW(),

  -- Metadata
  photos JSONB DEFAULT '[]',
  notes TEXT
);

CREATE INDEX idx_completed_jobs_tech ON completed_jobs(tech_id);

-- =====================================================
-- AUDIT LOG
-- =====================================================
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50),
  entity_id UUID,
  actor_type VARCHAR(50), -- 'user', 'tech', 'system', 'chatgpt'
  actor_id VARCHAR(255),
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_log_created ON audit_log(created_at DESC);

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- Function to get adjacent districts
CREATE OR REPLACE FUNCTION get_adjacent_districts(district_name seoul_district)
RETURNS seoul_district[] AS $$
DECLARE
  result seoul_district[];
BEGIN
  CASE district_name
    WHEN 'gangnam' THEN result := ARRAY['seocho', 'songpa', 'gwangjin', 'seongdong', 'yongsan']::seoul_district[];
    WHEN 'gangdong' THEN result := ARRAY['songpa', 'gwangjin', 'jungnang']::seoul_district[];
    WHEN 'gangbuk' THEN result := ARRAY['dobong', 'nowon', 'seongbuk', 'eunpyeong']::seoul_district[];
    WHEN 'gangseo' THEN result := ARRAY['yangcheon', 'mapo', 'eunpyeong']::seoul_district[];
    WHEN 'gwanak' THEN result := ARRAY['dongjak', 'geumcheon', 'seocho', 'guro']::seoul_district[];
    WHEN 'gwangjin' THEN result := ARRAY['seongdong', 'dongdaemun', 'jungnang', 'gangdong', 'songpa', 'gangnam']::seoul_district[];
    WHEN 'guro' THEN result := ARRAY['geumcheon', 'yeongdeungpo', 'yangcheon', 'gwanak']::seoul_district[];
    WHEN 'geumcheon' THEN result := ARRAY['guro', 'gwanak', 'dongjak', 'yeongdeungpo']::seoul_district[];
    WHEN 'nowon' THEN result := ARRAY['dobong', 'gangbuk', 'seongbuk', 'jungnang']::seoul_district[];
    WHEN 'dobong' THEN result := ARRAY['gangbuk', 'nowon']::seoul_district[];
    WHEN 'dongdaemun' THEN result := ARRAY['jungnang', 'gwangjin', 'seongdong', 'jung', 'jongno', 'seongbuk']::seoul_district[];
    WHEN 'dongjak' THEN result := ARRAY['yeongdeungpo', 'yongsan', 'seocho', 'gwanak', 'geumcheon']::seoul_district[];
    WHEN 'mapo' THEN result := ARRAY['seodaemun', 'yongsan', 'yeongdeungpo', 'gangseo', 'eunpyeong']::seoul_district[];
    WHEN 'seodaemun' THEN result := ARRAY['eunpyeong', 'jongno', 'jung', 'yongsan', 'mapo']::seoul_district[];
    WHEN 'seocho' THEN result := ARRAY['gangnam', 'dongjak', 'gwanak', 'yongsan']::seoul_district[];
    WHEN 'seongdong' THEN result := ARRAY['dongdaemun', 'gwangjin', 'gangnam', 'yongsan', 'jung']::seoul_district[];
    WHEN 'seongbuk' THEN result := ARRAY['gangbuk', 'nowon', 'jungnang', 'dongdaemun', 'jongno']::seoul_district[];
    WHEN 'songpa' THEN result := ARRAY['gangdong', 'gwangjin', 'gangnam']::seoul_district[];
    WHEN 'yangcheon' THEN result := ARRAY['gangseo', 'guro', 'yeongdeungpo']::seoul_district[];
    WHEN 'yeongdeungpo' THEN result := ARRAY['yangcheon', 'guro', 'geumcheon', 'dongjak', 'yongsan', 'mapo']::seoul_district[];
    WHEN 'yongsan' THEN result := ARRAY['mapo', 'seodaemun', 'jung', 'seongdong', 'gangnam', 'seocho', 'dongjak', 'yeongdeungpo']::seoul_district[];
    WHEN 'eunpyeong' THEN result := ARRAY['gangbuk', 'jongno', 'seodaemun', 'mapo', 'gangseo']::seoul_district[];
    WHEN 'jongno' THEN result := ARRAY['eunpyeong', 'seongbuk', 'dongdaemun', 'jung', 'seodaemun']::seoul_district[];
    WHEN 'jung' THEN result := ARRAY['jongno', 'dongdaemun', 'seongdong', 'yongsan', 'seodaemun']::seoul_district[];
    WHEN 'jungnang' THEN result := ARRAY['nowon', 'seongbuk', 'dongdaemun', 'gwangjin', 'gangdong']::seoul_district[];
    ELSE result := ARRAY[]::seoul_district[];
  END CASE;
  RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to count available techs in a district
CREATE OR REPLACE FUNCTION count_available_techs(district_name seoul_district)
RETURNS INTEGER AS $$
  SELECT COUNT(*)::INTEGER
  FROM technicians
  WHERE district = district_name
    AND is_available = true;
$$ LANGUAGE sql STABLE;

-- =====================================================
-- SEED DATA: Initial Technicians for 성동구 and 관악구
-- =====================================================
INSERT INTO technicians (name, phone, district, rating, completed_jobs, specialties) VALUES
  -- 성동구 (Seongdong-gu)
  ('김철수', '01011112222', 'seongdong', 4.8, 150, ARRAY['digital', 'smart']::lock_type[]),
  ('이영희', '01022223333', 'seongdong', 4.9, 200, ARRAY['digital', 'mechanical', 'smart']::lock_type[]),
  ('박민수', '01033334444', 'seongdong', 4.7, 120, ARRAY['digital', 'mechanical']::lock_type[]),
  ('정수진', '01044445555', 'seongdong', 4.6, 80, ARRAY['mechanical', 'padlock']::lock_type[]),
  ('한상철', '01055556666', 'seongdong', 4.5, 60, ARRAY['digital']::lock_type[]),

  -- 관악구 (Gwanak-gu)
  ('최동현', '01066667777', 'gwanak', 4.9, 180, ARRAY['digital', 'smart', 'mechanical']::lock_type[]),
  ('강미영', '01077778888', 'gwanak', 4.8, 160, ARRAY['digital', 'mechanical']::lock_type[]),
  ('윤성호', '01088889999', 'gwanak', 4.7, 140, ARRAY['smart', 'digital']::lock_type[]),
  ('송지혜', '01099990000', 'gwanak', 4.6, 100, ARRAY['mechanical', 'padlock']::lock_type[]),
  ('임재현', '01012341234', 'gwanak', 4.5, 70, ARRAY['digital']::lock_type[]);
