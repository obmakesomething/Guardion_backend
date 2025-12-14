import dotenv from 'dotenv';

dotenv.config();

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),

  database: {
    url: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/guardion',
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  },

  aws: {
    region: process.env.AWS_REGION || 'ap-northeast-2',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    s3Bucket: process.env.S3_BUCKET || 'guardion-evidence',
  },

  otp: {
    length: parseInt(process.env.OTP_LENGTH || '6', 10),
    expiresMinutes: parseInt(process.env.OTP_EXPIRES_MINUTES || '10', 10),
    maxAttempts: parseInt(process.env.OTP_MAX_ATTEMPTS || '5', 10),
  },

  accrual: {
    defaultAmount: parseInt(process.env.DEFAULT_ACCRUAL_AMOUNT || '3000', 10),
  },
};
