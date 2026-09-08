export const SUPPORTED_IMPORT_SPEEDS = ['BULLET', 'BLITZ', 'RAPID'] as const;

export type AccountImportSpeed = (typeof SUPPORTED_IMPORT_SPEEDS)[number];
export type AccountImportRatedFilter = 'ANY' | 'RATED' | 'UNRATED';
export type AccountImportRunStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type AccountImportWindowStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'RETRY_WAIT'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';
export type RawClockSequencePresence = 'PRESENT' | 'ABSENT' | 'INVALID';
export type TimeControlSource = 'LICHESS_CLOCK_OBJECT' | 'PGN_TIME_CONTROL' | 'UNKNOWN';

export interface AccountImportScope {
  speeds: AccountImportSpeed[];
  rated: AccountImportRatedFilter;
}

export interface LichessImportWindow {
  from: Date;
  to: Date;
}

export interface RawLichessClockState {
  sourceOrdinal: number;
  valueCentiseconds: number;
}

export interface RawLichessClockEvidence {
  presence: RawClockSequencePresence;
  explicitlyEmpty: boolean;
  sourceItemCount: number | null;
  states: RawLichessClockState[];
  anomalies: string[];
}

export interface NormalizedImportedGame {
  providerGameId: string;
  providerUrl: string | null;
  connectedLichessUserId: string;
  connectedLichessUsername: string;
  providerSource: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  rated: boolean;
  variant: string;
  speedCategory: string;
  perfCategory: string | null;
  pgnTimeControlRaw: string | null;
  initialTimeSeconds: number | null;
  incrementSeconds: number | null;
  timeControlSource: TimeControlSource;
  exactControlKey: string | null;
  whiteLichessUserId: string | null;
  blackLichessUserId: string | null;
  whiteUsername: string | null;
  blackUsername: string | null;
  whiteRating: number | null;
  blackRating: number | null;
  userColor: 'WHITE' | 'BLACK' | null;
  result: string;
  status: string;
  openingName: string | null;
  openingEco: string | null;
  pgn: string | null;
  moves: string | null;
  clocks: RawLichessClockEvidence;
}

export interface AccountImportWindowCounters {
  gamesSeen: number;
  gamesAccepted: number;
  gamesCommitted: number;
  gamesWithPresentClocks: number;
  gamesClockIncomplete: number;
}

export interface StoredAccountImportRun {
  id: string;
  appUserId: number;
  lichessUserId: string;
  lichessUsername: string;
  credentialGeneration: string;
  requestedFrom: Date;
  requestedTo: Date;
  speeds: string[];
  ratedFilter: string;
  scopeHash: string;
  status: string;
  totalWindows: number;
  nextWindowOrdinal: number;
  completedWindows: number;
  gamesSeen: number;
  gamesAccepted: number;
  gamesCommitted: number;
  gamesWithPresentClocks: number;
  gamesClockIncomplete: number;
  coveredFrom: Date | null;
  coveredThrough: Date | null;
  reconnectRequired: boolean;
  cancelRequestedAt: Date | null;
  providerCooldownUntil: Date | null;
  failureCode: string | null;
  failureMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AccountImportWindowClaim {
  id: string;
  runId: string;
  ordinal: number;
  windowFrom: Date;
  windowTo: Date;
  attempts: number;
  claimToken: string;
  run: StoredAccountImportRun;
}

export interface AccountImportCommitResult {
  gamesCommitted: number;
  gamesWithPresentClocks: number;
  gamesClockIncomplete: number;
}

export interface AccountImportFailure {
  code: string;
  message: string;
}

export class AccountImportClaimLostError extends Error {
  constructor() {
    super('The account-import claim fence is no longer current.');
    this.name = 'AccountImportClaimLostError';
  }
}

export class AccountImportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountImportValidationError';
  }
}

export class AccountImportNotFoundError extends Error {
  constructor() {
    super('Account import was not found.');
    this.name = 'AccountImportNotFoundError';
  }
}
