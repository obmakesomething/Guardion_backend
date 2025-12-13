import { v4 as uuidv4 } from 'uuid';
import { query, withTransaction } from '../../db/pool';
import {
  Case,
  CaseStatus,
  DispatchOffer,
  DispatchOfferStatus,
  TechAvailability,
  TechLocationPing,
  AuditAction,
  Accrual,
  AccrualStatus,
} from '../../types';
import { NotFoundError, ForbiddenError, BadRequestError, ConflictError } from '../../lib/errors';
import { logAuditEvent, AuditContext } from '../audit';
import { validateTransition } from '../case/case.stateMachine';
import { config } from '../../config';
import { eventEmitter, CaseEventType, TechEventType } from '../realtime/eventEmitter';
import { CreateDispatchOffersInput, AssignTechInput, TechLocationPingInput } from './dispatch.schema';

/**
 * Create dispatch offers for a case (send to multiple techs)
 */
export async function createDispatchOffers(
  caseId: string,
  input: CreateDispatchOffersInput,
  auditContext: AuditContext
): Promise<DispatchOffer[]> {
  // Verify case exists and is in DISPATCHING status
  const caseResult = await query<Case>(
    'SELECT * FROM cases WHERE case_id = $1',
    [caseId]
  );

  if (caseResult.rows.length === 0) {
    throw new NotFoundError('Case', caseId);
  }

  const currentCase = caseResult.rows[0];

  if (currentCase.status !== CaseStatus.DISPATCHING) {
    throw new BadRequestError(`Cannot create dispatch offers for case with status ${currentCase.status}`);
  }

  const offers: DispatchOffer[] = [];

  for (const techId of input.tech_ids) {
    // Verify tech exists and is available
    const techResult = await query<{ user_id: string; role: string }>(
      "SELECT user_id, role FROM users WHERE user_id = $1 AND role = 'tech'",
      [techId]
    );

    if (techResult.rows.length === 0) {
      continue; // Skip invalid tech IDs
    }

    // Create offer
    const offerId = uuidv4();
    const offerResult = await query<DispatchOffer>(
      `INSERT INTO dispatch_offers (offer_id, case_id, tech_id, status)
       VALUES ($1, $2, $3, 'SENT')
       RETURNING *`,
      [offerId, caseId, techId]
    );

    const offer = offerResult.rows[0];
    offers.push(offer);

    // Audit log
    await logAuditEvent({
      ...auditContext,
      action: AuditAction.DISPATCH_OFFER_SENT,
      target_type: 'dispatch_offer',
      target_id: offerId,
      payload: { case_id: caseId, tech_id: techId },
    });

    // Notify tech via realtime
    eventEmitter.emitTechEvent(techId, TechEventType.ASSIGNMENT, {
      type: 'offer',
      offer,
      case: currentCase,
    });
  }

  return offers;
}

/**
 * Respond to a dispatch offer (tech accepts/declines)
 */
export async function respondToDispatchOffer(
  offerId: string,
  accept: boolean,
  techId: string,
  auditContext: AuditContext
): Promise<DispatchOffer> {
  return withTransaction(async (client) => {
    const offerResult = await client.query<DispatchOffer>(
      'SELECT * FROM dispatch_offers WHERE offer_id = $1 FOR UPDATE',
      [offerId]
    );

    if (offerResult.rows.length === 0) {
      throw new NotFoundError('DispatchOffer', offerId);
    }

    const offer = offerResult.rows[0];

    if (offer.tech_id !== techId) {
      throw new ForbiddenError('This offer is not for you');
    }

    if (offer.status !== DispatchOfferStatus.SENT) {
      throw new BadRequestError(`Offer already ${offer.status.toLowerCase()}`);
    }

    const newStatus = accept ? DispatchOfferStatus.ACCEPTED : DispatchOfferStatus.DECLINED;

    const updateResult = await client.query<DispatchOffer>(
      `UPDATE dispatch_offers SET status = $1, responded_at = now()
       WHERE offer_id = $2 RETURNING *`,
      [newStatus, offerId]
    );

    const updatedOffer = updateResult.rows[0];

    // Audit log
    await logAuditEvent({
      ...auditContext,
      action: AuditAction.DISPATCH_OFFER_RESPONDED,
      target_type: 'dispatch_offer',
      target_id: offerId,
      payload: { accepted: accept },
    });

    return updatedOffer;
  });
}

/**
 * Accept a case (callcenter) - creates accrual
 */
export async function acceptCase(
  caseId: string,
  orgId: string,
  auditContext: AuditContext
): Promise<{ case: Case; accrual: Accrual }> {
  return withTransaction(async (client) => {
    const caseResult = await client.query<Case>(
      'SELECT * FROM cases WHERE case_id = $1 FOR UPDATE',
      [caseId]
    );

    if (caseResult.rows.length === 0) {
      throw new NotFoundError('Case', caseId);
    }

    const currentCase = caseResult.rows[0];

    // Check if already accepted (idempotency)
    if (currentCase.status === CaseStatus.ACCEPTED && currentCase.assigned_org_id === orgId) {
      // Already accepted by this org, return existing accrual
      const accrualResult = await client.query<Accrual>(
        "SELECT * FROM accruals WHERE case_id = $1 AND event_type = 'CASE_ACCEPTED'",
        [caseId]
      );
      return { case: currentCase, accrual: accrualResult.rows[0] };
    }

    // Check if already accepted by another org
    if (currentCase.status === CaseStatus.ACCEPTED && currentCase.assigned_org_id !== orgId) {
      throw new ConflictError('Case already accepted by another organization');
    }

    // Must be in DISPATCHING status
    if (currentCase.status !== CaseStatus.DISPATCHING) {
      throw new BadRequestError(`Cannot accept case with status ${currentCase.status}`);
    }

    validateTransition(currentCase.status, CaseStatus.ACCEPTED);

    // Update case
    const updateResult = await client.query<Case>(
      `UPDATE cases SET status = 'ACCEPTED', assigned_org_id = $1, accepted_at = now(), updated_at = now()
       WHERE case_id = $2 RETURNING *`,
      [orgId, caseId]
    );

    const updatedCase = updateResult.rows[0];

    // Create accrual (idempotent via unique constraint)
    const accrualId = uuidv4();
    const accrualResult = await client.query<Accrual>(
      `INSERT INTO accruals (accrual_id, org_id, case_id, amount, event_type, status)
       VALUES ($1, $2, $3, $4, 'CASE_ACCEPTED', 'ACCRUED')
       ON CONFLICT (case_id, event_type) DO NOTHING
       RETURNING *`,
      [accrualId, orgId, caseId, config.accrual.defaultAmount]
    );

    // If insert was skipped due to conflict, fetch existing
    let accrual = accrualResult.rows[0];
    if (!accrual) {
      const existingAccrual = await client.query<Accrual>(
        "SELECT * FROM accruals WHERE case_id = $1 AND event_type = 'CASE_ACCEPTED'",
        [caseId]
      );
      accrual = existingAccrual.rows[0];
    }

    // Add timeline event
    await client.query(
      `INSERT INTO case_timeline (case_id, event_type, actor_user_id, actor_role, payload)
       VALUES ($1, 'CASE_ACCEPTED', $2, $3, $4)`,
      [caseId, auditContext.actor_user_id, auditContext.actor_role, JSON.stringify({ org_id: orgId })]
    );

    // Audit logs
    await logAuditEvent({
      ...auditContext,
      actor_org_id: orgId,
      action: AuditAction.CASE_ACCEPTED,
      target_type: 'case',
      target_id: caseId,
      payload: { org_id: orgId },
    });

    await logAuditEvent({
      ...auditContext,
      actor_org_id: orgId,
      action: AuditAction.ACCRUAL_CREATED,
      target_type: 'accrual',
      target_id: accrual.accrual_id,
      payload: { case_id: caseId, amount: accrual.amount },
    });

    // Emit realtime events
    eventEmitter.emitCaseEvent(caseId, CaseEventType.STATUS_CHANGED, {
      case: updatedCase,
      previous_status: currentCase.status,
      new_status: CaseStatus.ACCEPTED,
    });

    eventEmitter.emitCaseEvent(caseId, CaseEventType.ACCRUAL_CREATED, {
      case_id: caseId,
      org_id: orgId,
      accrual_id: accrual.accrual_id,
      amount: accrual.amount,
    });

    return { case: updatedCase, accrual };
  });
}

/**
 * Assign a technician to a case (callcenter)
 */
export async function assignTech(
  caseId: string,
  input: AssignTechInput,
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

    // Must be in ACCEPTED status
    if (currentCase.status !== CaseStatus.ACCEPTED) {
      throw new BadRequestError(`Cannot assign tech to case with status ${currentCase.status}`);
    }

    // Verify tech exists
    const techResult = await client.query<{ user_id: string }>(
      "SELECT user_id FROM users WHERE user_id = $1 AND role = 'tech'",
      [input.tech_id]
    );

    if (techResult.rows.length === 0) {
      throw new NotFoundError('Technician', input.tech_id);
    }

    validateTransition(currentCase.status, CaseStatus.ASSIGNED);

    // Update case
    const updateResult = await client.query<Case>(
      `UPDATE cases SET status = 'ASSIGNED', assigned_tech_id = $1, updated_at = now()
       WHERE case_id = $2 RETURNING *`,
      [input.tech_id, caseId]
    );

    const updatedCase = updateResult.rows[0];

    // Update tech availability
    await client.query(
      `INSERT INTO tech_availability (tech_id, is_busy, updated_at)
       VALUES ($1, true, now())
       ON CONFLICT (tech_id) DO UPDATE SET is_busy = true, updated_at = now()`,
      [input.tech_id]
    );

    // Add timeline event
    await client.query(
      `INSERT INTO case_timeline (case_id, event_type, actor_user_id, actor_role, payload)
       VALUES ($1, 'CASE_ASSIGNED', $2, $3, $4)`,
      [caseId, auditContext.actor_user_id, auditContext.actor_role, JSON.stringify({ tech_id: input.tech_id })]
    );

    // Audit log
    await logAuditEvent({
      ...auditContext,
      action: AuditAction.CASE_ASSIGNED,
      target_type: 'case',
      target_id: caseId,
      payload: { tech_id: input.tech_id },
    });

    // Emit realtime events
    eventEmitter.emitCaseEvent(caseId, CaseEventType.ASSIGNED, {
      case_id: caseId,
      tech_id: input.tech_id,
      org_id: currentCase.assigned_org_id,
    });

    eventEmitter.emitCaseEvent(caseId, CaseEventType.STATUS_CHANGED, {
      case: updatedCase,
      previous_status: currentCase.status,
      new_status: CaseStatus.ASSIGNED,
    });

    // Notify tech
    eventEmitter.emitTechEvent(input.tech_id, TechEventType.ASSIGNMENT, {
      type: 'assigned',
      case: updatedCase,
    });

    return updatedCase;
  });
}

/**
 * Record tech location ping
 */
export async function recordTechLocationPing(
  techId: string,
  input: TechLocationPingInput,
  auditContext: AuditContext
): Promise<void> {
  const ts = input.ts ? new Date(input.ts) : new Date();

  // Insert ping
  await query<TechLocationPing>(
    `INSERT INTO tech_location_pings (tech_id, lat, lng, accuracy, ts)
     VALUES ($1, $2, $3, $4, $5)`,
    [techId, input.lat, input.lng, input.accuracy || null, ts]
  );

  // Update tech availability online status
  await query(
    `INSERT INTO tech_availability (tech_id, is_online, updated_at)
     VALUES ($1, true, now())
     ON CONFLICT (tech_id) DO UPDATE SET is_online = true, updated_at = now()`,
    [techId]
  );

  // Find active cases for this tech and broadcast location
  const activeCases = await query<{ case_id: string; location_lat: number; location_lng: number }>(
    `SELECT case_id, location_lat, location_lng FROM cases
     WHERE assigned_tech_id = $1
     AND status IN ('ASSIGNED', 'EN_ROUTE')`,
    [techId]
  );

  for (const caseRow of activeCases.rows) {
    // Calculate simple ETA
    const distanceKm = haversineDistance(input.lat, input.lng, caseRow.location_lat, caseRow.location_lng);
    const etaSeconds = Math.round((distanceKm / 30) * 3600); // Assume 30 km/h

    eventEmitter.emitTechLocation(
      caseRow.case_id,
      { tech_id: techId, lat: input.lat, lng: input.lng, accuracy: input.accuracy || null } as TechLocationPing,
      etaSeconds
    );
  }

  // Audit log (only occasionally to avoid spam)
  // In production, consider sampling or batching these logs
}

/**
 * Get latest tech location
 */
export async function getLatestTechLocation(techId: string): Promise<TechLocationPing | null> {
  const result = await query<TechLocationPing>(
    `SELECT * FROM tech_location_pings
     WHERE tech_id = $1 ORDER BY ts DESC LIMIT 1`,
    [techId]
  );
  return result.rows[0] || null;
}

/**
 * Get available techs
 */
export async function getAvailableTechs(): Promise<Array<{ user_id: string; display_name: string; is_online: boolean; is_busy: boolean }>> {
  const result = await query<{ user_id: string; display_name: string; is_online: boolean; is_busy: boolean }>(
    `SELECT u.user_id, u.display_name, COALESCE(ta.is_online, false) as is_online, COALESCE(ta.is_busy, false) as is_busy
     FROM users u
     LEFT JOIN tech_availability ta ON ta.tech_id = u.user_id
     WHERE u.role = 'tech'
     ORDER BY ta.is_online DESC NULLS LAST, ta.is_busy ASC NULLS LAST`
  );
  return result.rows;
}

// Haversine formula
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
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
