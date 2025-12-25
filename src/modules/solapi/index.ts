import crypto from 'crypto';
import { config } from '../../config/index.js';

interface SolapiMessage {
  to: string;
  from: string;
  kakaoOptions?: {
    pfId: string;
    templateId?: string;
    variables?: Record<string, string>;
  };
  text?: string;
}

interface SolapiResponse {
  groupId: string;
  messageId: string;
  statusCode: string;
  statusMessage: string;
}

/**
 * Generate HMAC signature for Solapi API
 */
function generateSignature(timestamp: string, salt: string): string {
  const message = `${timestamp}${salt}`;
  return crypto
    .createHmac('sha256', config.solapi.apiSecret)
    .update(message)
    .digest('hex');
}

/**
 * Generate authorization header for Solapi
 */
function getAuthHeader(): string {
  const timestamp = new Date().toISOString();
  const salt = crypto.randomBytes(16).toString('hex');
  const signature = generateSignature(timestamp, salt);

  return `HMAC-SHA256 apiKey=${config.solapi.apiKey}, date=${timestamp}, salt=${salt}, signature=${signature}`;
}

/**
 * Send Kakao Alimtalk message via Solapi
 */
export async function sendKakaoAlimtalk(
  phoneNumber: string,
  templateId: string,
  variables: Record<string, string>
): Promise<SolapiResponse | null> {
  if (!config.solapi.apiKey || !config.solapi.pfId) {
    console.log('[Solapi] API not configured, skipping notification');
    return null;
  }

  const message: SolapiMessage = {
    to: phoneNumber.replace(/-/g, ''),
    from: config.solapi.senderNumber,
    kakaoOptions: {
      pfId: config.solapi.pfId,
      templateId,
      variables,
    },
  };

  try {
    const response = await fetch('https://api.solapi.com/messages/v4/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': getAuthHeader(),
      },
      body: JSON.stringify({
        message,
        agent: { appId: 'klygo-AI' },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Solapi] Send failed:', errorText);
      return null;
    }

    return await response.json() as SolapiResponse;
  } catch (error) {
    console.error('[Solapi] Error sending message:', error);
    return null;
  }
}

/**
 * Send batch Kakao Alimtalk messages (up to 20 at a time for optimization)
 */
export async function sendBatchKakaoAlimtalk(
  messages: Array<{
    phoneNumber: string;
    templateId: string;
    variables: Record<string, string>;
  }>
): Promise<Array<SolapiResponse | null>> {
  if (!config.solapi.apiKey || !config.solapi.pfId) {
    console.log('[Solapi] API not configured, skipping batch notification');
    return messages.map(() => null);
  }

  const solapiMessages = messages.map((msg) => ({
    to: msg.phoneNumber.replace(/-/g, ''),
    from: config.solapi.senderNumber,
    kakaoOptions: {
      pfId: config.solapi.pfId,
      templateId: msg.templateId,
      variables: msg.variables,
    },
  }));

  try {
    const response = await fetch('https://api.solapi.com/messages/v4/send-many', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': getAuthHeader(),
      },
      body: JSON.stringify({
        messages: solapiMessages,
        agent: { appId: 'klygo-AI' },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Solapi] Batch send failed:', errorText);
      return messages.map(() => null);
    }

    const result = await response.json();
    return result as SolapiResponse[];
  } catch (error) {
    console.error('[Solapi] Error sending batch messages:', error);
    return messages.map(() => null);
  }
}

/**
 * Template IDs for different notification types
 */
export const TEMPLATE_IDS = {
  // 기사님께 새 요청 알림
  NEW_REQUEST: 'KA01PF241223000001',
  // 기사님께 광역 요청 알림 (할증)
  WIDE_AREA_REQUEST: 'KA01PF241223000002',
  // 고객님께 기사 배정 완료 알림
  TECH_ASSIGNED: 'KA01PF241223000003',
  // 고객님께 기사 출발 알림
  TECH_DEPARTED: 'KA01PF241223000004',
  // 고객님께 기사 도착 예정 알림
  TECH_ARRIVING: 'KA01PF241223000005',
  // 고객님께 작업 완료 + 잔금 결제 알림
  JOB_COMPLETED: 'KA01PF241223000006',
  // 고객님께 잔금 결제 요청 알림
  BALANCE_REQUEST: 'KA01PF241223000007',
} as const;

/**
 * Build notification message for technicians
 */
export function buildTechNotificationVariables(params: {
  district: string;
  lockType: string;
  price: number;
  urgencyNote: string;
  acceptUrl: string;
  competitorCount: number;
}): Record<string, string> {
  return {
    '#{지역}': params.district,
    '#{도어락종류}': params.lockType,
    '#{예상금액}': params.price.toLocaleString('ko-KR'),
    '#{긴급안내}': params.urgencyNote,
    '#{수락링크}': params.acceptUrl,
    '#{경쟁자수}': String(params.competitorCount),
  };
}

/**
 * Build notification for customer - tech assigned
 */
export function buildCustomerTechAssignedVariables(params: {
  techName: string;
  techPhone: string;
  eta: number;
  myPageUrl: string;
}): Record<string, string> {
  return {
    '#{기사님이름}': params.techName,
    '#{기사님연락처}': params.techPhone,
    '#{예상도착시간}': `${params.eta}분`,
    '#{마이페이지링크}': params.myPageUrl,
  };
}

/**
 * Build notification for customer - tech departed
 */
export function buildCustomerTechDepartedVariables(params: {
  techName: string;
  eta: number;
  myPageUrl: string;
}): Record<string, string> {
  return {
    '#{기사님이름}': params.techName,
    '#{예상도착시간}': `${params.eta}분`,
    '#{마이페이지링크}': params.myPageUrl,
  };
}

/**
 * Build notification for customer - tech arriving
 */
export function buildCustomerTechArrivingVariables(params: {
  techName: string;
  myPageUrl: string;
}): Record<string, string> {
  return {
    '#{기사님이름}': params.techName,
    '#{마이페이지링크}': params.myPageUrl,
  };
}

/**
 * Build notification for customer - balance payment request
 */
export function buildCustomerBalanceRequestVariables(params: {
  amount: number;
  paymentUrl: string;
}): Record<string, string> {
  return {
    '#{잔금금액}': params.amount.toLocaleString('ko-KR'),
    '#{결제링크}': params.paymentUrl,
  };
}

const MY_PAGE_URL = process.env.BASE_URL ? `${process.env.BASE_URL}/my` : 'https://klygo.online/my';

/**
 * Send customer notification - tech assigned
 */
export async function notifyCustomerTechAssigned(
  customerPhone: string,
  techName: string,
  techPhone: string,
  eta: number = 15
): Promise<boolean> {
  const result = await sendKakaoAlimtalk(
    customerPhone,
    TEMPLATE_IDS.TECH_ASSIGNED,
    buildCustomerTechAssignedVariables({ techName, techPhone, eta, myPageUrl: MY_PAGE_URL })
  );
  return result !== null;
}

/**
 * Send customer notification - tech departed
 */
export async function notifyCustomerTechDeparted(
  customerPhone: string,
  techName: string,
  eta: number = 10
): Promise<boolean> {
  const result = await sendKakaoAlimtalk(
    customerPhone,
    TEMPLATE_IDS.TECH_DEPARTED,
    buildCustomerTechDepartedVariables({ techName, eta, myPageUrl: MY_PAGE_URL })
  );
  return result !== null;
}

/**
 * Send customer notification - tech arriving (almost there)
 */
export async function notifyCustomerTechArriving(
  customerPhone: string,
  techName: string
): Promise<boolean> {
  const result = await sendKakaoAlimtalk(
    customerPhone,
    TEMPLATE_IDS.TECH_ARRIVING,
    buildCustomerTechArrivingVariables({ techName, myPageUrl: MY_PAGE_URL })
  );
  return result !== null;
}

/**
 * Send customer notification - balance payment request
 */
export async function notifyCustomerBalanceRequest(
  customerPhone: string,
  amount: number,
  paymentUrl: string
): Promise<boolean> {
  const result = await sendKakaoAlimtalk(
    customerPhone,
    TEMPLATE_IDS.BALANCE_REQUEST,
    buildCustomerBalanceRequestVariables({ amount, paymentUrl })
  );
  return result !== null;
}
