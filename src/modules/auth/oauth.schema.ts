import { z } from 'zod';

export const AuthProvider = {
  GOOGLE: 'google',
  PHONE: 'phone',
  LOCAL: 'local',
  KAKAO: 'kakao',
} as const;

export type AuthProvider = (typeof AuthProvider)[keyof typeof AuthProvider];

export const OAuthFlow = {
  LOGIN: 'login',
  LINK: 'link',
} as const;

export type OAuthFlow = (typeof OAuthFlow)[keyof typeof OAuthFlow];

export const OtpPurpose = {
  LOGIN: 'login',
  LINK: 'link',
  CASE_ACCESS: 'case_access',
  SENSITIVE_VIEW: 'sensitive_view',
} as const;

export type OtpPurpose = (typeof OtpPurpose)[keyof typeof OtpPurpose];

export const CaseAccessScope = {
  PROGRESS_ONLY: 'progress_only',
  REPORT_VIEW: 'report_view',
  EVIDENCE_VIEW: 'evidence_view',
} as const;

export type CaseAccessScope = (typeof CaseAccessScope)[keyof typeof CaseAccessScope];

// OAuth schemas
export const oauthStartSchema = z.object({
  redirect_uri: z.string().url(),
  flow: z.enum([OAuthFlow.LOGIN, OAuthFlow.LINK]),
});

export const oauthCallbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
  redirect_uri: z.string().url(),
  code_verifier: z.string().min(43).max(128),
});

export const oauthLinkSchema = oauthCallbackSchema;

// Phone OTP schemas
export const phoneOtpSendSchema = z.object({
  phone: z.string().min(10),
  purpose: z.enum([OtpPurpose.LOGIN, OtpPurpose.LINK, OtpPurpose.CASE_ACCESS, OtpPurpose.SENSITIVE_VIEW]),
});

export const phoneOtpVerifySchema = z.object({
  otp_id: z.string().uuid(),
  code: z.string().min(4).max(8),
  purpose: z.enum([OtpPurpose.LOGIN, OtpPurpose.LINK, OtpPurpose.CASE_ACCESS, OtpPurpose.SENSITIVE_VIEW]),
});

export const linkPhoneSchema = z.object({
  otp_id: z.string().uuid(),
});

// Refresh token schema
export const refreshSchema = z.object({
  refresh_token: z.string().min(1),
});

export type OAuthStartInput = z.infer<typeof oauthStartSchema>;
export type OAuthCallbackInput = z.infer<typeof oauthCallbackSchema>;
export type OAuthLinkInput = z.infer<typeof oauthLinkSchema>;
export type PhoneOtpSendInput = z.infer<typeof phoneOtpSendSchema>;
export type PhoneOtpVerifyInput = z.infer<typeof phoneOtpVerifySchema>;
export type LinkPhoneInput = z.infer<typeof linkPhoneSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
