import type {
  ImportedGameDetail,
  ImportedGameEngineSummary,
  ImportedGameListItem,
  ImportedGameListQuery,
  ImportedGameListResponse,
  ImportedGamePly,
  ImportedGameReplay,
  ImportedGameTimingSummary,
  ImportedGameUserColor,
} from '@why-i-suck-at-chess/contracts';
import {
  decodeImportedGameCursor,
  nextCursorForImportedGame,
  prismaImportedGamesRepository,
  type ImportedGameDetailRow,
  type ImportedGameListRow,
  type ImportedGameReplayRow,
  type ImportedGamesRepository,
} from './imported-games.repository.prisma';

type GameProjectionRow = ImportedGameListRow | ImportedGameReplayRow | ImportedGameDetailRow;

function toIso(value: Date | null | undefined): string | null {
  return value?.toISOString() ?? null;
}

function color(value: string | null | undefined): ImportedGameUserColor | null {
  const normalized = value?.trim().toUpperCase();
  return normalized === 'WHITE' || normalized === 'BLACK' ? normalized : null;
}

function resultForUser(value: string | null | undefined): ImportedGameListItem['resultForUser'] {
  const normalized = value?.trim().toUpperCase();
  return normalized === 'WIN' || normalized === 'DRAW' || normalized === 'LOSS' ? normalized : null;
}

function indexStatus(value: string | null | undefined): ImportedGameListItem['indexing']['status'] {
  if (value === 'INDEXED' || value === 'FAILED' || value === 'SKIPPED') return value;
  return 'PENDING';
}

function clockPresence(value: string | null | undefined): 'PRESENT' | 'ABSENT' | 'INVALID' {
  if (value === 'PRESENT' || value === 'INVALID') return value;
  return 'ABSENT';
}

function clockAlignmentStatus(value: string | null | undefined): ImportedGameTimingSummary['alignmentStatus'] {
  if (value === 'COMPLETE' || value === 'UNALIGNED' || value === 'ANOMALOUS') return value;
  return 'UNAVAILABLE';
}

function timingCoverageStatus(value: string | null | undefined): ImportedGameTimingSummary['coverageStatus'] {
  if (value === 'COMPLETE' || value === 'PARTIAL') return value;
  return 'UNAVAILABLE';
}

function engineStatus(value: string | null | undefined): ImportedGameEngineSummary['status'] {
  if (value === 'RUNNING' || value === 'FAILED' || value === 'SUPERSEDED') return value;
  if (value === 'QUEUED' || value === 'RETRY_WAIT') return 'QUEUED';
  if (value === 'SUCCEEDED') return 'COMPLETED';
  return 'NOT_ANALYZED';
}

function engineCoverageStatus(
  value: string | null | undefined,
): ImportedGameEngineSummary['coverageStatus'] {
  if (value === 'PENDING' || value === 'PARTIAL' || value === 'COMPLETE' || value === 'INCOMPLETE') {
    return value;
  }
  return 'UNAVAILABLE';
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function latestEngineRun(row: GameProjectionRow) {
  const run = row.analysisRuns[0] ?? null;
  if (!run || !row.plyIndexedAt || !run.sourcePlyIndexedAt) return null;
  return run.sourcePlyIndexedAt.getTime() === row.plyIndexedAt.getTime() ? run : null;
}

type CurrentEngineRun = {
  id: number;
  status: string;
  coverageStatus: string;
  analysisVersion: string;
  settingsHash: string;
  engineName: string | null;
  engineVersion: string | null;
  sourcePlyIndexedAt: Date | null;
};

function toEngineSummary(row: GameProjectionRow): ImportedGameEngineSummary {
  const run = latestEngineRun(row);
  return {
    status: engineStatus(run?.status),
    coverageStatus: engineCoverageStatus(run?.coverageStatus),
    runId: run?.id ?? null,
    positionsDone: run?.positionsDone ?? null,
    positionsTotal: run?.positionsTotal ?? null,
    pliesDone: run?.pliesDone ?? null,
    pliesTotal: run?.pliesTotal ?? null,
    engineName: run?.engineName ?? null,
    engineVersion: run?.engineVersion ?? null,
    completedAt: toIso(run?.completedAt),
  };
}

function toCommon(row: GameProjectionRow): ImportedGameListItem {
  return {
    id: row.id,
    provider: 'LICHESS',
    providerGameId: row.providerGameId,
    providerUrl: row.providerUrl,
    startedAt: toIso(row.startedAt),
    endedAt: toIso(row.endedAt),
    rated: row.rated,
    variant: row.variant,
    speedCategory: row.speedCategory,
    timeControl: {
      raw: row.timeControlRaw,
      initialSeconds: row.timeControlInitial,
      incrementSeconds: row.timeControlIncrement,
      exactKey: row.exactTimeControlKey,
      source: row.timeControlSource,
    },
    white: { username: row.whiteUsername, rating: row.whiteRating },
    black: { username: row.blackUsername, rating: row.blackRating },
    userColor: color(row.userColor),
    opponentUsername: row.opponentUsername,
    result: row.result,
    resultForUser: resultForUser(row.resultForUser),
    status: row.status,
    opening: { eco: row.openingEco, name: row.openingName },
    indexing: {
      status: indexStatus(row.plyIndexStatus),
      indexedAt: toIso(row.plyIndexedAt),
      error: row.plyIndexError,
    },
    timing: {
      alignmentStatus: clockAlignmentStatus(row.clockAlignmentStatus),
      coverageStatus: timingCoverageStatus(row.timingCoverageStatus),
      alignedPlyCount: row.alignedClockPlyCount,
      derivedPlyCount: row.derivedTimingPlyCount,
      derivationVersion: row.timingDerivationVersion,
    },
    engine: toEngineSummary(row),
  };
}

function toPly(
  row: ImportedGameReplayRow['plies'][number],
  currentEngineRun: CurrentEngineRun | null,
): ImportedGamePly {
  const positionAnalysis = row.beforePosition.engineAnalyses[0] ?? null;
  const sourceClockAvailable = row.sourceClockOrdinal !== null
    && row.sourceClockAfterCentiseconds !== null;
  const authoritativeRun = currentEngineRun?.id === row.engineAnalysisRunId
    && currentEngineRun.status === 'SUCCEEDED'
    && currentEngineRun.coverageStatus === 'COMPLETE'
    && row.engineAnalysisRun?.status === 'SUCCEEDED'
    && row.engineAnalysisRun.coverageStatus === 'COMPLETE';
  const engineAvailable = authoritativeRun
    && (row.scoreLossCp !== null || row.classificationCode !== null);
  const positionAnalysisAvailable = authoritativeRun
    && currentEngineRun !== null
    && positionAnalysis !== null
    && positionAnalysis.analysisVersion === currentEngineRun.analysisVersion
    && positionAnalysis.settingsHash === currentEngineRun.settingsHash
    && positionAnalysis.engineName === currentEngineRun.engineName
    && positionAnalysis.engineVersion === currentEngineRun.engineVersion;

  return {
    plyNumber: row.plyNumber,
    moveUci: row.moveUci,
    moverColor: color(row.moverColor) ?? 'WHITE',
    isUserMove: row.isUserMove,
    beforePosition: {
      id: row.beforePosition.id,
      normalizedFen: row.beforePosition.normalizedFen,
    },
    afterPosition: {
      id: row.afterPosition.id,
      normalizedFen: row.afterPosition.normalizedFen,
    },
    sourceClock: {
      status: sourceClockAvailable ? 'AVAILABLE' : 'UNAVAILABLE',
      sourceOrdinal: row.sourceClockOrdinal,
      afterCentiseconds: row.sourceClockAfterCentiseconds,
      semantics: row.sourceClockSemantics,
      alignmentVersion: row.clockAlignmentVersion,
    },
    timing: {
      status: row.timingDerivationStatus === 'AVAILABLE'
        || row.timingDerivationStatus === 'INCONSISTENT'
        || row.timingDerivationStatus === 'UNSUPPORTED'
        ? row.timingDerivationStatus
        : 'UNAVAILABLE',
      beforeMoveCentiseconds: row.clockBeforeMoveCentiseconds,
      effectiveIncrementCentiseconds: row.effectiveIncrementCentiseconds,
      moveTimeCentiseconds: row.clockDeltaMoveTimeCentiseconds,
      beforeClockProvenance: row.beforeClockProvenance,
      incrementProvenance: row.incrementProvenance,
      reliabilityFlags: row.timingReliabilityFlags,
      unavailableReason: row.timingUnavailableReason,
      derivationVersion: row.timingDerivationVersion,
    },
    engine: {
      status: engineAvailable ? 'AVAILABLE' : 'UNAVAILABLE',
      analysisRunId: engineAvailable ? row.engineAnalysisRunId : null,
      scoreLossCp: engineAvailable ? row.scoreLossCp : null,
      classificationCode: engineAvailable ? row.classificationCode : null,
      beforePosition: {
        status: positionAnalysisAvailable ? 'AVAILABLE' : 'UNAVAILABLE',
        analysisVersion: positionAnalysisAvailable ? positionAnalysis.analysisVersion : null,
        settingsHash: positionAnalysisAvailable ? positionAnalysis.settingsHash : null,
        engineName: positionAnalysisAvailable ? positionAnalysis.engineName : null,
        engineVersion: positionAnalysisAvailable ? positionAnalysis.engineVersion : null,
        depth: positionAnalysisAvailable ? positionAnalysis.depth : null,
        bestMoveUci: positionAnalysisAvailable ? positionAnalysis.bestMove : null,
        scoreCpWhite: positionAnalysisAvailable ? positionAnalysis.scoreCpWhite : null,
        mateWhite: positionAnalysisAvailable ? positionAnalysis.mateWhite : null,
      },
    },
    annotations: [],
  };
}

function toReplay(row: ImportedGameReplayRow | ImportedGameDetailRow): ImportedGameReplay {
  const currentEngineRun = latestEngineRun(row);
  return {
    ...toCommon(row),
    provenance: {
      source: row.source,
      connectedLichessUserId: row.connectedLichessUserId,
      connectedLichessUsername: row.connectedLichessUsername,
      importedAt: row.createdAt.toISOString(),
      sourceUpdatedAt: toIso(row.endedAt),
      readModelUpdatedAt: row.updatedAt.toISOString(),
    },
    clockSource: {
      presence: clockPresence(row.rawClockPresence),
      stateCount: row.rawClockStateCount,
      unit: row.rawClockUnit,
      anomalies: stringArray(row.rawClockAnomalies),
    },
    plies: row.plies.map((ply) => toPly(ply, currentEngineRun)),
  };
}

export interface ImportedGamesQueryService {
  list(appUserId: number, query: ImportedGameListQuery): Promise<ImportedGameListResponse>;
  getDetail(appUserId: number, gameId: number): Promise<ImportedGameDetail | null>;
  getReplay(appUserId: number, gameId: number): Promise<ImportedGameReplay | null>;
}

export function createImportedGamesQueryService(
  repository: ImportedGamesRepository = prismaImportedGamesRepository,
): ImportedGamesQueryService {
  return {
    async list(appUserId, query) {
      const rows = await repository.findList(
        appUserId,
        query,
        decodeImportedGameCursor(query.cursor),
      );
      const items = rows.slice(0, query.limit).map(toCommon);
      const hasMore = rows.length > query.limit;
      const last = items.length > 0 ? rows[items.length - 1] : null;
      return {
        items,
        pageInfo: {
          nextCursor: hasMore && last ? nextCursorForImportedGame(last) : null,
          hasMore,
        },
      };
    },

    async getDetail(appUserId, gameId) {
      const row = await repository.findDetail(appUserId, gameId);
      return row ? { ...toReplay(row), pgn: row.pgn } : null;
    },

    async getReplay(appUserId, gameId) {
      const row = await repository.findReplay(appUserId, gameId);
      return row ? toReplay(row) : null;
    },
  };
}

export const ImportedGamesQueryService = createImportedGamesQueryService();
