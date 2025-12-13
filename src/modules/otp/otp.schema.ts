import { z } from 'zod';

export const otpVerifySchema = z.object({
  otp: z.string().min(4).max(8),
});

export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;
