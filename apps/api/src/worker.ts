import 'dotenv/config';
import prisma from './prisma';

export async function runWorkerUntilStopped(): Promise<void> {
  console.info('Persistent worker started; no executors are registered in the bootstrap workspace.');

  await new Promise<void>((resolve) => {
    const stop = (signal: NodeJS.Signals) => {
      console.info('Stopping persistent worker', { signal });
      resolve();
    };

    process.once('SIGINT', () => stop('SIGINT'));
    process.once('SIGTERM', () => stop('SIGTERM'));
  });
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
