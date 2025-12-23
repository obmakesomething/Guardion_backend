import { config } from '../../config/index.js';
import type { QuoteParams, QuoteResult, LockType, SeoulDistrict } from '../../types/index.js';

/**
 * Difficulty price adjustments (in KRW)
 */
const DIFFICULTY_ADJUSTMENTS: Record<QuoteParams['difficulty'], number> = {
  easy: -10000,
  medium: 0,
  hard: 15000,
  expert: 30000,
};

/**
 * Lock type base adjustments (in KRW)
 */
const LOCK_TYPE_ADJUSTMENTS: Record<LockType, number> = {
  padlock: -20000,
  mechanical: -10000,
  digital: 0,
  smart: 20000,
  unknown: 5000,
};

/**
 * Night time surcharge (22:00 - 06:00)
 */
const NIGHT_SURCHARGE = 15000;

/**
 * Holiday surcharge
 */
const HOLIDAY_SURCHARGE = 10000;

/**
 * Urgent request surcharge
 */
const URGENT_SURCHARGE = 10000;

/**
 * Check if current time is night time (22:00 - 06:00 KST)
 */
export function isNightTime(date: Date = new Date()): boolean {
  // Convert to KST (UTC+9)
  const kstHours = (date.getUTCHours() + 9) % 24;
  return kstHours >= 22 || kstHours < 6;
}

/**
 * Check if date is a Korean holiday
 * This is a simplified version - in production, use a proper holiday API
 */
export function isKoreanHoliday(date: Date = new Date()): boolean {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const dayOfWeek = date.getDay();

  // Weekends
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return true;
  }

  // Major Korean holidays (fixed dates)
  const holidays = [
    { month: 1, day: 1 },   // New Year's Day
    { month: 3, day: 1 },   // Independence Movement Day
    { month: 5, day: 5 },   // Children's Day
    { month: 6, day: 6 },   // Memorial Day
    { month: 8, day: 15 },  // Liberation Day
    { month: 10, day: 3 },  // National Foundation Day
    { month: 10, day: 9 },  // Hangul Day
    { month: 12, day: 25 }, // Christmas
  ];

  return holidays.some((h) => h.month === month && h.day === day);
}

/**
 * Calculate dynamic quote based on various factors
 */
export function calculateQuote(params: QuoteParams): QuoteResult {
  const basePrice = config.pricing.basePrice;
  const priceBreakdown: string[] = [];

  // Base price
  priceBreakdown.push(`기본 요금: ${basePrice.toLocaleString('ko-KR')}원`);

  // Lock type adjustment
  const lockAdjustment = LOCK_TYPE_ADJUSTMENTS[params.lockType];
  if (lockAdjustment !== 0) {
    const sign = lockAdjustment > 0 ? '+' : '';
    priceBreakdown.push(`도어락 종류 (${params.lockType}): ${sign}${lockAdjustment.toLocaleString('ko-KR')}원`);
  }

  // Difficulty adjustment
  const difficultyAdjustment = DIFFICULTY_ADJUSTMENTS[params.difficulty];
  if (difficultyAdjustment !== 0) {
    const sign = difficultyAdjustment > 0 ? '+' : '';
    priceBreakdown.push(`작업 난이도 (${params.difficulty}): ${sign}${difficultyAdjustment.toLocaleString('ko-KR')}원`);
  }

  // Night surcharge
  const nightSurcharge = params.isNightTime ? NIGHT_SURCHARGE : 0;
  if (nightSurcharge > 0) {
    priceBreakdown.push(`야간 할증 (22시-06시): +${nightSurcharge.toLocaleString('ko-KR')}원`);
  }

  // Holiday surcharge
  const holidaySurcharge = params.isHoliday ? HOLIDAY_SURCHARGE : 0;
  if (holidaySurcharge > 0) {
    priceBreakdown.push(`휴일 할증: +${holidaySurcharge.toLocaleString('ko-KR')}원`);
  }

  // Urgent surcharge
  const urgentSurcharge = params.isUrgent ? URGENT_SURCHARGE : 0;
  if (urgentSurcharge > 0) {
    priceBreakdown.push(`긴급 출동 할증: +${urgentSurcharge.toLocaleString('ko-KR')}원`);
  }

  // Total calculation
  const totalPrice =
    basePrice +
    lockAdjustment +
    difficultyAdjustment +
    nightSurcharge +
    holidaySurcharge +
    urgentSurcharge;

  priceBreakdown.push(`---`);
  priceBreakdown.push(`총 예상 금액: ${totalPrice.toLocaleString('ko-KR')}원`);

  // Estimated arrival based on district density
  // This would be calculated more accurately with real tech availability data
  const estimatedArrival = getEstimatedArrival(params.district);

  return {
    basePrice,
    difficultyAdjustment,
    nightSurcharge,
    holidaySurcharge,
    urgentSurcharge,
    totalPrice,
    estimatedArrival,
    priceBreakdown,
  };
}

/**
 * Get estimated arrival time based on district
 * Returns time in minutes
 */
function getEstimatedArrival(district: SeoulDistrict): number {
  // Starting districts (성동구, 관악구) have faster response
  const priorityDistricts: SeoulDistrict[] = ['seongdong', 'gwanak'];

  if (priorityDistricts.includes(district)) {
    return 15; // 15 minutes for priority districts
  }

  // Adjacent to priority districts
  const adjacentToPriority: SeoulDistrict[] = [
    // Adjacent to 성동구
    'dongdaemun', 'gwangjin', 'gangnam', 'yongsan', 'jung',
    // Adjacent to 관악구
    'dongjak', 'geumcheon', 'seocho', 'guro',
  ];

  if (adjacentToPriority.includes(district)) {
    return 25; // 25 minutes for adjacent districts
  }

  // Other districts
  return 35; // 35 minutes for other districts
}

/**
 * Format quote for display
 */
export function formatQuoteForDisplay(quote: QuoteResult): string {
  return [
    `💰 예상 견적: ${quote.totalPrice.toLocaleString('ko-KR')}원`,
    `⏱️ 예상 도착: ${quote.estimatedArrival}분`,
    '',
    '📝 상세 내역:',
    ...quote.priceBreakdown,
  ].join('\n');
}

/**
 * Calculate price with wide area surcharge
 */
export function addWideAreaSurcharge(currentPrice: number): number {
  return currentPrice + config.pricing.surchargeAmount;
}
