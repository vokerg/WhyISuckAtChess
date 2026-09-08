export const IMPORT_PROVIDER = 'LICHESS';
export const IMPORT_SOURCE = 'LICHESS_API';
export const IMPORT_SCOPE_VERSION = 1;

export const IMPORT_RUN_STATUSES = [
  'QUEUED',
  'RUNNING',
  'CANCEL_REQUESTED',
  'CANCELLED',
  'COMPLETED',
  'FAILED',
] as const;

export type ImportRunStatus = typeof IMPORT_RUN_STATUSES[number];

export interface LichessImportScope {
  provider: 'LICHESS';
  speeds: readonly ['bullet', 'blitz', 'rapid'];
  rated?: boolean;
}

export interface ImportWindow {
  from: Date;
  to: Date;
}

export interface CreateImportRunInput {
  appUserId: number;
  scope: LichessImportScope;
  scopeHash: string;
  requestedFrom: Date;
  requestedTo: Date;
  windowsTotal: number;
  lichessUserId: string;
  lichessUsername: string;
}

export interface StoredImportRun {
  id: number;
  appUserId: number;
  provider: string;
  mode: string;
  source: string;
  status: ImportRunStatus;
  scopeVersion: number;
  scopeHash: string;
  scopeJson: unknown;
  requestedFrom: Date;
  requestedTo: Date;
  lichessUserIdSnapshot: string;
  lichessUsernameSnapshot: string;
  checkpointJson: unknown;
  windowsTotal: number;
  windowsCompleted: number;
  gamesSeen: number;
  gamesMatchedScope: number;
  gamesImported: number;
  gamesDuplicate: number;
  gamesUpdated: number;
  gamesSkipped: number;
  gamesSkippedOutOfScope: number;
  gamesFailed: number;
  lastProgressAt: Date | null;
  workKey: string;
  claimedAt: Date | null;
  heartbeatAt: Date | null;
  cancelRequestedAt: Date | null;
  rateLimitUntil: Date | null;
  errorCode: string | null;
  error: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AccountImportCredential {
  lichessUserId: string;
  username: string;
  accessToken: string;
  credentialGeneration: string;
}

export interface ImportCommitResult {
  imported: number;
  duplicate: number;
  updated: number;
}

export interface AccountImportRepository {
  createRun(input: CreateImportRunInput): Promise<StoredImportRun>;
  getRun(appUserId: number, runId: number): Promise<StoredImportRun | null>;
  claimNextRun(now: Date, staleAfter: Date): Promise<StoredImportRun | null>;
  heartbeat(runId: number, claimedAt: Date, now: Date): Promise<void>;
  deferRun(runId: number, claimedAt: Date, retryAt: Date, code: string, message: string, now: Date): Promise<void>;
  updateProgress(runId: number, claimedAt: Date, patch: {
    windowsCompleted?: number;
    gamesSeen?: number;
    gamesMatchedScope?: number;
    gamesImported?: number;
    gamesDuplicate?: number;
    gamesUpdated?: number;
    gamesSkipped?: number;
    gamesSkippedOutOfScope?: number;
    gamesFailed?: number;
    checkpointJson?: unknown;
  }): Promise<void>;
  requestCancel(appUserId: number, runId: number, now: Date): Promise<StoredImportRun | null>;
  commitGames(runId: number, appUserId: number, claimedAt: Date, games: import('./providers/lichess/lichess-account-import').NormalizedLichessGame[]): Promise<ImportCommitResult>;
  completeRun(runId: number, claimedAt: Date, run: StoredImportRun, now: Date): Promise<void>;
  cancelRun(runId: number, claimedAt: Date, now: Date): Promise<void>;
  failRun(runId: number, claimedAt: Date, code: string, message: string, now: Date): Promise<void>;
}
