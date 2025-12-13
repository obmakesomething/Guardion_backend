import { CaseStatus, TERMINAL_STATUSES } from '../../types';
import { InvalidStateTransitionError } from '../../lib/errors';

/**
 * Case State Machine
 *
 * Valid transitions:
 *
 * SUBMITTED → DISPATCHING (risk gate passed)
 * SUBMITTED → NEED_APPROVAL (risk gate: needs approval)
 * SUBMITTED → REJECTED (risk gate: rejected)
 * SUBMITTED → CANCELLED (customer/callcenter cancel)
 *
 * NEED_APPROVAL → DISPATCHING (approval granted)
 * NEED_APPROVAL → REJECTED (approval denied)
 * NEED_APPROVAL → CANCELLED
 *
 * DISPATCHING → ACCEPTED (callcenter accepts)
 * DISPATCHING → CANCELLED
 * DISPATCHING → EXPIRED (timeout)
 *
 * ACCEPTED → ASSIGNED (tech assigned)
 * ACCEPTED → CANCELLED
 *
 * ASSIGNED → EN_ROUTE (tech starts travel)
 * ASSIGNED → CANCELLED
 * ASSIGNED → FAILED (tech no-show)
 *
 * EN_ROUTE → ARRIVED (tech arrives)
 * EN_ROUTE → CANCELLED
 * EN_ROUTE → FAILED
 *
 * ARRIVED → WORKING (tech starts work)
 * ARRIVED → CANCELLED
 * ARRIVED → FAILED
 *
 * WORKING → OTP_PENDING (tech requests OTP)
 * WORKING → FAILED
 *
 * OTP_PENDING → COMPLETED (OTP verified)
 * OTP_PENDING → FAILED (OTP max attempts / timeout)
 *
 * Terminal states: COMPLETED, CANCELLED, EXPIRED, REJECTED, FAILED
 */

// Define valid transitions as a map
const VALID_TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  [CaseStatus.SUBMITTED]: [
    CaseStatus.DISPATCHING,
    CaseStatus.NEED_APPROVAL,
    CaseStatus.REJECTED,
    CaseStatus.CANCELLED,
  ],
  [CaseStatus.NEED_APPROVAL]: [
    CaseStatus.DISPATCHING,
    CaseStatus.REJECTED,
    CaseStatus.CANCELLED,
  ],
  [CaseStatus.DISPATCHING]: [
    CaseStatus.ACCEPTED,
    CaseStatus.CANCELLED,
    CaseStatus.EXPIRED,
  ],
  [CaseStatus.ACCEPTED]: [
    CaseStatus.ASSIGNED,
    CaseStatus.CANCELLED,
  ],
  [CaseStatus.ASSIGNED]: [
    CaseStatus.EN_ROUTE,
    CaseStatus.CANCELLED,
    CaseStatus.FAILED,
  ],
  [CaseStatus.EN_ROUTE]: [
    CaseStatus.ARRIVED,
    CaseStatus.CANCELLED,
    CaseStatus.FAILED,
  ],
  [CaseStatus.ARRIVED]: [
    CaseStatus.WORKING,
    CaseStatus.CANCELLED,
    CaseStatus.FAILED,
  ],
  [CaseStatus.WORKING]: [
    CaseStatus.OTP_PENDING,
    CaseStatus.FAILED,
  ],
  [CaseStatus.OTP_PENDING]: [
    CaseStatus.COMPLETED,
    CaseStatus.FAILED,
  ],
  // Terminal states have no valid transitions
  [CaseStatus.COMPLETED]: [],
  [CaseStatus.CANCELLED]: [],
  [CaseStatus.EXPIRED]: [],
  [CaseStatus.REJECTED]: [],
  [CaseStatus.FAILED]: [],
};

/**
 * Check if a status transition is valid
 */
export function isValidTransition(from: CaseStatus, to: CaseStatus): boolean {
  const validTargets = VALID_TRANSITIONS[from];
  return validTargets?.includes(to) ?? false;
}

/**
 * Validate and return the transition, or throw if invalid
 */
export function validateTransition(from: CaseStatus, to: CaseStatus): void {
  if (!isValidTransition(from, to)) {
    const reason = TERMINAL_STATUSES.includes(from)
      ? 'Case is in terminal state'
      : `${to} is not a valid next state from ${from}`;
    throw new InvalidStateTransitionError(from, to, reason);
  }
}

/**
 * Get valid next statuses from current status
 */
export function getValidNextStatuses(current: CaseStatus): CaseStatus[] {
  return VALID_TRANSITIONS[current] ?? [];
}

/**
 * Check if a status is terminal (no more transitions possible)
 */
export function isTerminalStatus(status: CaseStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Check if case can be cancelled from current status
 */
export function canCancel(status: CaseStatus): boolean {
  return VALID_TRANSITIONS[status]?.includes(CaseStatus.CANCELLED) ?? false;
}

/**
 * Statuses where tech can update status (EN_ROUTE, ARRIVED, WORKING, OTP_PENDING)
 */
export const TECH_UPDATABLE_STATUSES: CaseStatus[] = [
  CaseStatus.ASSIGNED,
  CaseStatus.EN_ROUTE,
  CaseStatus.ARRIVED,
  CaseStatus.WORKING,
];

/**
 * Check if tech can update case status
 */
export function canTechUpdateStatus(currentStatus: CaseStatus): boolean {
  return TECH_UPDATABLE_STATUSES.includes(currentStatus);
}

/**
 * Status progression for tech (order matters)
 */
export const TECH_STATUS_PROGRESSION: CaseStatus[] = [
  CaseStatus.ASSIGNED,
  CaseStatus.EN_ROUTE,
  CaseStatus.ARRIVED,
  CaseStatus.WORKING,
  CaseStatus.OTP_PENDING,
];

/**
 * Get the next expected status in tech progression
 */
export function getNextTechStatus(current: CaseStatus): CaseStatus | null {
  const idx = TECH_STATUS_PROGRESSION.indexOf(current);
  if (idx === -1 || idx >= TECH_STATUS_PROGRESSION.length - 1) {
    return null;
  }
  return TECH_STATUS_PROGRESSION[idx + 1];
}
