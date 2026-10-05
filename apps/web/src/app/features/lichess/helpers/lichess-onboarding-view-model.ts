import type {
  LichessCredentialState,
  LichessImportRequest,
  LichessImportRunStatus,
} from '@why-i-suck-at-chess/contracts';

export type RatedMode = 'any' | 'rated' | 'casual';

export function localDateTimeValue(date: Date): string {
  const part = (n: number) => String(n).padStart(2, '0');
  return date.getFullYear() + '-' + part(date.getMonth() + 1) + '-' +
    part(date.getDate()) + 'T' + part(date.getHours()) + ':' + part(date.getMinutes());
}

export function importScope(
  from: string,
  to: string,
  rated: RatedMode,
  at = new Date(),
): { request: LichessImportRequest | null; error: string | null } {
  const format = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
  if (!format.test(from) || !format.test(to)) {
    return { request: null, error: 'Choose a start and end date and time.' };
  }
  const start = new Date(from);
  const end = new Date(to);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return { request: null, error: 'Enter valid dates and times.' };
  }
  if (localDateTimeValue(start) !== from || localDateTimeValue(end) !== to) {
    return { request: null, error: 'Enter valid local dates and times.' };
  }
  if (end <= start) return { request: null, error: 'End must be after start.' };
  if (start > at || end > at) return { request: null, error: 'Import end cannot be in the future.' };
  return {
    request: {
      from: start.toISOString(),
      to: end.toISOString(),
      ...(rated === 'any' ? {} : { rated: rated === 'rated' }),
    },
    error: null,
  };
}

export function isActiveImport(status: LichessImportRunStatus): boolean {
  return status === 'QUEUED' || status === 'RUNNING' || status === 'CANCEL_REQUESTED';
}

export function credentialDescription(state: LichessCredentialState): string {
  switch (state) {
    case 'usable': return 'Usable — new imports are available.';
    case 'expired': return 'Expired — reconnect Lichess to import again.';
    case 'revoked': return 'Revoked — reconnect Lichess to import again.';
    case 'undecryptable': return 'Unreadable credential — reconnect Lichess to import again.';
    case 'missing': return 'No Lichess identity is connected.';
  }
}

export function callbackDescription(value: string | null): string | null {
  switch (value) {
    case '1': return 'Lichess returned from authorization. The connection below is verified by the server.';
    case 'cancelled': return 'Lichess authorization was cancelled. The existing connection, if any, is shown below.';
    case 'error': return 'Lichess authorization failed. You can try connecting again.';
    case 'conflict': return 'This Lichess identity belongs to another application user.';
    default: return null;
  }
}

export function safeImportError(code: string | null): string {
  switch (code) {
    case 'AUTH_REQUIRED':
    case 'AUTH_REVOKED':
    case 'CREDENTIAL_CHANGED':
      return 'Lichess credentials changed or are unavailable. Reconnect Lichess before starting another import.';
    case 'RATE_LIMITED':
      return 'Lichess is rate limiting this import. The queued run will retry automatically.';
    case 'PROVIDER_HTTP_ERROR':
      return 'The provider request failed. Check the connection before another import.';
    case 'MALFORMED_RECORD':
      return 'Lichess supplied invalid game data. The import stopped.';
    default: return 'The import could not finish. Inspect the persisted status and start a new bounded import when ready.';
  }
}

export function apiErrorMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback;
  const response = error as { status?: number };
  if (response.status === 401 || response.status === 403) {
    return 'Application authentication is required. Sign in to this app; Lichess connection is separate.';
  }
  return fallback;
}

export function apiErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const response = error as { error?: { code?: unknown } };
  return typeof response.error?.code === 'string' ? response.error.code : null;
}
