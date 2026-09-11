import 'dotenv/config';
import prisma from './prisma';
import { lichessConnectionService } from './modules/lichess/lichess-connection.service';
import { createLichessAccountImportService } from './modules/account-imports/account-import.service';
import { createStockfishAnalysisService } from './modules/engine-analysis/engine-analysis.service';
import { ImportedGamePlyIndexService } from './modules/imported-games/ply-index.service';

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
    const importRan = await importService.runOnce();
    const indexRan = await ImportedGamePlyIndexService.runOnce();
    const analysisRan = await analysisService.runOnce();
    if (!importRan && !indexRan && !analysisRan) {
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
