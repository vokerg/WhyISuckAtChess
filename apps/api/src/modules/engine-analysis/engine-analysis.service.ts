import {
  classifyPly,
  effectiveScoreCpWhite,
  scoreLossForSide,
  type ChessColor,
} from '@why-i-suck-at-chess/chess-domain';
import {
  createStockfishEngine,
  DEFAULT_STOCKFISH_SETTINGS,
  settingsHash,
  STOCKFISH_ANALYSIS_VERSION,
  type StockfishEngine,
  type StockfishPositionAnalysis,
  type StockfishSettings,
} from './stockfish.adapter';
import {
  prismaAnalysisRepository,
  type AnalysisPlyWork,
  type AnalysisRepository,
} from './engine-analysis.repository.prisma';

const ANALYSIS_WRITE_CHUNK_SIZE = 8;
const DEFAULT_STALE_AFTER_MS = 5 * 60_000;

export interface StockfishAnalysisService {
  runOnce(): Promise<boolean>;
  requestReanalysis(importedGameId: number): Promise<number>;
}

function moverColor(value: string): ChessColor {
  if (value === 'WHITE' || value === 'BLACK') return value;
  throw new Error('Unsupported mover color: ' + value);
}

function effectiveAnalysisScore(analysis: StockfishPositionAnalysis): number | null {
  return effectiveScoreCpWhite(analysis.scoreCpWhite, analysis.mateWhite);
}

function playedMoveScore(
  before: StockfishPositionAnalysis,
  after: StockfishPositionAnalysis,
  moveUci: string,
): number | null {
  const matchingLine = before.multiPv.find((line) => line.pv[0] === moveUci);
  const matchingScore = matchingLine
    ? effectiveScoreCpWhite(matchingLine.scoreCpWhite, matchingLine.mateWhite)
    : null;
  if (matchingScore !== null) return matchingScore;
  if (before.bestMove === moveUci) return effectiveAnalysisScore(before);
  return effectiveAnalysisScore(after);
}

function analysePly(
  ply: AnalysisPlyWork,
  analyses: Map<number, StockfishPositionAnalysis>,
): { plyNumber: number; scoreLossCp: number; classificationCode: number } {
  const before = analyses.get(ply.beforePositionId);
  const after = analyses.get(ply.afterPositionId);
  if (!before || !after) {
    throw new Error('Missing position evidence for ply ' + ply.plyNumber);
  }

  const bestScore = effectiveAnalysisScore(before);
  const playedScore = playedMoveScore(before, after, ply.moveUci);
  const scoreLossCp = scoreLossForSide(bestScore, playedScore, moverColor(ply.moverColor));
  if (scoreLossCp === null) {
    throw new Error('Could not normalize engine score for ply ' + ply.plyNumber);
  }

  const classificationCode = classifyPly({
    moveUci: ply.moveUci,
    bestMoveUci: before.bestMove,
    scoreLossCp,
  });
  if (classificationCode === null) {
    throw new Error('Could not classify ply ' + ply.plyNumber);
  }

  return { plyNumber: ply.plyNumber, scoreLossCp, classificationCode };
}

function staleAfterMs(explicit?: number): number {
  if (explicit !== undefined) return explicit;
  const configured = Number(process.env.STOCKFISH_STALE_AFTER_MS);
  return Number.isFinite(configured) && configured > 0
    ? Math.trunc(configured)
    : DEFAULT_STALE_AFTER_MS;
}

export function createStockfishAnalysisService(options: {
  repository?: AnalysisRepository;
  engineFactory?: () => Promise<StockfishEngine>;
  settings?: StockfishSettings;
  analysisVersion?: string;
  workerId?: string;
  staleAfterMs?: number;
} = {}): StockfishAnalysisService {
  const repository = options.repository ?? prismaAnalysisRepository;
  const settings = options.settings ?? DEFAULT_STOCKFISH_SETTINGS;
  const analysisVersion = options.analysisVersion ?? STOCKFISH_ANALYSIS_VERSION;
  const hash = settingsHash(settings);
  const workerId = options.workerId ?? 'stockfish-' + process.pid;
  const engineFactory = options.engineFactory ?? (() => createStockfishEngine({ settings }));
  const staleLeaseMs = staleAfterMs(options.staleAfterMs);

  return {
    async runOnce(): Promise<boolean> {
      await repository.recoverStaleRuns(new Date(Date.now() - staleLeaseMs));
      await repository.enqueueEligibleGame({ analysisVersion, settingsHash: hash, settings });
      const run = await repository.claimNext(workerId);
      if (!run) return false;

      let engine: StockfishEngine | null = null;
      try {
        engine = await engineFactory();
        if (!await repository.recordEngineIdentity(run, engine.engineName, engine.engineVersion)) {
          return true;
        }

        const work = await repository.loadGameWork(run);
        if (work.positions.length === 0 || work.plies.length === 0) {
          throw new Error('Indexed game has no analysis work');
        }

        const cached = await repository.loadCachedPositionAnalyses({
          positionIds: work.positions.map((position) => position.positionId),
          analysisVersion: run.analysisVersion,
          settingsHash: run.settingsHash,
          engineName: engine.engineName,
          engineVersion: engine.engineVersion,
        });
        const analyses = new Map<number, StockfishPositionAnalysis>();
        for (const analysis of cached) {
          analyses.set(analysis.positionId, analysis);
        }
        const cacheHits = analyses.size;
        const cacheMisses = work.positions.length - cacheHits;

        if (!await repository.initializeProgress(run, {
          positionsTotal: work.positions.length,
          pliesTotal: work.plies.length,
          cacheHits,
          cacheMisses,
        })) {
          return true;
        }

        let positionsDone = cacheHits;
        let pliesDone = 0;
        let pendingPositions: Array<{ positionId: number; analysis: StockfishPositionAnalysis }> = [];

        const flushPositions = async (): Promise<boolean> => {
          if (pendingPositions.length === 0) return true;
          const accepted = await repository.persistBatch(run, {
            engineName: engine!.engineName,
            engineVersion: engine!.engineVersion,
            positionResults: pendingPositions,
            plyResults: [],
            positionsDone,
            pliesDone,
          });
          pendingPositions = [];
          return accepted;
        };

        for (const position of work.positions) {
          if (analyses.has(position.positionId)) continue;
          const analysis = await engine.analyzeFen(position.normalizedFen);
          analyses.set(position.positionId, analysis);
          pendingPositions.push({ positionId: position.positionId, analysis });
          positionsDone += 1;

          if (pendingPositions.length >= ANALYSIS_WRITE_CHUNK_SIZE) {
            if (!await flushPositions()) return true;
          }
        }
        if (!await flushPositions()) return true;

        let pendingPlies: Array<{
          plyNumber: number;
          scoreLossCp: number;
          classificationCode: number;
        }> = [];

        const flushPlies = async (): Promise<boolean> => {
          if (pendingPlies.length === 0) return true;
          const accepted = await repository.persistBatch(run, {
            engineName: engine!.engineName,
            engineVersion: engine!.engineVersion,
            positionResults: [],
            plyResults: pendingPlies,
            positionsDone,
            pliesDone,
          });
          pendingPlies = [];
          return accepted;
        };

        for (const ply of work.plies) {
          pendingPlies.push(analysePly(ply, analyses));
          pliesDone += 1;
          if (pendingPlies.length >= ANALYSIS_WRITE_CHUNK_SIZE) {
            if (!await flushPlies()) return true;
          }
        }
        if (!await flushPlies()) return true;

        await repository.markSucceeded(run);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await repository.markFailure(run, message);
      } finally {
        await engine?.close();
      }
      return true;
    },

    requestReanalysis(importedGameId: number): Promise<number> {
      return repository.requestReanalysis({
        importedGameId,
        analysisVersion,
        settingsHash: hash,
        settings,
      });
    },
  };
}
