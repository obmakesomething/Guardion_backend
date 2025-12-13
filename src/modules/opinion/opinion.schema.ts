import { z } from 'zod';
import { CauseCategory, ConfidenceLevel } from '../../types';

export const submitOpinionSchema = z.object({
  cause_category: z.enum([
    CauseCategory.SUSPECTED_DEFECT,
    CauseCategory.SUSPECTED_USER_ISSUE,
    CauseCategory.UNKNOWN,
  ]),
  basis_text: z.string().min(10),
  confidence: z.enum([ConfidenceLevel.HIGH, ConfidenceLevel.MEDIUM, ConfidenceLevel.LOW]),
});

export type SubmitOpinionInput = z.infer<typeof submitOpinionSchema>;
