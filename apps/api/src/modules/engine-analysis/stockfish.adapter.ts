import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { scoreFromSideToMoveToWhite } from '@why-i-suck-at-chess/chess-domain';

export interface StockfishSettings {
  depth: number;
  multiPv: number;
  threads: number;
  hashMb: number;
}

export interface ParsedStockfishInfoLine {
  multiPv: number;
  depth: number;
  scoreCp: number | null;
  mateIn: number | null;
  pv: string[];
  raw: string;
}

export interface StockfishPvLine {
  multiPv: number;
  depth: number;
  scoreCpWhite: number | null;
  mateWhite: number | null;
  pv: string[];
  raw: string;
}

export interface StockfishPositionAnalysis {
  depth: number;
  scoreCpWhite: number | null;
  mateWhite: number | null;
  bestMove: string | null;
  bestPv: string[];
  multiPv: StockfishPvLine[];
  rawInfo: string[];
}

export interface StockfishEngine {
  readonly engineName: string;
  readonly engineVersion: string;
  analyzeFen(fen: string): Promise<StockfishPositionAnalysis>;
  close(): Promise<void>;
}

export const DEFAULT_STOCKFISH_SETTINGS: StockfishSettings = Object.freeze({
  depth: 16,
  multiPv: 3,
  threads: 1,
  hashMb: 64,
});

export const STOCKFISH_ANALYSIS_VERSION = 'stockfish-depth16-multipv3-v1';
export const DEFAULT_STOCKFISH_COMMAND_TIMEOUT_MS = 30_000;

export function settingsHash(settings: StockfishSettings): string {
  // Keep the persisted provenance key stable when callers construct the same
  // settings with a different object insertion order.
  const canonicalSettings = {
    depth: settings.depth,
    multiPv: settings.multiPv,
    threads: settings.threads,
    hashMb: settings.hashMb,
  };
  return createHash('sha256').update(JSON.stringify(canonicalSettings)).digest('hex');
}

export function toUciFen(fen: string): string {
  const fields = fen.trim().split(/\s+/);
  if (fields.length >= 6) return fields.join(' ');
  if (fields.length === 4) return `${fields.join(' ')} 0 1`;
  throw new Error('Stockfish requires a four- or six-field FEN');
}

export function parseStockfishInfo(line: string): ParsedStockfishInfoLine | null {
  if (!line.startsWith('info ')) return null;
  const tokens = line.trim().split(/\s+/);
  const valueAfter = (name: string): string | undefined => {
    const index = tokens.indexOf(name);
    return index >= 0 ? tokens[index + 1] : undefined;
  };
  const depth = Number(valueAfter('depth'));
  if (!Number.isInteger(depth)) return null;
  const multiPv = Number(valueAfter('multipv') ?? '1');
  const scoreIndex = tokens.indexOf('score');
  let scoreCp: number | null = null;
  let mateIn: number | null = null;
  if (scoreIndex >= 0) {
    if (tokens[scoreIndex + 1] === 'cp') scoreCp = Number(tokens[scoreIndex + 2]);
    if (tokens[scoreIndex + 1] === 'mate') mateIn = Number(tokens[scoreIndex + 2]);
  }
  const pvIndex = tokens.indexOf('pv');
  const pv = pvIndex >= 0 ? tokens.slice(pvIndex + 1) : [];
  if (
    !Number.isInteger(multiPv)
    || (!Number.isFinite(scoreCp) && scoreCp !== null)
    || (!Number.isFinite(mateIn) && mateIn !== null)
  ) {
    return null;
  }
  return { multiPv, depth, scoreCp, mateIn, pv, raw: line };
}

export function summarizeStockfishSearch(
  lines: string[],
  bestMove: string | null,
  fenOrActiveColor: string | 'w' | 'b' = 'w',
): StockfishPositionAnalysis {
  const parsed = lines.map(parseStockfishInfo).filter(
    (line): line is ParsedStockfishInfoLine => line !== null,
  );
  if (parsed.length === 0) throw new Error('Stockfish returned no parseable search info');

  const latestByMultiPv = new Map<number, ParsedStockfishInfoLine>();
  for (const line of parsed) {
    const previous = latestByMultiPv.get(line.multiPv);
    if (!previous || line.depth >= previous.depth) latestByMultiPv.set(line.multiPv, line);
  }

  const multiPv = [...latestByMultiPv.values()]
    .sort((a, b) => a.multiPv - b.multiPv)
    .map((line): StockfishPvLine => ({
      multiPv: line.multiPv,
      depth: line.depth,
      scoreCpWhite: scoreFromSideToMoveToWhite(line.scoreCp, fenOrActiveColor),
      mateWhite: scoreFromSideToMoveToWhite(line.mateIn, fenOrActiveColor),
      pv: line.pv,
      raw: line.raw,
    }));
  const principal = multiPv.find((line) => line.multiPv === 1) ?? multiPv[0];

  return {
    depth: Math.max(...multiPv.map((line) => line.depth)),
    scoreCpWhite: principal.scoreCpWhite,
    mateWhite: principal.mateWhite,
    bestMove,
    bestPv: principal.pv,
    multiPv,
    rawInfo: lines,
  };
}

class UciLineReader {
  private buffer = '';
  private readonly pending: Array<(line: string) => void> = [];
  private readonly queued: string[] = [];

  constructor(stream: NodeJS.ReadableStream) {
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      this.buffer += String(chunk);
      let newline = this.buffer.indexOf('\n');
      while (newline >= 0) {
        const line = this.buffer.slice(0, newline).trimEnd();
        this.buffer = this.buffer.slice(newline + 1);
        const waiter = this.pending.shift();
        if (waiter) waiter(line); else this.queued.push(line);
        newline = this.buffer.indexOf('\n');
      }
    });
  }

  next(): Promise<string> {
    const queued = this.queued.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve) => this.pending.push(resolve));
  }
}

function configuredTimeoutMs(explicit?: number): number {
  if (explicit !== undefined) return explicit;
  const fromEnv = Number(process.env.STOCKFISH_COMMAND_TIMEOUT_MS);
  return Number.isFinite(fromEnv) && fromEnv > 0
    ? Math.trunc(fromEnv)
    : DEFAULT_STOCKFISH_COMMAND_TIMEOUT_MS;
}

export async function createStockfishEngine(options: {
  binaryPath?: string;
  settings?: StockfishSettings;
  commandTimeoutMs?: number;
  spawnProcess?: (binaryPath: string) => ChildProcessWithoutNullStreams;
} = {}): Promise<StockfishEngine> {
  const settings = options.settings ?? DEFAULT_STOCKFISH_SETTINGS;
  const commandTimeoutMs = configuredTimeoutMs(options.commandTimeoutMs);
  const binaryPath = options.binaryPath ?? process.env.STOCKFISH_PATH ?? 'stockfish';
  const child = options.spawnProcess?.(binaryPath) ?? spawn(binaryPath, [], { stdio: 'pipe' });
  const reader = new UciLineReader(child.stdout);
  let closing = false;

  const processFailure = new Promise<never>((_, reject) => {
    child.once('error', (error) => {
      if (!closing) reject(error);
    });
    child.once('exit', (code, signal) => {
      if (!closing) {
        reject(new Error(
          `Stockfish exited unexpectedly (code=${code ?? 'none'}, signal=${signal ?? 'none'})`,
        ));
      }
    });
  });
  void processFailure.catch(() => {});

  const write = (command: string) => child.stdin.write(`${command}\n`);
  const waitFor = async (
    predicate: (line: string) => boolean,
    operation: string,
  ): Promise<string[]> => {
    const seen: string[] = [];
    const deadline = Date.now() + commandTimeoutMs;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`Stockfish ${operation} timed out after ${commandTimeoutMs}ms`);

      let timeout: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Stockfish ${operation} timed out after ${commandTimeoutMs}ms`)),
          remaining,
        );
      });

      try {
        const line = await Promise.race([reader.next(), processFailure, timeoutPromise]);
        seen.push(line);
        if (predicate(line)) return seen;
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }
  };

  try {
    write('uci');
    const uciLines = await waitFor((line) => line === 'uciok', 'uci initialization');
    const nameLine = uciLines.find((line) => line.startsWith('id name ')) ?? 'id name Stockfish unknown';
    const engineName = nameLine.slice('id name '.length).trim();
    const versionMatch = engineName.match(/(\d+(?:\.\d+)?(?:[-\w.]*)?)/);
    const engineVersion = versionMatch?.[1] ?? 'unknown';

    write(`setoption name Threads value ${settings.threads}`);
    write(`setoption name Hash value ${settings.hashMb}`);
    write(`setoption name MultiPV value ${settings.multiPv}`);
    write('isready');
    await waitFor((line) => line === 'readyok', 'readiness check');

    return {
      engineName,
      engineVersion,
      async analyzeFen(fen: string): Promise<StockfishPositionAnalysis> {
        write('ucinewgame');
        write(`position fen ${toUciFen(fen)}`);
        write(`go depth ${settings.depth}`);
        const lines = await waitFor((line) => line.startsWith('bestmove '), 'position analysis');
        const bestMoveLine = lines.at(-1) ?? '';
        const bestMove = bestMoveLine.split(/\s+/)[1] ?? null;
        return summarizeStockfishSearch(
          lines.filter((line) => line.startsWith('info ')),
          bestMove === '(none)' ? null : bestMove,
          fen,
        );
      },
      async close(): Promise<void> {
        if (!child.killed) {
          closing = true;
          write('quit');
          child.kill();
        }
      },
    };
  } catch (error) {
    closing = true;
    if (!child.killed) child.kill();
    throw error;
  }
}
