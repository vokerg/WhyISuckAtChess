import 'dotenv/config';
import prisma from './prisma';
import { lichessConnectionService } from './modules/lichess/lichess-connection.service';
import { createLichessAccountImportService } from './modules/account-imports/account-import.service';
import { createStockfishAnalysisService } from './modules/engine-analysis/engine-analysis.service';
import { ImportedGamePlyIndexService } from './modules/imported-games/ply-index.service';

export interface WorkerCycleExecutor {
  runOnce(): Promise<boolean>;
}

export interface WorkerCycleDependencies {
  importService: WorkerCycleExecutor;
  plyIndexService: WorkerCycleExecutor;
  analysisService: WorkerCycleExecutor;
}

export async function runWorkerCycle(
  dependencies: WorkerCycleDependencies,
): Promise<boolean> {
  const importRan = await dependencies.importService.runOnce();
  const indexRan = await dependencies.plyIndexService.runOnce();
  const analysisRan = await dependencies.analysisService.runOnce();
  return importRan || indexRan || analysisRan;
}

export async function runWorkerUntilStopped(): Promise<void> {
  const importService = createLichessAccountImportService({ connectionService: lichessConnectionService });
  const analysisService = createStockfishAnalysisService();
  console.info('Persistent worker started; Lichess import, ply indexing, and Stockfish analysis executors are registered.');

  let stopping = false;
  const stop = (signal: NodeJS.Signals) => {
    console.info('Stopping persistent worker', { signal });
    stopping = true;
  };
  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));

  while (!stopping) {
    const ran = await runWorkerCycle({
      importService,
      plyIndexService: ImportedGamePlyIndexService,
      analysisService,
    });
    if (!ran) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function bootstrap() {
  try {
    await runWorkerUntilStopped();
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void bootstrap().catch((error) => {
    console.error('Persistent worker failed', error);
    process.exitCode = 1;
  });
}
