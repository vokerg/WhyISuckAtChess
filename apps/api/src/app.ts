import type { HealthResponse } from '@why-i-suck-at-chess/contracts';
import Fastify, { type FastifyServerOptions } from 'fastify';
import prisma from './prisma';

export interface PrismaLifecycle {
  $disconnect(): Promise<void>;
}

export interface BuildAppOptions {
  logger?: FastifyServerOptions['logger'];
  prisma?: PrismaLifecycle;
}

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? false });
  const prismaLifecycle = options.prisma ?? prisma;

  app.addHook('onClose', async () => {
    await prismaLifecycle.$disconnect();
  });

  app.get('/health', async (): Promise<HealthResponse> => ({
    ok: true,
    service: 'why-i-suck-at-chess-api',
  }));

  return app;
}
