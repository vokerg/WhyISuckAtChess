import { z } from 'zod';

const utcInstantSchema = z.iso.datetime({ offset: true });
const optionalUtcInstantSchema = utcInstantSchema.nullable();

export const lichessImportRunStatusSchema = z.enum([
  'QUEUED',
  'RUNNING',
  'CANCEL_REQUESTED',
  'CANCELLED',
  'COMPLETED',
  'FAILED',
]);

export const lichessImportRunSchema = z.object({
  id: z.number().int().positive(),
  provider: z.literal('LICHESS'),
  status: lichessImportRunStatusSchema,
  lichessUserIdSnapshot: z.string().min(1),
  lichessUsernameSnapshot: z.string().min(1),
  scope: z.object({
    provider: z.literal('LICHESS'),
    speeds: z.tuple([z.literal('bullet'), z.literal('blitz'), z.literal('rapid')]),
    rated: z.boolean().optional(),
  }).strict(),
  requestedFrom: utcInstantSchema,
  requestedTo: utcInstantSchema,
  windowsTotal: z.number().int().nonnegative(),
  windowsCompleted: z.number().int().nonnegative(),
  gamesSeen: z.number().int().nonnegative(),
  gamesMatchedScope: z.number().int().nonnegative(),
  gamesImported: z.number().int().nonnegative(),
  gamesDuplicate: z.number().int().nonnegative(),
  gamesUpdated: z.number().int().nonnegative(),
  gamesSkippedOutOfScope: z.number().int().nonnegative(),
  errorCode: z.string().nullable(),
  error: z.string().nullable(),
  lastProgressAt: optionalUtcInstantSchema,
  rateLimitUntil: optionalUtcInstantSchema,
  startedAt: optionalUtcInstantSchema,
  completedAt: optionalUtcInstantSchema,
}).strict();

export const lichessImportRunResponseSchema = z.object({
  importRun: lichessImportRunSchema,
}).strict();

export const lichessLatestImportResponseSchema = z.object({
  importRun: lichessImportRunSchema.nullable(),
}).strict();

export type LichessImportRun = z.infer<typeof lichessImportRunSchema>;
export type LichessImportRunStatus = z.infer<typeof lichessImportRunStatusSchema>;
