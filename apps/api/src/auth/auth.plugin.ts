import type { FastifyInstance, FastifyRequest } from 'fastify';
import { loadAuthConfig, type AuthConfig } from './auth.config';
import {
  currentAppUserService,
  type CurrentAppUserService,
} from './current-app-user.service';

const PUBLIC_PATHS = new Set(['/health', '/api/auth/lichess/callback']);

export interface AuthPluginOptions {
  authConfig?: AuthConfig;
  currentUserService?: Pick<CurrentAppUserService, 'resolveDevUser' | 'resolveExternalUser'>;
}

function isPublicRequest(request: FastifyRequest): boolean {
  const path = request.url.split('?', 1)[0];
  return request.method === 'OPTIONS' || PUBLIC_PATHS.has(path);
}

function readCookie(request: FastifyRequest, name: string): string | undefined {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return undefined;

  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function readToken(request: FastifyRequest): string | undefined {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith('Bearer ')) {
    const token = authorization.slice('Bearer '.length).trim();
    if (token) return token;
  }
  return readCookie(request, '__session');
}

function readStringClaim(payload: Record<string, unknown>, name: string): string | undefined {
  const value = payload[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export async function registerAuth(app: FastifyInstance, options: AuthPluginOptions = {}): Promise<void> {
  const config = options.authConfig ?? loadAuthConfig();
  const userService = options.currentUserService ?? currentAppUserService;
  const jose = config.mode === 'clerk' ? await import('jose') : null;
  const jwks = config.mode === 'clerk' ? jose!.createRemoteJWKSet(config.jwksUrl) : null;

  app.decorateRequest('auth', null);
  app.addHook('onRequest', async (request, reply) => {
    if (isPublicRequest(request)) return;

    if (config.mode === 'dev-single-user') {
      const resolved = await userService.resolveDevUser();
      request.auth = resolved.auth;
      return;
    }

    const token = readToken(request);
    if (!token) {
      return reply.code(401).send({ message: 'Unauthorized' });
    }

    let payload: Record<string, unknown>;
    try {
      const verified = await jose!.jwtVerify(token, jwks!, {
        issuer: config.issuer,
        ...(config.audience ? { audience: config.audience } : {}),
      });
      payload = verified.payload as Record<string, unknown>;
    } catch (error) {
      request.log.warn({ err: error }, 'Request authentication failed during JWT verification');
      return reply.code(401).send({ message: 'Unauthorized' });
    }

    const subject = readStringClaim(payload, 'sub');
    const authorizedParty = payload['azp'];
    const invalidAuthorizedParty = authorizedParty !== undefined
      && (typeof authorizedParty !== 'string' || !config.authorizedParties.includes(authorizedParty));

    if (!subject || invalidAuthorizedParty) {
      return reply.code(401).send({ message: 'Unauthorized' });
    }

    const resolved = await userService.resolveExternalUser({
      provider: 'clerk',
      externalSubject: subject,
      email: readStringClaim(payload, 'email'),
      displayName: readStringClaim(payload, 'name'),
    });
    request.auth = resolved.auth;
  });
}
