/**
 * Fastify/Pino automatically logs the request target when logging is enabled.
 * OAuth callbacks contain single-use authorization codes and PKCE state in the
 * query string, so never serialize a raw URL or request headers into logs.
 *
 * Use for all HTTP requests rather than relying on per-route logging overrides:
 * early routing failures and unmatched requests still pass through this boundary.
 */
export function serializeSafeHttpRequest(request: {
  method?: string;
  url?: string;
  socket?: { remoteAddress?: string; remotePort?: number };
}) {
  const url = typeof request.url === 'string' ? request.url.split('?', 1)[0] : undefined;
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
