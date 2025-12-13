import { z } from 'zod';
import { UserRole } from '../../types';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const registerSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().min(10).optional(),
  password: z.string().min(8),
  display_name: z.string().min(1).optional(),
  role: z.enum([UserRole.CUSTOMER, UserRole.CALLCENTER, UserRole.TECH, UserRole.ADMIN]).default(UserRole.CUSTOMER),
}).refine((data) => data.email || data.phone, {
  message: 'Either email or phone is required',
});

export const verifyPhoneSchema = z.object({
  phone: z.string().min(10),
  code: z.string().min(4).max(8),
});

export const refreshTokenSchema = z.object({
  refresh_token: z.string(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type VerifyPhoneInput = z.infer<typeof verifyPhoneSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
