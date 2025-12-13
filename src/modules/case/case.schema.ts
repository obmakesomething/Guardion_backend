import { z } from 'zod';
import { CaseStatus, RiskDecision } from '../../types';

export const createCaseSchema = z.object({
  customer_phone: z.string().min(10),
  address_text: z.string().min(1),
  location_lat: z.number().min(-90).max(90),
  location_lng: z.number().min(-180).max(180),
  place_note: z.string().optional().nullable(),
  symptom_note: z.string().optional().nullable(),
});

export const caseIdParamSchema = z.object({
  caseId: z.string().uuid(),
});

export const setRiskSchema = z.object({
  decision: z.enum([RiskDecision.PROCEED, RiskDecision.NEED_APPROVAL, RiskDecision.REJECT]),
  risk_level: z.number().int().min(0).max(5),
  note: z.string().optional().nullable(),
});

export const updateCaseStatusSchema = z.object({
  status: z.enum([
    CaseStatus.EN_ROUTE,
    CaseStatus.ARRIVED,
    CaseStatus.WORKING,
    CaseStatus.OTP_PENDING,
  ]),
  note: z.string().optional().nullable(),
});

export const cancelCaseSchema = z.object({
  reason: z.string().min(1),
});

export const getCasesQuerySchema = z.object({
  status: z.enum([
    CaseStatus.SUBMITTED,
    CaseStatus.NEED_APPROVAL,
    CaseStatus.DISPATCHING,
    CaseStatus.ACCEPTED,
    CaseStatus.ASSIGNED,
    CaseStatus.EN_ROUTE,
    CaseStatus.ARRIVED,
    CaseStatus.WORKING,
    CaseStatus.OTP_PENDING,
    CaseStatus.COMPLETED,
    CaseStatus.CANCELLED,
    CaseStatus.EXPIRED,
    CaseStatus.REJECTED,
    CaseStatus.FAILED,
  ]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type CreateCaseInput = z.infer<typeof createCaseSchema>;
export type SetRiskInput = z.infer<typeof setRiskSchema>;
export type UpdateCaseStatusInput = z.infer<typeof updateCaseStatusSchema>;
export type CancelCaseInput = z.infer<typeof cancelCaseSchema>;
export type GetCasesQuery = z.infer<typeof getCasesQuerySchema>;
