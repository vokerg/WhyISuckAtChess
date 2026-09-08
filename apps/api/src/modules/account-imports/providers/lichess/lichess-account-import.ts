
export const LICHESS_GAMES_URL = 'https://lichess.org/api/games/user';
export const LICHESS_IMPORT_SPEEDS = ['bullet', 'blitz', 'rapid'] as const;

export type LichessClockPresence = 'PRESENT' | 'ABSENT' | 'INVALID';
export type LichessTimeControlSource = 'LICHESS_CLOCK_OBJECT' | 'PGN_TIME_CONTROL' | 'UNKNOWN';

export interface LichessGamesRequestOptions {
  username: string;
  from: Date;
  to: Date;
  sort?: 'dateAsc' | 'dateDesc';
  rated?: boolean;
  speeds?: readonly string[];
}

export interface LichessClockObject {
  initial?: unknown;
  increment?: unknown;
  totalTime?: unknown;
}

export interface LichessGame {
  id?: unknown;
  rated?: unknown;
  variant?: unknown;
  speed?: unknown;
  perf?: unknown;
  createdAt?: unknown;
  lastMoveAt?: unknown;
  status?: unknown;
  winner?: unknown;
  url?: unknown;
  pgn?: unknown;
  moves?: unknown;
  opening?: unknown;
  players?: unknown;
  clock?: LichessClockObject;
  clocks?: unknown;
  [key: string]: unknown;
}

export interface NormalizedLichessGame {
  providerGameId: string;
  providerUrl: string | null;
  source: string;
  connectedLichessUserId: string;
  connectedLichessUsername: string;
  pgn: string | null;
  rated: boolean | null;
  variant: string | null;
  speedCategory: string | null;
  performanceCategory: string | null;
  timeControlRaw: string | null;
  timeControlInitial: number | null;
  timeControlIncrement: number | null;
  timeControlSource: LichessTimeControlSource;
  exactTimeControlKey: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  whiteUsername: string | null;
  blackUsername: string | null;
  whiteRating: number | null;
  blackRating: number | null;
  userColor: 'white' | 'black' | null;
  opponentUsername: string | null;
  result: string | null;
  resultForUser: 'win' | 'loss' | 'draw' | 'unknown' | null;
  status: string | null;
  openingName: string | null;
  openingEco: string | null;
  rawClockPresence: LichessClockPresence;
  rawClockValuesCentiseconds: number[];
  rawClockAnomalies: string[];
}

export class LichessNdjsonRecordError extends Error {
  constructor(readonly lineNumber: number, cause: unknown) {
    super(`Lichess returned malformed NDJSON on line ${lineNumber}.`);
    this.name = 'LichessNdjsonRecordError';
    this.cause = cause;
  }
}

export function buildLichessGamesRequestUrl(options: LichessGamesRequestOptions): string {
  if (options.to <= options.from) throw new Error('Lichess import window must be a non-empty half-open interval.');

  const params = new URLSearchParams({
    since: String(options.from.getTime()),
    until: String(options.to.getTime() - 1),
    perfType: (options.speeds ?? LICHESS_IMPORT_SPEEDS).join(','),
    finished: 'true',
    sort: options.sort ?? 'dateAsc',
    pgnInJson: 'true',
    opening: 'true',
    clocks: 'true',
  });
  if (options.rated !== undefined) params.set('rated', String(options.rated));
  return `${LICHESS_GAMES_URL}/${encodeURIComponent(options.username)}?${params.toString()}`;
}

export async function* readLichessNdjson(
  response: Response,
  signal?: AbortSignal,
): AsyncGenerator<LichessGame, void, void> {
  if (!response.body) {
    const text = await response.text();
    if (!text.trim()) return;
    yield parseNdjsonLine(text.trim(), 1);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let lineNumber = 0;

  while (true) {
    if (signal?.aborted) throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      lineNumber += 1;
      yield parseNdjsonLine(trimmed, lineNumber);
    }
    if (done) break;
  }

  const trimmed = buffer.trim();
  if (trimmed) {
    lineNumber += 1;
    yield parseNdjsonLine(trimmed, lineNumber);
  }
}

function parseNdjsonLine(line: string, lineNumber: number): LichessGame {
  try {
    const parsed: unknown = JSON.parse(line);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('record is not an object');
    }
    return parsed as LichessGame;
  } catch (error) {
    throw new LichessNdjsonRecordError(lineNumber, error);
  }
}

export function normalizeLichessGame(
  game: LichessGame,
  identity: { lichessUserId: string; username: string },
): NormalizedLichessGame {
  const providerGameId = readRequiredString(game.id, 'id');
  const pgn = readOptionalString(game.pgn);
  const white = readPlayer(game.players, 'white');
  const black = readPlayer(game.players, 'black');
  const userColor = colorFor(identity, white, black);
  const result = readOptionalString(game.status) === 'draw'
    ? '1/2-1/2'
    : readOptionalString(game.winner) === 'white'
      ? '1-0'
      : readOptionalString(game.winner) === 'black' ? '0-1' : readPgnHeader(pgn, 'Result');
  const resultForUser = userColor && result
    ? result === '1/2-1/2' ? 'draw'
      : (result === '1-0') === (userColor === 'white') ? 'win' : 'loss'
    : null;
  const clock = normalizeClocks(game);
  const timeControl = normalizeTimeControl(game.clock, pgn);

  return {
    providerGameId,
    providerUrl: readOptionalString(game.url),
    source: readOptionalString(game.source) ?? 'LICHESS_API',
    connectedLichessUserId: identity.lichessUserId,
    connectedLichessUsername: identity.username,
    pgn,
    rated: typeof game.rated === 'boolean' ? game.rated : null,
    variant: readOptionalString(game.variant),
    speedCategory: readOptionalString(game.speed),
    performanceCategory: readOptionalString(game.perf),
    timeControlRaw: timeControl.raw,
    timeControlInitial: timeControl.initial,
    timeControlIncrement: timeControl.increment,
    timeControlSource: timeControl.source,
    exactTimeControlKey: timeControl.key,
    startedAt: dateFromUnknown(game.createdAt),
    endedAt: dateFromUnknown(game.lastMoveAt),
    whiteUsername: white.username,
    blackUsername: black.username,
    whiteRating: white.rating,
    blackRating: black.rating,
    userColor,
    opponentUsername: userColor === 'white' ? black.username : userColor === 'black' ? white.username : null,
    result,
    resultForUser,
    status: readOptionalString(game.status),
    openingName: readOptionalString(readRecord(game.opening)?.name),
    openingEco: readOptionalString(readRecord(game.opening)?.eco),
    rawClockPresence: clock.presence,
    rawClockValuesCentiseconds: clock.values,
    rawClockAnomalies: [...clock.anomalies, ...timeControl.anomalies],
  };
}

function normalizeClocks(game: LichessGame): {
  presence: LichessClockPresence;
  values: number[];
  anomalies: string[];
} {
  if (!Object.prototype.hasOwnProperty.call(game, 'clocks')) {
    return { presence: 'ABSENT', values: [], anomalies: ['CLOCKS_ABSENT'] };
  }
  if (!Array.isArray(game.clocks)) {
    return { presence: 'INVALID', values: [], anomalies: ['CLOCK_SAMPLE_INVALID'] };
  }
  const values: number[] = [];
  let invalid = false;
  for (const value of game.clocks) {
    if (isNonNegativeInteger(value)) {
      values.push(value);
    } else {
      invalid = true;
    }
  }
  return {
    presence: invalid ? 'INVALID' : 'PRESENT',
    values,
    anomalies: invalid ? ['CLOCK_SAMPLE_INVALID'] : [],
  };
}

function normalizeTimeControl(clock: LichessClockObject | undefined, pgn: string | null): {
  raw: string | null;
  initial: number | null;
  increment: number | null;
  source: LichessTimeControlSource;
  key: string | null;
  anomalies: string[];
} {
  const raw = readPgnHeader(pgn, 'TimeControl');
  const clockInitial = readNonNegativeInteger(clock?.initial);
  const clockIncrement = readNonNegativeInteger(clock?.increment);
  const pgnControl = parsePgnTimeControl(raw);
  const anomalies: string[] = [];

  if (clock && (clockInitial === null || clockIncrement === null)) anomalies.push('TIME_CONTROL_INVALID');
  if (clockInitial !== null && pgnControl && (clockInitial !== pgnControl.initial || clockIncrement !== pgnControl.increment)) {
    anomalies.push('TIME_CONTROL_SOURCE_CONFLICT');
  }
  if (clockInitial !== null && clockIncrement !== null) {
    return {
      raw,
      initial: clockInitial,
      increment: clockIncrement,
      source: 'LICHESS_CLOCK_OBJECT',
      key: `${clockInitial}+${clockIncrement}`,
      anomalies,
    };
  }
  if (pgnControl) {
    return { raw, ...pgnControl, source: 'PGN_TIME_CONTROL', key: `${pgnControl.initial}+${pgnControl.increment}`, anomalies };
  }
  return { raw, initial: null, increment: null, source: 'UNKNOWN', key: raw, anomalies };
}

function parsePgnTimeControl(raw: string | null): { initial: number; increment: number } | null {
  if (!raw || raw === '?') return null;
  const match = /^(\d+)(?:\+(\d+))?$/.exec(raw.trim());
  if (!match) return null;
  const initial = Number(match[1]);
  const increment = Number(match[2] ?? 0);
  return isNonNegativeInteger(initial) && isNonNegativeInteger(increment) ? { initial, increment } : null;
}

function readPlayer(players: unknown, color: 'white' | 'black'): { username: string | null; rating: number | null; id: string | null } {
  const record = readRecord(readRecord(players)?.[color]);
  const user = readRecord(record?.user);
  return {
    username: readOptionalString(user?.name) ?? readOptionalString(record?.name),
    id: readOptionalString(user?.id) ?? readOptionalString(record?.id),
    rating: readNonNegativeInteger(record?.rating),
  };
}

function colorFor(
  identity: { lichessUserId: string; username: string },
  white: { username: string | null; id: string | null },
  black: { username: string | null; id: string | null },
): 'white' | 'black' | null {
  if (identity.lichessUserId === white.id || identity.username.toLowerCase() === white.username?.toLowerCase()) return 'white';
  if (identity.lichessUserId === black.id || identity.username.toLowerCase() === black.username?.toLowerCase()) return 'black';
  return null;
}

function readPgnHeader(pgn: string | null, header: string): string | null {
  if (!pgn) return null;
  const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^\\[${escaped}\\s+"([^"]*)"\\]`, 'mi').exec(pgn);
  return match?.[1] ?? null;
}

function readRequiredString(value: unknown, field: string): string {
  const result = readOptionalString(value);
  if (!result) throw new Error(`Lichess record is missing ${field}.`);
  return result;
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNonNegativeInteger(value: unknown): number | null {
  return isNonNegativeInteger(value) ? value : null;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function dateFromUnknown(value: unknown): Date | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return typeof value === 'string' ? validDate(value) : null;
}

function validDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
