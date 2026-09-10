import {
  fenTurnColor,
  reconstructPgnPlies,
  type ChessColor,
} from '@why-i-suck-at-chess/chess-domain';
import {
  PlyIndexSourceChangedError,
  countPlyRowsForGame,
  getImportedGameForPlyIndex,
  markPlyIndexFailure,
  markPlyIndexSkipped,
  replacePlyProjection,
} from './ply-index.repository.prisma';
import { positionKeyForNormalizedFen } from '../positions/position-key';
import {
  CLOCK_ALIGNMENT_VERSION,
  TIMING_DERIVATION_VERSION,
  alignLichessClockStates,
  derivePlyTiming,
  isStandardImportedGameSpeed,
  isStandardImportedGameVariant,
} from '../timing/timing-policy';

export const PLY_INDEX_POLICY_VERSION = 1;
const MAX_SOURCE_SNAPSHOT_RETRIES = 2;

export type PlyIndexStatus = 'INDEXED' | 'ALREADY_INDEXED' | 'SKIPPED' | 'FAILED';

export interface ImportedGamePlyIndexResult {
  importedGameId: number;
  status: PlyIndexStatus;
  pliesIndexed?: number;
  plyIndexedAt?: Date | null;
  error?: string;
  skipReason?: string;
}

function normalizeUserColor(value: string | null): ChessColor {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'white') return 'WHITE';
  if (normalized === 'black') return 'BLACK';
  throw new Error('Imported game has no trustworthy user color for ply-side semantics');
}

function containsAnomaly(value: unknown, needle: string): boolean {
  if (value === null || value === undefined) return false;
  try {
    return JSON.stringify(value).toUpperCase().includes(needle);
  } catch {
    return false;
  }
}

function skipReasonForGame(game: { variant: string | null; speedCategory: string | null }): string | null {
  if (!isStandardImportedGameVariant(game.variant)) return 'UNSUPPORTED_VARIANT';
  if (!isStandardImportedGameSpeed(game.speedCategory)) return 'UNSUPPORTED_SPEED_CATEGORY';
  return null;
}

function canRetrySourceSnapshot(error: unknown, retriesRemaining: number): error is PlyIndexSourceChangedError {
  return error instanceof PlyIndexSourceChangedError && retriesRemaining > 0;
}

async function indexOneAttempt(
  appUserId: number,
  importedGameId: number,
  options: { force?: boolean },
  retriesRemaining: number,
): Promise<ImportedGamePlyIndexResult> {
  const game = await getImportedGameForPlyIndex(appUserId, importedGameId);
  if (!game) throw new Error('Imported game not found');

  const retry = () => indexOneAttempt(appUserId, importedGameId, options, retriesRemaining - 1);
  const skipReason = skipReasonForGame(game);
  if (skipReason) {
    try {
      await markPlyIndexSkipped(
        importedGameId,
        skipReason,
        PLY_INDEX_POLICY_VERSION,
        game.updatedAt,
      );
      return { importedGameId, status: 'SKIPPED', skipReason };
    } catch (error) {
      if (canRetrySourceSnapshot(error, retriesRemaining)) return retry();
      throw error;
    }
  }

  const durableClockCount = game.rawClockStates.length;
  if (
    game.plyIndexStatus === 'INDEXED'
    && game.plyIndexPolicyVersion === PLY_INDEX_POLICY_VERSION
    && game.clockAlignmentVersion === CLOCK_ALIGNMENT_VERSION
    && game.timingDerivationVersion === TIMING_DERIVATION_VERSION
    && game.indexedRawClockStateCount === durableClockCount
    && !options.force
  ) {
    return {
      importedGameId,
      status: 'ALREADY_INDEXED',
      pliesIndexed: await countPlyRowsForGame(importedGameId),
      plyIndexedAt: game.plyIndexedAt,
    };
  }

  if (!game.pgn) {
    const message = 'Imported game has no PGN to index';
    try {
      await markPlyIndexFailure(importedGameId, message, game.updatedAt);
      return { importedGameId, status: 'FAILED', error: message };
    } catch (error) {
      if (canRetrySourceSnapshot(error, retriesRemaining)) return retry();
      throw error;
    }
  }

  try {
    if (game.rawClockStateCount !== durableClockCount) {
      throw new Error('Raw clock metadata does not match the durable source-clock sequence');
    }

    const userColor = normalizeUserColor(game.userColor);
    const reconstructed = reconstructPgnPlies(game.pgn);
    const terminalActiveColor = reconstructed.length > 0
      ? fenTurnColor(reconstructed[reconstructed.length - 1].afterFen)
      : null;

    const alignment = alignLichessClockStates({
      moveCount: reconstructed.length,
      rawClockPresence: game.rawClockPresence,
      rawClockStates: game.rawClockStates,
      provider: game.provider,
      status: game.status,
      terminalActiveColor,
    });

    const playerClockModifierUnresolved = containsAnomaly(
      game.rawClockAnomalies,
      'PLAYER_CLOCK_MODIFIER_UNRESOLVED',
    ) || game.source.toLowerCase().includes('arena');
    const allowsExternalClockAdjustments = containsAnomaly(
      game.rawClockAnomalies,
      'POSSIBLE_EXTERNAL_CLOCK_ADJUSTMENT',
    );

    const timing = derivePlyTiming({
      moveCount: reconstructed.length,
      variant: game.variant,
      speedCategory: game.speedCategory,
      provider: game.provider,
      source: game.source,
      status: game.status,
      incrementSeconds: game.timeControlIncrement,
      playerClockModifierUnresolved,
      allowsExternalClockAdjustments,
    }, alignment);

    const alignedByPly = new Map(alignment.aligned.map((fact) => [fact.plyNumber, fact]));
    const timingByPly = new Map(timing.rows.map((row) => [row.plyNumber, row]));

    const rows = reconstructed.map((ply) => {
      const aligned = alignedByPly.get(ply.plyNumber);
      const derived = timingByPly.get(ply.plyNumber);
      if (!derived) throw new Error(`Missing timing projection for ply ${ply.plyNumber}`);

      return {
        importedGameId,
        plyNumber: ply.plyNumber,
        beforeNormalizedFen: ply.beforeNormalizedFen,
        beforePositionKey: positionKeyForNormalizedFen(ply.beforeNormalizedFen),
        afterNormalizedFen: ply.afterNormalizedFen,
        afterPositionKey: positionKeyForNormalizedFen(ply.afterNormalizedFen),
        moveUci: ply.moveUci,
        moverColor: ply.moverColor,
        isUserMove: ply.moverColor === userColor,
        sourceClockOrdinal: aligned?.sourceOrdinal ?? null,
        sourceClockAfterCentiseconds: aligned?.valueCentiseconds ?? null,
        sourceClockSemantics: aligned?.semantics ?? null,
        clockAlignmentVersion: aligned?.alignmentVersion ?? null,
        clockBeforeMoveCentiseconds: derived.clockBeforeMoveCentiseconds,
        effectiveIncrementCentiseconds: derived.effectiveIncrementCentiseconds,
        clockDeltaMoveTimeCentiseconds: derived.clockDeltaMoveTimeCentiseconds,
        beforeClockProvenance: derived.beforeClockProvenance,
        incrementProvenance: derived.incrementProvenance,
        timingDerivationVersion: derived.derivationVersion,
        timingDerivationStatus: derived.derivationStatus,
        timingReliabilityFlags: derived.reliabilityFlags,
        timingUnavailableReason: derived.unavailableReason,
      };
    });

    const result = await replacePlyProjection({
      importedGameId,
      expectedSourceUpdatedAt: game.updatedAt,
      rows,
      terminal: alignment.terminal ?? null,
      plyIndexPolicyVersion: PLY_INDEX_POLICY_VERSION,
      indexedRawClockStateCount: durableClockCount,
      clockAlignmentStatus: alignment.status,
      clockAlignmentVersion: CLOCK_ALIGNMENT_VERSION,
      alignedClockPlyCount: alignment.aligned.length,
      timingDerivationVersion: TIMING_DERIVATION_VERSION,
      derivedTimingPlyCount: timing.availableCount,
      timingCoverageStatus: timing.coverageStatus,
    });

    return {
      importedGameId,
      status: 'INDEXED',
      pliesIndexed: result.pliesIndexed,
      plyIndexedAt: result.plyIndexedAt,
    };
  } catch (error) {
    if (canRetrySourceSnapshot(error, retriesRemaining)) return retry();

    const message = error instanceof Error ? error.message : String(error);
    try {
      await markPlyIndexFailure(importedGameId, message, game.updatedAt);
      return { importedGameId, status: 'FAILED', error: message };
    } catch (failureError) {
      if (canRetrySourceSnapshot(failureError, retriesRemaining)) return retry();
      throw failureError;
    }
  }
}

export const ImportedGamePlyIndexService = {
  indexOne: async (
    appUserId: number,
    importedGameId: number,
    options: { force?: boolean } = {},
  ): Promise<ImportedGamePlyIndexResult> => indexOneAttempt(
    appUserId,
    importedGameId,
    options,
    MAX_SOURCE_SNAPSHOT_RETRIES,
  ),
};
