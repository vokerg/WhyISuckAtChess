import type { Prisma, PrismaClient } from '@prisma/client';
import prisma from '../../prisma';
import type {
  AccountImportRepository,
  CreateImportRunInput,
  ImportCommitResult,
  StoredImportRun,
} from './account-import.types';
import type { NormalizedLichessGame } from './providers/lichess/lichess-account-import';

const ACTIVE_STATUSES = ['QUEUED', 'RUNNING', 'CANCEL_REQUESTED'] as const;

export class ActiveImportRunError extends Error {
  constructor(readonly activeRunId: number) {
    super(`An account import is already active for this user (run ${activeRunId}).`);
    this.name = 'ActiveImportRunError';
  }
}

export class ImportLeaseLostError extends Error {
  constructor(readonly runId: number) {
    super(`The import lease for run ${runId} is no longer owned by this worker.`);
    this.name = 'ImportLeaseLostError';
  }
}

export function createPrismaAccountImportRepository(database: PrismaClient = prisma): AccountImportRepository {
  return {
    createRun: async (input) => database.$transaction(async (transaction) => {
      const active = await transaction.importRun.findFirst({
        where: { appUserId: input.appUserId, status: { in: [...ACTIVE_STATUSES] } },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (active) throw new ActiveImportRunError(active.id);

      const row = await transaction.importRun.create({
        data: {
          appUserId: input.appUserId,
          provider: 'LICHESS',
          scopeHash: input.scopeHash,
          scopeJson: input.scope as unknown as Prisma.InputJsonValue,
          requestedFrom: input.requestedFrom,
          requestedTo: input.requestedTo,
          windowsTotal: input.windowsTotal,
          workKey: `${input.appUserId}:${input.scopeHash}:${input.requestedFrom.toISOString()}:${input.requestedTo.toISOString()}`,
          lichessUserIdSnapshot: input.lichessUserId,
          lichessUsernameSnapshot: input.lichessUsername,
        },
      });
      return toStoredRun(row);
    }),

    getRun: async (appUserId, runId) => {
      const row = await database.importRun.findFirst({ where: { id: runId, appUserId } });
      return row ? toStoredRun(row) : null;
    },

    claimNextRun: async (now, staleAfter) => database.$transaction(async (transaction) => {
      const candidate = await transaction.importRun.findFirst({
        where: {
          OR: [
            { status: 'QUEUED', OR: [{ rateLimitUntil: null }, { rateLimitUntil: { lte: now } }] },
            { status: 'RUNNING', heartbeatAt: { lt: staleAfter } },
            { status: 'CANCEL_REQUESTED', heartbeatAt: { lt: staleAfter } },
          ],
        },
        orderBy: { createdAt: 'asc' },
      });
      if (!candidate) return null;

      const claimed = await transaction.importRun.updateMany({
        where: {
          id: candidate.id,
          status: candidate.status,
          ...(candidate.status === 'RUNNING' ? { heartbeatAt: candidate.heartbeatAt } : {}),
        },
        data: {
          status: 'RUNNING',
          claimedAt: now,
          heartbeatAt: now,
          startedAt: candidate.startedAt ?? now,
          lastProgressAt: now,
        },
      });
      if (claimed.count !== 1) return null;
      const row = await transaction.importRun.findUniqueOrThrow({ where: { id: candidate.id } });
      return toStoredRun(row);
    }),

    heartbeat: async (runId, claimedAt, now) => {
      const updated = await database.importRun.updateMany({ where: { id: runId, status: 'RUNNING', claimedAt }, data: { heartbeatAt: now } });
      if (updated.count !== 1) throw new ImportLeaseLostError(runId);
    },

    deferRun: async (runId, claimedAt, retryAt, code, message, now) => {
      const updated = await database.importRun.updateMany({
        where: { id: runId, status: 'RUNNING', claimedAt },
        data: { status: 'QUEUED', rateLimitUntil: retryAt, errorCode: code, error: message, heartbeatAt: null, lastProgressAt: now },
      });
      if (updated.count !== 1) throw new ImportLeaseLostError(runId);
    },

    updateProgress: async (runId, claimedAt, patch) => {
      const data: Prisma.ImportRunUpdateInput = { lastProgressAt: new Date() };
      if (patch.windowsCompleted !== undefined) data.windowsCompleted = { increment: patch.windowsCompleted };
      if (patch.gamesSeen !== undefined) data.gamesSeen = { increment: patch.gamesSeen };
      if (patch.gamesMatchedScope !== undefined) data.gamesMatchedScope = { increment: patch.gamesMatchedScope };
      if (patch.gamesImported !== undefined) data.gamesImported = { increment: patch.gamesImported };
      if (patch.gamesDuplicate !== undefined) data.gamesDuplicate = { increment: patch.gamesDuplicate };
      if (patch.gamesUpdated !== undefined) data.gamesUpdated = { increment: patch.gamesUpdated };
      if (patch.gamesSkipped !== undefined) data.gamesSkipped = { increment: patch.gamesSkipped };
      if (patch.gamesSkippedOutOfScope !== undefined) data.gamesSkippedOutOfScope = { increment: patch.gamesSkippedOutOfScope };
      if (patch.gamesFailed !== undefined) data.gamesFailed = { increment: patch.gamesFailed };
      if (patch.checkpointJson !== undefined) data.checkpointJson = patch.checkpointJson as Prisma.InputJsonValue;
      const updated = await database.importRun.updateMany({ where: { id: runId, status: 'RUNNING', claimedAt }, data });
      if (updated.count !== 1) throw new ImportLeaseLostError(runId);
    },

    requestCancel: async (appUserId, runId, now) => {
      const row = await database.importRun.findFirst({ where: { id: runId, appUserId } });
      if (!row) return null;
      if (row.status === 'QUEUED') {
        return toStoredRun(await database.importRun.update({
          where: { id: runId },
          data: { status: 'CANCELLED', cancelRequestedAt: now, completedAt: now, lastProgressAt: now },
        }));
      }
      if (row.status === 'RUNNING') {
        return toStoredRun(await database.importRun.update({
          where: { id: runId },
          data: { status: 'CANCEL_REQUESTED', cancelRequestedAt: now, lastProgressAt: now },
        }));
      }
      return toStoredRun(row);
    },

    commitGames: async (runId, appUserId, claimedAt, games) => database.$transaction(async (transaction) => {
      const leased = await transaction.importRun.count({ where: { id: runId, appUserId, status: 'RUNNING', claimedAt } });
      if (leased !== 1) throw new ImportLeaseLostError(runId);

      const result: ImportCommitResult = { imported: 0, duplicate: 0, updated: 0 };
      for (const game of games) {
        const existing = await transaction.importedGame.findUnique({
          where: {
            appUserId_provider_providerGameId: {
              appUserId,
              provider: 'LICHESS',
              providerGameId: game.providerGameId,
            },
          },
          include: { rawClockStates: { orderBy: { sourceOrdinal: 'asc' } } },
        });

        if (!existing) {
          const created = await transaction.importedGame.create({ data: gameData(appUserId, game) });
          await insertClockStates(transaction, created.id, game.rawClockValuesCentiseconds);
          result.imported += 1;
          continue;
        }

        const existingValues = existing.rawClockStates.map((state) => state.valueCentiseconds);
        const clockDecision = decideClockSequence(existing.rawClockPresence, existingValues, game.rawClockPresence, game.rawClockValuesCentiseconds);
        const existingAnomalies = readStringArray(existing.rawClockAnomalies);
        const anomalies = uniqueStrings([
          ...existingAnomalies,
          ...game.rawClockAnomalies,
          ...(clockDecision.conflict ? ['CLOCK_SEQUENCE_CONFLICT'] : []),
        ]);
        const anomaliesChanged = anomalies.length !== existingAnomalies.length;
        const metadataChanged = existing.pgn !== game.pgn
          || existing.status !== game.status
          || existing.startedAt?.getTime() !== game.startedAt?.getTime()
          || existing.endedAt?.getTime() !== game.endedAt?.getTime()
          || existing.timeControlInitial !== game.timeControlInitial
          || existing.timeControlIncrement !== game.timeControlIncrement;
        const indexingSourceChanged = metadataChanged
          || clockDecision.update
          || anomaliesChanged
          || existing.variant !== game.variant
          || existing.speedCategory !== game.speedCategory
          || existing.userColor !== game.userColor
          || existing.source !== game.source;

        const updateData: Prisma.ImportedGameUpdateInput = {
          providerUrl: game.providerUrl,
          source: game.source,
          connectedLichessUserId: game.connectedLichessUserId,
          connectedLichessUsername: game.connectedLichessUsername,
          pgn: game.pgn,
          rated: game.rated,
          variant: game.variant,
          speedCategory: game.speedCategory,
          performanceCategory: game.performanceCategory,
          timeControlRaw: game.timeControlRaw,
          timeControlInitial: game.timeControlInitial,
          timeControlIncrement: game.timeControlIncrement,
          timeControlSource: game.timeControlSource,
          exactTimeControlKey: game.exactTimeControlKey,
          startedAt: game.startedAt,
          endedAt: game.endedAt,
          whiteUsername: game.whiteUsername,
          blackUsername: game.blackUsername,
          whiteRating: game.whiteRating,
          blackRating: game.blackRating,
          userColor: game.userColor,
          opponentUsername: game.opponentUsername,
          result: game.result,
          resultForUser: game.resultForUser,
          status: game.status,
          openingName: game.openingName,
          openingEco: game.openingEco,
          rawClockAnomalies: anomalies as Prisma.InputJsonValue,
        };

        if (indexingSourceChanged) {
          Object.assign(updateData, {
            plyIndexStatus: 'PENDING',
            plyIndexPolicyVersion: null,
            plyIndexedAt: null,
            plyIndexError: null,
            indexedRawClockStateCount: 0,
            clockAlignmentStatus: 'UNAVAILABLE',
            clockAlignmentVersion: null,
            alignedClockPlyCount: 0,
            timingDerivationVersion: null,
            derivedTimingPlyCount: 0,
            timingCoverageStatus: 'UNAVAILABLE',
          } satisfies Prisma.ImportedGameUpdateInput);
          await transaction.importedGamePly.deleteMany({ where: { importedGameId: existing.id } });
          await transaction.terminalClockSourceFact.deleteMany({ where: { importedGameId: existing.id } });
        }

        if (clockDecision.update) {
          updateData.rawClockPresence = game.rawClockPresence;
          updateData.rawClockStateCount = game.rawClockValuesCentiseconds.length;
          await transaction.importedGame.update({ where: { id: existing.id }, data: updateData });
          await transaction.lichessClockState.deleteMany({ where: { importedGameId: existing.id } });
          await insertClockStates(transaction, existing.id, game.rawClockValuesCentiseconds);
        } else {
          await transaction.importedGame.update({ where: { id: existing.id }, data: updateData });
        }

        if (metadataChanged || clockDecision.update || anomaliesChanged) result.updated += 1;
        else result.duplicate += 1;
      }
      return result;
    }),

    completeRun: async (runId, claimedAt, run, now) => database.$transaction(async (transaction) => {
      const updated = await transaction.importRun.updateMany({
        where: { id: runId, status: 'RUNNING', claimedAt },
        data: { status: 'COMPLETED', completedAt: now, heartbeatAt: null, lastProgressAt: now, windowsCompleted: run.windowsTotal },
      });
      if (updated.count !== 1) throw new ImportLeaseLostError(runId);
      await transaction.accountImportCoverage.upsert({
        where: { appUserId_scopeHash: { appUserId: run.appUserId, scopeHash: run.scopeHash } },
        update: { coveredFrom: run.requestedFrom, coveredThrough: run.requestedTo, lastCompletedImportRunId: run.id, scopeJson: run.scopeJson as Prisma.InputJsonValue },
        create: { appUserId: run.appUserId, scopeVersion: run.scopeVersion, scopeHash: run.scopeHash, scopeJson: run.scopeJson as Prisma.InputJsonValue, coveredFrom: run.requestedFrom, coveredThrough: run.requestedTo, lastCompletedImportRunId: run.id },
      });
    }),

    cancelRun: async (runId, claimedAt, now) => {
      const updated = await database.importRun.updateMany({ where: { id: runId, status: 'RUNNING', claimedAt }, data: { status: 'CANCELLED', completedAt: now, heartbeatAt: null, lastProgressAt: now } });
      if (updated.count !== 1) throw new ImportLeaseLostError(runId);
    },

    failRun: async (runId, claimedAt, code, message, now) => {
      const updated = await database.importRun.updateMany({ where: { id: runId, status: 'RUNNING', claimedAt }, data: { status: 'FAILED', errorCode: code, error: message, completedAt: now, heartbeatAt: null, lastProgressAt: now } });
      if (updated.count !== 1) throw new ImportLeaseLostError(runId);
    },
  };
}

function gameData(appUserId: number, game: NormalizedLichessGame): Prisma.ImportedGameCreateInput {
  return {
    appUser: { connect: { id: appUserId } },
    provider: 'LICHESS',
    providerGameId: game.providerGameId,
    providerUrl: game.providerUrl,
    source: game.source,
    connectedLichessUserId: game.connectedLichessUserId,
    connectedLichessUsername: game.connectedLichessUsername,
    pgn: game.pgn,
    rated: game.rated,
    variant: game.variant,
    speedCategory: game.speedCategory,
    performanceCategory: game.performanceCategory,
    timeControlRaw: game.timeControlRaw,
    timeControlInitial: game.timeControlInitial,
    timeControlIncrement: game.timeControlIncrement,
    timeControlSource: game.timeControlSource,
    exactTimeControlKey: game.exactTimeControlKey,
    startedAt: game.startedAt,
    endedAt: game.endedAt,
    whiteUsername: game.whiteUsername,
    blackUsername: game.blackUsername,
    whiteRating: game.whiteRating,
    blackRating: game.blackRating,
    userColor: game.userColor,
    opponentUsername: game.opponentUsername,
    result: game.result,
    resultForUser: game.resultForUser,
    status: game.status,
    openingName: game.openingName,
    openingEco: game.openingEco,
    rawClockPresence: game.rawClockPresence,
    rawClockStateCount: game.rawClockValuesCentiseconds.length,
    rawClockUnit: 'CENTISECONDS',
    rawClockAnomalies: game.rawClockAnomalies as Prisma.InputJsonValue,
  };
}

async function insertClockStates(transaction: Prisma.TransactionClient, importedGameId: number, values: number[]): Promise<void> {
  if (!values.length) return;
  await transaction.lichessClockState.createMany({
    data: values.map((value, index) => ({ importedGameId, sourceOrdinal: index + 1, valueCentiseconds: value })),
  });
}

export function decideClockSequence(
  existingPresence: string,
  existingValues: number[],
  incomingPresence: string,
  incomingValues: number[],
): { update: boolean; conflict: boolean } {
  if (incomingPresence === 'ABSENT') return { update: false, conflict: false };
  if (existingPresence !== 'PRESENT') return { update: true, conflict: false };
  if (incomingPresence !== 'PRESENT') return { update: false, conflict: false };
  if (incomingValues.length < existingValues.length) return { update: false, conflict: false };
  const isPrefix = existingValues.every((value, index) => incomingValues[index] === value);
  if (!isPrefix) return { update: false, conflict: true };
  return { update: incomingValues.length > existingValues.length, conflict: false };
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function toStoredRun(row: unknown): StoredImportRun {
  return row as unknown as StoredImportRun;
}
