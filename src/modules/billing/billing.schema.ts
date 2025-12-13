import { z } from 'zod';
import { AccrualStatus } from '../../types';

export const getAccrualsQuerySchema = z.object({
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum([AccrualStatus.ACCRUED, AccrualStatus.VOIDED, AccrualStatus.INVOICED]).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export const generateInvoiceSchema = z.object({
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const voidAccrualSchema = z.object({
  reason: z.string().min(1),
});

export type GetAccrualsQuery = z.infer<typeof getAccrualsQuerySchema>;
export type GenerateInvoiceInput = z.infer<typeof generateInvoiceSchema>;
export type VoidAccrualInput = z.infer<typeof voidAccrualSchema>;
