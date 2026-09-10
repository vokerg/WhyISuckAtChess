import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';

export interface StockfishSettings {
  depth: number;
  multiPv: number;
  threads: number;
  hashMb: number;
}

export interface StockfishPvLine {
  multiPv: number;
  depth: number;
  scoreCp: number | null;
  mateIn: number | null;
  pv: string[];
  raw: string;
}

export interface StockfishPositionAnalysis {
  depth: number;
  scoreCp: number | null;
  mateIn: number | null;
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

export function settingsHash(settings: StockfishSettings): string {
  return createHash('sha256').update(JSON.stringify(settings)).digest('hex');
}

export function parseStockfishInfo(line: string): StockfishPvLine | null {
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
  if (!Number.isInteger(multiPv) || (!Number.isFinite(scoreCp) && scoreCp !== null) || (!Number.isFinite(mateIn) && mateIn !== null)) {
    return null;
  }
  return { multiPv, depth, scoreCp, mateIn, pv, raw: line };
}

export function summarizeStockfishSearch(lines: string[], bestMove: string | null): StockfishPositionAnalysis {
  const parsed = lines.map(parseStockfishInfo).filter((line): line is StockfishPvLine => line !== null);
  if (parsed.length === 0) throw new Error('Stockfish returned no parseable search info');
  const maxDepth = Math.max(...parsed.map((line) => line.depth));
  const latestByMultiPv = new Map<number, StockfishPvLine>();
  for (const line of parsed) {
    const previous = latestByMultiPv.get(line.multiPv);
    if (!previous || line.depth >= previous.depth) latestByMultiPv.set(line.multiPv, line);
  }
  const multiPv = [...latestByMultiPv.values()].sort((a, b) => a.multiPv - b.multiPv);
  const principal = multiPv.find((line) => line.multiPv === 1) ?? multiPv[0];
  return {
    depth: maxDepth,
    scoreCp: principal.scoreCp,
    mateIn: principal.mateIn,
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

export async function createStockfishEngine(options: {
  binaryPath?: string;
  settings?: StockfishSettings;
  spawnProcess?: (binaryPath: string) => ChildProcessWithoutNullStreams;
} = {}): Promise<StockfishEngine> {
  const settings = options.settings ?? DEFAULT_STOCKFISH_SETTINGS;
  const binaryPath = options.binaryPath ?? process.env.STOCKFISH_PATH ?? 'stockfish';
  const child = options.spawnProcess?.(binaryPath) ?? spawn(binaryPath, [], { stdio: 'pipe' });
  const reader = new UciLineReader(child.stdout);
  const write = (command: string) => child.stdin.write(`${command}\n`);
  const waitFor = async (predicate: (line: string) => boolean): Promise<string[]> => {
    const seen: string[] = [];
    for (;;) {
      const line = await reader.next();
      seen.push(line);
      if (predicate(line)) return seen;
    }
  };

  write('uci');
  const uciLines = await waitFor((line) => line === 'uciok');
  const nameLine = uciLines.find((line) => line.startsWith('id name ')) ?? 'id name Stockfish unknown';
  const engineName = nameLine.slice('id name '.length).trim();
  const versionMatch = engineName.match(/(\d+(?:\.\d+)?(?:[-\w.]*)?)/);
  const engineVersion = versionMatch?.[1] ?? 'unknown';
  write(`setoption name Threads value ${settings.threads}`);
  write(`setoption name Hash value ${settings.hashMb}`);
  write(`setoption name MultiPV value ${settings.multiPv}`);
  write('isready');
  await waitFor((line) => line === 'readyok');

  return {
    engineName,
    engineVersion,
    async analyzeFen(fen: string): Promise<StockfishPositionAnalysis> {
      write('ucinewgame');
      write(`position fen ${fen}`);
      write(`go depth ${settings.depth}`);
      const lines = await waitFor((line) => line.startsWith('bestmove '));
      const bestMoveLine = lines.at(-1) ?? '';
      const bestMove = bestMoveLine.split(/\s+/)[1] ?? null;
      return summarizeStockfishSearch(lines.filter((line) => line.startsWith('info ')), bestMove === '(none)' ? null : bestMove);
    },
    async close(): Promise<void> {
      if (!child.killed) {
        write('quit');
        child.kill();
      }
    },
  };
}
