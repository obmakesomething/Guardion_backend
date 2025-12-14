import { v4 as uuidv4 } from 'uuid';
import { PoolClient } from 'pg';
import { query, withTransaction } from '../../db/pool';
import { Case, CaseDetail, CaseStatus, UserRole, AuditAction, RiskDecision, Evidence } from '../../types';
import { NotFoundError, ForbiddenError, BadRequestError } from '../../lib/errors';
import { logAuditEvent, AuditContext } from '../audit';
import { validateTransition, canCancel, canTechUpdateStatus } from './case.stateMachine';
import { CreateCaseInput, SetRiskInput, UpdateCaseStatusInput, GetCasesQuery } from './case.schema';
import { eventEmitter, CaseEventType } from '../realtime/eventEmitter';

/**
 * Create a new case (customer)
 */
export async function createCase(
  input: CreateCaseInput,
  customerId: string | null,
  auditContext: AuditContext
): Promise<Case> {
  const caseId = uuidv4();

  const result = await query<Case>(
    `INSERT INTO cases (case_id, customer_id, customer_phone, address_text, location_lat, location_lng, place_note, symptom_note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      caseId,
      customerId,
      input.customer_phone,
      input.address_text,
      input.location_lat,
      input.location_lng,
      input.place_note || null,
      input.symptom_note || null,
    ]
  );

  const newCase = result.rows[0];

  // Add to timeline
  await addCaseTimelineEvent(caseId, 'CASE_CREATED', auditContext, { input });

  // Audit log
  await logAuditEvent({
    ...auditContext,
    action: AuditAction.CASE_CREATED,
    target_type: 'case',
    target_id: caseId,
    payload: { customer_phone: input.customer_phone, address: input.address_text },
  });

  // Emit realtime event
  eventEmitter.emitCaseEvent(caseId, CaseEventType.STATUS_CHANGED, {
    case: newCase,
    previous_status: null,
    new_status: CaseStatus.SUBMITTED,
  });

  return newCase;
}

/**
 * Get case by ID
 */
export async function getCaseById(caseId: string): Promise<Case | null> {
  const result = await query<Case>(
    'SELECT * FROM cases WHERE case_id = $1',
    [caseId]
  );
  return result.rows[0] || null;
}

/**
 * Get case detail with tech summary and evidence
 */
export async function getCaseDetail(
  caseId: string,
  viewerUserId: string,
  viewerRole: UserRole
): Promise<CaseDetail | null> {
  const caseResult = await query<Case>(
    'SELECT * FROM cases WHERE case_id = $1',
    [caseId]
  );

  if (caseResult.rows.length === 0) {
    return null;
  }

  const caseData = caseResult.rows[0];

  // Get tech summary if assigned
  let techSummary: CaseDetail['tech_summary'] = null;
  if (caseData.assigned_tech_id) {
    const techResult = await query<{ user_id: string; display_name: string; phone: string | null }>(
      'SELECT user_id, display_name, phone FROM users WHERE user_id = $1',
      [caseData.assigned_tech_id]
    );
    if (techResult.rows[0]) {
      const tech = techResult.rows[0];
      techSummary = {
        tech_id: tech.user_id,
        display_name: tech.display_name || 'Technician',
        phone_relay: null, // Could implement masked/relay phone
      };
    }
  }

  // Get evidence (with access control)
  const evidenceResult = await query<Evidence>(
    'SELECT * FROM evidence WHERE case_id = $1 ORDER BY created_at DESC',
    [caseId]
  );

  // Filter evidence based on viewer role
  const evidence = evidenceResult.rows.filter((e) => {
    // Admin and callcenter can see all
    if (viewerRole === UserRole.ADMIN || viewerRole === UserRole.CALLCENTER) {
      return true;
    }
    // Tech can only see after assignment
    if (viewerRole === UserRole.TECH) {
      return caseData.assigned_tech_id === viewerUserId;
    }
    // Customer can see their own uploads
    if (viewerRole === UserRole.CUSTOMER) {
      return e.uploader_user_id === viewerUserId;
    }
    return false;
  });

  // Calculate ETA if tech is en route
  let etaSeconds: number | null = null;
  if (caseData.assigned_tech_id && (caseData.status === CaseStatus.EN_ROUTE || caseData.status === CaseStatus.ASSIGNED)) {
    // Get latest tech location
    const pingResult = await query<{ lat: number; lng: number; ts: Date }>(
      `SELECT lat, lng, ts FROM tech_location_pings
       WHERE tech_id = $1 ORDER BY ts DESC LIMIT 1`,
      [caseData.assigned_tech_id]
    );
    if (pingResult.rows[0]) {
      // Simple distance-based ETA estimate (in production, use routing API)
      const techLat = pingResult.rows[0].lat;
      const techLng = pingResult.rows[0].lng;
      const distanceKm = haversineDistance(techLat, techLng, caseData.location_lat, caseData.location_lng);
      // Assume 30 km/h average speed in urban area
      etaSeconds = Math.round((distanceKm / 30) * 3600);
    }
  }

  return {
    ...caseData,
    eta_seconds: etaSeconds,
    tech_summary: techSummary,
    evidence,
  };
}

/**
 * Get cases for customer
 */
export async function getCustomerCases(
  customerId: string,
  queryParams: GetCasesQuery
): Promise<Case[]> {
  const { status, limit, offset } = queryParams;

  let sql = 'SELECT * FROM cases WHERE customer_id = $1';
  const params: unknown[] = [customerId];

  if (status) {
    sql += ' AND status = $2';
    params.push(status);
  }

  sql += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
  params.push(limit, offset);

  const result = await query<Case>(sql, params);
  return result.rows;
}

/**
 * Get cases for organization (callcenter queue)
 */
export async function getOrgCases(
  orgId: string,
  queryParams: GetCasesQuery
): Promise<Case[]> {
  const { status, limit, offset } = queryParams;

  // Get cases assigned to org OR unassigned cases (for queue)
  let sql = 'SELECT * FROM cases WHERE (assigned_org_id = $1 OR assigned_org_id IS NULL)';
  const params: unknown[] = [orgId];

  if (status) {
    sql += ' AND status = $2';
    params.push(status);
  }

  sql += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
  params.push(limit, offset);

  const result = await query<Case>(sql, params);
  return result.rows;
}

/**
 * Get assigned cases for tech
 */
export async function getTechAssignedCases(techId: string): Promise<Case[]> {
  const result = await query<Case>(
    `SELECT * FROM cases
     WHERE assigned_tech_id = $1
     AND status NOT IN ('COMPLETED', 'CANCELLED', 'EXPIRED', 'REJECTED', 'FAILED')
     ORDER BY created_at DESC`,
    [techId]
  );
  return result.rows;
}

/**
 * Set risk decision (callcenter)
 */
export async function setRiskDecision(
  caseId: string,
  input: SetRiskInput,
  auditContext: AuditContext
): Promise<Case> {
  return withTransaction(async (client) => {
    const caseResult = await client.query<Case>(
      'SELECT * FROM cases WHERE case_id = $1 FOR UPDATE',
      [caseId]
    );

    if (caseResult.rows.length === 0) {
      throw new NotFoundError('Case', caseId);
    }

    const currentCase = caseResult.rows[0];

    // Can only set risk on SUBMITTED cases
    if (currentCase.status !== CaseStatus.SUBMITTED) {
      throw new BadRequestError(`Cannot set risk on case with status ${currentCase.status}`);
    }

    let newStatus: CaseStatus;
    switch (input.decision) {
      case RiskDecision.PROCEED:
        newStatus = CaseStatus.DISPATCHING;
        break;
      case RiskDecision.NEED_APPROVAL:
        newStatus = CaseStatus.NEED_APPROVAL;
        break;
      case RiskDecision.REJECT:
        newStatus = CaseStatus.REJECTED;
        break;
    }

    validateTransition(currentCase.status, newStatus);

    const updateResult = await client.query<Case>(
      `UPDATE cases SET status = $1, risk_level = $2, updated_at = now()
       WHERE case_id = $3 RETURNING *`,
      [newStatus, input.risk_level, caseId]
    );

    const updatedCase = updateResult.rows[0];

    // Timeline
    await addCaseTimelineEventWithClient(client, caseId, 'RISK_SET', auditContext, {
      decision: input.decision,
      risk_level: input.risk_level,
      note: input.note,
    });

    // Audit
    await logAuditEvent({
      ...auditContext,
      action: AuditAction.RISK_SET,
      target_type: 'case',
      target_id: caseId,
      payload: { decision: input.decision, risk_level: input.risk_level },
    });

    // Emit realtime event
    eventEmitter.emitCaseEvent(caseId, CaseEventType.STATUS_CHANGED, {
      case: updatedCase,
      previous_status: currentCase.status,
      new_status: newStatus,
    });

    return updatedCase;
  });
}

/**
 * Update case status (tech)
 */
export async function updateCaseStatus(
  caseId: string,
  newStatus: CaseStatus,
  techId: string,
  auditContext: AuditContext,
  note?: string
): Promise<Case> {
  return withTransaction(async (client) => {
    const caseResult = await client.query<Case>(
      'SELECT * FROM cases WHERE case_id = $1 FOR UPDATE',
      [caseId]
    );

    if (caseResult.rows.length === 0) {
      throw new NotFoundError('Case', caseId);
    }

    const currentCase = caseResult.rows[0];

    // Check tech is assigned
    if (currentCase.assigned_tech_id !== techId) {
      throw new ForbiddenError('You are not assigned to this case');
    }

    // Check tech can update from current status
    if (!canTechUpdateStatus(currentCase.status)) {
      throw new BadRequestError(`Tech cannot update case from status ${currentCase.status}`);
    }

    // Validate transition
    validateTransition(currentCase.status, newStatus);

    const updateResult = await client.query<Case>(
      'UPDATE cases SET status = $1, updated_at = now() WHERE case_id = $2 RETURNING *',
      [newStatus, caseId]
    );

    const updatedCase = updateResult.rows[0];

    // Timeline
    await addCaseTimelineEventWithClient(client, caseId, 'STATUS_CHANGED', auditContext, {
      from: currentCase.status,
      to: newStatus,
      note,
    });

    // Audit
    await logAuditEvent({
      ...auditContext,
      action: AuditAction.CASE_STATUS_CHANGED,
      target_type: 'case',
      target_id: caseId,
      payload: { from: currentCase.status, to: newStatus },
    });

    // Emit realtime event
    eventEmitter.emitCaseEvent(caseId, CaseEventType.STATUS_CHANGED, {
      case: updatedCase,
      previous_status: currentCase.status,
      new_status: newStatus,
    });

    return updatedCase;
  });
}

/**
 * Cancel a case
 */
export async function cancelCase(
  caseId: string,
  reason: string,
  auditContext: AuditContext
): Promise<Case> {
  return withTransaction(async (client) => {
    const caseResult = await client.query<Case>(
      'SELECT * FROM cases WHERE case_id = $1 FOR UPDATE',
      [caseId]
    );

    if (caseResult.rows.length === 0) {
      throw new NotFoundError('Case', caseId);
    }

    const currentCase = caseResult.rows[0];

    if (!canCancel(currentCase.status)) {
      throw new BadRequestError(`Cannot cancel case with status ${currentCase.status}`);
    }

    validateTransition(currentCase.status, CaseStatus.CANCELLED);

    const updateResult = await client.query<Case>(
      'UPDATE cases SET status = $1, updated_at = now() WHERE case_id = $2 RETURNING *',
      [CaseStatus.CANCELLED, caseId]
    );

    const updatedCase = updateResult.rows[0];

    // Timeline
    await addCaseTimelineEventWithClient(client, caseId, 'CASE_CANCELLED', auditContext, { reason });

    // Audit
    await logAuditEvent({
      ...auditContext,
      action: AuditAction.CASE_STATUS_CHANGED,
      target_type: 'case',
      target_id: caseId,
      payload: { from: currentCase.status, to: CaseStatus.CANCELLED, reason },
    });

    // Emit realtime event
    eventEmitter.emitCaseEvent(caseId, CaseEventType.STATUS_CHANGED, {
      case: updatedCase,
      previous_status: currentCase.status,
      new_status: CaseStatus.CANCELLED,
    });

    return updatedCase;
  });
}

/**
 * Mark case as completed (internal - called after OTP verification)
 */
export async function completeCaseAfterOtp(
  caseId: string,
  auditContext: AuditContext
): Promise<Case> {
  return withTransaction(async (client) => {
    const caseResult = await client.query<Case>(
      'SELECT * FROM cases WHERE case_id = $1 FOR UPDATE',
      [caseId]
    );

    if (caseResult.rows.length === 0) {
      throw new NotFoundError('Case', caseId);
    }

    const currentCase = caseResult.rows[0];

    if (currentCase.status !== CaseStatus.OTP_PENDING) {
      throw new BadRequestError('Case must be in OTP_PENDING status to complete');
    }

    validateTransition(currentCase.status, CaseStatus.COMPLETED);

    const updateResult = await client.query<Case>(
      'UPDATE cases SET status = $1, updated_at = now() WHERE case_id = $2 RETURNING *',
      [CaseStatus.COMPLETED, caseId]
    );

    const updatedCase = updateResult.rows[0];

    // Timeline
    await addCaseTimelineEventWithClient(client, caseId, 'CASE_COMPLETED', auditContext, {});

    // Emit realtime event
    eventEmitter.emitCaseEvent(caseId, CaseEventType.STATUS_CHANGED, {
      case: updatedCase,
      previous_status: currentCase.status,
      new_status: CaseStatus.COMPLETED,
    });

    return updatedCase;
  });
}

// Helper functions

async function addCaseTimelineEvent(
  caseId: string,
  eventType: string,
  auditContext: AuditContext,
  payload: Record<string, unknown>
): Promise<void> {
  await query(
    `INSERT INTO case_timeline (case_id, event_type, actor_user_id, actor_role, payload)
     VALUES ($1, $2, $3, $4, $5)`,
    [caseId, eventType, auditContext.actor_user_id, auditContext.actor_role, JSON.stringify(payload)]
  );
}

async function addCaseTimelineEventWithClient(
  client: PoolClient,
  caseId: string,
  eventType: string,
  auditContext: AuditContext,
  payload: Record<string, unknown>
): Promise<void> {
  await client.query(
    `INSERT INTO case_timeline (case_id, event_type, actor_user_id, actor_role, payload)
     VALUES ($1, $2, $3, $4, $5)`,
    [caseId, eventType, auditContext.actor_user_id, auditContext.actor_role, JSON.stringify(payload)]
  );
}

// Haversine formula for distance calculation
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}
