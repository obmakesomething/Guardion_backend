import { v4 as uuidv4 } from 'uuid';
import AWS from 'aws-sdk';
import { query } from '../../db/pool';
import { Evidence, EvidenceAccessLog, Case, CaseStatus, UserRole, AuditAction, EvidenceType } from '../../types';
import { NotFoundError, ForbiddenError, BadRequestError } from '../../lib/errors';
import { logAuditEvent, AuditContext } from '../audit';
import { config } from '../../config';
import { eventEmitter, CaseEventType } from '../realtime/eventEmitter';
import { EvidencePresignInput, EvidenceCompleteInput } from './evidence.schema';

// Check if S3 is configured
const isS3Configured = !!(config.aws.accessKeyId && config.aws.secretAccessKey);

// Initialize S3 client only if configured
const s3 = isS3Configured
  ? new AWS.S3({
      region: config.aws.region,
      accessKeyId: config.aws.accessKeyId,
      secretAccessKey: config.aws.secretAccessKey,
    })
  : null;

/**
 * Generate presigned URL for evidence upload
 * Falls back to mock URL if S3 is not configured (for development/Railway without S3)
 */
export async function createPresignedUploadUrl(
  caseId: string,
  input: EvidencePresignInput,
  uploaderUserId: string,
  uploaderRole: UserRole
): Promise<{
  upload_url: string;
  method: string;
  headers: Record<string, string>;
  object_key: string;
  expires_at: Date;
}> {
  // Verify case exists
  const caseResult = await query<Case>(
    'SELECT * FROM cases WHERE case_id = $1',
    [caseId]
  );

  if (caseResult.rows.length === 0) {
    throw new NotFoundError('Case', caseId);
  }

  const currentCase = caseResult.rows[0];

  // Access control: who can upload
  if (uploaderRole === UserRole.CUSTOMER) {
    // Customer can only upload to their own case
    if (currentCase.customer_id !== uploaderUserId) {
      throw new ForbiddenError('Cannot upload evidence to another customer\'s case');
    }
  } else if (uploaderRole === UserRole.TECH) {
    // Tech can only upload to assigned cases
    if (currentCase.assigned_tech_id !== uploaderUserId) {
      throw new ForbiddenError('Cannot upload evidence to a case not assigned to you');
    }
  }
  // Callcenter and admin can upload to any case

  // Generate unique object key
  const ext = input.file_name.split('.').pop() || 'jpg';
  const objectKey = `cases/${caseId}/${input.type}/${uuidv4()}.${ext}`;

  // Generate presigned URL
  const expiresIn = 300; // 5 minutes
  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  let presignedUrl: string;

  if (s3) {
    // Use real S3
    presignedUrl = s3.getSignedUrl('putObject', {
      Bucket: config.aws.s3Bucket,
      Key: objectKey,
      ContentType: input.content_type,
      Expires: expiresIn,
    });
  } else {
    // Mock URL for development without S3
    // In production on Railway, you'd want to use Railway's volume or a different storage
    console.warn('[Evidence] S3 not configured, using mock presigned URL');
    presignedUrl = `/api/evidence/upload/${objectKey}`;
  }

  return {
    upload_url: presignedUrl,
    method: 'PUT',
    headers: {
      'Content-Type': input.content_type,
    },
    object_key: objectKey,
    expires_at: expiresAt,
  };
}

/**
 * Complete evidence upload (register metadata)
 */
export async function completeEvidenceUpload(
  caseId: string,
  input: EvidenceCompleteInput,
  uploaderUserId: string,
  uploaderRole: UserRole,
  auditContext: AuditContext
): Promise<Evidence> {
  // Verify case exists
  const caseResult = await query<Case>(
    'SELECT * FROM cases WHERE case_id = $1',
    [caseId]
  );

  if (caseResult.rows.length === 0) {
    throw new NotFoundError('Case', caseId);
  }

  // Create evidence record
  const evidenceId = uuidv4();

  const result = await query<Evidence>(
    `INSERT INTO evidence (evidence_id, case_id, type, uploader_role, uploader_user_id, storage_key)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [evidenceId, caseId, input.type, uploaderRole, uploaderUserId, input.object_key]
  );

  const evidence = result.rows[0];

  // Audit log
  await logAuditEvent({
    ...auditContext,
    action: AuditAction.EVIDENCE_UPLOADED,
    target_type: 'evidence',
    target_id: evidenceId,
    payload: { case_id: caseId, type: input.type },
  });

  // Emit realtime event
  eventEmitter.emitCaseEvent(caseId, CaseEventType.EVIDENCE_ADDED, {
    case_id: caseId,
    evidence_id: evidenceId,
    type: input.type,
    uploader_role: uploaderRole,
  });

  return evidence;
}

/**
 * Get evidence for a case (with access control)
 */
export async function getCaseEvidence(
  caseId: string,
  viewerUserId: string,
  viewerRole: UserRole,
  auditContext: AuditContext
): Promise<Evidence[]> {
  // Verify case exists
  const caseResult = await query<Case>(
    'SELECT * FROM cases WHERE case_id = $1',
    [caseId]
  );

  if (caseResult.rows.length === 0) {
    throw new NotFoundError('Case', caseId);
  }

  const currentCase = caseResult.rows[0];

  // Get evidence
  const evidenceResult = await query<Evidence>(
    'SELECT * FROM evidence WHERE case_id = $1 ORDER BY created_at DESC',
    [caseId]
  );

  // Filter and enrich based on viewer role
  const evidenceWithUrls: Evidence[] = [];

  for (const evidence of evidenceResult.rows) {
    const canView = checkEvidenceViewPermission(currentCase, evidence, viewerUserId, viewerRole);

    if (canView) {
      // Log access
      await logEvidenceAccess(evidence.evidence_id, viewerUserId, viewerRole, auditContext);

      // Generate signed view URL
      const viewUrl = generateViewUrl(evidence.storage_key);

      evidenceWithUrls.push({
        ...evidence,
        view_url: viewUrl,
      });
    }
  }

  return evidenceWithUrls;
}

/**
 * Get single evidence item with view URL
 */
export async function getEvidenceWithUrl(
  evidenceId: string,
  viewerUserId: string,
  viewerRole: UserRole,
  auditContext: AuditContext
): Promise<Evidence | null> {
  const evidenceResult = await query<Evidence>(
    'SELECT * FROM evidence WHERE evidence_id = $1',
    [evidenceId]
  );

  if (evidenceResult.rows.length === 0) {
    return null;
  }

  const evidence = evidenceResult.rows[0];

  // Get case for access control
  const caseResult = await query<Case>(
    'SELECT * FROM cases WHERE case_id = $1',
    [evidence.case_id]
  );

  if (caseResult.rows.length === 0) {
    return null;
  }

  const currentCase = caseResult.rows[0];

  const canView = checkEvidenceViewPermission(currentCase, evidence, viewerUserId, viewerRole);

  if (!canView) {
    throw new ForbiddenError('Cannot view this evidence');
  }

  // Log access
  await logEvidenceAccess(evidenceId, viewerUserId, viewerRole, auditContext);

  // Generate signed view URL
  const viewUrl = generateViewUrl(evidence.storage_key);

  return {
    ...evidence,
    view_url: viewUrl,
  };
}

/**
 * Generate view URL (S3 or mock)
 */
function generateViewUrl(storageKey: string): string {
  if (s3) {
    return s3.getSignedUrl('getObject', {
      Bucket: config.aws.s3Bucket,
      Key: storageKey,
      Expires: 3600, // 1 hour
    });
  } else {
    // Mock URL for development without S3
    return `/api/evidence/view/${storageKey}`;
  }
}

/**
 * Check if viewer has permission to view evidence
 */
function checkEvidenceViewPermission(
  caseData: Case,
  evidence: Evidence,
  viewerUserId: string,
  viewerRole: UserRole
): boolean {
  // Admin can view all
  if (viewerRole === UserRole.ADMIN) {
    return true;
  }

  // Callcenter can view all (needed for triage)
  if (viewerRole === UserRole.CALLCENTER) {
    return true;
  }

  // Customer can view evidence from their own case
  if (viewerRole === UserRole.CUSTOMER) {
    return caseData.customer_id === viewerUserId;
  }

  // Tech can only view after assignment
  if (viewerRole === UserRole.TECH) {
    // Must be assigned to this case
    if (caseData.assigned_tech_id !== viewerUserId) {
      return false;
    }

    // Case must be in ASSIGNED or later status
    const assignedStatuses: CaseStatus[] = [
      CaseStatus.ASSIGNED,
      CaseStatus.EN_ROUTE,
      CaseStatus.ARRIVED,
      CaseStatus.WORKING,
      CaseStatus.OTP_PENDING,
      CaseStatus.COMPLETED,
    ];

    return assignedStatuses.includes(caseData.status);
  }

  return false;
}

/**
 * Log evidence access
 */
async function logEvidenceAccess(
  evidenceId: string,
  viewerUserId: string,
  viewerRole: UserRole,
  auditContext: AuditContext
): Promise<void> {
  // Insert access log
  await query(
    `INSERT INTO evidence_access_logs (evidence_id, viewer_user_id, viewer_role)
     VALUES ($1, $2, $3)`,
    [evidenceId, viewerUserId, viewerRole]
  );

  // Audit event
  await logAuditEvent({
    ...auditContext,
    action: AuditAction.EVIDENCE_VIEWED,
    target_type: 'evidence',
    target_id: evidenceId,
    payload: { viewer_user_id: viewerUserId, viewer_role: viewerRole },
  });
}

/**
 * Get evidence access logs
 */
export async function getEvidenceAccessLogs(evidenceId: string): Promise<EvidenceAccessLog[]> {
  const result = await query<EvidenceAccessLog>(
    'SELECT * FROM evidence_access_logs WHERE evidence_id = $1 ORDER BY ts DESC',
    [evidenceId]
  );
  return result.rows;
}
