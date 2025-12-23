import type { LockAnalysisResult, LockType } from '../../types/index.js';

/**
 * Known lock brands and their typical models
 */
const KNOWN_LOCKS: Record<string, { type: LockType; difficulty: LockAnalysisResult['difficulty']; time: number }> = {
  // Samsung Digital Locks
  'samsung_shp': { type: 'digital', difficulty: 'medium', time: 20 },
  'samsung_dp': { type: 'smart', difficulty: 'hard', time: 35 },
  'samsung_p': { type: 'digital', difficulty: 'medium', time: 25 },

  // LG Digital Locks
  'lg_gateman': { type: 'digital', difficulty: 'medium', time: 25 },

  // Yale
  'yale_nest': { type: 'smart', difficulty: 'hard', time: 40 },
  'yale_digital': { type: 'digital', difficulty: 'medium', time: 20 },

  // Schlage
  'schlage_connect': { type: 'smart', difficulty: 'hard', time: 35 },
  'schlage_mechanical': { type: 'mechanical', difficulty: 'easy', time: 15 },

  // Korean brands
  'evernet': { type: 'digital', difficulty: 'easy', time: 15 },
  'milre': { type: 'digital', difficulty: 'medium', time: 20 },
  'commax': { type: 'digital', difficulty: 'medium', time: 25 },
  'kocom': { type: 'digital', difficulty: 'medium', time: 20 },

  // Generic
  'generic_digital': { type: 'digital', difficulty: 'medium', time: 25 },
  'generic_mechanical': { type: 'mechanical', difficulty: 'easy', time: 15 },
  'generic_padlock': { type: 'padlock', difficulty: 'easy', time: 10 },
};

/**
 * Analyze lock from image description
 * In production, this would call an AI vision API
 */
export async function analyzeLockImage(imageUrl: string): Promise<LockAnalysisResult> {
  // TODO: Integrate with actual AI vision API (GPT-4V, Claude Vision, etc.)
  // For now, return a mock analysis

  // Simulate API delay
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Default to a common Korean digital lock
  const defaultResult: LockAnalysisResult = {
    lockType: 'digital',
    brand: null,
    model: null,
    difficulty: 'medium',
    estimatedTime: 25,
    confidence: 60,
  };

  return defaultResult;
}

/**
 * Analyze lock from user description (text-based)
 */
export function analyzeLockFromDescription(description: string): LockAnalysisResult {
  const lowerDesc = description.toLowerCase();

  // Check for known brands
  if (lowerDesc.includes('삼성') || lowerDesc.includes('samsung')) {
    if (lowerDesc.includes('스마트') || lowerDesc.includes('smart') || lowerDesc.includes('dp')) {
      return {
        lockType: 'smart',
        brand: 'Samsung',
        model: 'SHP-DP Series',
        difficulty: 'hard',
        estimatedTime: 35,
        confidence: 75,
      };
    }
    return {
      lockType: 'digital',
      brand: 'Samsung',
      model: 'SHP Series',
      difficulty: 'medium',
      estimatedTime: 25,
      confidence: 70,
    };
  }

  if (lowerDesc.includes('게이트맨') || lowerDesc.includes('gateman') || lowerDesc.includes('lg')) {
    return {
      lockType: 'digital',
      brand: 'LG Gateman',
      model: null,
      difficulty: 'medium',
      estimatedTime: 25,
      confidence: 70,
    };
  }

  if (lowerDesc.includes('에버넷') || lowerDesc.includes('evernet')) {
    return {
      lockType: 'digital',
      brand: 'Evernet',
      model: null,
      difficulty: 'easy',
      estimatedTime: 15,
      confidence: 75,
    };
  }

  if (lowerDesc.includes('밀레') || lowerDesc.includes('milre')) {
    return {
      lockType: 'digital',
      brand: 'Milre',
      model: null,
      difficulty: 'medium',
      estimatedTime: 20,
      confidence: 70,
    };
  }

  // Check for lock types
  if (lowerDesc.includes('디지털') || lowerDesc.includes('digital') || lowerDesc.includes('번호')) {
    return {
      lockType: 'digital',
      brand: null,
      model: null,
      difficulty: 'medium',
      estimatedTime: 25,
      confidence: 60,
    };
  }

  if (lowerDesc.includes('스마트') || lowerDesc.includes('smart') || lowerDesc.includes('앱')) {
    return {
      lockType: 'smart',
      brand: null,
      model: null,
      difficulty: 'hard',
      estimatedTime: 35,
      confidence: 55,
    };
  }

  if (lowerDesc.includes('열쇠') || lowerDesc.includes('기계식') || lowerDesc.includes('mechanical')) {
    return {
      lockType: 'mechanical',
      brand: null,
      model: null,
      difficulty: 'easy',
      estimatedTime: 15,
      confidence: 65,
    };
  }

  if (lowerDesc.includes('자물쇠') || lowerDesc.includes('padlock')) {
    return {
      lockType: 'padlock',
      brand: null,
      model: null,
      difficulty: 'easy',
      estimatedTime: 10,
      confidence: 70,
    };
  }

  // Default unknown
  return {
    lockType: 'unknown',
    brand: null,
    model: null,
    difficulty: 'medium',
    estimatedTime: 30,
    confidence: 40,
  };
}

/**
 * Get difficulty description in Korean
 */
export function getDifficultyDescription(difficulty: LockAnalysisResult['difficulty']): string {
  const descriptions: Record<LockAnalysisResult['difficulty'], string> = {
    easy: '쉬움 (일반 열쇠/자물쇠)',
    medium: '보통 (일반 디지털 도어락)',
    hard: '어려움 (스마트락/고급 도어락)',
    expert: '전문가 수준 (특수 보안 장치)',
  };
  return descriptions[difficulty];
}

/**
 * Get lock type description in Korean
 */
export function getLockTypeDescription(lockType: LockType): string {
  const descriptions: Record<LockType, string> = {
    digital: '디지털 도어락',
    mechanical: '기계식 잠금장치',
    smart: '스마트락',
    padlock: '자물쇠',
    unknown: '미확인',
  };
  return descriptions[lockType];
}
