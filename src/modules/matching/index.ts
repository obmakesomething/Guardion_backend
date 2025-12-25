import { v4 as uuid } from 'uuid';
import { config } from '../../config/index.js';
import { query } from '../../db/pool.js';
import {
  sendBatchKakaoAlimtalk,
  TEMPLATE_IDS,
  buildTechNotificationVariables,
  notifyCustomerTechAssigned,
  notifyCustomerTechDeparted,
  notifyCustomerTechArriving,
  notifyCustomerBalanceRequest,
} from '../solapi/index.js';
import {
  type SeoulDistrict,
  type Technician,
  type MatchRequest,
  type MatchingStatus,
  type LockAnalysisResult,
  type CustomerInfo,
  type JobStatus,
  DISTRICT_NAMES,
  ADJACENT_DISTRICTS,
} from '../../types/index.js';

// In-memory store for active match requests
// In production, use Redis or database
const activeMatches = new Map<string, MatchRequest>();

/**
 * Check tech density in a district
 * Returns the count of available technicians
 */
export async function checkTechDensity(district: SeoulDistrict): Promise<number> {
  try {
    const result = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM technicians
       WHERE district = $1 AND is_available = true`,
      [district]
    );
    return parseInt(result.rows[0]?.count ?? '0', 10);
  } catch (error) {
    console.error('[Matching] Error checking tech density:', error);
    // Fallback: assume low density
    return 0;
  }
}

/**
 * Get available technicians in specified districts
 * Ordered by rating DESC, limited by batch size
 */
export async function getAvailableTechs(
  districts: SeoulDistrict[],
  excludeIds: string[] = [],
  limit: number = config.matching.batchSize
): Promise<Technician[]> {
  try {
    const result = await query<{
      id: string;
      name: string;
      phone: string;
      district: SeoulDistrict;
      rating: number;
      completed_jobs: number;
      is_available: boolean;
      specialties: string[];
      last_active_at: Date;
    }>(
      `SELECT id, name, phone, district, rating, completed_jobs, is_available, specialties, last_active_at
       FROM technicians
       WHERE district = ANY($1)
         AND is_available = true
         AND ($2::uuid[] IS NULL OR id != ALL($2))
       ORDER BY rating DESC, completed_jobs DESC
       LIMIT $3`,
      [districts, excludeIds.length > 0 ? excludeIds : null, limit]
    );

    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      phone: row.phone,
      district: row.district,
      rating: Number(row.rating),
      completedJobs: row.completed_jobs,
      isAvailable: row.is_available,
      specialties: row.specialties as any,
      lastActiveAt: row.last_active_at,
    }));
  } catch (error) {
    console.error('[Matching] Error getting available techs:', error);
    return [];
  }
}

/**
 * Initialize a new match request
 */
export async function createMatchRequest(params: {
  userId?: string;
  district: SeoulDistrict;
  lockAnalysis?: LockAnalysisResult;
  basePrice: number;
  customer?: CustomerInfo;
}): Promise<MatchRequest> {
  const id = uuid();
  const now = new Date();

  const matchRequest: MatchRequest = {
    id,
    userId: params.userId ?? 'anonymous',
    district: params.district,
    lockAnalysis: params.lockAnalysis ?? null,
    basePrice: params.basePrice,
    surchargeApproved: false,
    surchargeAmount: config.pricing.surchargeAmount,
    currentLevel: 1,
    status: 'pending',
    matchedTechId: null,
    matchedTech: null,
    notifiedTechIds: [],
    createdAt: now,
    expiresAt: null,
    customer: params.customer,
  };

  activeMatches.set(id, matchRequest);

  // Log to database (async, don't await)
  query(
    `INSERT INTO match_requests (id, district, base_price, status, created_at, customer_phone, customer_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, params.district, params.basePrice, 'pending', now, params.customer?.phone, params.customer?.address]
  ).catch((err) => console.error('[Matching] Failed to log match request:', err));

  return matchRequest;
}

/**
 * Update customer info for a match request
 */
export function updateCustomerInfo(requestId: string, customer: CustomerInfo): boolean {
  const request = activeMatches.get(requestId);
  if (!request) {
    return false;
  }

  request.customer = customer;
  activeMatches.set(requestId, request);

  // Update database (async)
  query(
    `UPDATE match_requests SET customer_phone = $1, customer_address = $2 WHERE id = $3`,
    [customer.phone, customer.address, requestId]
  ).catch((err) => console.error('[Matching] Failed to update customer info:', err));

  return true;
}

/**
 * Get a match request by ID
 */
export function getMatchRequest(requestId: string): MatchRequest | null {
  return activeMatches.get(requestId) ?? null;
}

/**
 * Phase 1: Pre-check - Determine if we should skip to Level 2
 */
export async function shouldSkipToLevel2(district: SeoulDistrict): Promise<boolean> {
  const techCount = await checkTechDensity(district);
  return techCount < config.matching.minTechsForLocalMatch;
}

/**
 * Execute Level 1 matching (local district)
 */
export async function executeLevel1Matching(requestId: string): Promise<{
  notifiedCount: number;
  techs: Technician[];
}> {
  const request = activeMatches.get(requestId);
  if (!request) {
    throw new Error('Match request not found');
  }

  request.status = 'matching';
  request.currentLevel = 1;

  // Get available techs in the same district
  const techs = await getAvailableTechs(
    [request.district],
    request.notifiedTechIds,
    config.matching.batchSize
  );

  if (techs.length === 0) {
    return { notifiedCount: 0, techs: [] };
  }

  // Send notifications
  await sendTechNotifications(request, techs, 1);

  // Update request
  request.notifiedTechIds.push(...techs.map((t) => t.id));
  activeMatches.set(requestId, request);

  return { notifiedCount: techs.length, techs };
}

/**
 * Execute Level 2 matching (adjacent districts)
 * Requires surcharge approval
 */
export async function executeLevel2Matching(requestId: string): Promise<{
  notifiedCount: number;
  techs: Technician[];
  districts: SeoulDistrict[];
}> {
  const request = activeMatches.get(requestId);
  if (!request) {
    throw new Error('Match request not found');
  }

  if (!request.surchargeApproved) {
    throw new Error('Surcharge not approved for Level 2 matching');
  }

  request.currentLevel = 2;

  // Get adjacent districts
  const adjacentDistricts = ADJACENT_DISTRICTS[request.district] || [];

  // Get available techs in adjacent districts
  const techs = await getAvailableTechs(
    adjacentDistricts,
    request.notifiedTechIds,
    config.matching.batchSize
  );

  if (techs.length === 0) {
    return { notifiedCount: 0, techs: [], districts: adjacentDistricts };
  }

  // Send notifications with surcharge info
  await sendTechNotifications(request, techs, 2);

  // Update request
  request.notifiedTechIds.push(...techs.map((t) => t.id));
  activeMatches.set(requestId, request);

  return { notifiedCount: techs.length, techs, districts: adjacentDistricts };
}

/**
 * Execute Level 3 matching (all Seoul)
 */
export async function executeLevel3Matching(requestId: string): Promise<{
  notifiedCount: number;
  techs: Technician[];
}> {
  const request = activeMatches.get(requestId);
  if (!request) {
    throw new Error('Match request not found');
  }

  request.currentLevel = 3;

  // Get all Seoul districts
  const allDistricts = Object.keys(DISTRICT_NAMES) as SeoulDistrict[];

  // Get available techs from all districts, excluding already notified
  const techs = await getAvailableTechs(
    allDistricts,
    request.notifiedTechIds,
    config.matching.batchSize * 2 // Double batch for city-wide
  );

  if (techs.length === 0) {
    return { notifiedCount: 0, techs: [] };
  }

  // Send notifications
  await sendTechNotifications(request, techs, 3);

  // Update request
  request.notifiedTechIds.push(...techs.map((t) => t.id));
  activeMatches.set(requestId, request);

  return { notifiedCount: techs.length, techs };
}

/**
 * Send Kakao notifications to technicians
 */
async function sendTechNotifications(
  request: MatchRequest,
  techs: Technician[],
  level: 1 | 2 | 3
): Promise<void> {
  const templateId = level === 1 ? TEMPLATE_IDS.NEW_REQUEST : TEMPLATE_IDS.WIDE_AREA_REQUEST;

  const messages = techs.map((tech) => ({
    phoneNumber: tech.phone,
    templateId,
    variables: buildTechNotificationVariables({
      district: DISTRICT_NAMES[request.district],
      lockType: request.lockAnalysis?.lockType ?? 'digital',
      price: request.basePrice + (request.surchargeApproved ? request.surchargeAmount : 0),
      urgencyNote: level > 1 ? '광역 매칭 요청입니다' : '긴급 개문 요청입니다',
      acceptUrl: `https://klygo.online/accept/${request.id}?tech=${tech.id}`,
      competitorCount: techs.length,
    }),
  }));

  // Send in batches of 20
  for (let i = 0; i < messages.length; i += 20) {
    const batch = messages.slice(i, i + 20);
    await sendBatchKakaoAlimtalk(batch);
  }
}

/**
 * Approve surcharge for wide area matching
 */
export function approveSurcharge(requestId: string): boolean {
  const request = activeMatches.get(requestId);
  if (!request) {
    return false;
  }

  request.surchargeApproved = true;
  activeMatches.set(requestId, request);

  // Update database (async)
  query(
    `UPDATE match_requests SET surcharge_approved = true WHERE id = $1`,
    [requestId]
  ).catch((err) => console.error('[Matching] Failed to update surcharge approval:', err));

  return true;
}

/**
 * Handle tech acceptance
 */
export async function acceptMatch(
  requestId: string,
  techId: string
): Promise<{ success: boolean; message: string; customer?: CustomerInfo }> {
  const request = activeMatches.get(requestId);
  if (!request) {
    return { success: false, message: '요청을 찾을 수 없습니다.' };
  }

  if (request.status === 'matched' || request.status === 'departed' ||
      request.status === 'arrived' || request.status === 'completed') {
    return { success: false, message: '이미 다른 기사님이 수락하셨습니다.' };
  }

  // Get tech info
  let techInfo: Technician | null = null;
  try {
    const result = await query<{
      id: string; name: string; phone: string; district: SeoulDistrict; rating: number;
    }>(
      `SELECT id, name, phone, district, rating FROM technicians WHERE id = $1`,
      [techId]
    );
    if (result.rows[0]) {
      techInfo = {
        id: result.rows[0].id,
        name: result.rows[0].name,
        phone: result.rows[0].phone,
        district: result.rows[0].district,
        rating: Number(result.rows[0].rating),
        completedJobs: 0,
        isAvailable: true,
        specialties: [],
        lastActiveAt: new Date(),
      };
    }
  } catch (err) {
    console.error('[Matching] Failed to get tech info:', err);
  }

  // Update request
  request.status = 'matched';
  request.matchedTechId = techId;
  request.matchedTech = techInfo;
  request.matchedAt = new Date();
  activeMatches.set(requestId, request);

  // Update database
  await query(
    `UPDATE match_requests SET status = 'matched', matched_tech_id = $1, matched_at = NOW() WHERE id = $2`,
    [techId, requestId]
  );

  // Notify customer via Kakao
  if (request.customer?.phone && techInfo) {
    notifyCustomerTechAssigned(
      request.customer.phone,
      techInfo.name,
      techInfo.phone,
      15 // ETA 15 minutes
    ).catch(err => console.error('[Matching] Failed to notify customer:', err));
  }

  return {
    success: true,
    message: '수락 완료! 고객님께 연락드리겠습니다.',
    customer: request.customer
  };
}

/**
 * Update job status - tech departed
 */
export async function updateJobDeparted(
  requestId: string,
  techId: string,
  eta: number = 10
): Promise<{ success: boolean; message: string }> {
  const request = activeMatches.get(requestId);
  if (!request) {
    return { success: false, message: '요청을 찾을 수 없습니다.' };
  }

  if (request.matchedTechId !== techId) {
    return { success: false, message: '권한이 없습니다.' };
  }

  request.status = 'departed';
  request.departedAt = new Date();
  activeMatches.set(requestId, request);

  // Update database
  await query(
    `UPDATE match_requests SET status = 'departed', departed_at = NOW() WHERE id = $1`,
    [requestId]
  );

  // Notify customer
  if (request.customer?.phone && request.matchedTech) {
    notifyCustomerTechDeparted(
      request.customer.phone,
      request.matchedTech.name,
      eta
    ).catch(err => console.error('[Matching] Failed to notify customer:', err));
  }

  return { success: true, message: '출발 알림이 전송되었습니다.' };
}

/**
 * Update job status - tech arrived
 */
export async function updateJobArrived(
  requestId: string,
  techId: string
): Promise<{ success: boolean; message: string }> {
  const request = activeMatches.get(requestId);
  if (!request) {
    return { success: false, message: '요청을 찾을 수 없습니다.' };
  }

  if (request.matchedTechId !== techId) {
    return { success: false, message: '권한이 없습니다.' };
  }

  request.status = 'arrived';
  request.arrivedAt = new Date();
  activeMatches.set(requestId, request);

  // Update database
  await query(
    `UPDATE match_requests SET status = 'arrived', arrived_at = NOW() WHERE id = $1`,
    [requestId]
  );

  // Notify customer
  if (request.customer?.phone && request.matchedTech) {
    notifyCustomerTechArriving(
      request.customer.phone,
      request.matchedTech.name
    ).catch(err => console.error('[Matching] Failed to notify customer:', err));
  }

  return { success: true, message: '도착 알림이 전송되었습니다.' };
}

/**
 * Update job status - completed (with balance)
 */
export async function updateJobCompleted(
  requestId: string,
  techId: string,
  balanceAmount: number,
  paymentUrl: string
): Promise<{ success: boolean; message: string }> {
  const request = activeMatches.get(requestId);
  if (!request) {
    return { success: false, message: '요청을 찾을 수 없습니다.' };
  }

  if (request.matchedTechId !== techId) {
    return { success: false, message: '권한이 없습니다.' };
  }

  request.status = 'completed';
  request.completedAt = new Date();
  activeMatches.set(requestId, request);

  // Update database
  await query(
    `UPDATE match_requests SET status = 'completed', completed_at = NOW() WHERE id = $1`,
    [requestId]
  );

  // Notify customer with balance payment link
  if (request.customer?.phone) {
    notifyCustomerBalanceRequest(
      request.customer.phone,
      balanceAmount,
      paymentUrl
    ).catch(err => console.error('[Matching] Failed to notify customer:', err));
  }

  return { success: true, message: '작업 완료! 잔금 요청이 전송되었습니다.' };
}

/**
 * Get current matching status for widget
 */
export function getMatchingStatus(requestId: string): MatchingStatus | null {
  const request = activeMatches.get(requestId);
  if (!request) {
    return null;
  }

  const elapsedSeconds = Math.floor((Date.now() - request.createdAt.getTime()) / 1000);

  const levelNames = {
    1: '내 주변 검색 중',
    2: '인접 지역 확장 중',
    3: '서울 전역 검색 중',
  };

  let searchingDistricts: string[] = [];
  if (request.currentLevel === 1) {
    searchingDistricts = [DISTRICT_NAMES[request.district]];
  } else if (request.currentLevel === 2) {
    const adjacent = ADJACENT_DISTRICTS[request.district] || [];
    searchingDistricts = adjacent.map((d) => DISTRICT_NAMES[d]);
  } else {
    searchingDistricts = ['서울 전역'];
  }

  const totalPrice = request.basePrice + (request.surchargeApproved ? request.surchargeAmount : 0);

  return {
    requestId,
    level: request.currentLevel,
    levelName: levelNames[request.currentLevel],
    searchingDistricts,
    notifiedCount: request.notifiedTechIds.length,
    elapsedSeconds,
    totalPrice,
    surchargeRequired: request.currentLevel >= 2 && !request.surchargeApproved,
    surchargeAmount: request.surchargeAmount,
    matchedTech: null, // Would be populated when matched
  };
}

/**
 * Cancel a match request
 */
export function cancelMatch(requestId: string): boolean {
  const request = activeMatches.get(requestId);
  if (!request) {
    return false;
  }

  request.status = 'cancelled';
  activeMatches.set(requestId, request);

  // Update database (async)
  query(
    `UPDATE match_requests SET status = 'cancelled' WHERE id = $1`,
    [requestId]
  ).catch((err) => console.error('[Matching] Failed to cancel match:', err));

  return true;
}

/**
 * Cancel a match request with refund option (for customer cancellation)
 */
export async function cancelMatchRequest(
  requestId: string,
  withRefund: boolean
): Promise<{ success: boolean; message: string }> {
  const request = activeMatches.get(requestId);
  if (!request) {
    return { success: false, message: '요청을 찾을 수 없습니다.' };
  }

  // Only allow cancellation for pending/matching status
  if (!['pending', 'matching'].includes(request.status)) {
    return { success: false, message: '이미 기사님이 배정되어 취소가 불가능합니다.' };
  }

  // Check if within 1 minute for refund
  const elapsedMs = Date.now() - request.createdAt.getTime();
  const canRefund = elapsedMs < 60000; // 1 minute

  if (withRefund && !canRefund) {
    return { success: false, message: '1분이 경과하여 환불이 불가능합니다.' };
  }

  request.status = 'cancelled';
  activeMatches.set(requestId, request);

  // Update database
  await query(
    `UPDATE match_requests SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1`,
    [requestId]
  );

  // Process refund if requested and eligible
  if (withRefund && canRefund) {
    // TODO: Implement Toss Payments refund API call
    // For now, just log it
    console.log(`[Matching] Refund requested for ${requestId}`);

    // Update payment status
    await query(
      `UPDATE payments SET status = 'refunded', refunded_at = NOW()
       WHERE match_request_id = $1 AND type = 'callout' AND status = 'completed'`,
      [requestId]
    );
  }

  return {
    success: true,
    message: withRefund ? '취소되었습니다. 환불이 진행됩니다.' : '취소되었습니다.'
  };
}
