import type { HealthResponse } from '@why-i-suck-at-chess/contracts';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { registerAuth, type AuthPluginOptions } from './auth/auth.plugin';
import {
  registerLichessRoutes,
} from './modules/lichess/lichess.routes';
import {
  lichessConnectionService,
  type LichessConnectionService,
} from './modules/lichess/lichess-connection.service';
import {
  createLichessAccountImportService,
  type LichessAccountImportService,
} from './modules/account-imports/account-import.service';
import { registerAccountImportRoutes } from './modules/account-imports/account-import.routes';
import {
  registerImportedGamesRoutes,
} from './modules/imported-games/imported-games.routes';
import {
  ImportedGamesQueryService as defaultImportedGamesQueryService,
  type ImportedGamesQueryService,
} from './modules/imported-games/imported-games.service';
import prisma from './prisma';

export interface PrismaLifecycle {
  $disconnect(): Promise<void>;
}

export interface BuildAppOptions extends AuthPluginOptions {
  logger?: FastifyServerOptions['logger'];
  prisma?: PrismaLifecycle;
  lichessService?: LichessConnectionService;
  accountImportService?: LichessAccountImportService;
  importedGamesService?: ImportedGamesQueryService;
}

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? false });
  const prismaLifecycle = options.prisma ?? prisma;

  app.addHook('onClose', async () => {
    await prismaLifecycle.$disconnect();
  });

  await registerAuth(app, {
    authConfig: options.authConfig,
    currentUserService: options.currentUserService,
  });

  app.get('/health', async (): Promise<HealthResponse> => ({
    ok: true,
    service: 'why-i-suck-at-chess-api',
  }));

  await registerLichessRoutes(app, options.lichessService);
  await registerAccountImportRoutes(
    app,
    options.accountImportService ?? createLichessAccountImportService({
      connectionService: options.lichessService ?? lichessConnectionService,
    }),
  );
  await registerImportedGamesRoutes(
    app,
    options.importedGamesService ?? defaultImportedGamesQueryService,
  );

  return app;
}
