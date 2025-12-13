import {
  UserRole,
  CaseStatus,
  EvidenceType,
  DispatchOfferStatus,
  ConfidenceLevel,
  CauseCategory,
  AccrualStatus,
  InvoiceStatus,
  AuditAction,
} from './enums';

// Organization
export interface Org {
  org_id: string;
  name: string;
  created_at: Date;
}

// User
export interface User {
  user_id: string;
  role: UserRole;
  email: string | null;
  password_hash: string | null;
  phone: string | null;
  phone_verified_at: Date | null;
  display_name: string | null;
  created_at: Date;
  updated_at: Date;
}

// User without sensitive fields (for API responses)
export interface UserPublic {
  user_id: string;
  role: UserRole;
  email: string | null;
  phone: string | null;
  display_name: string | null;
}

// Org membership
export interface OrgMembership {
  org_id: string;
  user_id: string;
  scope: string;
  created_at: Date;
}

// Case
export interface Case {
  case_id: string;
  status: CaseStatus;
  risk_level: number;
  customer_id: string | null;
  customer_phone: string;
  address_text: string;
  location_lat: number;
  location_lng: number;
  place_note: string | null;
  symptom_note: string | null;
  assigned_org_id: string | null;
  assigned_tech_id: string | null;
  accepted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// Case detail (with computed fields)
export interface CaseDetail extends Case {
  eta_seconds: number | null;
  tech_summary: {
    tech_id: string;
    display_name: string;
    phone_relay: string | null;
  } | null;
  evidence: Evidence[];
}

// Dispatch offer
export interface DispatchOffer {
  offer_id: string;
  case_id: string;
  tech_id: string;
  status: DispatchOfferStatus;
  created_at: Date;
  responded_at: Date | null;
}

// Tech availability
export interface TechAvailability {
  tech_id: string;
  is_online: boolean;
  is_busy: boolean;
  updated_at: Date;
}

// Tech location ping
export interface TechLocationPing {
  ping_id: string;
  tech_id: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  ts: Date;
}

// Case timeline
export interface CaseTimeline {
  timeline_id: string;
  case_id: string;
  event_type: string;
  actor_user_id: string | null;
  actor_role: UserRole | null;
  payload: Record<string, unknown>;
  ts: Date;
}

// Evidence
export interface Evidence {
  evidence_id: string;
  case_id: string;
  type: EvidenceType;
  uploader_role: UserRole;
  uploader_user_id: string | null;
  storage_key: string;
  created_at: Date;
  view_url?: string | null; // Signed URL when viewer has permission
}

// Evidence access log
export interface EvidenceAccessLog {
  log_id: string;
  evidence_id: string;
  viewer_user_id: string | null;
  viewer_role: UserRole | null;
  ts: Date;
}

// OTP challenge
export interface OtpChallenge {
  case_id: string;
  otp_hash: string;
  expires_at: Date;
  attempt_count: number;
  verified_at: Date | null;
}

// Tech opinion report
export interface TechOpinionReport {
  case_id: string;
  cause: CauseCategory;
  basis_text: string;
  confidence: ConfidenceLevel;
  signed_at: Date;
  disclaimer: string;
}

// Accrual
export interface Accrual {
  accrual_id: string;
  org_id: string;
  case_id: string;
  amount: number;
  event_type: string;
  status: AccrualStatus;
  created_at: Date;
  void_reason: string | null;
}

// Invoice
export interface Invoice {
  invoice_id: string;
  org_id: string;
  period_start: Date;
  period_end: Date;
  total_amount: number;
  status: InvoiceStatus;
  created_at: Date;
}

// Invoice line
export interface InvoiceLine {
  invoice_line_id: string;
  invoice_id: string;
  accrual_id: string;
  amount: number;
  created_at: Date;
}

// Invoice with lines
export interface InvoiceWithLines extends Invoice {
  lines: { accrual_id: string; amount: number }[];
}

// Audit event
export interface AuditEvent {
  event_id: string;
  ts: Date;
  actor_user_id: string | null;
  actor_role: UserRole | null;
  actor_org_id: string | null;
  action: AuditAction;
  target_type: string;
  target_id: string;
  payload: Record<string, unknown>;
}
