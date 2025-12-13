import bcrypt from 'bcrypt';
import { query, withTransaction } from '../../db/pool';
import { OtpChallenge, Case, CaseStatus, AuditAction } from '../../types';
import { NotFoundError, ForbiddenError, BadRequestError } from '../../lib/errors';
import { logAuditEvent, AuditContext } from '../audit';
import { config } from '../../config';
import { eventEmitter, CaseEventType } from '../realtime/eventEmitter';
import { completeCaseAfterOtp } from '../case/case.service';

const SALT_ROUNDS = 10;

/**
 * Generate a random OTP code
 */
function generateOtpCode(length: number): string {
  const digits = '0123456789';
  let otp = '';
  for (let i = 0; i < length; i++) {
    otp += digits[Math.floor(Math.random() * digits.length)];
  }
  return otp;
}

/**
 * Request OTP (tech triggers, sends to customer)
 */
export async function requestOtp(
  caseId: string,
  techId: string,
  auditContext: AuditContext
): Promise<{ case_id: string; expires_at: Date }> {
  return withTransaction(async (client) => {
    // Get case
    const caseResult = await client.query<Case>(
      'SELECT * FROM cases WHERE case_id = $1 FOR UPDATE',
      [caseId]
    );

    if (caseResult.rows.length === 0) {
      throw new NotFoundError('Case', caseId);
    }

    const currentCase = caseResult.rows[0];

    // Verify tech is assigned
    if (currentCase.assigned_tech_id !== techId) {
      throw new ForbiddenError('You are not assigned to this case');
    }

    // Case must be in WORKING status (or transition to OTP_PENDING)
    if (currentCase.status !== CaseStatus.WORKING && currentCase.status !== CaseStatus.OTP_PENDING) {
      throw new BadRequestError(`Cannot request OTP for case with status ${currentCase.status}`);
    }

    // Generate OTP
    const otpCode = generateOtpCode(config.otp.length);
    const otpHash = await bcrypt.hash(otpCode, SALT_ROUNDS);
    const expiresAt = new Date(Date.now() + config.otp.expiresMinutes * 60 * 1000);

    // Upsert OTP challenge
    await client.query(
      `INSERT INTO otp_challenges (case_id, otp_hash, expires_at, attempt_count)
       VALUES ($1, $2, $3, 0)
       ON CONFLICT (case_id) DO UPDATE SET
         otp_hash = $2,
         expires_at = $3,
         attempt_count = 0,
         verified_at = NULL`,
      [caseId, otpHash, expiresAt]
    );

    // Update case status to OTP_PENDING if not already
    if (currentCase.status === CaseStatus.WORKING) {
      await client.query(
        "UPDATE cases SET status = 'OTP_PENDING', updated_at = now() WHERE case_id = $1",
        [caseId]
      );

      // Add timeline event
      await client.query(
        `INSERT INTO case_timeline (case_id, event_type, actor_user_id, actor_role, payload)
         VALUES ($1, 'OTP_REQUESTED', $2, $3, $4)`,
        [caseId, auditContext.actor_user_id, auditContext.actor_role, '{}']
      );
    }

    // Audit log
    await logAuditEvent({
      ...auditContext,
      action: AuditAction.OTP_REQUESTED,
      target_type: 'case',
      target_id: caseId,
      payload: { expires_at: expiresAt.toISOString() },
    });

    // Emit realtime event
    eventEmitter.emitCaseEvent(caseId, CaseEventType.OTP_REQUESTED, {
      case_id: caseId,
      expires_at: expiresAt,
    });

    // In production, send OTP to customer via SMS
    // For MVP, log it (in dev) or use SMS service
    console.log(`[OTP] Case ${caseId}: OTP code is ${otpCode} (expires at ${expiresAt.toISOString()})`);

    return {
      case_id: caseId,
      expires_at: expiresAt,
    };
  });
}

/**
 * Verify OTP (customer enters code)
 */
export async function verifyOtp(
  caseId: string,
  otpCode: string,
  customerId: string,
  auditContext: AuditContext
): Promise<{ ok: boolean; case: Case }> {
  return withTransaction(async (client) => {
    // Get case
    const caseResult = await client.query<Case>(
      'SELECT * FROM cases WHERE case_id = $1 FOR UPDATE',
      [caseId]
    );

    if (caseResult.rows.length === 0) {
      throw new NotFoundError('Case', caseId);
    }

    const currentCase = caseResult.rows[0];

    // Verify customer owns this case
    if (currentCase.customer_id !== customerId) {
      throw new ForbiddenError('This is not your case');
    }

    // Case must be in OTP_PENDING status
    if (currentCase.status !== CaseStatus.OTP_PENDING) {
      throw new BadRequestError(`Cannot verify OTP for case with status ${currentCase.status}`);
    }

    // Get OTP challenge
    const challengeResult = await client.query<OtpChallenge>(
      'SELECT * FROM otp_challenges WHERE case_id = $1 FOR UPDATE',
      [caseId]
    );

    if (challengeResult.rows.length === 0) {
      throw new BadRequestError('No OTP challenge found. Please request a new OTP.');
    }

    const challenge = challengeResult.rows[0];

    // Check if already verified
    if (challenge.verified_at) {
      // Case should already be completed, but return success anyway
      return { ok: true, case: currentCase };
    }

    // Check expiration
    if (new Date() > new Date(challenge.expires_at)) {
      await logAuditEvent({
        ...auditContext,
        action: AuditAction.OTP_VERIFIED_FAIL,
        target_type: 'case',
        target_id: caseId,
        payload: { reason: 'expired' },
      });

      throw new BadRequestError('OTP has expired. Please request a new one.');
    }

    // Check max attempts
    if (challenge.attempt_count >= config.otp.maxAttempts) {
      await logAuditEvent({
        ...auditContext,
        action: AuditAction.OTP_VERIFIED_FAIL,
        target_type: 'case',
        target_id: caseId,
        payload: { reason: 'max_attempts' },
      });

      throw new BadRequestError('Maximum OTP attempts exceeded. Please request a new OTP.');
    }

    // Increment attempt count
    await client.query(
      'UPDATE otp_challenges SET attempt_count = attempt_count + 1 WHERE case_id = $1',
      [caseId]
    );

    // Verify OTP
    const isValid = await bcrypt.compare(otpCode, challenge.otp_hash);

    if (!isValid) {
      await logAuditEvent({
        ...auditContext,
        action: AuditAction.OTP_VERIFIED_FAIL,
        target_type: 'case',
        target_id: caseId,
        payload: { reason: 'invalid_code', attempt: challenge.attempt_count + 1 },
      });

      throw new BadRequestError('Invalid OTP code');
    }

    // Mark as verified
    await client.query(
      'UPDATE otp_challenges SET verified_at = now() WHERE case_id = $1',
      [caseId]
    );

    // Complete the case
    const completedCase = await completeCaseAfterOtp(caseId, auditContext);

    // Audit log
    await logAuditEvent({
      ...auditContext,
      action: AuditAction.OTP_VERIFIED_SUCCESS,
      target_type: 'case',
      target_id: caseId,
      payload: {},
    });

    // Emit realtime event
    eventEmitter.emitCaseEvent(caseId, CaseEventType.OTP_VERIFIED, {
      case_id: caseId,
      success: true,
    });

    return { ok: true, case: completedCase };
  });
}

/**
 * Get OTP challenge status (without exposing hash)
 */
export async function getOtpStatus(caseId: string): Promise<{
  exists: boolean;
  expires_at: Date | null;
  attempts: number;
  verified: boolean;
} | null> {
  const result = await query<OtpChallenge>(
    'SELECT * FROM otp_challenges WHERE case_id = $1',
    [caseId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const challenge = result.rows[0];

  return {
    exists: true,
    expires_at: challenge.expires_at,
    attempts: challenge.attempt_count,
    verified: challenge.verified_at !== null,
  };
}
