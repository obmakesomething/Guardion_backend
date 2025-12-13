import { query } from '../../db/pool';
import { TechOpinionReport, Case, CaseStatus, AuditAction } from '../../types';
import { NotFoundError, ForbiddenError, BadRequestError, ConflictError } from '../../lib/errors';
import { logAuditEvent, AuditContext } from '../audit';
import { SubmitOpinionInput } from './opinion.schema';

const DEFAULT_DISCLAIMER = 'This is a technical opinion and not a legal determination.';

/**
 * Submit technical opinion report (tech)
 */
export async function submitOpinion(
  caseId: string,
  input: SubmitOpinionInput,
  techId: string,
  auditContext: AuditContext
): Promise<TechOpinionReport> {
  // Get case
  const caseResult = await query<Case>(
    'SELECT * FROM cases WHERE case_id = $1',
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

  // Case should be completed or at least OTP_PENDING
  const allowedStatuses: CaseStatus[] = [CaseStatus.OTP_PENDING, CaseStatus.COMPLETED];
  if (!allowedStatuses.includes(currentCase.status)) {
    throw new BadRequestError(`Cannot submit opinion for case with status ${currentCase.status}`);
  }

  // Check if opinion already exists
  const existingResult = await query<TechOpinionReport>(
    'SELECT * FROM tech_opinion_reports WHERE case_id = $1',
    [caseId]
  );

  if (existingResult.rows.length > 0) {
    throw new ConflictError('Opinion report already submitted for this case');
  }

  // Insert opinion
  const result = await query<TechOpinionReport>(
    `INSERT INTO tech_opinion_reports (case_id, cause, basis_text, confidence, disclaimer)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [caseId, input.cause_category, input.basis_text, input.confidence, DEFAULT_DISCLAIMER]
  );

  const opinion = result.rows[0];

  // Audit log
  await logAuditEvent({
    ...auditContext,
    action: AuditAction.OPINION_SUBMITTED,
    target_type: 'tech_opinion_report',
    target_id: caseId,
    payload: { cause_category: input.cause_category, confidence: input.confidence },
  });

  return opinion;
}

/**
 * Get opinion report for a case
 */
export async function getOpinionReport(caseId: string): Promise<TechOpinionReport | null> {
  const result = await query<TechOpinionReport>(
    'SELECT * FROM tech_opinion_reports WHERE case_id = $1',
    [caseId]
  );
  return result.rows[0] || null;
}

/**
 * Get report link (includes opinion + evidence package)
 */
export async function getReportLink(
  caseId: string,
  viewerUserId: string,
  viewerRole: string
): Promise<{ case_id: string; report_url: string } | null> {
  // Get case
  const caseResult = await query<Case>(
    'SELECT * FROM cases WHERE case_id = $1',
    [caseId]
  );

  if (caseResult.rows.length === 0) {
    return null;
  }

  const currentCase = caseResult.rows[0];

  // Check access - customer can only see their own case, callcenter/admin can see all
  if (viewerRole === 'customer' && currentCase.customer_id !== viewerUserId) {
    throw new ForbiddenError('Cannot access this report');
  }

  // Get opinion
  const opinionResult = await query<TechOpinionReport>(
    'SELECT * FROM tech_opinion_reports WHERE case_id = $1',
    [caseId]
  );

  if (opinionResult.rows.length === 0) {
    return null;
  }

  // In production, generate a signed report URL or PDF
  // For MVP, return a simple link pattern
  const reportUrl = `/api/reports/${caseId}`;

  return {
    case_id: caseId,
    report_url: reportUrl,
  };
}
