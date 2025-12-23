import { v4 as uuid } from 'uuid';
import { config } from '../../config/index.js';
import { query } from '../../db/pool.js';

/**
 * Payment Types
 */
export type PaymentType = 'callout' | 'balance' | 'surcharge';
export type PaymentStatus = 'pending' | 'ready' | 'completed' | 'failed' | 'cancelled' | 'refunded';

export interface PaymentRequest {
  id: string;
  matchRequestId: string;
  type: PaymentType;
  amount: number;
  status: PaymentStatus;
  orderId: string;
  paymentKey?: string;
  createdAt: Date;
  paidAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface TossPaymentResponse {
  paymentKey: string;
  orderId: string;
  status: string;
  totalAmount: number;
  approvedAt?: string;
  method?: string;
  card?: {
    company: string;
    number: string;
  };
}

// In-memory store for payments
const paymentRequests = new Map<string, PaymentRequest>();

/**
 * Create a payment request for callout deposit
 */
export async function createCalloutPayment(matchRequestId: string): Promise<{
  paymentId: string;
  orderId: string;
  amount: number;
  checkoutUrl: string;
}> {
  const id = uuid();
  const orderId = `OPENNOW-${Date.now()}-${id.slice(0, 8)}`;
  const amount = config.pricing.calloutFee;

  const paymentRequest: PaymentRequest = {
    id,
    matchRequestId,
    type: 'callout',
    amount,
    status: 'pending',
    orderId,
    createdAt: new Date(),
  };

  paymentRequests.set(id, paymentRequest);

  // Log to database
  try {
    await query(
      `INSERT INTO payments (id, match_request_id, type, amount, status, order_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, matchRequestId, 'callout', amount, 'pending', orderId, new Date()]
    );
  } catch (error) {
    console.error('[Payment] Failed to log payment request:', error);
  }

  // Generate Toss checkout URL
  const checkoutUrl = buildTossCheckoutUrl({
    orderId,
    amount,
    orderName: 'OpenNow AI 긴급 개문 출장비',
    customerName: '고객',
  });

  return {
    paymentId: id,
    orderId,
    amount,
    checkoutUrl,
  };
}

/**
 * Create a payment request for final balance
 */
export async function createBalancePayment(
  matchRequestId: string,
  balanceAmount: number,
  techNotes?: string
): Promise<{
  paymentId: string;
  orderId: string;
  amount: number;
  platformFee: number;
  techShare: number;
  checkoutUrl: string;
}> {
  const id = uuid();
  const orderId = `OPENNOW-BAL-${Date.now()}-${id.slice(0, 8)}`;

  // Calculate platform fee (10-15% of balance)
  const platformFee = Math.round(balanceAmount * config.pricing.balanceFeeRate);
  const techShare = balanceAmount - platformFee;

  const paymentRequest: PaymentRequest = {
    id,
    matchRequestId,
    type: 'balance',
    amount: balanceAmount,
    status: 'pending',
    orderId,
    createdAt: new Date(),
    metadata: { platformFee, techShare, techNotes },
  };

  paymentRequests.set(id, paymentRequest);

  // Log to database
  try {
    await query(
      `INSERT INTO payments (id, match_request_id, type, amount, status, order_id, platform_fee, tech_share, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, matchRequestId, 'balance', balanceAmount, 'pending', orderId, platformFee, techShare, new Date()]
    );
  } catch (error) {
    console.error('[Payment] Failed to log balance payment request:', error);
  }

  const checkoutUrl = buildTossCheckoutUrl({
    orderId,
    amount: balanceAmount,
    orderName: 'OpenNow AI 긴급 개문 작업비',
    customerName: '고객',
  });

  return {
    paymentId: id,
    orderId,
    amount: balanceAmount,
    platformFee,
    techShare,
    checkoutUrl,
  };
}

/**
 * Build Toss Payments checkout URL
 */
function buildTossCheckoutUrl(params: {
  orderId: string;
  amount: number;
  orderName: string;
  customerName: string;
}): string {
  if (!config.toss.clientKey) {
    // Development fallback - return mock URL
    return `${config.urls.paymentPage}?orderId=${params.orderId}&amount=${params.amount}&mock=true`;
  }

  // Toss Payments checkout page URL
  const baseUrl = 'https://pay.toss.im/checkout';
  const queryParams = new URLSearchParams({
    clientKey: config.toss.clientKey,
    orderId: params.orderId,
    amount: String(params.amount),
    orderName: params.orderName,
    customerName: params.customerName,
    successUrl: config.toss.successUrl,
    failUrl: config.toss.failUrl,
  });

  return `${baseUrl}?${queryParams.toString()}`;
}

/**
 * Confirm payment with Toss (called from success callback)
 */
export async function confirmTossPayment(
  paymentKey: string,
  orderId: string,
  amount: number
): Promise<{ success: boolean; payment?: TossPaymentResponse; error?: string }> {
  // Find payment request by orderId
  const paymentRequest = Array.from(paymentRequests.values())
    .find((p) => p.orderId === orderId);

  if (!paymentRequest) {
    return { success: false, error: '결제 요청을 찾을 수 없습니다.' };
  }

  if (paymentRequest.amount !== amount) {
    return { success: false, error: '결제 금액이 일치하지 않습니다.' };
  }

  if (!config.toss.secretKey) {
    // Development mode - auto approve
    paymentRequest.status = 'completed';
    paymentRequest.paymentKey = paymentKey;
    paymentRequest.paidAt = new Date();
    paymentRequests.set(paymentRequest.id, paymentRequest);

    return {
      success: true,
      payment: {
        paymentKey,
        orderId,
        status: 'DONE',
        totalAmount: amount,
        approvedAt: new Date().toISOString(),
      },
    };
  }

  // Call Toss Payments API to confirm
  try {
    const response = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(config.toss.secretKey + ':').toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        paymentKey,
        orderId,
        amount,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('[Payment] Toss confirm failed:', errorData);
      paymentRequest.status = 'failed';
      paymentRequests.set(paymentRequest.id, paymentRequest);
      return { success: false, error: errorData.message ?? '결제 승인에 실패했습니다.' };
    }

    const tossPayment = await response.json() as TossPaymentResponse;

    // Update payment request
    paymentRequest.status = 'completed';
    paymentRequest.paymentKey = paymentKey;
    paymentRequest.paidAt = new Date();
    paymentRequests.set(paymentRequest.id, paymentRequest);

    // Update database
    await query(
      `UPDATE payments SET status = 'completed', payment_key = $1, paid_at = $2 WHERE id = $3`,
      [paymentKey, new Date(), paymentRequest.id]
    );

    return { success: true, payment: tossPayment };
  } catch (error) {
    console.error('[Payment] Error confirming payment:', error);
    paymentRequest.status = 'failed';
    paymentRequests.set(paymentRequest.id, paymentRequest);
    return { success: false, error: '결제 처리 중 오류가 발생했습니다.' };
  }
}

/**
 * Get payment status
 */
export function getPaymentStatus(paymentId: string): PaymentRequest | null {
  return paymentRequests.get(paymentId) ?? null;
}

/**
 * Get payment by match request ID and type
 */
export function getPaymentByMatchAndType(
  matchRequestId: string,
  type: PaymentType
): PaymentRequest | null {
  return Array.from(paymentRequests.values())
    .find((p) => p.matchRequestId === matchRequestId && p.type === type) ?? null;
}

/**
 * Check if callout has been paid for a match request
 */
export function isCalloutPaid(matchRequestId: string): boolean {
  const payment = getPaymentByMatchAndType(matchRequestId, 'callout');
  return payment?.status === 'completed';
}

/**
 * Estimate balance range based on lock difficulty
 */
export function estimateBalanceRange(difficulty: 'easy' | 'medium' | 'hard' | 'expert'): {
  min: number;
  max: number;
  description: string;
} {
  const ranges: Record<string, { min: number; max: number; description: string }> = {
    easy: { min: 30000, max: 50000, description: '일반 잠금 (자물쇠, 기계식)' },
    medium: { min: 50000, max: 80000, description: '디지털 도어락 (일반)' },
    hard: { min: 80000, max: 120000, description: '고급 스마트락' },
    expert: { min: 120000, max: 200000, description: '특수 보안 장치' },
  };

  return ranges[difficulty] ?? ranges.medium;
}

/**
 * Format price for display
 */
export function formatPrice(amount: number): string {
  return `₩${amount.toLocaleString('ko-KR')}`;
}

/**
 * Calculate settlement amounts for technician
 */
export function calculateSettlement(matchRequestId: string): {
  calloutShare: number;
  balanceShare: number;
  totalShare: number;
  platformTotal: number;
} | null {
  const calloutPayment = getPaymentByMatchAndType(matchRequestId, 'callout');
  const balancePayment = getPaymentByMatchAndType(matchRequestId, 'balance');

  if (!calloutPayment || calloutPayment.status !== 'completed') {
    return null;
  }

  const calloutShare = config.pricing.techCalloutShare;
  let balanceShare = 0;
  let platformFromBalance = 0;

  if (balancePayment?.status === 'completed') {
    const metadata = balancePayment.metadata as { techShare?: number; platformFee?: number } | undefined;
    balanceShare = metadata?.techShare ?? 0;
    platformFromBalance = metadata?.platformFee ?? 0;
  }

  return {
    calloutShare,
    balanceShare,
    totalShare: calloutShare + balanceShare,
    platformTotal: config.pricing.platformFeeFromCallout + platformFromBalance,
  };
}
