import 'dotenv/config';
import prisma from './prisma';
import { lichessConnectionService } from './modules/lichess/lichess-connection.service';
import { createLichessAccountImportService } from './modules/account-imports/account-import.service';

export async function runWorkerUntilStopped(): Promise<void> {
  const importService = createLichessAccountImportService({ connectionService: lichessConnectionService });
  console.info('Persistent worker started; Lichess account import executor is registered.');

  let stopping = false;
  const stop = (signal: NodeJS.Signals) => {
    console.info('Stopping persistent worker', { signal });
    stopping = true;
  };
  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));

  while (!stopping) {
    const ran = await importService.runOnce();
    if (!ran) await new Promise((resolve) => setTimeout(resolve, 1000));
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
