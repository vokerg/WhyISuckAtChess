import 'dotenv/config';
import { buildApp } from './app';

const port = process.env['PORT'] ? Number.parseInt(process.env['PORT'], 10) : 3000;

async function bootstrap() {
  const app = await buildApp({ logger: true });
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'Shutting down API server');
    await app.close();
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ host: '0.0.0.0', port });
  } catch (error) {
    app.log.error({ err: error }, 'API startup failed');
    process.exitCode = 1;
    await app.close().catch(() => undefined);
  }
}

void bootstrap();
