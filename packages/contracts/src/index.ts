import { z } from 'zod';

export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal('why-i-suck-at-chess-api'),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
