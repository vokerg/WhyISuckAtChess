import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import type {
  LichessConnectionStatus,
  LichessImportRun,
} from '@why-i-suck-at-chess/contracts';
import { firstValueFrom } from 'rxjs';
import { LichessOnboardingApiService } from '../data-access/lichess-onboarding-api.service';
import {
  apiErrorCode,
  apiErrorMessage,
  importScope,
  isActiveImport,
  localDateTimeValue,
  type RatedMode,
} from '../helpers/lichess-onboarding-view-model';

const POLL_MS = 2500;
const initialEnd = new Date();

@Injectable()
export class LichessOnboardingStore {
  private readonly api = inject(LichessOnboardingApiService);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private polling = false;
  private generation = 0;
  private destroyed = false;

  readonly connection = signal<LichessConnectionStatus | null>(null);
  readonly run = signal<LichessImportRun | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly pollingError = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly fromInput = signal(localDateTimeValue(new Date(initialEnd.getTime() - 30 * 24 * 60 * 60 * 1000)));
  readonly toInput = signal(localDateTimeValue(initialEnd));
  readonly ratedMode = signal<RatedMode>('any');

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.invalidatePolling();
    });
  }

  get scope() {
    return importScope(this.fromInput(), this.toInput(), this.ratedMode());
  }

  get usable(): boolean {
    const connection = this.connection();
    return connection?.connected === true && connection.credentialState === 'usable' &&
      !connection.reconnectRequired && connection.account !== null;
  }

  async load(): Promise<void> {
    if (this.loading() || this.busy()) return;
    const generation = this.invalidatePolling();
    this.loading.set(true);
    this.error.set(null);
    this.pollingError.set(null);
    this.connection.set(null);
    this.run.set(null);
    try {
      const [connection, latest] = await Promise.allSettled([
        firstValueFrom(this.api.connection()),
        firstValueFrom(this.api.latest()),
      ]);
      if (!this.isCurrent(generation)) return;
      if (connection.status === 'fulfilled') this.connection.set(connection.value);
      else this.error.set(apiErrorMessage(connection.reason, 'Could not load the Lichess connection.'));
      if (latest.status === 'fulfilled') this.run.set(latest.value);
      else this.pollingError.set(apiErrorMessage(latest.reason, 'Could not recover recent import progress.'));
    } finally {
      if (this.isCurrent(generation)) {
        this.loading.set(false);
        this.schedulePoll();
      }
    }
  }

  async connect(): Promise<void> {
    if (this.busy() || this.loading()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const url = new URL(await firstValueFrom(this.api.start()));
      if (url.protocol !== 'https:' || url.hostname !== 'lichess.org' || url.pathname !== '/oauth') {
        throw new Error('Unsafe OAuth redirect.');
      }
      if (this.destroyed) return;
      this.document.defaultView?.location.assign(url.toString());
    } catch (error) {
      if (!this.destroyed) this.error.set(apiErrorMessage(error, 'Could not start Lichess authorization.'));
    } finally {
      if (!this.destroyed) this.busy.set(false);
    }
  }

  async disconnect(): Promise<void> {
    if (this.busy() || this.loading() || !this.connection()?.connected) return;
    if (!this.document.defaultView?.confirm(
      'Disconnect Lichess? This removes the OAuth credential, but does not delete imported games or evidence.',
    )) return;
    const generation = this.invalidatePolling();
    this.busy.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(this.api.disconnect());
      if (!this.isCurrent(generation)) return;
      // A successful DELETE is authoritative. Do not show an old usable credential if re-reading fails.
      this.connection.set(null);
      this.notice.set('Lichess disconnect completed. Imported games and evidence remain available.');
      await this.refreshConnection(generation);
    } catch (error) {
      if (this.isCurrent(generation)) this.error.set(apiErrorMessage(error, 'Could not disconnect Lichess.'));
    } finally {
      if (this.isCurrent(generation)) {
        this.busy.set(false);
        this.schedulePoll();
      }
    }
  }

  async startImport(): Promise<void> {
    if (this.busy() || this.loading() || !this.usable ||
      this.run() && isActiveImport(this.run()!.status)) return;
    const scope = this.scope;
    if (!scope.request) {
      this.error.set(scope.error);
      return;
    }
    const generation = this.invalidatePolling();
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      const run = await firstValueFrom(this.api.create(scope.request));
      if (this.isCurrent(generation)) {
        this.run.set(run);
        this.notice.set('Bounded Lichess import requested. Progress comes from the server.');
      }
    } catch (error) {
      if (!this.isCurrent(generation)) return;
      if (apiErrorCode(error) === 'ACTIVE_IMPORT') {
        await this.recoverLatest(generation);
        if (this.isCurrent(generation)) {
          if (this.run()) {
            this.notice.set('An import is already active. Recovered its server-owned progress.');
          } else {
            this.error.set('An import is already active, but progress could not be recovered. Reload to retry.');
          }
        }
      } else if (apiErrorCode(error) === 'LICHESS_RECONNECT_REQUIRED') {
        this.error.set('Lichess credentials are unavailable. Reconnect before importing.');
        await this.refreshConnection(generation);
      } else {
        this.error.set(apiErrorMessage(error, 'Could not request the Lichess import.'));
      }
    } finally {
      if (this.isCurrent(generation)) {
        this.busy.set(false);
        this.schedulePoll();
      }
    }
  }

  async cancelImport(): Promise<void> {
    const run = this.run();
    if (!run || !isActiveImport(run.status) || run.status === 'CANCEL_REQUESTED' ||
      this.busy() || this.loading()) return;
    const generation = this.invalidatePolling();
    this.busy.set(true);
    this.error.set(null);
    try {
      const refreshed = await firstValueFrom(this.api.cancel(run.id));
      if (this.isCurrent(generation)) this.run.set(refreshed);
    } catch (error) {
      if (this.isCurrent(generation)) {
        this.error.set(apiErrorMessage(error, 'Could not request cancellation.'));
        await this.recoverLatest(generation);
      }
    } finally {
      if (this.isCurrent(generation)) {
        this.busy.set(false);
        this.schedulePoll();
      }
    }
  }

  private async refreshConnection(generation: number): Promise<void> {
    try {
      const status = await firstValueFrom(this.api.connection());
      if (this.isCurrent(generation)) this.connection.set(status);
    } catch (error) {
      if (this.isCurrent(generation)) {
        this.error.set(apiErrorMessage(error, 'Could not refresh the Lichess connection.'));
      }
    }
  }

  private async recoverLatest(generation: number): Promise<void> {
    try {
      const latest = await firstValueFrom(this.api.latest());
      if (this.isCurrent(generation)) this.run.set(latest);
    } catch (error) {
      if (this.isCurrent(generation)) {
        this.pollingError.set(apiErrorMessage(error, 'Could not recover import progress.'));
      }
    }
  }

  private schedulePoll(): void {
    const run = this.run();
    if (this.destroyed || this.pollTimer || this.polling || this.loading() || this.busy() ||
      !run || !isActiveImport(run.status)) return;
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      void this.pollRun();
    }, POLL_MS);
  }

  private async pollRun(): Promise<void> {
    const run = this.run();
    if (this.destroyed || this.polling || !run || !isActiveImport(run.status) || this.busy()) return;
    const generation = this.generation;
    this.polling = true;
    try {
      const updated = await firstValueFrom(this.api.run(run.id));
      if (this.isCurrent(generation) && this.run()?.id === run.id) {
        this.run.set(updated);
        this.pollingError.set(null);
      }
    } catch (error) {
      if (this.isCurrent(generation) && this.run()?.id === run.id) {
        this.pollingError.set(apiErrorMessage(error, 'Could not refresh import progress. Retry by reloading.'));
      }
    } finally {
      this.polling = false;
      this.schedulePoll();
    }
  }

  private invalidatePolling(): number {
    this.generation += 1;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
    return this.generation;
  }

  private isCurrent(generation: number): boolean {
    return !this.destroyed && this.generation === generation;
  }
}
