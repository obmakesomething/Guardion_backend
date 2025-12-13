import { z } from 'zod';

export const createDispatchOffersSchema = z.object({
  tech_ids: z.array(z.string().uuid()).min(1),
});

export const respondToOfferSchema = z.object({
  accept: z.boolean(),
});

export const assignTechSchema = z.object({
  tech_id: z.string().uuid(),
});

export const techLocationPingSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().optional().nullable(),
  ts: z.string().datetime().optional(),
});

export type CreateDispatchOffersInput = z.infer<typeof createDispatchOffersSchema>;
export type RespondToOfferInput = z.infer<typeof respondToOfferSchema>;
export type AssignTechInput = z.infer<typeof assignTechSchema>;
export type TechLocationPingInput = z.infer<typeof techLocationPingSchema>;
