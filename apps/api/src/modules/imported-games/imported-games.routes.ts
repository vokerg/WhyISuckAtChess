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
import { InvalidImportedGameCursorError } from './imported-games.errors';

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
      if (error instanceof InvalidImportedGameCursorError) {
        return reply.code(400).send({ error: error.message });
      }
      throw error;
    }
  });

  app.get<{ Params: ImportedGameRouteParams }>('/api/imported-games/:gameId/replay', async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) return;

    const gameId = parseGameId(request.params.gameId);
    if (gameId === null) return reply.code(400).send({ error: 'Invalid imported game id' });

    const replay = await service.getReplay(auth.userId, gameId);
    if (!replay) return reply.code(404).send({ message: 'Imported game not found' });
    return importedGameReplayResponseSchema.parse(replay);
  });

  app.get<{ Params: ImportedGameRouteParams }>('/api/imported-games/:gameId', async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) return;

    const gameId = parseGameId(request.params.gameId);
    if (gameId === null) return reply.code(400).send({ error: 'Invalid imported game id' });

    const detail = await service.getDetail(auth.userId, gameId);
    if (!detail) return reply.code(404).send({ message: 'Imported game not found' });
    return importedGameDetailResponseSchema.parse(detail);
  });
}

function parseGameId(value: string): number | null {
  const gameId = Number(value);
  return Number.isSafeInteger(gameId) && gameId > 0 && gameId <= 2_147_483_647 ? gameId : null;
}
