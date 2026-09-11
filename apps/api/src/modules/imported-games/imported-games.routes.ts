import type { FastifyInstance } from 'fastify';
import {
  importedGameDetailResponseSchema,
  importedGameListResponseSchema,
  importedGameListQuerySchema,
  importedGameReplayResponseSchema,
} from '@why-i-suck-at-chess/contracts';
import { requireAuth } from '../../auth/request-auth';
import {
  ImportedGamesQueryService,
  type ImportedGamesQueryService as ImportedGamesQueryServiceType,
} from './imported-games.service';

export interface ImportedGameRouteParams {
  gameId: string;
}

export async function registerImportedGamesRoutes(
  app: FastifyInstance,
  service: ImportedGamesQueryServiceType = ImportedGamesQueryService,
): Promise<void> {
  app.get('/api/imported-games', async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) return;

    const parsedQuery = importedGameListQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.code(400).send({ error: 'Invalid imported-games query', issues: parsedQuery.error.issues });
    }

    try {
      return importedGameListResponseSchema.parse(await service.list(auth.userId, parsedQuery.data));
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error, 'Could not list imported games') });
    }
  });

  app.get<{ Params: ImportedGameRouteParams }>('/api/imported-games/:gameId/replay', async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) return;

    const gameId = parseGameId(request.params.gameId);
    if (gameId === null) return reply.code(400).send({ error: 'Invalid imported game id' });

    try {
      const replay = await service.getReplay(auth.userId, gameId);
      if (!replay) return reply.code(404).send({ message: 'Imported game not found' });
      return importedGameReplayResponseSchema.parse(replay);
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error, 'Could not load imported game replay') });
    }
  });

  app.get<{ Params: ImportedGameRouteParams }>('/api/imported-games/:gameId', async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) return;

    const gameId = parseGameId(request.params.gameId);
    if (gameId === null) return reply.code(400).send({ error: 'Invalid imported game id' });

    try {
      const detail = await service.getDetail(auth.userId, gameId);
      if (!detail) return reply.code(404).send({ message: 'Imported game not found' });
      return importedGameDetailResponseSchema.parse(detail);
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error, 'Could not load imported game') });
    }
  });
}

function parseGameId(value: string): number | null {
  const gameId = Number(value);
  return Number.isInteger(gameId) && gameId > 0 ? gameId : null;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
