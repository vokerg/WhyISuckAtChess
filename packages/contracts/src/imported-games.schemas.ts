import { z } from 'zod';

const nullableDateTimeSchema = z.iso.datetime({ offset: true }).nullable();

export const importedGameProviderSchema = z.literal('LICHESS');
export const importedGameResultForUserSchema = z.enum(['WIN', 'DRAW', 'LOSS']);
export const importedGameUserColorSchema = z.enum(['WHITE', 'BLACK']);
export const importedGamePlyIndexStatusSchema = z.enum(['PENDING', 'INDEXED', 'FAILED', 'SKIPPED']);
export const importedGameRawClockPresenceSchema = z.enum(['PRESENT', 'ABSENT', 'INVALID']);
export const importedGameClockAlignmentStatusSchema = z.enum([
  'COMPLETE',
  'UNAVAILABLE',
  'UNALIGNED',
  'ANOMALOUS',
]);
export const importedGameTimingStatusSchema = z.enum([
  'AVAILABLE',
  'UNAVAILABLE',
  'INCONSISTENT',
  'UNSUPPORTED',
]);
export const importedGameTimingCoverageStatusSchema = z.enum(['COMPLETE', 'PARTIAL', 'UNAVAILABLE']);
export const importedGameEngineStatusSchema = z.enum([
  'NOT_ANALYZED',
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'SUPERSEDED',
]);
export const importedGameEngineCoverageStatusSchema = z.enum([
  'PENDING',
  'PARTIAL',
  'COMPLETE',
  'UNAVAILABLE',
  'INCOMPLETE',
]);

export const importedGameListQuerySchema = z.object({
  sort: z.enum(['endedAtDesc', 'endedAtAsc']).default('endedAtDesc'),
  limit: z.preprocess(
    (value) => Array.isArray(value) ? value.at(-1) : value,
    z.coerce.number().int().min(1).max(100).default(25),
  ),
  cursor: z.string().min(1).optional(),
}).strict();

export type ImportedGameListQuery = z.output<typeof importedGameListQuerySchema>;

export const importedGameTimeControlSchema = z.object({
  raw: z.string().nullable(),
  initialSeconds: z.number().int().nonnegative().nullable(),
  incrementSeconds: z.number().int().nonnegative().nullable(),
  exactKey: z.string().nullable(),
  source: z.string(),
}).strict();

export const importedGamePlayerSchema = z.object({
  username: z.string().nullable(),
  rating: z.number().int().nullable(),
}).strict();

export const importedGameOpeningSchema = z.object({
  eco: z.string().nullable(),
  name: z.string().nullable(),
}).strict();

export const importedGameIndexingSchema = z.object({
  status: importedGamePlyIndexStatusSchema,
  indexedAt: nullableDateTimeSchema,
  error: z.string().nullable(),
}).strict();

export const importedGameTimingSummarySchema = z.object({
  alignmentStatus: importedGameClockAlignmentStatusSchema,
  coverageStatus: importedGameTimingCoverageStatusSchema,
  alignedPlyCount: z.number().int().nonnegative(),
  derivedPlyCount: z.number().int().nonnegative(),
  derivationVersion: z.number().int().positive().nullable(),
}).strict();

export const importedGameEngineSummarySchema = z.object({
  status: importedGameEngineStatusSchema,
  coverageStatus: importedGameEngineCoverageStatusSchema,
  runId: z.number().int().positive().nullable(),
  positionsDone: z.number().int().nonnegative().nullable(),
  positionsTotal: z.number().int().nonnegative().nullable(),
  pliesDone: z.number().int().nonnegative().nullable(),
  pliesTotal: z.number().int().nonnegative().nullable(),
  engineName: z.string().nullable(),
  engineVersion: z.string().nullable(),
  completedAt: nullableDateTimeSchema,
}).strict();

export const importedGameProvenanceSchema = z.object({
  source: z.string(),
  connectedLichessUserId: z.string(),
  connectedLichessUsername: z.string(),
  importedAt: z.iso.datetime({ offset: true }),
  sourceUpdatedAt: nullableDateTimeSchema,
  readModelUpdatedAt: z.iso.datetime({ offset: true }),
}).strict();

export const importedGameSourceClockSchema = z.object({
  status: z.enum(['AVAILABLE', 'UNAVAILABLE']),
  sourceOrdinal: z.number().int().positive().nullable(),
  afterCentiseconds: z.number().int().nonnegative().nullable(),
  semantics: z.string().nullable(),
  alignmentVersion: z.number().int().positive().nullable(),
}).strict();

export const importedGamePlyTimingSchema = z.object({
  status: importedGameTimingStatusSchema,
  beforeMoveCentiseconds: z.number().int().nonnegative().nullable(),
  effectiveIncrementCentiseconds: z.number().int().nonnegative().nullable(),
  moveTimeCentiseconds: z.number().int().nonnegative().nullable(),
  beforeClockProvenance: z.string(),
  incrementProvenance: z.string(),
  reliabilityFlags: z.array(z.string()),
  unavailableReason: z.string().nullable(),
  derivationVersion: z.number().int().positive().nullable(),
}).strict();

export const importedGamePositionEngineEvidenceSchema = z.object({
  status: z.enum(['AVAILABLE', 'UNAVAILABLE']),
  analysisVersion: z.string().nullable(),
  settingsHash: z.string().nullable(),
  engineName: z.string().nullable(),
  engineVersion: z.string().nullable(),
  depth: z.number().int().nonnegative().nullable(),
  bestMoveUci: z.string().nullable(),
  scoreCpWhite: z.number().int().nullable(),
  mateWhite: z.number().int().nullable(),
}).strict();

export const importedGamePlyEngineEvidenceSchema = z.object({
  status: z.enum(['AVAILABLE', 'UNAVAILABLE']),
  analysisRunId: z.number().int().positive().nullable(),
  scoreLossCp: z.number().int().nonnegative().nullable(),
  classificationCode: z.number().int().nullable(),
  beforePosition: importedGamePositionEngineEvidenceSchema,
}).strict();

export const importedGameEvidenceAnnotationSchema = z.object({
  kind: z.string(),
  label: z.string(),
  severity: z.enum(['INFO', 'WARNING', 'CRITICAL']).optional(),
}).strict();

export const importedGamePlySchema = z.object({
  plyNumber: z.number().int().positive(),
  moveUci: z.string().min(4),
  moverColor: importedGameUserColorSchema,
  isUserMove: z.boolean(),
  beforePosition: z.object({
    id: z.number().int().positive(),
    normalizedFen: z.string().min(1),
  }).strict(),
  afterPosition: z.object({
    id: z.number().int().positive(),
    normalizedFen: z.string().min(1),
  }).strict(),
  sourceClock: importedGameSourceClockSchema,
  timing: importedGamePlyTimingSchema,
  engine: importedGamePlyEngineEvidenceSchema,
  annotations: z.array(importedGameEvidenceAnnotationSchema),
}).strict();

const importedGameCommonSchema = z.object({
  id: z.number().int().positive(),
  provider: importedGameProviderSchema,
  providerGameId: z.string().min(1),
  providerUrl: z.string().url().nullable(),
  startedAt: nullableDateTimeSchema,
  endedAt: nullableDateTimeSchema,
  rated: z.boolean().nullable(),
  variant: z.string().nullable(),
  speedCategory: z.string().nullable(),
  timeControl: importedGameTimeControlSchema,
  white: importedGamePlayerSchema,
  black: importedGamePlayerSchema,
  userColor: importedGameUserColorSchema.nullable(),
  opponentUsername: z.string().nullable(),
  result: z.string().nullable(),
  resultForUser: importedGameResultForUserSchema.nullable(),
  status: z.string().nullable(),
  opening: importedGameOpeningSchema,
  indexing: importedGameIndexingSchema,
  timing: importedGameTimingSummarySchema,
  engine: importedGameEngineSummarySchema,
}).strict();

export const importedGameListItemSchema = importedGameCommonSchema;

export const importedGameListResponseSchema = z.object({
  items: z.array(importedGameListItemSchema),
  pageInfo: z.object({
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  }).strict(),
}).strict();

export const importedGameReplayResponseSchema = importedGameCommonSchema.extend({
  provenance: importedGameProvenanceSchema,
  clockSource: z.object({
    presence: importedGameRawClockPresenceSchema,
    stateCount: z.number().int().nonnegative(),
    unit: z.string(),
    anomalies: z.array(z.string()),
  }).strict(),
  plies: z.array(importedGamePlySchema),
}).strict();

export const importedGameDetailResponseSchema = importedGameReplayResponseSchema.extend({
  pgn: z.string().nullable(),
}).strict();

export type ImportedGameProvider = z.output<typeof importedGameProviderSchema>;
export type ImportedGameResultForUser = z.output<typeof importedGameResultForUserSchema>;
export type ImportedGameUserColor = z.output<typeof importedGameUserColorSchema>;
export type ImportedGamePlyIndexStatus = z.output<typeof importedGamePlyIndexStatusSchema>;
export type ImportedGameTimingStatus = z.output<typeof importedGameTimingStatusSchema>;
export type ImportedGameTimingSummary = z.output<typeof importedGameTimingSummarySchema>;
export type ImportedGameEngineSummary = z.output<typeof importedGameEngineSummarySchema>;
export type ImportedGameListItem = z.output<typeof importedGameListItemSchema>;
export type ImportedGameListResponse = z.output<typeof importedGameListResponseSchema>;
export type ImportedGameReplay = z.output<typeof importedGameReplayResponseSchema>;
export type ImportedGameDetail = z.output<typeof importedGameDetailResponseSchema>;
export type ImportedGamePly = z.output<typeof importedGamePlySchema>;
