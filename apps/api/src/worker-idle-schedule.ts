import { setTimeout as sleep } from 'node:timers/promises';

const ACTIVE_WINDOW_MS = 30_000;
const MIN_IDLE_INTERVAL_MS = 10 * 60_000;
const MAX_IDLE_INTERVAL_MS = 60 * 60_000;

export function readIdleScanInterval(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const interval = Number(value);
  if (!/^\d+$/.test(value) || !Number.isInteger(interval)
    || interval < MIN_IDLE_INTERVAL_MS || interval > MAX_IDLE_INTERVAL_MS) {
    throw new Error('WORKER_IDLE_SCAN_INTERVAL_MS must be an integer between 600000 and 3600000.');
  }
  return interval;
}

/** Co-schedule empty scans across loops and wake idle peers when work makes progress. */
export class IdleScanSchedule {
  private activeUntil = 0;
  private nextWake = new AbortController();
  private stopped = false;

  constructor(private readonly intervalMs: number, private readonly now = Date.now) {}

  noteWork(): void {
    const now = this.now();
    const wasIdle = now >= this.activeUntil;
    this.activeUntil = now + ACTIVE_WINDOW_MS;
    if (wasIdle) {
      this.nextWake.abort();
      this.nextWake = new AbortController();
    }
  }

  delayMs(pollMs: number): number {
    const now = this.now();
    if (now < this.activeUntil) return pollMs;
    return this.intervalMs - now % this.intervalMs;
  }

  async wait(pollMs: number): Promise<void> {
    if (this.stopped) return;
    try {
      await sleep(this.delayMs(pollMs), undefined, { signal: this.nextWake.signal });
    } catch (error) {
      if (!(error instanceof Error) || error.name !== 'AbortError') throw error;
    }
  }

  stop(): void {
    this.stopped = true;
    this.nextWake.abort();
  }
}
