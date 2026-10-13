import type { FastifyInstance } from 'fastify';

/**
 * Fastify/Pino automatically logs the request target when logging is enabled.
 * OAuth callbacks contain single-use authorization codes and PKCE state in the
 * query string, so never serialize a raw URL or request headers into logs.
 *
 * Use for all HTTP requests rather than relying on per-route logging overrides:
 * unmatched requests additionally require the safe 404 handler below.
 */
export function serializeSafeHttpRequest(request: {
  method?: string;
  url?: string;
  socket?: { remoteAddress?: string; remotePort?: number };
}) {
  const url = typeof request.url === 'string' ? safePathname(request.url) : undefined;
  return {
    method: request.method,
    url,
    remoteAddress: request.socket?.remoteAddress,
    remotePort: request.socket?.remotePort,
  };
}

export const apiLoggerOptions = {
  serializers: {
    req: serializeSafeHttpRequest,
  },
};

/** Fastify's built-in 404 handler logs the *raw* request URL in its message,
 * bypassing Pino's req serializer. Replace it so unknown paths cannot echo
 * OAuth codes, PKCE state or other query values into logs or error bodies.
 */
export function registerSafeNotFoundHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    const pathname = safePathname(request.url);
    return reply.code(404).send({
      statusCode: 404,
      error: 'Not Found',
      message: `Route ${request.method}:${pathname} not found`,
    });
  });
}

function safePathname(rawUrl: string): string {
  try {
    // Absolute-form request targets and fragments must not enter log messages.
    return new URL(rawUrl, 'http://localhost').pathname;
  } catch {
    return '/'; // Fail closed on malformed request targets.
  }
}
