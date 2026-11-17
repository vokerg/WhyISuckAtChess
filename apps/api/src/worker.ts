import 'dotenv/config';
import { IdleScanSchedule, readIdleScanInterval } from './worker-idle-schedule';
import { setTimeout as sleep } from 'node:timers/promises';
import { createDiagnosisWorkerService } from './modules/diagnosis/diagnosis-worker.service';
import prisma from './prisma';
import { lichessConnectionService } from './modules/lichess/lichess-connection.service';
import { createLichessAccountImportService } from './modules/account-imports/account-import.service';
import { createStockfishAnalysisService } from './modules/engine-analysis/engine-analysis.service';
import { ImportedGamePlyIndexService } from './modules/imported-games/ply-index.service';
import { createEvidenceService } from './modules/evidence/evidence.service';
import { evidenceDetectors } from './modules/evidence/evidence.registry';

export interface WorkerCycleExecutor {
  runOnce(): Promise<boolean>;
}

export interface WorkerCycleDependencies {
  importService: WorkerCycleExecutor;
  plyIndexService: WorkerCycleExecutor;
  analysisService: WorkerCycleExecutor;
  evidenceService?: WorkerCycleExecutor;
  diagnosisService?: WorkerCycleExecutor;
}

export async function runWorkerCycle(
  dependencies: WorkerCycleDependencies,
): Promise<boolean> {
  const importRan = await dependencies.importService.runOnce();
  const indexRan = await dependencies.plyIndexService.runOnce();
  const analysisRan = await dependencies.analysisService.runOnce();
  const evidenceRan = dependencies.evidenceService
    ? await dependencies.evidenceService.runOnce()
    : false;
  const diagnosisRan = dependencies.diagnosisService
    ? await dependencies.diagnosisService.runOnce() : false;
  return importRan || indexRan || analysisRan || evidenceRan || diagnosisRan;
}

export async function runWorkerUntilStopped(): Promise<void> {
  const idleInterval = readIdleScanInterval(process.env.WORKER_IDLE_SCAN_INTERVAL_MS);
  const idleSchedule = idleInterval === undefined ? undefined : new IdleScanSchedule(idleInterval);
  const importService = createLichessAccountImportService({ connectionService: lichessConnectionService });
  const analysisService = createStockfishAnalysisService();
  const evidenceService = createEvidenceService({ detectors: evidenceDetectors });
  const diagnosisService = createDiagnosisWorkerService();
  console.info('Persistent worker started; Lichess import, ply indexing, Stockfish analysis, deterministic evidence, and diagnosis publication executors are registered.');

  const shutdown = new AbortController();
  const stop = (signal: NodeJS.Signals) => {
    console.info('Stopping persistent worker', { signal });
    shutdown.abort();
    idleSchedule?.stop();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  try {
    while (!shutdown.signal.aborted) {
      const ran = await runWorkerCycle({
        importService,
        plyIndexService: ImportedGamePlyIndexService,
        analysisService,
        evidenceService,
        diagnosisService,
      });
      if (shutdown.signal.aborted) break;
      if (ran) {
        idleSchedule?.noteWork();
      } else if (idleSchedule) {
        if (idleSchedule.delayMs(1000) > 1000) await prisma.$disconnect();
        await idleSchedule.wait(1000);
      } else {
        await sleep(1000, undefined, { signal: shutdown.signal });
      }
    }
  } catch (error) {
    if (!shutdown.signal.aborted || !(error instanceof Error) || error.name !== 'AbortError') throw error;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
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
