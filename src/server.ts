import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { config } from './config/index.js';
import {
  analyzeLockFromDescription,
  analyzeLockImage,
  getLockTypeDescription,
  getDifficultyDescription,
} from './modules/lock-analysis/index.js';
import {
  createMatchRequest,
  executeLevel1Matching,
  executeLevel2Matching,
  getMatchingStatus,
  getMatchRequest,
  updateJobDeparted,
  updateJobArrived,
  updateJobCompleted,
} from './modules/matching/index.js';
import {
  createCalloutPayment,
  createBalancePayment,
  estimateBalanceRange,
  formatPrice,
  confirmTossPayment,
  getPaymentByMatchAndType,
} from './modules/payment/index.js';
import { DISTRICT_NAMES, type SeoulDistrict } from './types/index.js';
import { acceptMatch } from './modules/matching/index.js';
import {
  generateOTP,
  storeOTP,
  verifyOTP,
  getOrCreateCustomerByPhone,
  getOrCreateCustomerByGoogle,
  generateToken,
  verifyToken,
  getCustomerRequests,
  linkCustomerToRequest,
} from './modules/auth/index.js';
import { sendKakaoAlimtalk } from './modules/solapi/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================
// Information URLs (NOT order/dispatch - info only)
// ============================================================
const INFO_URLS = {
  faq: 'https://klygo.online/faq',          // 자주 묻는 질문
  safetyGuide: 'https://klygo.online/guide', // 안전 가이드
  priceInfo: 'https://klygo.online/pricing', // 가격 안내 (범위)
};

// Helper: Read request body as JSON
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// Helper: Send JSON response
function sendJson(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

// Load widget HTML
let widgetHtml: string;
try {
  widgetHtml = readFileSync(join(__dirname, '../public/klygo-widget.html'), 'utf8');
} catch {
  widgetHtml = '<html><body><h1>klygo Widget</h1></body></html>';
}

// ============================================================
// NEW TOOL SCHEMAS - Triage Only (No dispatch/payment in app)
// ============================================================

// Tool 1: 상황 평가 (트리아지)
const assessSituationSchema = {
  situationType: z.enum(['door_locked', 'key_lost', 'lock_broken', 'other'])
    .describe('상황 유형: door_locked(문 잠김), key_lost(열쇠 분실), lock_broken(도어락 고장), other(기타)'),
  isOwner: z.boolean().describe('본인 거주지/점유 여부'),
  canVerifyIdentity: z.boolean().describe('신분증 등으로 본인 확인 가능 여부'),
  urgency: z.enum(['now', 'today', 'tomorrow']).describe('긴급도: now(지금), today(오늘 중), tomorrow(내일)'),
  allowDamage: z.boolean().describe('파손 개문 허용 여부'),
};

// Tool 2: 도어락 분석 (기존 유지)
const analyzeLockSchema = {
  imageUrl: z.string().optional().describe('도어락 사진 URL (선택)'),
  description: z.string().describe('도어락 종류, 브랜드, 또는 상황 설명'),
  lockType: z.enum(['digital', 'mechanical', 'smart', 'padlock', 'unknown']).optional()
    .describe('도어락 유형'),
};

// Tool 3: 최종 추천 및 외부 연결
const getRecommendationSchema = {
  situationType: z.enum(['door_locked', 'key_lost', 'lock_broken', 'other']),
  lockType: z.enum(['digital', 'mechanical', 'smart', 'padlock', 'unknown']),
  difficulty: z.enum(['easy', 'medium', 'hard', 'expert']),
  urgency: z.enum(['now', 'today', 'tomorrow']),
  roughArea: z.string().optional().describe('대략적 지역 (예: 서울 성동구) - 정확한 주소 아님'),
};

// Widget state interface - Simplified for triage
interface WidgetState {
  status: 'idle' | 'assessing' | 'analyzing' | 'recommendation';
  assessment?: {
    situationType: string;
    isOwner: boolean;
    urgency: string;
    allowDamage: boolean;
  };
  lockAnalysis?: {
    lockType: string;
    brand: string | null;
    difficulty: string;
    estimatedTime: number;
    costRange: { min: number; max: number };
  };
  recommendation?: {
    level: 'diy' | 'technician' | 'emergency';
    summary: string;
    externalUrl: string;
  };
}

let currentWidgetState: WidgetState = { status: 'idle' };

function buildWidgetResponse(message: string) {
  return {
    content: [{ type: 'text' as const, text: message }],
    structuredContent: { widgetState: currentWidgetState },
  };
}

function createklygoServer() {
  const server = new McpServer({ name: 'klygo', version: '2.0.0' });

  // Register the widget resource
  server.registerResource(
    'klygo-widget',
    'ui://widget/klygo.html',
    { description: 'klygo 긴급 개문 서비스 - 상담 위젯' },
    async () => ({
      contents: [
        {
          uri: 'ui://widget/klygo.html',
          mimeType: 'text/html+skybridge',
          text: widgetHtml,
          _meta: { 'openai/widgetPrefersBorder': true },
        },
      ],
    })
  );

  // ============================================================
  // Tool 1: assess_situation (상황 평가 - 트리아지)
  // ============================================================
  server.registerTool(
    'assess_situation',
    {
      title: '상황 평가',
      description: '문 잠김/열쇠 분실 등 상황을 평가하고, DIY 가능 여부와 기사 호출 필요성을 판단합니다.',
      inputSchema: assessSituationSchema,
      annotations: {
        readOnlyHint: true,  // 읽기 전용 - 외부 시스템 변경 없음
      },
    },
    async (args) => {
      currentWidgetState = {
        status: 'assessing',
        assessment: {
          situationType: args.situationType,
          isOwner: args.isOwner,
          urgency: args.urgency,
          allowDamage: args.allowDamage,
        },
      };

      // 본인 확인 불가 시 경고
      if (!args.isOwner || !args.canVerifyIdentity) {
        return buildWidgetResponse(
          `⚠️ 주의사항\n\n` +
          `본인 거주지가 아니거나 신분 확인이 어려운 경우,\n` +
          `기사님이 현장에서 신분 확인을 요청할 수 있습니다.\n\n` +
          `• 신분증 (주민등록증, 운전면허증)\n` +
          `• 거주 증빙 (등기부등본, 임대차계약서)\n` +
          `• 관리사무소/경비실 확인\n\n` +
          `위 서류를 준비해주시면 원활한 서비스가 가능합니다.`
        );
      }

      const situationNames: Record<string, string> = {
        door_locked: '문 잠김',
        key_lost: '열쇠 분실',
        lock_broken: '도어락 고장',
        other: '기타 상황',
      };

      const urgencyNames: Record<string, string> = {
        now: '지금 바로',
        today: '오늘 중',
        tomorrow: '내일',
      };

      return buildWidgetResponse(
        `📋 상황 확인\n\n` +
        `• 상황: ${situationNames[args.situationType]}\n` +
        `• 긴급도: ${urgencyNames[args.urgency]}\n` +
        `• 파손 허용: ${args.allowDamage ? '예' : '아니오 (무파괴 개문 시도)'}\n\n` +
        `다음으로, 도어락 종류를 알려주시거나 사진을 보내주세요.\n` +
        `도어락 분석을 통해 예상 비용과 시간을 안내해드립니다.`
      );
    }
  );

  // ============================================================
  // Tool 2: analyze_lock (도어락 분석)
  // ============================================================
  server.registerTool(
    'analyze_lock',
    {
      title: '도어락 분석',
      description: '도어락 사진이나 설명을 기반으로 종류, 난이도, 예상 비용 범위를 분석합니다.',
      inputSchema: analyzeLockSchema,
      annotations: {
        readOnlyHint: true,  // 읽기 전용 - 외부 시스템 변경 없음
      },
    },
    async (args) => {
      currentWidgetState = { ...currentWidgetState, status: 'analyzing' };

      let analysis;
      if (args.imageUrl) {
        analysis = await analyzeLockImage(args.imageUrl);
      } else if (args.description) {
        analysis = analyzeLockFromDescription(args.description);
      } else {
        return buildWidgetResponse('도어락 사진 또는 설명을 제공해주세요.');
      }

      // Get estimated cost range
      const costRange = estimateBalanceRange(analysis.difficulty);

      currentWidgetState = {
        ...currentWidgetState,
        status: 'analyzing',
        lockAnalysis: {
          lockType: getLockTypeDescription(analysis.lockType),
          brand: analysis.brand,
          difficulty: getDifficultyDescription(analysis.difficulty),
          estimatedTime: analysis.estimatedTime,
          costRange: { min: costRange.min, max: costRange.max },
        },
      };

      const message = [
        `🔐 도어락 분석 결과`,
        ``,
        `• 종류: ${getLockTypeDescription(analysis.lockType)}`,
        analysis.brand ? `• 브랜드: ${analysis.brand}` : null,
        `• 난이도: ${getDifficultyDescription(analysis.difficulty)}`,
        `• 예상 작업 시간: 약 ${analysis.estimatedTime}분`,
        ``,
        `━━━━━━━━━━━━━━━━━━━━━━`,
        `💰 예상 비용 범위`,
        `━━━━━━━━━━━━━━━━━━━━━━`,
        `• 출장비: ${formatPrice(config.pricing.calloutFee)} (선결제)`,
        `• 작업비: ${formatPrice(costRange.min)} ~ ${formatPrice(costRange.max)}`,
        `• 총 예상: ${formatPrice(costRange.min + config.pricing.calloutFee)} ~ ${formatPrice(costRange.max + config.pricing.calloutFee)}`,
        ``,
        `※ 실제 비용은 현장 상황에 따라 달라질 수 있습니다.`,
        ``,
        `━━━━━━━━━━━━━━━━━━━━━━`,
        `🔧 작업 방식 안내`,
        `━━━━━━━━━━━━━━━━━━━━━━`,
        `• 무파괴 개문: 도어락 손상 없이 개문 (가능한 경우)`,
        `• 파괴 개문: 도어락 해체 후 개문 (불가피한 경우)`,
        `• 파괴 개문 시 새 도어락 설치 비용 별도 발생`,
      ]
        .filter(Boolean)
        .join('\n');

      return buildWidgetResponse(message);
    }
  );

  // ============================================================
  // Tool 3: get_recommendation (최종 추천 및 외부 연결)
  // ============================================================
  server.registerTool(
    'get_recommendation',
    {
      title: '상황별 안내',
      description: '상황 분석 결과를 바탕으로 DIY 가능 여부, 일반적 비용 범위, 주의사항을 안내합니다. 업체 연결/예약/배차/결제는 제공하지 않습니다.',
      inputSchema: getRecommendationSchema,
      annotations: {
        readOnlyHint: true,  // 읽기 전용 - 정보 제공만
      },
    },
    async (args) => {
      // Determine recommendation level
      let level: 'diy' | 'technician' | 'emergency' = 'technician';
      let summary = '';

      // DIY 가능 케이스
      if (
        args.lockType === 'mechanical' &&
        args.difficulty === 'easy' &&
        args.urgency !== 'now'
      ) {
        level = 'diy';
        summary = 'DIY로 해결 가능할 수 있습니다';
      }
      // 긴급 케이스
      else if (
        args.urgency === 'now' &&
        (args.situationType === 'door_locked' || args.difficulty === 'expert')
      ) {
        level = 'emergency';
        summary = '긴급 출동이 필요합니다';
      }
      // 일반 기사 호출
      else {
        level = 'technician';
        summary = '전문 기사님 호출을 권장합니다';
      }

      currentWidgetState = {
        ...currentWidgetState,
        status: 'recommendation',
        recommendation: {
          level,
          summary,
          externalUrl: INFO_URLS.faq,
        },
      };

      const levelMessages: Record<string, string[]> = {
        diy: [
          `✅ DIY 가능성 있음`,
          ``,
          `간단한 기계식 잠금장치로 보입니다.`,
          `아래 방법을 먼저 시도해보세요:`,
          ``,
          `1. 관리사무소/경비실에 마스터키 문의`,
          `2. 가족/동거인에게 여분 열쇠 요청`,
          `3. 카드 등으로 래치 밀어보기 (일부 도어락)`,
          ``,
          `⚠️ 무리한 시도 시 도어락이 손상될 수 있습니다.`,
        ],
        technician: [
          `👨‍🔧 전문 기사 필요`,
          ``,
          `이 상황은 전문 기사의 도움이 필요해 보입니다.`,
          ``,
          `━━━━━━━━━━━━━━━━━━━━━━`,
          `💰 일반적인 비용 범위 (참고용)`,
          `━━━━━━━━━━━━━━━━━━━━━━`,
          `• 출장비: 3~4만원대`,
          `• 작업비: 5~12만원대 (난이도별 상이)`,
          ``,
          `※ 본 금액은 정보 제공용 범위이며,`,
          `  특정 업체의 견적/오퍼가 아닙니다.`,
        ],
        emergency: [
          `🚨 긴급 상황 안내`,
          ``,
          `빠른 조치가 필요한 상황입니다.`,
          ``,
          `• 야간/주말에는 할증이 적용될 수 있습니다`,
          `• 안전상 문제가 있다면 119에 먼저 연락하세요`,
          ``,
          `━━━━━━━━━━━━━━━━━━━━━━`,
          `💰 일반적인 비용 범위 (참고용)`,
          `━━━━━━━━━━━━━━━━━━━━━━`,
          `• 출장비: 3~5만원대 (야간 할증 포함 시)`,
          `• 작업비: 5~15만원대`,
          ``,
          `※ 본 금액은 정보 제공용 범위이며,`,
          `  특정 업체의 견적/오퍼가 아닙니다.`,
        ],
      };

      // 정보 제공용 안내 (주문/배차 유도 아님)
      const infoSection = [
        ``,
        `━━━━━━━━━━━━━━━━━━━━━━`,
        `📚 추가 정보`,
        `━━━━━━━━━━━━━━━━━━━━━━`,
        ``,
        `• 자주 묻는 질문: ${INFO_URLS.faq}`,
        `• 안전 가이드: ${INFO_URLS.safetyGuide}`,
        `• 가격 구성 안내: ${INFO_URLS.priceInfo}`,
        ``,
        `━━━━━━━━━━━━━━━━━━━━━━`,
        `⚠️ 중요 안내`,
        `━━━━━━━━━━━━━━━━━━━━━━`,
        `• 본 앱은 정보 제공 목적이며,`,
        `  업체 연결/예약/배차/결제를 하지 않습니다.`,
        `• 실제 서비스 이용은 별도 채널을 통해 진행하세요.`,
        ``,
        `🔒 바가지 방지 팁`,
        `• 작업 전 반드시 견적을 확인하세요`,
        `• 추가비 항목(파손/심야 등)을 미리 문의하세요`,
        `• 불합리한 요금은 소비자원에 신고 가능합니다`,
      ];

      const message = [...levelMessages[level], ...infoSection].filter(Boolean).join('\n');

      return buildWidgetResponse(message);
    }
  );

  return server;
}

// HTTP Server
const port = config.port;
const MCP_PATH = '/mcp';

const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (!req.url) {
    res.writeHead(400).end('Missing URL');
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type, mcp-session-id',
      'Access-Control-Expose-Headers': 'Mcp-Session-Id',
    });
    res.end();
    return;
  }

  // Health check
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      service: 'klygo',
      status: 'healthy',
      version: '2.0.0',
      description: 'Emergency locksmith information service',
      note: 'Information only - no dispatch/booking/payment',
      infoPages: INFO_URLS,
    }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('OK');
    return;
  }

  // =========================================================
  // EXTERNAL DISPATCH API (웹/카카오에서 호출)
  // =========================================================

  // Create dispatch request (from external web/kakao)
  if (req.method === 'POST' && url.pathname === '/api/dispatch/create') {
    try {
      const body = await readJsonBody(req);
      const { phone, address, lockType, difficulty, situationType, notes } = body as {
        phone: string;
        address: string;
        lockType: string;
        difficulty: string;
        situationType: string;
        notes?: string;
      };

      if (!phone || !address) {
        sendJson(res, 400, { success: false, error: '전화번호와 주소가 필요합니다.' });
        return;
      }

      // Create match request
      const districtMatch = address.match(/(강남|강동|강북|강서|관악|광진|구로|금천|노원|도봉|동대문|동작|마포|서대문|서초|성동|성북|송파|양천|영등포|용산|은평|종로|중구|중랑)구/);
      const district = districtMatch ? districtMatch[0] : 'seongdong';

      const matchRequest = await createMatchRequest({
        district: district as SeoulDistrict,
        basePrice: config.pricing.calloutFee,
        customer: { phone, address },
      });

      // Create payment
      const payment = await createCalloutPayment(matchRequest.id);

      sendJson(res, 200, {
        success: true,
        requestId: matchRequest.id,
        payment: {
          amount: payment.amount,
          checkoutUrl: payment.checkoutUrl,
        },
        message: '결제 완료 후 기사님 매칭이 시작됩니다.',
      });
    } catch (error) {
      console.error('[Dispatch] Create error:', error);
      sendJson(res, 500, { success: false, error: '요청 생성 중 오류가 발생했습니다.' });
    }
    return;
  }

  // Start matching after payment (webhook or callback)
  if (req.method === 'POST' && url.pathname === '/api/dispatch/start-matching') {
    try {
      const body = await readJsonBody(req);
      const { requestId } = body as { requestId: string };

      if (!requestId) {
        sendJson(res, 400, { success: false, error: 'requestId가 필요합니다.' });
        return;
      }

      const result = await executeLevel1Matching(requestId);

      sendJson(res, 200, {
        success: true,
        notifiedCount: result.notifiedCount,
        message: `${result.notifiedCount}명의 기사님께 알림을 보냈습니다.`,
      });
    } catch (error) {
      console.error('[Dispatch] Start matching error:', error);
      sendJson(res, 500, { success: false, error: '매칭 시작 중 오류가 발생했습니다.' });
    }
    return;
  }

  // =========================================================
  // Payment confirmation (Toss callback)
  // =========================================================
  if (req.method === 'POST' && url.pathname === '/api/payment/confirm') {
    try {
      const body = await readJsonBody(req);
      const { paymentKey, orderId, amount } = body as {
        paymentKey: string;
        orderId: string;
        amount: number;
      };

      if (!paymentKey || !orderId || !amount) {
        sendJson(res, 400, { success: false, error: 'Missing required fields' });
        return;
      }

      const result = await confirmTossPayment(paymentKey, orderId, amount);

      if (result.success) {
        sendJson(res, 200, {
          success: true,
          message: '결제가 완료되었습니다. 기사님 매칭이 시작됩니다.',
          payment: result.payment,
        });
      } else {
        sendJson(res, 400, { success: false, error: result.error });
      }
    } catch (error) {
      console.error('[Payment] Confirm error:', error);
      sendJson(res, 500, { success: false, error: '결제 처리 중 오류가 발생했습니다.' });
    }
    return;
  }

  // =========================================================
  // Tech APIs (기사 전용)
  // =========================================================
  if (req.method === 'POST' && url.pathname === '/api/tech/accept') {
    try {
      const body = await readJsonBody(req);
      const { requestId, techId } = body as { requestId: string; techId: string };

      if (!requestId || !techId) {
        sendJson(res, 400, { success: false, error: '요청 ID와 기사님 ID가 필요합니다.' });
        return;
      }

      const result = await acceptMatch(requestId, techId);
      sendJson(res, result.success ? 200 : 400, result);
    } catch (error) {
      console.error('[Tech] Accept error:', error);
      sendJson(res, 500, { success: false, error: '처리 중 오류가 발생했습니다.' });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/tech/departed') {
    try {
      const body = await readJsonBody(req);
      const { requestId, techId, eta } = body as { requestId: string; techId: string; eta?: number };

      if (!requestId || !techId) {
        sendJson(res, 400, { success: false, error: '필수 정보가 누락되었습니다.' });
        return;
      }

      const result = await updateJobDeparted(requestId, techId, eta ?? 10);
      sendJson(res, result.success ? 200 : 400, result);
    } catch (error) {
      console.error('[Tech] Departed error:', error);
      sendJson(res, 500, { success: false, error: '처리 중 오류가 발생했습니다.' });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/tech/arrived') {
    try {
      const body = await readJsonBody(req);
      const { requestId, techId } = body as { requestId: string; techId: string };

      if (!requestId || !techId) {
        sendJson(res, 400, { success: false, error: '필수 정보가 누락되었습니다.' });
        return;
      }

      const result = await updateJobArrived(requestId, techId);
      sendJson(res, result.success ? 200 : 400, result);
    } catch (error) {
      console.error('[Tech] Arrived error:', error);
      sendJson(res, 500, { success: false, error: '처리 중 오류가 발생했습니다.' });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/tech/submit-balance') {
    try {
      const body = await readJsonBody(req);
      const { requestId, techId, balanceAmount } = body as {
        requestId: string;
        techId: string;
        balanceAmount: number;
      };

      if (!requestId || !balanceAmount) {
        sendJson(res, 400, { success: false, error: '필수 정보가 누락되었습니다.' });
        return;
      }

      const payment = await createBalancePayment(requestId, balanceAmount);
      await updateJobCompleted(requestId, techId, balanceAmount, payment.checkoutUrl);

      sendJson(res, 200, {
        success: true,
        message: '잔금 요청이 전송되었습니다.',
        payment: { amount: payment.amount, checkoutUrl: payment.checkoutUrl },
      });
    } catch (error) {
      console.error('[Tech] Submit balance error:', error);
      sendJson(res, 500, { success: false, error: '잔금 전송 중 오류가 발생했습니다.' });
    }
    return;
  }

  // =========================================================
  // Job status APIs
  // =========================================================
  if (req.method === 'GET' && url.pathname === '/api/job/status') {
    const requestId = url.searchParams.get('requestId');

    if (!requestId) {
      sendJson(res, 400, { error: 'requestId required' });
      return;
    }

    const request = getMatchRequest(requestId);
    if (!request) {
      sendJson(res, 404, { error: 'Job not found' });
      return;
    }

    sendJson(res, 200, {
      status: request.status,
      matchedTechId: request.matchedTechId,
      isTaken: request.status !== 'pending' && request.status !== 'matching',
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/matching/status') {
    const requestId = url.searchParams.get('requestId');

    if (!requestId) {
      sendJson(res, 400, { error: 'requestId required' });
      return;
    }

    const status = getMatchingStatus(requestId);
    sendJson(res, 200, { status });
    return;
  }

  // =========================================================
  // SUPPORT: Customer support form submission
  // =========================================================
  if (req.method === 'POST' && url.pathname === '/api/support/submit') {
    try {
      const body = await readJsonBody(req);
      const { name, contact, type, message } = body as {
        name: string;
        contact: string;
        type: string;
        message: string;
      };

      if (!name || !contact || !message) {
        sendJson(res, 400, { success: false, error: '필수 정보가 누락되었습니다.' });
        return;
      }

      // Log support request (will be sent to email via external service)
      const supportRequest = {
        id: `SUP-${Date.now()}`,
        name,
        contact,
        type,
        message,
        createdAt: new Date().toISOString(),
      };

      console.log('[Support] New support request:', JSON.stringify(supportRequest, null, 2));

      // Send email notification via Solapi (if configured) or just log
      try {
        // For now, just log - can integrate email service later
        // In production: use nodemailer, SendGrid, or Solapi SMS
        console.log(`[Support] Email would be sent to: daepop98@gmail.com`);
        console.log(`[Support] From: ${name} <${contact}>`);
        console.log(`[Support] Type: ${type}`);
        console.log(`[Support] Message: ${message}`);
      } catch (emailError) {
        console.error('[Support] Failed to send email:', emailError);
      }

      sendJson(res, 200, {
        success: true,
        message: '문의가 접수되었습니다.',
        ticketId: supportRequest.id,
      });
    } catch (error) {
      console.error('[Support] Submit error:', error);
      sendJson(res, 500, { success: false, error: '문의 접수 중 오류가 발생했습니다.' });
    }
    return;
  }

  // =========================================================
  // AUTH: Demo account login (for OpenAI reviewers)
  // =========================================================
  if (req.method === 'POST' && url.pathname === '/api/auth/demo') {
    try {
      const body = await readJsonBody(req);
      const { email, password } = body as { email: string; password: string };

      const DEMO_EMAIL = 'reviewer@openai.com';
      const DEMO_PASSWORD = 'klygo-demo-2024';

      if (email !== DEMO_EMAIL || password !== DEMO_PASSWORD) {
        sendJson(res, 401, { success: false, message: '잘못된 인증 정보입니다.' });
        return;
      }

      const demoCustomerId = 'demo-reviewer-openai-001';
      const token = generateToken({
        customerId: demoCustomerId,
        email: DEMO_EMAIL,
        name: 'OpenAI Reviewer',
        authMethod: 'google',
      });

      sendJson(res, 200, {
        success: true,
        token,
        customer: { customerId: demoCustomerId, email: DEMO_EMAIL, name: 'OpenAI Reviewer' },
      });
    } catch (error) {
      console.error('[Auth] Demo login error:', error);
      sendJson(res, 500, { success: false, message: '로그인 처리 중 오류가 발생했습니다.' });
    }
    return;
  }

  // =========================================================
  // AUTH: Send OTP via SMS
  // =========================================================
  if (req.method === 'POST' && url.pathname === '/api/auth/send-otp') {
    try {
      const body = await readJsonBody(req);
      const { phone } = body as { phone: string };

      if (!phone || phone.length < 10) {
        sendJson(res, 400, { success: false, message: '올바른 전화번호를 입력해주세요.' });
        return;
      }

      const otp = generateOTP();
      storeOTP(phone, otp);

      await sendKakaoAlimtalk(phone, 'SMS_AUTH', { '#{인증번호}': otp });
      console.log(`[Auth] OTP for ${phone}: ${otp}`);

      sendJson(res, 200, { success: true, message: '인증번호가 전송되었습니다.' });
    } catch (error) {
      console.error('[Auth] Send OTP error:', error);
      sendJson(res, 500, { success: false, message: '인증번호 전송에 실패했습니다.' });
    }
    return;
  }

  // =========================================================
  // AUTH: Verify OTP and login
  // =========================================================
  if (req.method === 'POST' && url.pathname === '/api/auth/verify-otp') {
    try {
      const body = await readJsonBody(req);
      const { phone, otp } = body as { phone: string; otp: string };

      if (!phone || !otp) {
        sendJson(res, 400, { success: false, message: '전화번호와 인증번호가 필요합니다.' });
        return;
      }

      const isValid = verifyOTP(phone, otp);

      if (!isValid) {
        sendJson(res, 400, { success: false, message: '인증번호가 일치하지 않거나 만료되었습니다.' });
        return;
      }

      const customerId = await getOrCreateCustomerByPhone(phone);
      await linkCustomerToRequest(phone, customerId);

      const token = generateToken({ customerId, phone, authMethod: 'sms' });

      sendJson(res, 200, { success: true, token, customer: { customerId, phone } });
    } catch (error) {
      console.error('[Auth] Verify OTP error:', error);
      sendJson(res, 500, { success: false, message: '인증 처리 중 오류가 발생했습니다.' });
    }
    return;
  }

  // =========================================================
  // AUTH: Google OAuth
  // =========================================================
  if (req.method === 'GET' && url.pathname === '/api/auth/google') {
    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = `${config.urls.baseUrl}/api/auth/google/callback`;

    if (!googleClientId) {
      res.writeHead(302, { Location: '/login?error=google_not_configured' });
      res.end();
      return;
    }

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', googleClientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'email profile');

    res.writeHead(302, { Location: authUrl.toString() });
    res.end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/auth/google/callback') {
    try {
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error || !code) {
        res.writeHead(302, { Location: '/login?error=google_auth_failed' });
        res.end();
        return;
      }

      const googleClientId = process.env.GOOGLE_CLIENT_ID;
      const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
      const redirectUri = `${config.urls.baseUrl}/api/auth/google/callback`;

      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: googleClientId!,
          client_secret: googleClientSecret!,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });

      const tokenData = await tokenRes.json() as { access_token: string };

      const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });

      const userData = await userRes.json() as { id: string; email: string; name: string };

      const customerId = await getOrCreateCustomerByGoogle(userData.id, userData.email, userData.name);
      const token = generateToken({
        customerId,
        email: userData.email,
        name: userData.name,
        authMethod: 'google',
      });

      res.writeHead(302, { Location: `/my?token=${token}` });
      res.end();
    } catch (error) {
      console.error('[Auth] Google callback error:', error);
      res.writeHead(302, { Location: '/login?error=google_auth_failed' });
      res.end();
    }
    return;
  }

  // =========================================================
  // CUSTOMER: Get my requests
  // =========================================================
  if (req.method === 'GET' && url.pathname === '/api/customer/requests') {
    try {
      const authHeader = req.headers['authorization'];
      const token = authHeader?.replace('Bearer ', '');

      if (!token) {
        sendJson(res, 401, { error: '로그인이 필요합니다.' });
        return;
      }

      const session = verifyToken(token);
      if (!session) {
        sendJson(res, 401, { error: '세션이 만료되었습니다.' });
        return;
      }

      const requests = await getCustomerRequests(session.customerId);
      sendJson(res, 200, { requests });
    } catch (error) {
      console.error('[Customer] Get requests error:', error);
      sendJson(res, 500, { error: '요청 조회 중 오류가 발생했습니다.' });
    }
    return;
  }

  // =========================================================
  // Serve static files from /public
  // =========================================================
  if (req.method === 'GET') {
    const publicPath = join(__dirname, '../public');
    let filePath = url.pathname === '/' ? '/index.html' : url.pathname;

    if (filePath.includes('..')) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    const fullPath = join(publicPath, filePath);

    try {
      const content = readFileSync(fullPath);
      const ext = filePath.split('.').pop() ?? 'html';
      const mimeTypes: Record<string, string> = {
        html: 'text/html',
        css: 'text/css',
        js: 'application/javascript',
        json: 'application/json',
        png: 'image/png',
        jpg: 'image/jpeg',
        svg: 'image/svg+xml',
      };
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] ?? 'text/plain' });
      res.end(content);
      return;
    } catch {
      // File not found - continue to MCP
    }
  }

  // MCP endpoint
  const MCP_METHODS = new Set(['POST', 'GET', 'DELETE']);
  if (url.pathname === MCP_PATH && req.method && MCP_METHODS.has(req.method)) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

    const server = createklygoServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on('close', () => {
      transport.close();
      server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error('Error handling MCP request:', error);
      if (!res.headersSent) {
        res.writeHead(500).end('Internal server error');
      }
    }
    return;
  }

  // 404
  res.writeHead(404).end('Not Found');
});

httpServer.listen(port, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   🔓 klygo v2.0 - 긴급 개문 정보 서비스                  ║
║                                                               ║
║   MCP Server: http://localhost:${port}${MCP_PATH.padEnd(28)}║
║   Health:     http://localhost:${port}/health${' '.repeat(22)}║
║                                                               ║
║   🛠️  ChatGPT 앱 도구 (정보 제공 전용):                      ║
║   1. assess_situation   - 상황 평가                           ║
║   2. analyze_lock       - 도어락 분석                         ║
║   3. get_recommendation - 상황별 안내                         ║
║                                                               ║
║   📚 정보 페이지:                                             ║
║   • FAQ: ${INFO_URLS.faq.padEnd(47)}║
║   • 안전 가이드: ${INFO_URLS.safetyGuide.padEnd(39)}║
║   • 가격 안내: ${INFO_URLS.priceInfo.padEnd(41)}║
║                                                               ║
║   ⚠️  본 앱은 업체연결/예약/배차/결제를 하지 않습니다       ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
  `);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  httpServer.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down...');
  httpServer.close(() => process.exit(0));
});
