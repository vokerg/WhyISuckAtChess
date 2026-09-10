import {
  createStockfishEngine,
  DEFAULT_STOCKFISH_SETTINGS,
  settingsHash,
  STOCKFISH_ANALYSIS_VERSION,
  type StockfishEngine,
  type StockfishSettings,
} from './stockfish.adapter';
import { prismaAnalysisRepository, type AnalysisRepository } from './engine-analysis.repository.prisma';

export interface StockfishAnalysisService {
  runOnce(): Promise<boolean>;
  requestReanalysis(importedGameId: number): Promise<number>;
}

export function createStockfishAnalysisService(options: {
  repository?: AnalysisRepository;
  engineFactory?: () => Promise<StockfishEngine>;
  settings?: StockfishSettings;
  analysisVersion?: string;
  workerId?: string;
} = {}): StockfishAnalysisService {
  const repository = options.repository ?? prismaAnalysisRepository;
  const settings = options.settings ?? DEFAULT_STOCKFISH_SETTINGS;
  const analysisVersion = options.analysisVersion ?? STOCKFISH_ANALYSIS_VERSION;
  const hash = settingsHash(settings);
  const workerId = options.workerId ?? `stockfish-${process.pid}`;
  const engineFactory = options.engineFactory ?? (() => createStockfishEngine({ settings }));

  return {
    async runOnce(): Promise<boolean> {
      await repository.enqueueEligibleGame({ analysisVersion, settingsHash: hash, settings });
      const run = await repository.claimNext(workerId);
      if (!run) return false;

      let engine: StockfishEngine | null = null;
      try {
        engine = await engineFactory();
        if (!await repository.recordEngineIdentity(run.id, engine.engineName, engine.engineVersion)) return true;
        const positions = await repository.loadPositions(run.id);
        for (const position of positions) {
          const analysis = await engine.analyzeFen(position.normalizedFen);
          const accepted = await repository.persistPositionResult({
            runId: run.id,
            positionId: position.positionId,
            engineName: engine.engineName,
            engineVersion: engine.engineVersion,
            settingsHash: hash,
            analysis,
          });
          if (!accepted) return true;
        }
        await repository.markSucceeded(run.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await repository.markFailure(run, message);
      } finally {
        await engine?.close();
      }
      return true;
    },

    requestReanalysis(importedGameId: number): Promise<number> {
      return repository.requestReanalysis({ importedGameId, analysisVersion, settingsHash: hash, settings });
    },
  };
}
