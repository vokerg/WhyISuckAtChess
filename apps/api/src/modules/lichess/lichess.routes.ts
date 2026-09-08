import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../auth/request-auth';
import {
  LichessOAuthError,
  lichessConnectionService,
  type LichessConnectionService,
} from './lichess-connection.service';

interface CallbackQuery {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
}

export async function registerLichessRoutes(
  app: FastifyInstance,
  service: LichessConnectionService = lichessConnectionService,
): Promise<void> {
  app.get('/api/me/lichess-connection', async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) return;
    return service.getStatusForUser(auth.userId);
  });

  app.post('/api/me/lichess-connection/start', async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) return;
    return { url: await service.createAuthorizationUrl(auth.userId) };
  });

  app.get<{ Querystring: CallbackQuery }>('/api/auth/lichess/callback', async (request, reply) => {
    try {
      await service.handleCallback(request.query);
      return reply.redirect(`${readWebAppUrl()}/settings/lichess?lichessConnected=1`);
    } catch (error) {
      if (error instanceof LichessOAuthError) {
        return reply.redirect(
          `${readWebAppUrl()}/settings/lichess?lichessConnected=${encodeURIComponent(error.redirectStatus)}`,
        );
      }
      throw error;
    }
  });

  app.delete('/api/me/lichess-connection', async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) return;
    return service.disconnectForUser(auth.userId);
  });
}

function readWebAppUrl(): string {
  return (process.env['WEB_APP_URL'] || 'http://localhost:4200').replace(/\/$/, '');
}
