import { z } from 'zod';

export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal('why-i-suck-at-chess-api'),
}).strict();

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
}).strict();

export type LichessConnectedAccount = z.infer<typeof LichessConnectedAccountSchema>;

export const LichessConnectionStatusSchema = z.object({
  connected: z.boolean(),
  account: LichessConnectedAccountSchema.nullable(),
  credentialState: LichessCredentialStateSchema,
  reconnectRequired: z.boolean(),
}).strict();

export type LichessConnectionStatus = z.infer<typeof LichessConnectionStatusSchema>;

export const LichessConnectionStartResponseSchema = z.object({
  url: z.url(),
}).strict();

export type LichessConnectionStartResponse = z.infer<typeof LichessConnectionStartResponseSchema>;

export const LichessDisconnectResponseSchema = z.object({
  disconnected: z.literal(true),
}).strict();

export type LichessDisconnectResponse = z.infer<typeof LichessDisconnectResponseSchema>;

export const LichessImportRequestSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  rated: z.boolean().optional(),
}).strict();

export type LichessImportRequest = z.infer<typeof LichessImportRequestSchema>;

export * from './imported-games.schemas';
