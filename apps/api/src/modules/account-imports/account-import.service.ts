import crypto from 'node:crypto';
import type { LichessConnectionService } from '../lichess/lichess-connection.service';
import { createPrismaAccountImportRepository } from './account-import.repository.prisma';
import type {
  AccountImportRepository,
  CreateImportRunInput,
  ImportWindow,
  LichessImportScope,
  StoredImportRun,
} from './account-import.types';
import {
  LICHESS_IMPORT_SPEEDS,
  buildLichessGamesRequestUrl,
  LichessNdjsonRecordError,
  normalizeLichessGame,
  readLichessNdjson,
} from './providers/lichess/lichess-account-import';

const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const COMMIT_BATCH_SIZE = 50;
const STALE_RUN_MS = 15 * 60 * 1000;

export interface CreateLichessImportRequest {
  from?: Date;
  to?: Date;
  rated?: boolean;
}

export interface AccountImportServiceOptions {
  repository?: AccountImportRepository;
  connectionService: Pick<LichessConnectionService, 'getCredentialForUser' | 'markCredentialRevokedForUser'>;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export function createLichessAccountImportService(options: AccountImportServiceOptions) {
  const repository = options.repository ?? createPrismaAccountImportRepository();
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());

  const requestImport = async (appUserId: number, request: CreateLichessImportRequest = {}) => {
    const credential = await options.connectionService.getCredentialForUser(appUserId);
    const to = request.to ?? now();
    const from = request.from ?? new Date(to.getTime() - 30 * WINDOW_MS);
    if (to <= from) throw new Error('Import end must be after import start.');

    const scope: LichessImportScope = {
      provider: 'LICHESS',
      speeds: ['bullet', 'blitz', 'rapid'],
      ...(request.rated === undefined ? {} : { rated: request.rated }),
    };
    const windows = planImportWindows(from, to);
    const input: CreateImportRunInput = {
      appUserId,
      scope,
      scopeHash: hashScope(scope),
      requestedFrom: from,
      requestedTo: to,
      windowsTotal: windows.length,
      lichessUserId: credential.lichessUserId,
      lichessUsername: credential.username,
    };
    return repository.createRun(input);
  };

  const getRun = (appUserId: number, runId: number) => repository.getRun(appUserId, runId);
  const cancelRun = (appUserId: number, runId: number) => repository.requestCancel(appUserId, runId, now());

  const executeRun = async (run: StoredImportRun): Promise<StoredImportRun | null> => {
    let credential;
    try {
      credential = await options.connectionService.getCredentialForUser(run.appUserId);
      if (credential.credentialGeneration === undefined) throw new Error('Credential generation is missing.');
      if (credential.lichessUserId !== run.lichessUserIdSnapshot) {
        await repository.failRun(run.id, 'CREDENTIAL_CHANGED', 'The connected Lichess identity changed while this import was queued.', now());
        return repository.getRun(run.appUserId, run.id);
      }
    } catch (error) {
      await repository.failRun(run.id, 'AUTH_REQUIRED', error instanceof Error ? error.message : 'Lichess credential unavailable.', now());
      return repository.getRun(run.appUserId, run.id);
    }

    const windows = planImportWindows(run.requestedFrom, run.requestedTo);
    const startWindow = readCheckpoint(run.checkpointJson);

    try {
      for (let index = startWindow; index < windows.length; index += 1) {
        if (await isCancellationRequested(run)) {
          await repository.cancelRun(run.id, now());
          return repository.getRun(run.appUserId, run.id);
        }

        const window = windows[index];
        const url = buildLichessGamesRequestUrl({
          username: credential.username,
          from: window.from,
          to: window.to,
          sort: 'dateAsc',
          rated: readRatedScope(run.scopeJson),
          speeds: LICHESS_IMPORT_SPEEDS,
        });
        const response = await fetchImpl(url, {
          headers: {
            Accept: 'application/x-ndjson',
            Authorization: `Bearer ${credential.accessToken}`,
          },
        });

        if (response.status === 401 || response.status === 403) {
          await options.connectionService.markCredentialRevokedForUser(run.appUserId, credential.credentialGeneration);
          await repository.failRun(run.id, 'AUTH_REVOKED', 'Lichess rejected the connected credential.', now());
          return repository.getRun(run.appUserId, run.id);
        }
        if (response.status === 429) {
          const retryAt = retryAtFromResponse(response, now());
          await repository.deferRun(run.id, retryAt, 'RATE_LIMITED', 'Lichess rate-limited this import window.', now());
          return repository.getRun(run.appUserId, run.id);
        }
        if (!response.ok) {
          await repository.failRun(run.id, 'PROVIDER_HTTP_ERROR', `Lichess returned HTTP ${response.status}.`, now());
          return repository.getRun(run.appUserId, run.id);
        }

        let seen = 0;
        let matched = 0;
        let skipped = 0;
        let importedGames: Awaited<ReturnType<AccountImportRepository['commitGames']>> = { imported: 0, duplicate: 0, updated: 0 };
        let batch: ReturnType<typeof normalizeLichessGame>[] = [];
        for await (const rawGame of readLichessNdjson(response)) {
          seen += 1;
          const normalized = normalizeLichessGame(rawGame, credential);
          if (!isInScope(normalized, window, run.scopeJson)) {
            skipped += 1;
            continue;
          }
          matched += 1;
          batch.push(normalized);
          if (batch.length >= COMMIT_BATCH_SIZE) {
            const committed = await repository.commitGames(run.appUserId, batch);
            importedGames = sumCommitResults(importedGames, committed);
            await repository.updateProgress(run.id, { gamesSeen: seen, gamesMatchedScope: matched, gamesSkippedOutOfScope: skipped, gamesImported: committed.imported, gamesDuplicate: committed.duplicate, gamesUpdated: committed.updated });
            seen = 0;
            matched = 0;
            skipped = 0;
            batch = [];
            await repository.heartbeat(run.id, now());
            if (await isCancellationRequested(run)) {
              await repository.cancelRun(run.id, now());
              return repository.getRun(run.appUserId, run.id);
            }
          }
        }
        if (batch.length) {
          const committed = await repository.commitGames(run.appUserId, batch);
          importedGames = sumCommitResults(importedGames, committed);
          await repository.updateProgress(run.id, { gamesSeen: seen, gamesMatchedScope: matched, gamesSkippedOutOfScope: skipped, gamesImported: committed.imported, gamesDuplicate: committed.duplicate, gamesUpdated: committed.updated });
        } else if (seen || skipped) {
          await repository.updateProgress(run.id, { gamesSeen: seen, gamesMatchedScope: matched, gamesSkippedOutOfScope: skipped });
        }
        await repository.updateProgress(run.id, {
          windowsCompleted: 1,
          checkpointJson: { nextWindow: index + 1, lastWindow: { from: window.from.toISOString(), to: window.to.toISOString() } },
        });
        await repository.heartbeat(run.id, now());
      }

      await repository.completeRun(run.id, run, now());
      return repository.getRun(run.appUserId, run.id);
    } catch (error) {
      if (error instanceof LichessNdjsonRecordError) {
        await repository.failRun(run.id, 'MALFORMED_RECORD', error.message, now());
      } else {
        await repository.failRun(run.id, 'IMPORT_FAILED', error instanceof Error ? error.message : 'Lichess import failed.', now());
      }
      return repository.getRun(run.appUserId, run.id);
    }
  };

  const runOnce = async (): Promise<boolean> => {
    const current = now();
    const run = await repository.claimNextRun(current, new Date(current.getTime() - STALE_RUN_MS));
    if (!run) return false;
    await executeRun(run);
    return true;
  };

  async function isCancellationRequested(run: StoredImportRun): Promise<boolean> {
    const current = await repository.getRun(run.appUserId, run.id);
    return current?.status === 'CANCEL_REQUESTED' || current?.cancelRequestedAt !== null;
  }

  return { requestImport, getRun, cancelRun, executeRun, runOnce };
}

export type LichessAccountImportService = ReturnType<typeof createLichessAccountImportService>;

export function planImportWindows(from: Date, to: Date, windowMs = WINDOW_MS): ImportWindow[] {
  const windows: ImportWindow[] = [];
  let cursor = from;
  while (cursor < to) {
    const next = new Date(Math.min(cursor.getTime() + windowMs, to.getTime()));
    windows.push({ from: cursor, to: next });
    cursor = next;
  }
  return windows;
}

export function hashScope(scope: LichessImportScope): string {
  return crypto.createHash('sha256').update(JSON.stringify({ provider: scope.provider, speeds: [...scope.speeds], rated: scope.rated ?? null })).digest('hex');
}

export function toImportRunResponse(run: StoredImportRun) {
  return {
    id: run.id,
    provider: run.provider,
    status: run.status,
    scope: run.scopeJson,
    requestedFrom: run.requestedFrom.toISOString(),
    requestedTo: run.requestedTo.toISOString(),
    windowsTotal: run.windowsTotal,
    windowsCompleted: run.windowsCompleted,
    gamesSeen: run.gamesSeen,
    gamesMatchedScope: run.gamesMatchedScope,
    gamesImported: run.gamesImported,
    gamesDuplicate: run.gamesDuplicate,
    gamesUpdated: run.gamesUpdated,
    gamesSkippedOutOfScope: run.gamesSkippedOutOfScope,
    errorCode: run.errorCode,
    error: run.error,
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
  };
}

function readCheckpoint(value: unknown): number {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
  const nextWindow = (value as { nextWindow?: unknown }).nextWindow;
  return typeof nextWindow === 'number' && Number.isInteger(nextWindow) && nextWindow >= 0 ? nextWindow : 0;
}

function readRatedScope(value: unknown): boolean | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return typeof (value as { rated?: unknown }).rated === 'boolean' ? (value as { rated: boolean }).rated : undefined;
}

function isInScope(game: ReturnType<typeof normalizeLichessGame>, window: ImportWindow, scopeJson: unknown): boolean {
  const speeds = LICHESS_IMPORT_SPEEDS as readonly string[];
  if (!game.speedCategory || !speeds.includes(game.speedCategory)) return false;
  const rated = readRatedScope(scopeJson);
  if (rated !== undefined && game.rated !== rated) return false;
  if (game.startedAt && (game.startedAt < window.from || game.startedAt >= window.to)) return false;
  return true;
}

function retryAtFromResponse(response: Response, now: Date): Date {
  const retryAfter = response.headers.get('retry-after');
  const seconds = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(seconds) && seconds >= 0) return new Date(now.getTime() + Math.min(seconds, 3600) * 1000);
  const date = retryAfter ? new Date(retryAfter) : null;
  return date && !Number.isNaN(date.getTime()) ? date : new Date(now.getTime() + 60_000);
}

function sumCommitResults(
  left: { imported: number; duplicate: number; updated: number },
  right: { imported: number; duplicate: number; updated: number },
) {
  return { imported: left.imported + right.imported, duplicate: left.duplicate + right.duplicate, updated: left.updated + right.updated };
}
