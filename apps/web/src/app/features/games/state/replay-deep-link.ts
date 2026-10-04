/** Query targets are positions after a source ply, not move-list offsets. */
export function parseReplayRequestedPly(raw: string | null): number | null {
  if (raw === null || !/^[1-9][0-9]*$/.test(raw)) return null;
  const ply = Number(raw);
  return Number.isSafeInteger(ply) ? ply : null;
}

/** Unknown and out-of-range references cannot invent a replay position. */
export function resolveReplayRequestedPly(
  requestedPly: number | null,
  indexedPlyCount: number,
): number {
  return requestedPly !== null && Number.isSafeInteger(requestedPly) &&
    requestedPly > 0 && requestedPly <= indexedPlyCount
    ? requestedPly
    : 0;
}
