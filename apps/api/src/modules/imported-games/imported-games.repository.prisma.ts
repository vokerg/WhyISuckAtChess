import { Prisma, type PrismaClient } from '@prisma/client';
import type { ImportedGameListQuery } from '@why-i-suck-at-chess/contracts';
import prisma from '../../prisma';
import { InvalidImportedGameCursorError } from './imported-games.errors';

export interface ImportedGameCursor {
  endedAt: string | null;
  id: number;
}

const latestEngineRunOrderBy: Prisma.GameAnalysisRunOrderByWithRelationInput[] = [
  { createdAt: 'desc' },
  { id: 'desc' },
];

const latestPositionAnalysisOrderBy: Prisma.StockfishPositionAnalysisOrderByWithRelationInput[] = [
  { createdAt: 'desc' },
  { id: 'desc' },
];

const latestEngineRunSelect = {
  id: true,
  status: true,
  coverageStatus: true,
  positionsDone: true,
  positionsTotal: true,
  pliesDone: true,
  pliesTotal: true,
  engineName: true,
  engineVersion: true,
  completedAt: true,
  createdAt: true,
} as const;

const importedGameListSelect = {
  id: true,
  provider: true,
  providerGameId: true,
  providerUrl: true,
  startedAt: true,
  endedAt: true,
  rated: true,
  variant: true,
  speedCategory: true,
  timeControlRaw: true,
  timeControlInitial: true,
  timeControlIncrement: true,
  timeControlSource: true,
  exactTimeControlKey: true,
  whiteUsername: true,
  blackUsername: true,
  whiteRating: true,
  blackRating: true,
  userColor: true,
  opponentUsername: true,
  result: true,
  resultForUser: true,
  status: true,
  openingName: true,
  openingEco: true,
  plyIndexStatus: true,
  plyIndexedAt: true,
  plyIndexError: true,
  clockAlignmentStatus: true,
  alignedClockPlyCount: true,
  timingDerivationVersion: true,
  derivedTimingPlyCount: true,
  timingCoverageStatus: true,
  analysisRuns: {
    orderBy: latestEngineRunOrderBy,
    take: 1,
    select: latestEngineRunSelect,
  },
} as const;

const importedGamePlySelect = {
  plyNumber: true,
  moveUci: true,
  moverColor: true,
  isUserMove: true,
  beforePositionId: true,
  afterPositionId: true,
  beforePosition: {
    select: {
      id: true,
      normalizedFen: true,
      engineAnalyses: {
        orderBy: latestPositionAnalysisOrderBy,
        take: 1,
        select: {
          analysisVersion: true,
          settingsHash: true,
          engineName: true,
          engineVersion: true,
          depth: true,
          bestMove: true,
          scoreCpWhite: true,
          mateWhite: true,
        },
      },
    },
  },
  afterPosition: {
    select: {
      id: true,
      normalizedFen: true,
    },
  },
  sourceClockOrdinal: true,
  sourceClockAfterCentiseconds: true,
  sourceClockSemantics: true,
  clockAlignmentVersion: true,
  clockBeforeMoveCentiseconds: true,
  effectiveIncrementCentiseconds: true,
  clockDeltaMoveTimeCentiseconds: true,
  beforeClockProvenance: true,
  incrementProvenance: true,
  timingDerivationVersion: true,
  timingDerivationStatus: true,
  timingReliabilityFlags: true,
  timingUnavailableReason: true,
  engineAnalysisRunId: true,
  engineAnalysisRun: {
    select: {
      id: true,
      status: true,
      coverageStatus: true,
    },
  },
  scoreLossCp: true,
  classificationCode: true,
} as const;

const importedGameReplaySelect = {
  ...importedGameListSelect,
  source: true,
  connectedLichessUserId: true,
  connectedLichessUsername: true,
  rawClockPresence: true,
  rawClockStateCount: true,
  rawClockUnit: true,
  rawClockAnomalies: true,
  createdAt: true,
  updatedAt: true,
  plies: {
    orderBy: { plyNumber: 'asc' as const },
    select: importedGamePlySelect,
  },
} as const;

const importedGameDetailSelect = {
  ...importedGameReplaySelect,
  pgn: true,
} as const;

export type ImportedGameListRow = Prisma.ImportedGameGetPayload<{ select: typeof importedGameListSelect }>;
export type ImportedGameReplayRow = Prisma.ImportedGameGetPayload<{ select: typeof importedGameReplaySelect }>;
export type ImportedGameDetailRow = Prisma.ImportedGameGetPayload<{ select: typeof importedGameDetailSelect }>;

type ImportedGameDatabase = Pick<PrismaClient, 'importedGame'>;

function encodeCursor(row: Pick<ImportedGameCursor, 'endedAt' | 'id'>): string {
  return Buffer.from(JSON.stringify(row), 'utf8').toString('base64url');
}

export function decodeImportedGameCursor(cursor?: string): ImportedGameCursor | null {
  if (!cursor) return null;

  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object') throw new Error('invalid cursor object');
    const value = parsed as { endedAt?: unknown; id?: unknown };
    if (!Number.isInteger(value.id) || (typeof value.id !== 'number') || value.id <= 0) {
      throw new Error('invalid cursor id');
    }
    if (value.endedAt !== null && typeof value.endedAt !== 'string' && value.endedAt !== undefined) {
      throw new Error('invalid cursor date');
    }
    if (typeof value.endedAt === 'string' && !Number.isFinite(new Date(value.endedAt).getTime())) {
      throw new Error('invalid cursor date');
    }
    return { endedAt: typeof value.endedAt === 'string' ? value.endedAt : null, id: value.id };
  } catch {
    throw new InvalidImportedGameCursorError();
  }
}

function cursorWhere(
  cursor: ImportedGameCursor | null,
  sort: ImportedGameListQuery['sort'],
): Prisma.ImportedGameWhereInput | undefined {
  if (!cursor) return undefined;

  if (sort === 'endedAtAsc') {
    if (!cursor.endedAt) return { endedAt: null, id: { gt: cursor.id } };
    return {
      OR: [
        { endedAt: { gt: new Date(cursor.endedAt) } },
        { endedAt: new Date(cursor.endedAt), id: { gt: cursor.id } },
        { endedAt: null },
      ],
    };
  }

  if (!cursor.endedAt) return { endedAt: null, id: { lt: cursor.id } };
  return {
    OR: [
      { endedAt: { lt: new Date(cursor.endedAt) } },
      { endedAt: new Date(cursor.endedAt), id: { lt: cursor.id } },
      { endedAt: null },
    ],
  };
}

function orderBy(sort: ImportedGameListQuery['sort']): Prisma.ImportedGameOrderByWithRelationInput[] {
  return sort === 'endedAtAsc'
    ? [{ endedAt: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }]
    : [{ endedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }];
}

export interface ImportedGamesRepository {
  findList(
    appUserId: number,
    query: ImportedGameListQuery,
    cursor: ImportedGameCursor | null,
  ): Promise<ImportedGameListRow[]>;
  findDetail(appUserId: number, gameId: number): Promise<ImportedGameDetailRow | null>;
  findReplay(appUserId: number, gameId: number): Promise<ImportedGameReplayRow | null>;
}

export function createPrismaImportedGamesRepository(
  database: ImportedGameDatabase = prisma,
): ImportedGamesRepository {
  return {
    async findList(appUserId, query, cursor) {
      const afterCursor = cursorWhere(cursor, query.sort);
      const rows = await database.importedGame.findMany({
        where: afterCursor
          ? { AND: [{ appUserId, provider: 'LICHESS' }, afterCursor] }
          : { appUserId, provider: 'LICHESS' },
        orderBy: orderBy(query.sort),
        take: query.limit + 1,
        select: importedGameListSelect,
      });
      return rows as unknown as ImportedGameListRow[];
    },

    async findDetail(appUserId, gameId) {
      const row = await database.importedGame.findFirst({
        where: { id: gameId, appUserId, provider: 'LICHESS' },
        select: importedGameDetailSelect,
      });
      return row as unknown as ImportedGameDetailRow | null;
    },

    async findReplay(appUserId, gameId) {
      const row = await database.importedGame.findFirst({
        where: { id: gameId, appUserId, provider: 'LICHESS' },
        select: importedGameReplaySelect,
      });
      return row as unknown as ImportedGameReplayRow | null;
    },
  };
}

export const prismaImportedGamesRepository = createPrismaImportedGamesRepository();

export function nextCursorForImportedGame(row: Pick<ImportedGameListRow, 'endedAt' | 'id'>): string {
  return encodeCursor({ endedAt: row.endedAt?.toISOString() ?? null, id: row.id });
}
