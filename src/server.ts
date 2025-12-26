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
  shouldSkipToLevel2,
  executeLevel1Matching,
  executeLevel2Matching,
  approveSurcharge,
  getMatchingStatus,
  updateCustomerInfo,
  getMatchRequest,
  updateJobDeparted,
  updateJobArrived,
  updateJobCompleted,
} from './modules/matching/index.js';
import type { CustomerInfo } from './types/index.js';
import {
  createCalloutPayment,
  createBalancePayment,
  isCalloutPaid,
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

// Tool input schemas
const analyzeLockStatusSchema = {
  imageUrl: z.string().optional().describe('도어락 사진 URL (선택)'),
  description: z.string().describe('도어락 종류, 브랜드, 또는 상황 설명'),
};

const payCalloutDepositSchema = {
  requestId: z.string().describe('매칭 요청 ID'),
};

const requestSmartMatchSchema = {
  district: z.string().describe('서울시 구 이름 (예: 성동구, 관악구)'),
  address: z.string().describe('상세 주소 (예: 성동구 왕십리로 123)'),
  phone: z.string().describe('연락받을 전화번호'),
  lockType: z.enum(['digital', 'mechanical', 'smart', 'padlock', 'unknown']).default('digital'),
  difficulty: z.enum(['easy', 'medium', 'hard', 'expert']).default('medium'),
  lockPhotoUrl: z.string().describe('도어락 사진 URL'),
  userId: z.string().optional(),
};

const payFinalBalanceSchema = {
  requestId: z.string().describe('매칭 요청 ID'),
  balanceAmount: z.number().describe('기사님이 입력한 잔금 금액'),
};

const approveSurchargeSchema = {
  requestId: z.string().describe('매칭 요청 ID'),
};

// District name mapping (Korean to English)
function getDistrictKey(koreanName: string): SeoulDistrict | null {
  const mapping: Record<string, SeoulDistrict> = {
    '강남구': 'gangnam', '강동구': 'gangdong', '강북구': 'gangbuk', '강서구': 'gangseo',
    '관악구': 'gwanak', '광진구': 'gwangjin', '구로구': 'guro', '금천구': 'geumcheon',
    '노원구': 'nowon', '도봉구': 'dobong', '동대문구': 'dongdaemun', '동작구': 'dongjak',
    '마포구': 'mapo', '서대문구': 'seodaemun', '서초구': 'seocho', '성동구': 'seongdong',
    '성북구': 'seongbuk', '송파구': 'songpa', '양천구': 'yangcheon', '영등포구': 'yeongdeungpo',
    '용산구': 'yongsan', '은평구': 'eunpyeong', '종로구': 'jongno', '중구': 'jung', '중랑구': 'jungnang',
  };
  return mapping[koreanName] || null;
}

// Widget state interface
interface WidgetState {
  requestId?: string;
  status: 'idle' | 'analyzing' | 'awaiting_payment' | 'matching' | 'surcharge_pending' | 'matched' | 'awaiting_balance' | 'completed';
  lockAnalysis?: {
    lockType: string;
    brand: string | null;
    difficulty: string;
    estimatedTime: number;
    balanceRange: { min: number; max: number };
  };
  payment?: {
    calloutFee: number;
    checkoutUrl: string;
    isPaid: boolean;
  };
  matching?: {
    level: number;
    levelName: string;
    searchingDistricts: string[];
    notifiedCount: number;
    elapsedSeconds: number;
  };
  surchargeAmount?: number;
  matchedTech?: {
    name: string;
    rating: number;
    eta: number;
  };
  balance?: {
    amount: number;
    checkoutUrl: string;
    isPaid: boolean;
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
  const server = new McpServer({ name: 'klygo', version: '1.0.0' });

  // Register the widget resource
  server.registerResource(
    'klygo-widget',
    'ui://widget/klygo.html',
    { description: 'klygo 긴급 개문 서비스 위젯' },
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
  // Tool 1: analyze_lock_status (도어락 분석)
  // ============================================================
  server.registerTool(
    'analyze_lock_status',
    {
      title: '도어락 분석',
      description: '사진이나 설명을 기반으로 도어락 모델을 분석하고, 예상 잔금 범위를 안내합니다.',
      inputSchema: analyzeLockStatusSchema,
      annotations: {
        readOnlyHint: true,
      },
      _meta: {
        'openai/outputTemplate': 'ui://widget/klygo.html',
        'openai/toolInvocation/invoking': '도어락 분석 중...',
        'openai/toolInvocation/invoked': '도어락 분석 완료',
      },
    },
    async (args) => {
      currentWidgetState = { status: 'analyzing' };

      let analysis;
      if (args.imageUrl) {
        analysis = await analyzeLockImage(args.imageUrl);
      } else if (args.description) {
        analysis = analyzeLockFromDescription(args.description);
      } else {
        return buildWidgetResponse('도어락 사진 또는 설명을 제공해주세요.');
      }

      // Get estimated balance range
      const balanceRange = estimateBalanceRange(analysis.difficulty);

      currentWidgetState = {
        status: 'idle',
        lockAnalysis: {
          lockType: getLockTypeDescription(analysis.lockType),
          brand: analysis.brand,
          difficulty: getDifficultyDescription(analysis.difficulty),
          estimatedTime: analysis.estimatedTime,
          balanceRange: { min: balanceRange.min, max: balanceRange.max },
        },
      };

      const message = [
        `🔐 도어락 분석 결과`,
        ``,
        `• 종류: ${getLockTypeDescription(analysis.lockType)}`,
        analysis.brand ? `• 브랜드: ${analysis.brand}` : null,
        analysis.model ? `• 모델: ${analysis.model}` : null,
        `• 난이도: ${getDifficultyDescription(analysis.difficulty)}`,
        `• 예상 작업 시간: 약 ${analysis.estimatedTime}분`,
        ``,
        `💰 예상 잔금 범위: ${formatPrice(balanceRange.min)} ~ ${formatPrice(balanceRange.max)}`,
        `   (${balanceRange.description})`,
        ``,
        `━━━━━━━━━━━━━━━━━━━━━━`,
        `🔧 작업 방식 안내`,
        `━━━━━━━━━━━━━━━━━━━━━━`,
        `• 무파괴 개문: 도어락 손상 없이 개문 (가능한 경우)`,
        `• 파괴 개문: 도어락 해체 후 개문 (불가피한 경우)`,
        `• 파괴 개문 시 새 도어락 설치 비용 별도 발생`,
        ``,
        `📌 기사님 호출을 원하시면 출장비 ${formatPrice(config.pricing.calloutFee)}를 먼저 결제해주세요.`,
        `   (기사님 도착 후 취소 시 반환 불가)`,
      ]
        .filter(Boolean)
        .join('\n');

      return buildWidgetResponse(message);
    }
  );

  // ============================================================
  // Tool 2: pay_callout_deposit (출장비 결제)
  // ============================================================
  server.registerTool(
    'pay_callout_deposit',
    {
      title: '출장비 결제',
      description: `출장비 ${formatPrice(config.pricing.calloutFee)}를 결제합니다. 결제 완료 후 기사님 매칭이 시작됩니다.`,
      inputSchema: payCalloutDepositSchema,
      annotations: {
        readOnlyHint: false,
        openWorldHint: true,
        destructiveHint: true,
      },
      _meta: {
        'openai/outputTemplate': 'ui://widget/klygo.html',
        'openai/toolInvocation/invoking': '결제창 생성 중...',
        'openai/toolInvocation/invoked': '결제창 생성 완료',
      },
    },
    async (args) => {
      // Create payment request
      const payment = await createCalloutPayment(args.requestId);

      currentWidgetState = {
        ...currentWidgetState,
        status: 'awaiting_payment',
        requestId: args.requestId,
        payment: {
          calloutFee: payment.amount,
          checkoutUrl: payment.checkoutUrl,
          isPaid: false,
        },
      };

      const message = [
        `💳 출장비 결제`,
        ``,
        `결제 금액: ${formatPrice(payment.amount)}`,
        ``,
        `• 플랫폼 이용료: ${formatPrice(config.pricing.platformFeeFromCallout)}`,
        `• 기사님 배정금: ${formatPrice(config.pricing.techCalloutShare)}`,
        ``,
        `⚠️ 기사님 도착 후 취소 시 출장비는 반환되지 않습니다.`,
        ``,
        `아래 링크를 클릭하여 결제를 진행해주세요:`,
        `🔗 ${payment.checkoutUrl}`,
      ].join('\n');

      return buildWidgetResponse(message);
    }
  );

  // ============================================================
  // Tool 3: request_smart_match (기사님 호출 - 핵심 도구)
  // ============================================================
  server.registerTool(
    'request_smart_match',
    {
      title: '기사님 호출',
      description: '출장비 결제 완료 후 기사님을 호출합니다. 단계별 확장 매칭을 통해 가장 가까운 기사님을 찾습니다.',
      inputSchema: requestSmartMatchSchema,
      annotations: {
        readOnlyHint: false,
        openWorldHint: true,
        destructiveHint: true,
      },
      _meta: {
        'openai/outputTemplate': 'ui://widget/klygo.html',
        'openai/toolInvocation/invoking': '기사님 찾는 중...',
        'openai/toolInvocation/invoked': '매칭 진행 중',
      },
    },
    async (args) => {
      const districtKey = getDistrictKey(args.district);
      if (!districtKey) {
        return buildWidgetResponse(`죄송합니다. "${args.district}"는 현재 서비스 지역이 아닙니다.`);
      }

      // Validate required customer info
      if (!args.phone || !args.address || !args.lockPhotoUrl) {
        return buildWidgetResponse(
          `📞 기사님 호출에 필요한 정보가 부족합니다.\n\n` +
          `다음 정보를 모두 알려주세요:\n` +
          `• 연락받을 전화번호\n` +
          `• 상세 주소 (동/호수 포함)\n` +
          `• 도어락 사진 (업로드해주세요)`
        );
      }

      // Create match request with customer info
      const matchRequest = await createMatchRequest({
        userId: args.userId,
        district: districtKey,
        basePrice: config.pricing.calloutFee,
        customer: {
          phone: args.phone,
          address: args.address,
          lockPhotoUrl: args.lockPhotoUrl,
        },
      });

      // Check if callout has been paid
      const calloutPaid = isCalloutPaid(matchRequest.id);

      if (!calloutPaid) {
        // Create payment first
        const payment = await createCalloutPayment(matchRequest.id);

        currentWidgetState = {
          status: 'awaiting_payment',
          requestId: matchRequest.id,
          payment: {
            calloutFee: payment.amount,
            checkoutUrl: payment.checkoutUrl,
            isPaid: false,
          },
        };

        return buildWidgetResponse(
          `📍 ${args.district}에서 기사님을 호출합니다.\n\n` +
          `💳 출장비: ${formatPrice(config.pricing.calloutFee)}\n\n` +
          `아래 링크에서 결제하시면 바로 기사님 찾기가 시작됩니다!\n\n` +
          `🔗 결제하기: ${payment.checkoutUrl}\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━\n` +
          `📱 결제 후 진행 알림은 카카오톡으로 받으실 수 있어요.`
        );
      }

      currentWidgetState = { status: 'matching', requestId: matchRequest.id };

      // Phase 1: Check density - Smart Skip
      const skipToLevel2 = await shouldSkipToLevel2(districtKey);

      if (skipToLevel2) {
        currentWidgetState = {
          status: 'surcharge_pending',
          requestId: matchRequest.id,
          surchargeAmount: config.pricing.wideAreaSurcharge,
          matching: {
            level: 1,
            levelName: '지역 밀도 낮음',
            searchingDistricts: [DISTRICT_NAMES[districtKey]],
            notifiedCount: 0,
            elapsedSeconds: 0,
          },
        };

        return buildWidgetResponse(
          `📍 ${args.district}에 현재 대기 중인 기사님이 부족합니다.\n\n` +
          `인접 지역으로 범위를 확장하면 더 빠르게 기사님을 찾을 수 있습니다.\n` +
          `광역 매칭 시 +${formatPrice(config.pricing.wideAreaSurcharge)}의 추가 비용이 발생합니다.\n\n` +
          `광역 매칭을 진행하시려면 "할증 승인"을 해주세요.`
        );
      }

      // Execute Level 1 matching
      const level1Result = await executeLevel1Matching(matchRequest.id);

      currentWidgetState = {
        status: 'matching',
        requestId: matchRequest.id,
        matching: {
          level: 1,
          levelName: '내 주변 검색 중',
          searchingDistricts: [DISTRICT_NAMES[districtKey]],
          notifiedCount: level1Result.notifiedCount,
          elapsedSeconds: 0,
        },
      };

      if (level1Result.notifiedCount === 0) {
        currentWidgetState.status = 'surcharge_pending';
        currentWidgetState.surchargeAmount = config.pricing.wideAreaSurcharge;

        return buildWidgetResponse(
          `📍 ${args.district}에서 현재 가용 기사님을 찾지 못했습니다.\n\n` +
          `인접 지역으로 범위를 확장하시겠습니까?\n` +
          `광역 매칭 시 +${formatPrice(config.pricing.wideAreaSurcharge)}의 추가 비용이 발생합니다.`
        );
      }

      return buildWidgetResponse(
        `✅ 접수 완료! 기사님을 찾고 있습니다.\n\n` +
        `📍 지역: ${args.district}\n` +
        `👨‍🔧 ${level1Result.notifiedCount}명의 기사님께 카카오 알림을 보냈습니다.\n` +
        `💳 출장비: ${formatPrice(config.pricing.calloutFee)} (결제 완료)\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🔔 진행 상황 안내\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `• 기사님이 수락하면 카카오톡으로 알려드려요\n` +
        `• 기사님 출발/도착 알림도 카카오톡으로 받으실 수 있어요\n` +
        `• 2분 내 응답 없으면 자동으로 더 넓은 지역에서 찾습니다\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🔧 작업 안내\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `• 상황에 따라 무파괴 또는 파괴 개문이 진행될 수 있습니다\n` +
        `• 파괴 개문 시 새 도어락 설치가 필요할 수 있습니다\n` +
        `• 정확한 비용은 현장에서 기사님이 안내해드립니다\n\n` +
        `⚠️ 기사님 배정 후에는 취소가 어렵습니다.\n` +
        `   (기사님이 이미 출발하시기 때문에 취소 시 출장비 환불 불가)`
      );
    }
  );

  // ============================================================
  // Tool 4: approve_surcharge (광역 매칭 할증 승인)
  // ============================================================
  server.registerTool(
    'approve_surcharge',
    {
      title: '광역 할증 승인',
      description: `광역 매칭을 위한 추가 비용(+${formatPrice(config.pricing.wideAreaSurcharge)})을 승인합니다.`,
      inputSchema: approveSurchargeSchema,
      annotations: {
        readOnlyHint: false,
        openWorldHint: true,
      },
      _meta: {
        'openai/outputTemplate': 'ui://widget/klygo.html',
        'openai/toolInvocation/invoking': '할증 승인 처리 중...',
        'openai/toolInvocation/invoked': '할증 승인 완료',
      },
    },
    async (args) => {
      const success = approveSurcharge(args.requestId);

      if (!success) {
        return buildWidgetResponse('요청을 찾을 수 없습니다. 다시 시도해주세요.');
      }

      // Execute Level 2 matching
      const level2Result = await executeLevel2Matching(args.requestId);

      const status = getMatchingStatus(args.requestId);
      if (!status) {
        return buildWidgetResponse('매칭 상태를 확인할 수 없습니다.');
      }

      currentWidgetState = {
        status: 'matching',
        requestId: args.requestId,
        matching: {
          level: 2,
          levelName: '인접 지역 확장 중',
          searchingDistricts: level2Result.districts.map((d) => DISTRICT_NAMES[d]),
          notifiedCount: status.notifiedCount,
          elapsedSeconds: status.elapsedSeconds,
        },
      };

      return buildWidgetResponse(
        `✅ 광역 매칭이 시작되었습니다!\n\n` +
        `📍 검색 지역: ${level2Result.districts.map((d) => DISTRICT_NAMES[d]).join(', ')}\n` +
        `👨‍🔧 ${level2Result.notifiedCount}명의 기사님께 카카오 알림을 보냈습니다.\n` +
        `💳 추가 비용: +${formatPrice(config.pricing.wideAreaSurcharge)}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🔔 진행 상황 안내\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `• 기사님이 수락하면 카카오톡으로 알려드려요\n` +
        `• 기사님 출발/도착 알림도 카카오톡으로 받으실 수 있어요\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🔧 작업 안내\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `• 상황에 따라 무파괴 또는 파괴 개문이 진행됩니다\n` +
        `• 파괴 개문 시 새 도어락 설치가 필요할 수 있습니다\n\n` +
        `⚠️ 기사님 배정 후에는 취소가 어렵습니다.`
      );
    }
  );

  // ============================================================
  // Tool 5: pay_final_balance (잔금 결제)
  // ============================================================
  server.registerTool(
    'pay_final_balance',
    {
      title: '잔금 결제',
      description: '기사님이 입력한 잔금을 결제합니다. 작업 완료 후 기사님이 전송한 금액을 확인하고 결제해주세요.',
      inputSchema: payFinalBalanceSchema,
      annotations: {
        readOnlyHint: false,
        openWorldHint: true,
        destructiveHint: true,
      },
      _meta: {
        'openai/outputTemplate': 'ui://widget/klygo.html',
        'openai/toolInvocation/invoking': '잔금 결제창 생성 중...',
        'openai/toolInvocation/invoked': '잔금 결제창 생성 완료',
      },
    },
    async (args) => {
      const payment = await createBalancePayment(args.requestId, args.balanceAmount);

      currentWidgetState = {
        ...currentWidgetState,
        status: 'awaiting_balance',
        balance: {
          amount: payment.amount,
          checkoutUrl: payment.checkoutUrl,
          isPaid: false,
        },
      };

      const message = [
        `💳 잔금 결제`,
        ``,
        `작업비 (잔금): ${formatPrice(payment.amount)}`,
        ``,
        `• 기사님 정산액: ${formatPrice(payment.techShare)}`,
        `• 플랫폼 수수료: ${formatPrice(payment.platformFee)}`,
        ``,
        `아래 링크를 클릭하여 결제를 완료해주세요:`,
        `🔗 ${payment.checkoutUrl}`,
        ``,
        `✅ 결제 완료 후 서비스가 완료됩니다.`,
        `📄 결제 영수증은 자동으로 발급됩니다.`,
      ].join('\n');

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
      version: '1.0.0',
      pricing: {
        calloutFee: config.pricing.calloutFee,
        wideAreaSurcharge: config.pricing.wideAreaSurcharge,
      },
    }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('OK');
    return;
  }

  // =========================================================
  // API: Payment confirmation (Toss callback)
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
        // Payment confirmed - now we can start matching
        // The matching will be triggered by the frontend polling or webhook
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
  // API: Tech accepts a job
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

  // =========================================================
  // API: Tech updates job status - departed
  // =========================================================
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

  // =========================================================
  // API: Tech updates job status - arrived
  // =========================================================
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

  // =========================================================
  // API: Tech submits balance amount (job completed)
  // =========================================================
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

      // Create balance payment request for customer
      const payment = await createBalancePayment(requestId, balanceAmount);

      console.log('[Tech] Balance submitted:', { requestId, techId, balanceAmount });

      // Update job status to completed and notify customer
      await updateJobCompleted(requestId, techId, balanceAmount, payment.checkoutUrl);

      sendJson(res, 200, {
        success: true,
        message: '잔금 요청이 전송되었습니다.',
        payment: {
          amount: payment.amount,
          checkoutUrl: payment.checkoutUrl,
        },
      });
    } catch (error) {
      console.error('[Tech] Submit balance error:', error);
      sendJson(res, 500, { success: false, error: '잔금 전송 중 오류가 발생했습니다.' });
    }
    return;
  }

  // =========================================================
  // API: Get job status (for tech page polling)
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

  // =========================================================
  // Toss Payments Webhook (server-to-server callback)
  // =========================================================
  if (req.method === 'POST' && url.pathname === '/api/webhook/toss') {
    try {
      const body = await readJsonBody(req);
      console.log('[Webhook] Toss payment event:', body);

      // Toss sends payment status updates here
      // Verify the webhook signature in production
      const { eventType, data } = body as {
        eventType: string;
        data: { paymentKey: string; orderId: string; status: string };
      };

      if (eventType === 'PAYMENT_STATUS_CHANGED' && data.status === 'DONE') {
        // Payment completed - trigger matching if callout payment
        console.log('[Webhook] Payment completed:', data.orderId);
      }

      sendJson(res, 200, { success: true });
    } catch (error) {
      console.error('[Webhook] Toss error:', error);
      sendJson(res, 500, { success: false });
    }
    return;
  }

  // =========================================================
  // API: Get payment status
  // =========================================================
  if (req.method === 'GET' && url.pathname === '/api/payment/status') {
    const requestId = url.searchParams.get('requestId');
    const type = url.searchParams.get('type') as 'callout' | 'balance';

    if (!requestId) {
      sendJson(res, 400, { error: 'requestId required' });
      return;
    }

    const payment = getPaymentByMatchAndType(requestId, type ?? 'callout');
    sendJson(res, 200, { payment });
    return;
  }

  // =========================================================
  // API: Get matching status
  // =========================================================
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

      // Send OTP via Solapi SMS
      const result = await sendKakaoAlimtalk(phone, 'SMS_AUTH', {
        '#{인증번호}': otp,
      });

      // For development, also log the OTP
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

      // Create or get customer
      const customerId = await getOrCreateCustomerByPhone(phone);

      // Link any existing requests to this customer
      await linkCustomerToRequest(phone, customerId);

      // Generate JWT token
      const token = generateToken({
        customerId,
        phone,
        authMethod: 'sms',
      });

      sendJson(res, 200, {
        success: true,
        token,
        customer: { customerId, phone },
      });
    } catch (error) {
      console.error('[Auth] Verify OTP error:', error);
      sendJson(res, 500, { success: false, message: '인증 처리 중 오류가 발생했습니다.' });
    }
    return;
  }

  // =========================================================
  // AUTH: Google OAuth redirect
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
    authUrl.searchParams.set('access_type', 'offline');

    res.writeHead(302, { Location: authUrl.toString() });
    res.end();
    return;
  }

  // =========================================================
  // AUTH: Google OAuth callback
  // =========================================================
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

      // Exchange code for tokens
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

      // Get user info
      const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });

      const userData = await userRes.json() as { id: string; email: string; name: string };

      // Create or get customer
      const customerId = await getOrCreateCustomerByGoogle(userData.id, userData.email, userData.name);

      // Generate JWT token
      const token = generateToken({
        customerId,
        email: userData.email,
        name: userData.name,
        authMethod: 'google',
      });

      // Redirect to my page with token in URL (will be stored in localStorage)
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
  // AUTH: Kakao OAuth redirect
  // =========================================================
  if (req.method === 'GET' && url.pathname === '/api/auth/kakao') {
    const kakaoClientId = process.env.KAKAO_CLIENT_ID;
    const redirectUri = `${config.urls.baseUrl}/api/auth/kakao/callback`;

    if (!kakaoClientId) {
      res.writeHead(302, { Location: '/login?error=kakao_not_configured' });
      res.end();
      return;
    }

    const authUrl = new URL('https://kauth.kakao.com/oauth/authorize');
    authUrl.searchParams.set('client_id', kakaoClientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');

    res.writeHead(302, { Location: authUrl.toString() });
    res.end();
    return;
  }

  // =========================================================
  // AUTH: Kakao OAuth callback
  // =========================================================
  if (req.method === 'GET' && url.pathname === '/api/auth/kakao/callback') {
    try {
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error || !code) {
        res.writeHead(302, { Location: '/login?error=kakao_auth_failed' });
        res.end();
        return;
      }

      const kakaoClientId = process.env.KAKAO_CLIENT_ID;
      const kakaoClientSecret = process.env.KAKAO_CLIENT_SECRET;
      const redirectUri = `${config.urls.baseUrl}/api/auth/kakao/callback`;

      // Exchange code for tokens
      const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: kakaoClientId!,
          client_secret: kakaoClientSecret || '',
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });

      const tokenData = await tokenRes.json() as { access_token: string };

      // Get user info
      const userRes = await fetch('https://kapi.kakao.com/v2/user/me', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });

      const userData = await userRes.json() as {
        id: number;
        kakao_account?: { email?: string; profile?: { nickname?: string } };
      };

      const email = userData.kakao_account?.email || `kakao_${userData.id}@kakao.com`;
      const name = userData.kakao_account?.profile?.nickname || '카카오 사용자';

      // Create or get customer (reuse Google function with kakao_ prefix)
      const customerId = await getOrCreateCustomerByGoogle(`kakao_${userData.id}`, email, name);

      // Generate JWT token
      const token = generateToken({
        customerId,
        email,
        name,
        authMethod: 'kakao',
      });

      // Redirect to my page with token in URL
      res.writeHead(302, { Location: `/my?token=${token}` });
      res.end();
    } catch (error) {
      console.error('[Auth] Kakao callback error:', error);
      res.writeHead(302, { Location: '/login?error=kakao_auth_failed' });
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
  // CUSTOMER: Cancel request
  // =========================================================
  if (req.method === 'POST' && url.pathname === '/api/customer/cancel') {
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

      const body = await readJsonBody(req);
      const { requestId, refund } = body as { requestId: string; refund: boolean };

      if (!requestId) {
        sendJson(res, 400, { success: false, message: '요청 ID가 필요합니다.' });
        return;
      }

      // Get match request
      const matchRequest = getMatchRequest(requestId);
      if (!matchRequest) {
        sendJson(res, 404, { success: false, message: '요청을 찾을 수 없습니다.' });
        return;
      }

      // Check if cancellable (only pending or matching status)
      if (!['pending', 'matching'].includes(matchRequest.status)) {
        sendJson(res, 400, {
          success: false,
          message: '이미 기사님이 배정되어 취소가 불가능합니다.'
        });
        return;
      }

      // Cancel the request
      const { cancelMatchRequest } = await import('./modules/matching/index.js');
      const cancelResult = await cancelMatchRequest(requestId, refund);

      if (cancelResult.success) {
        sendJson(res, 200, {
          success: true,
          message: refund ? '취소되었습니다. 환불이 진행됩니다.' : '취소되었습니다.',
          refunded: refund
        });
      } else {
        sendJson(res, 400, { success: false, message: cancelResult.message });
      }
    } catch (error) {
      console.error('[Customer] Cancel error:', error);
      sendJson(res, 500, { error: '취소 처리 중 오류가 발생했습니다.' });
    }
    return;
  }

  // =========================================================
  // Serve static files from /public
  // =========================================================
  if (req.method === 'GET') {
    const publicPath = join(__dirname, '../public');
    let filePath = url.pathname === '/' ? '/index.html' : url.pathname;

    // Security: prevent directory traversal
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
      // File not found - continue to check other routes
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
║   🔓 klygo - 긴급 개문 서비스                            ║
║                                                               ║
║   MCP Server: http://localhost:${port}${MCP_PATH.padEnd(28)}║
║   Health:     http://localhost:${port}/health${' '.repeat(22)}║
║                                                               ║
║   💰 출장비: ${formatPrice(config.pricing.calloutFee).padEnd(43)}║
║   📍 서비스 지역: 성동구, 관악구 (서울 전역 확장 예정)        ║
║                                                               ║
║   🛠️  도구 목록:                                              ║
║   1. analyze_lock_status   - 도어락 분석                      ║
║   2. pay_callout_deposit   - 출장비 결제                      ║
║   3. request_smart_match   - 기사님 호출                      ║
║   4. pay_final_balance     - 잔금 결제                        ║
║   5. approve_surcharge     - 광역 할증 승인                   ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  httpServer.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down...');
  httpServer.close(() => process.exit(0));
});
