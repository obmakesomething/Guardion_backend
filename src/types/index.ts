// Seoul Districts (Gu)
export type SeoulDistrict =
  | 'gangnam' | 'gangdong' | 'gangbuk' | 'gangseo'
  | 'gwanak' | 'gwangjin' | 'guro' | 'geumcheon'
  | 'nowon' | 'dobong' | 'dongdaemun' | 'dongjak'
  | 'mapo' | 'seodaemun' | 'seocho' | 'seongdong'
  | 'seongbuk' | 'songpa' | 'yangcheon' | 'yeongdeungpo'
  | 'yongsan' | 'eunpyeong' | 'jongno' | 'jung' | 'jungnang';

// District display names in Korean
export const DISTRICT_NAMES: Record<SeoulDistrict, string> = {
  gangnam: '강남구',
  gangdong: '강동구',
  gangbuk: '강북구',
  gangseo: '강서구',
  gwanak: '관악구',
  gwangjin: '광진구',
  guro: '구로구',
  geumcheon: '금천구',
  nowon: '노원구',
  dobong: '도봉구',
  dongdaemun: '동대문구',
  dongjak: '동작구',
  mapo: '마포구',
  seodaemun: '서대문구',
  seocho: '서초구',
  seongdong: '성동구',
  seongbuk: '성북구',
  songpa: '송파구',
  yangcheon: '양천구',
  yeongdeungpo: '영등포구',
  yongsan: '용산구',
  eunpyeong: '은평구',
  jongno: '종로구',
  jung: '중구',
  jungnang: '중랑구',
};

// Adjacent districts matrix
export const ADJACENT_DISTRICTS: Record<SeoulDistrict, SeoulDistrict[]> = {
  gangnam: ['seocho', 'songpa', 'gwangjin', 'seongdong', 'yongsan'],
  gangdong: ['songpa', 'gwangjin', 'jungnang'],
  gangbuk: ['dobong', 'nowon', 'seongbuk', 'eunpyeong'],
  gangseo: ['yangcheon', 'mapo', 'eunpyeong'],
  gwanak: ['dongjak', 'geumcheon', 'seocho', 'guro'],
  gwangjin: ['seongdong', 'dongdaemun', 'jungnang', 'gangdong', 'songpa', 'gangnam'],
  guro: ['geumcheon', 'yeongdeungpo', 'yangcheon', 'gwanak'],
  geumcheon: ['guro', 'gwanak', 'dongjak', 'yeongdeungpo'],
  nowon: ['dobong', 'gangbuk', 'seongbuk', 'jungnang'],
  dobong: ['gangbuk', 'nowon'],
  dongdaemun: ['jungnang', 'gwangjin', 'seongdong', 'jung', 'jongno', 'seongbuk'],
  dongjak: ['yeongdeungpo', 'yongsan', 'seocho', 'gwanak', 'geumcheon'],
  mapo: ['seodaemun', 'yongsan', 'yeongdeungpo', 'gangseo', 'eunpyeong'],
  seodaemun: ['eunpyeong', 'jongno', 'jung', 'yongsan', 'mapo'],
  seocho: ['gangnam', 'dongjak', 'gwanak', 'yongsan'],
  seongdong: ['dongdaemun', 'gwangjin', 'gangnam', 'yongsan', 'jung'],
  seongbuk: ['gangbuk', 'nowon', 'jungnang', 'dongdaemun', 'jongno'],
  songpa: ['gangdong', 'gwangjin', 'gangnam'],
  yangcheon: ['gangseo', 'guro', 'yeongdeungpo'],
  yeongdeungpo: ['yangcheon', 'guro', 'geumcheon', 'dongjak', 'yongsan', 'mapo'],
  yongsan: ['mapo', 'seodaemun', 'jung', 'seongdong', 'gangnam', 'seocho', 'dongjak', 'yeongdeungpo'],
  eunpyeong: ['gangbuk', 'jongno', 'seodaemun', 'mapo', 'gangseo'],
  jongno: ['eunpyeong', 'seongbuk', 'dongdaemun', 'jung', 'seodaemun'],
  jung: ['jongno', 'dongdaemun', 'seongdong', 'yongsan', 'seodaemun'],
  jungnang: ['nowon', 'seongbuk', 'dongdaemun', 'gwangjin', 'gangdong'],
};

// Lock types and difficulty
export type LockType = 'digital' | 'mechanical' | 'smart' | 'padlock' | 'unknown';

export interface LockAnalysisResult {
  lockType: LockType;
  brand: string | null;
  model: string | null;
  difficulty: 'easy' | 'medium' | 'hard' | 'expert';
  estimatedTime: number; // minutes
  confidence: number; // 0-100
}

// Technician (Affiliate)
export interface Technician {
  id: string;
  name: string;
  phone: string;
  district: SeoulDistrict;
  rating: number;
  completedJobs: number;
  isAvailable: boolean;
  specialties: LockType[];
  lastActiveAt: Date;
}

// Matching request
export interface MatchRequest {
  id: string;
  userId: string;
  district: SeoulDistrict;
  lockAnalysis: LockAnalysisResult | null;
  basePrice: number;
  surchargeApproved: boolean;
  surchargeAmount: number;
  currentLevel: 1 | 2 | 3;
  status: 'pending' | 'matching' | 'matched' | 'cancelled' | 'expired';
  matchedTechId: string | null;
  notifiedTechIds: string[];
  createdAt: Date;
  expiresAt: Date | null;
}

// Quote calculation
export interface QuoteParams {
  district: SeoulDistrict;
  lockType: LockType;
  difficulty: 'easy' | 'medium' | 'hard' | 'expert';
  isNightTime: boolean;
  isHoliday: boolean;
  isUrgent: boolean;
}

export interface QuoteResult {
  basePrice: number;
  difficultyAdjustment: number;
  nightSurcharge: number;
  holidaySurcharge: number;
  urgentSurcharge: number;
  totalPrice: number;
  estimatedArrival: number; // minutes
  priceBreakdown: string[];
}

// Matching status for widget
export interface MatchingStatus {
  requestId: string;
  level: 1 | 2 | 3;
  levelName: string;
  searchingDistricts: string[];
  notifiedCount: number;
  elapsedSeconds: number;
  totalPrice: number;
  surchargeRequired: boolean;
  surchargeAmount: number;
  matchedTech: {
    name: string;
    rating: number;
    eta: number;
  } | null;
}
