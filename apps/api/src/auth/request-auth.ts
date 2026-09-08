import type { FastifyReply, FastifyRequest } from 'fastify';

export interface RequestAuth {
  userId: number;
  provider: string;
  externalSubject: string;
  email?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: RequestAuth | null;
  }
}

export function requireAuth(request: FastifyRequest, reply: FastifyReply): RequestAuth | null {
  if (request.auth) return request.auth;
  void reply.code(401).send({ message: 'Unauthorized' });
  return null;
}
