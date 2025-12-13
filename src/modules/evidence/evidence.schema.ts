import { z } from 'zod';
import { EvidenceType } from '../../types';

export const evidencePresignSchema = z.object({
  type: z.enum([EvidenceType.DOOR, EvidenceType.LOCK, EvidenceType.KEY, EvidenceType.OTHER]),
  content_type: z.string().regex(/^image\/(jpeg|png|gif|webp)$/, 'Must be an image type'),
  file_name: z.string().min(1),
});

export const evidenceCompleteSchema = z.object({
  type: z.enum([EvidenceType.DOOR, EvidenceType.LOCK, EvidenceType.KEY, EvidenceType.OTHER]),
  object_key: z.string().min(1),
});

export type EvidencePresignInput = z.infer<typeof evidencePresignSchema>;
export type EvidenceCompleteInput = z.infer<typeof evidenceCompleteSchema>;
