import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT ?? 8787),
  nodeEnv: process.env.NODE_ENV ?? 'development',

  // Database
  databaseUrl: process.env.DATABASE_URL ?? '',

  // Solapi (Kakao Alimtalk)
  solapi: {
    apiKey: process.env.SOLAPI_API_KEY ?? '',
    apiSecret: process.env.SOLAPI_API_SECRET ?? '',
    pfId: process.env.SOLAPI_PFID ?? '',
    senderNumber: process.env.SOLAPI_SENDER_NUMBER ?? '',
  },

  // Toss Payments
  toss: {
    clientKey: process.env.TOSS_CLIENT_KEY ?? '',
    secretKey: process.env.TOSS_SECRET_KEY ?? '',
    webhookSecret: process.env.TOSS_WEBHOOK_SECRET ?? '',
    successUrl: process.env.TOSS_SUCCESS_URL ?? 'https://alygo.online/payment/success',
    failUrl: process.env.TOSS_FAIL_URL ?? 'https://alygo.online/payment/fail',
  },

  // Matching Engine
  matching: {
    level1TimeoutSec: Number(process.env.MATCH_LEVEL1_TIMEOUT_SEC ?? 120),
    level2TimeoutSec: Number(process.env.MATCH_LEVEL2_TIMEOUT_SEC ?? 180),
    batchSize: Number(process.env.MATCH_BATCH_SIZE ?? 20),
    minTechsForLocalMatch: 3,
  },

  // Pricing (새 수익 구조)
  pricing: {
    // 선결제 출장비
    calloutFee: Number(process.env.CALLOUT_FEE ?? 35000),
    // 기본 출장비 (= calloutFee, 호환성용)
    basePrice: Number(process.env.CALLOUT_FEE ?? 35000),
    // 플랫폼 수익 (출장비에서)
    platformFeeFromCallout: Number(process.env.PLATFORM_FEE_CALLOUT ?? 5000),
    // 기사님 배정액
    techCalloutShare: Number(process.env.TECH_CALLOUT_SHARE ?? 30000),
    // 광역 매칭 할증
    wideAreaSurcharge: Number(process.env.WIDE_AREA_SURCHARGE ?? 5000),
    // 할증 금액 (= wideAreaSurcharge, 호환성용)
    surchargeAmount: Number(process.env.WIDE_AREA_SURCHARGE ?? 5000),
    // 잔금 수수료율 (10-15%)
    balanceFeeRate: Number(process.env.BALANCE_FEE_RATE ?? 0.1),
  },

  // Feature Flags
  features: {
    enableArsBackup: process.env.ENABLE_ARS_BACKUP === 'true',
  },

  // URLs
  urls: {
    baseUrl: process.env.BASE_URL ?? 'https://alygo.online',
    techAcceptPage: process.env.TECH_ACCEPT_URL ?? 'https://alygo.online/tech',
    paymentPage: process.env.PAYMENT_URL ?? 'https://alygo.online/pay',
  },
} as const;

export type Config = typeof config;
