import prisma from '../../prisma';
import type {
  RatingContextCompositionRepository,
  RatingContextGame,
} from './rating-context-composition.service';

export function createPrismaRatingContextCompositionRepository(database: typeof prisma = prisma): RatingContextCompositionRepository {
  return {
  async loadOwnedRatingContext(appUserId, importedGameIds) {
    if (importedGameIds.length === 0) return [];

    const games = await database.importedGame.findMany({
      where: {
        appUserId,
        id: { in: [...importedGameIds] },
      },
      select: {
        id: true,
        userColor: true,
        whiteRating: true,
        blackRating: true,
      },
      orderBy: { id: 'asc' },
    });

    return games.map<RatingContextGame>((game) => {
      if (game.userColor?.toUpperCase() === 'WHITE') {
        return {
          importedGameId: game.id,
          userRating: game.whiteRating,
          opponentRating: game.blackRating,
        };
      }
      if (game.userColor?.toUpperCase() === 'BLACK') {
        return {
          importedGameId: game.id,
          userRating: game.blackRating,
          opponentRating: game.whiteRating,
        };
      }
      return {
        importedGameId: game.id,
        userRating: null,
        opponentRating: null,
      };
    });
  },
};
}

export const prismaRatingContextCompositionRepository = createPrismaRatingContextCompositionRepository();
