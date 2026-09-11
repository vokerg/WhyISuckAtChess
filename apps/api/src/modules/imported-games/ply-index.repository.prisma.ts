import prisma from '../../prisma';
import {
  assertPositionKeyMatchesFen,
  positionKeyHex,
} from '../positions/position-key';

export class PlyIndexSourceChangedError extends Error {
  constructor(readonly importedGameId: number) {
    super(`Imported game ${importedGameId} changed while ply indexing was in flight`);
    this.name = 'PlyIndexSourceChangedError';
  }
}

export interface PlyProjectionInput {
  importedGameId: number;
  plyNumber: number;
  beforeNormalizedFen: string;
  beforePositionKey: Buffer;
  afterNormalizedFen: string;
  afterPositionKey: Buffer;
  moveUci: string;
  moverColor: 'WHITE' | 'BLACK';
  isUserMove: boolean;
  sourceClockOrdinal: number | null;
  sourceClockAfterCentiseconds: number | null;
  sourceClockSemantics: string | null;
  clockAlignmentVersion: number | null;
  clockBeforeMoveCentiseconds: number | null;
  effectiveIncrementCentiseconds: number | null;
  clockDeltaMoveTimeCentiseconds: number | null;
  beforeClockProvenance: string;
  incrementProvenance: string;
  timingDerivationVersion: number;
  timingDerivationStatus: string;
  timingReliabilityFlags: string[];
  timingUnavailableReason: string | null;
}

export interface TerminalClockProjectionInput {
  sourceOrdinal: number;
  activeColor: 'WHITE' | 'BLACK';
  valueCentiseconds: number;
  semantics: string;
  alignmentVersion: number;
}

export async function findNextPendingImportedGameForPlyIndex() {
  return prisma.importedGame.findFirst({
    where: {
      provider: 'LICHESS',
      plyIndexStatus: 'PENDING',
    },
    orderBy: [
      { updatedAt: 'asc' },
      { id: 'asc' },
    ],
    select: {
      id: true,
      appUserId: true,
    },
  });
}

export async function getImportedGameForPlyIndex(appUserId: number, importedGameId: number) {
  return prisma.importedGame.findFirst({
    where: { id: importedGameId, appUserId },
    select: {
      id: true,
      pgn: true,
      provider: true,
      source: true,
      variant: true,
      speedCategory: true,
      status: true,
      userColor: true,
      timeControlIncrement: true,
      rawClockPresence: true,
      rawClockStateCount: true,
      rawClockAnomalies: true,
      plyIndexStatus: true,
      plyIndexPolicyVersion: true,
      indexedRawClockStateCount: true,
      clockAlignmentVersion: true,
      timingDerivationVersion: true,
      plyIndexedAt: true,
      updatedAt: true,
      rawClockStates: {
        orderBy: { sourceOrdinal: 'asc' },
        select: { sourceOrdinal: true, valueCentiseconds: true },
      },
    },
  });
}

function assertUniquePositionInputs(rows: PlyProjectionInput[]) {
  const positionsByKey = new Map<string, string>();
  for (const row of rows) {
    for (const position of [
      { key: row.beforePositionKey, fen: row.beforeNormalizedFen },
      { key: row.afterPositionKey, fen: row.afterNormalizedFen },
    ]) {
      const keyHex = positionKeyHex(position.key);
      const existing = positionsByKey.get(keyHex);
      if (existing && existing !== position.fen) {
        throw new Error(`Position key collision before DB write for key ${keyHex}: ${existing} vs ${position.fen}`);
      }
      positionsByKey.set(keyHex, position.fen);
    }
  }
  return positionsByKey;
}

function assertFenceAcquired(importedGameId: number, count: number): void {
  if (count !== 1) throw new PlyIndexSourceChangedError(importedGameId);
}

export async function replacePlyProjection(input: {
  importedGameId: number;
  expectedSourceUpdatedAt: Date;
  rows: PlyProjectionInput[];
  terminal: TerminalClockProjectionInput | null;
  plyIndexPolicyVersion: number;
  indexedRawClockStateCount: number;
  clockAlignmentStatus: string;
  clockAlignmentVersion: number;
  alignedClockPlyCount: number;
  timingDerivationVersion: number;
  derivedTimingPlyCount: number;
  timingCoverageStatus: string;
}) {
  const expectedFenByKey = assertUniquePositionInputs(input.rows);

  return prisma.$transaction(async (tx) => {
    const indexedAt = new Date();
    const fenced = await tx.importedGame.updateMany({
      where: { id: input.importedGameId, updatedAt: input.expectedSourceUpdatedAt },
      data: {
        plyIndexStatus: 'INDEXED',
        plyIndexPolicyVersion: input.plyIndexPolicyVersion,
        plyIndexedAt: indexedAt,
        plyIndexError: null,
        indexedRawClockStateCount: input.indexedRawClockStateCount,
        clockAlignmentStatus: input.clockAlignmentStatus,
        clockAlignmentVersion: input.clockAlignmentVersion,
        alignedClockPlyCount: input.alignedClockPlyCount,
        timingDerivationVersion: input.timingDerivationVersion,
        derivedTimingPlyCount: input.derivedTimingPlyCount,
        timingCoverageStatus: input.timingCoverageStatus,
      },
    });
    assertFenceAcquired(input.importedGameId, fenced.count);

    await tx.importedGamePly.deleteMany({ where: { importedGameId: input.importedGameId } });
    await tx.terminalClockSourceFact.deleteMany({ where: { importedGameId: input.importedGameId } });

    const uniquePositions = Array.from(expectedFenByKey.entries()).map(([keyHex, normalizedFen]) => ({
      keyHex,
      normalizedFen,
      positionKey: Buffer.from(keyHex, 'hex'),
    }));

    if (uniquePositions.length > 0) {
      await tx.position.createMany({
        data: uniquePositions.map((position) => ({
          normalizedFen: position.normalizedFen,
          positionKey: new Uint8Array(position.positionKey),
        })),
        skipDuplicates: true,
      });
    }

    const storedPositions = uniquePositions.length === 0
      ? []
      : await tx.position.findMany({
        where: {
          positionKey: {
            in: uniquePositions.map((position) => new Uint8Array(position.positionKey)),
          },
        },
        select: { id: true, positionKey: true, normalizedFen: true },
      });

    const positionIdsByKey = new Map<string, number>();
    for (const position of storedPositions) {
      const keyHex = positionKeyHex(position.positionKey);
      const expectedNormalizedFen = expectedFenByKey.get(keyHex);
      if (!expectedNormalizedFen) throw new Error(`Resolved unexpected position key ${keyHex}`);
      assertPositionKeyMatchesFen({
        expectedNormalizedFen,
        actualNormalizedFen: position.normalizedFen,
        positionKey: position.positionKey,
      });
      positionIdsByKey.set(keyHex, position.id);
    }

    if (positionIdsByKey.size !== expectedFenByKey.size) {
      throw new Error('Could not resolve every normalized position identity after persistence');
    }

    if (input.rows.length > 0) {
      await tx.importedGamePly.createMany({
        data: input.rows.map((row) => {
          const beforePositionId = positionIdsByKey.get(positionKeyHex(row.beforePositionKey));
          const afterPositionId = positionIdsByKey.get(positionKeyHex(row.afterPositionKey));
          if (!beforePositionId || !afterPositionId) {
            throw new Error(`Could not resolve before/after positions for ply ${row.plyNumber}`);
          }
          return {
            importedGameId: row.importedGameId,
            plyNumber: row.plyNumber,
            beforePositionId,
            afterPositionId,
            moveUci: row.moveUci,
            moverColor: row.moverColor,
            isUserMove: row.isUserMove,
            sourceClockOrdinal: row.sourceClockOrdinal,
            sourceClockAfterCentiseconds: row.sourceClockAfterCentiseconds,
            sourceClockSemantics: row.sourceClockSemantics,
            clockAlignmentVersion: row.clockAlignmentVersion,
            clockBeforeMoveCentiseconds: row.clockBeforeMoveCentiseconds,
            effectiveIncrementCentiseconds: row.effectiveIncrementCentiseconds,
            clockDeltaMoveTimeCentiseconds: row.clockDeltaMoveTimeCentiseconds,
            beforeClockProvenance: row.beforeClockProvenance,
            incrementProvenance: row.incrementProvenance,
            timingDerivationVersion: row.timingDerivationVersion,
            timingDerivationStatus: row.timingDerivationStatus,
            timingReliabilityFlags: row.timingReliabilityFlags,
            timingUnavailableReason: row.timingUnavailableReason,
          };
        }),
      });
    }

    if (input.terminal) {
      await tx.terminalClockSourceFact.create({
        data: {
          importedGameId: input.importedGameId,
          sourceOrdinal: input.terminal.sourceOrdinal,
          activeColor: input.terminal.activeColor,
          valueCentiseconds: input.terminal.valueCentiseconds,
          semantics: input.terminal.semantics,
          alignmentVersion: input.terminal.alignmentVersion,
        },
      });
    }

    const game = await tx.importedGame.findUniqueOrThrow({
      where: { id: input.importedGameId },
      select: { id: true, plyIndexedAt: true },
    });

    return { importedGameId: game.id, plyIndexedAt: game.plyIndexedAt, pliesIndexed: input.rows.length };
  });
}

export async function markPlyIndexFailure(
  importedGameId: number,
  message: string,
  expectedSourceUpdatedAt: Date,
) {
  return prisma.$transaction(async (tx) => {
    const fenced = await tx.importedGame.updateMany({
      where: { id: importedGameId, updatedAt: expectedSourceUpdatedAt },
      data: {
        plyIndexStatus: 'FAILED',
        plyIndexPolicyVersion: null,
        plyIndexedAt: null,
        plyIndexError: message,
        indexedRawClockStateCount: 0,
        clockAlignmentStatus: 'UNAVAILABLE',
        clockAlignmentVersion: null,
        alignedClockPlyCount: 0,
        timingDerivationVersion: null,
        derivedTimingPlyCount: 0,
        timingCoverageStatus: 'UNAVAILABLE',
      },
    });
    assertFenceAcquired(importedGameId, fenced.count);
    await tx.importedGamePly.deleteMany({ where: { importedGameId } });
    await tx.terminalClockSourceFact.deleteMany({ where: { importedGameId } });
    return tx.importedGame.findUniqueOrThrow({
      where: { id: importedGameId },
      select: { id: true, plyIndexError: true },
    });
  });
}

export async function markPlyIndexSkipped(
  importedGameId: number,
  reason: string,
  policyVersion: number,
  expectedSourceUpdatedAt: Date,
) {
  return prisma.$transaction(async (tx) => {
    const fenced = await tx.importedGame.updateMany({
      where: { id: importedGameId, updatedAt: expectedSourceUpdatedAt },
      data: {
        plyIndexStatus: 'SKIPPED',
        plyIndexPolicyVersion: policyVersion,
        plyIndexedAt: null,
        plyIndexError: reason,
        indexedRawClockStateCount: 0,
        clockAlignmentStatus: 'UNAVAILABLE',
        clockAlignmentVersion: null,
        alignedClockPlyCount: 0,
        timingDerivationVersion: null,
        derivedTimingPlyCount: 0,
        timingCoverageStatus: 'UNAVAILABLE',
      },
    });
    assertFenceAcquired(importedGameId, fenced.count);
    await tx.importedGamePly.deleteMany({ where: { importedGameId } });
    await tx.terminalClockSourceFact.deleteMany({ where: { importedGameId } });
    return tx.importedGame.findUniqueOrThrow({
      where: { id: importedGameId },
      select: { id: true },
    });
  });
}

export async function countPlyRowsForGame(importedGameId: number) {
  return prisma.importedGamePly.count({ where: { importedGameId } });
}
