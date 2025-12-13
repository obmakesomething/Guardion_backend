// User roles
export const UserRole = {
  CUSTOMER: 'customer',
  CALLCENTER: 'callcenter',
  TECH: 'tech',
  ADMIN: 'admin',
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];

// Case statuses
export const CaseStatus = {
  SUBMITTED: 'SUBMITTED',
  NEED_APPROVAL: 'NEED_APPROVAL',
  DISPATCHING: 'DISPATCHING',
  ACCEPTED: 'ACCEPTED',
  ASSIGNED: 'ASSIGNED',
  EN_ROUTE: 'EN_ROUTE',
  ARRIVED: 'ARRIVED',
  WORKING: 'WORKING',
  OTP_PENDING: 'OTP_PENDING',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
  REJECTED: 'REJECTED',
  FAILED: 'FAILED',
} as const;

export type CaseStatus = (typeof CaseStatus)[keyof typeof CaseStatus];

// Terminal statuses (case cannot transition from these)
export const TERMINAL_STATUSES: CaseStatus[] = [
  CaseStatus.COMPLETED,
  CaseStatus.CANCELLED,
  CaseStatus.EXPIRED,
  CaseStatus.REJECTED,
  CaseStatus.FAILED,
];

// Evidence types
export const EvidenceType = {
  DOOR: 'door',
  LOCK: 'lock',
  KEY: 'key',
  OTHER: 'other',
} as const;

export type EvidenceType = (typeof EvidenceType)[keyof typeof EvidenceType];

// Dispatch offer statuses
export const DispatchOfferStatus = {
  SENT: 'SENT',
  ACCEPTED: 'ACCEPTED',
  DECLINED: 'DECLINED',
  EXPIRED: 'EXPIRED',
} as const;

export type DispatchOfferStatus = (typeof DispatchOfferStatus)[keyof typeof DispatchOfferStatus];

// Risk decision
export const RiskDecision = {
  PROCEED: 'PROCEED',
  NEED_APPROVAL: 'NEED_APPROVAL',
  REJECT: 'REJECT',
} as const;

export type RiskDecision = (typeof RiskDecision)[keyof typeof RiskDecision];

// Confidence level
export const ConfidenceLevel = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
} as const;

export type ConfidenceLevel = (typeof ConfidenceLevel)[keyof typeof ConfidenceLevel];

// Cause category
export const CauseCategory = {
  SUSPECTED_DEFECT: 'suspected_defect',
  SUSPECTED_USER_ISSUE: 'suspected_user_issue',
  UNKNOWN: 'unknown',
} as const;

export type CauseCategory = (typeof CauseCategory)[keyof typeof CauseCategory];

// Accrual status
export const AccrualStatus = {
  ACCRUED: 'ACCRUED',
  VOIDED: 'VOIDED',
  INVOICED: 'INVOICED',
} as const;

export type AccrualStatus = (typeof AccrualStatus)[keyof typeof AccrualStatus];

// Invoice status
export const InvoiceStatus = {
  DRAFT: 'DRAFT',
  SENT: 'SENT',
  PAID: 'PAID',
} as const;

export type InvoiceStatus = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];

// Audit event actions
export const AuditAction = {
  // Case lifecycle
  CASE_CREATED: 'CASE_CREATED',
  CASE_SUBMITTED: 'CASE_SUBMITTED',
  CASE_STATUS_CHANGED: 'CASE_STATUS_CHANGED',

  // Risk
  RISK_SET: 'RISK_SET',
  APPROVAL_REQUESTED: 'APPROVAL_REQUESTED',
  APPROVAL_RESOLVED: 'APPROVAL_RESOLVED',

  // Dispatch
  DISPATCH_OFFER_SENT: 'DISPATCH_OFFER_SENT',
  DISPATCH_OFFER_RESPONDED: 'DISPATCH_OFFER_RESPONDED',
  CASE_ACCEPTED: 'CASE_ACCEPTED',
  CASE_ASSIGNED: 'CASE_ASSIGNED',

  // Location
  TECH_LOCATION_PINGED: 'TECH_LOCATION_PINGED',

  // Evidence
  EVIDENCE_UPLOADED: 'EVIDENCE_UPLOADED',
  EVIDENCE_VIEWED: 'EVIDENCE_VIEWED',

  // OTP
  OTP_REQUESTED: 'OTP_REQUESTED',
  OTP_VERIFIED_SUCCESS: 'OTP_VERIFIED_SUCCESS',
  OTP_VERIFIED_FAIL: 'OTP_VERIFIED_FAIL',

  // Opinion
  OPINION_SUBMITTED: 'OPINION_SUBMITTED',

  // Billing
  ACCRUAL_CREATED: 'ACCRUAL_CREATED',
  ACCRUAL_VOIDED: 'ACCRUAL_VOIDED',
  INVOICE_GENERATED: 'INVOICE_GENERATED',

  // Auth
  USER_LOGIN: 'USER_LOGIN',
  USER_LOGOUT: 'USER_LOGOUT',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
} as const;

export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];
