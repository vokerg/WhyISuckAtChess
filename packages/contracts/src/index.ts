import { z } from 'zod';

export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal('why-i-suck-at-chess-api'),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const LichessCredentialStateSchema = z.enum([
  'missing',
  'usable',
  'expired',
  'revoked',
  'undecryptable',
]);

export type LichessCredentialState = z.infer<typeof LichessCredentialStateSchema>;

export const LichessConnectedAccountSchema = z.object({
  lichessUserId: z.string().min(1),
  username: z.string().min(1),
  scopes: z.array(z.string()),
  connectedAt: z.string().datetime(),
  expiresAt: z.string().datetime().nullable(),
});

export type LichessConnectedAccount = z.infer<typeof LichessConnectedAccountSchema>;

export const LichessConnectionStatusSchema = z.object({
  connected: z.boolean(),
  account: LichessConnectedAccountSchema.nullable(),
  credentialState: LichessCredentialStateSchema,
  reconnectRequired: z.boolean(),
});

export type LichessConnectionStatus = z.infer<typeof LichessConnectionStatusSchema>;

export const LichessConnectionStartResponseSchema = z.object({
  url: z.url(),
});

export type LichessConnectionStartResponse = z.infer<typeof LichessConnectionStartResponseSchema>;

export const LichessDisconnectResponseSchema = z.object({
  disconnected: z.literal(true),
});

export type LichessDisconnectResponse = z.infer<typeof LichessDisconnectResponseSchema>;
