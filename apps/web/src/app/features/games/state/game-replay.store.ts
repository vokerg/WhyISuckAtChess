import { computed, inject, Injectable, signal } from '@angular/core';
import type { ImportedGamePly, ImportedGameReplay } from '@why-i-suck-at-chess/contracts';
import { firstValueFrom } from 'rxjs';
import { ImportedGamesApiService } from '../data-access/imported-games-api.service';
import { ReplayStepper } from './replay-stepper';

@Injectable()
export class GameReplayStore {
  private readonly api = inject(ImportedGamesApiService);
  private readonly stepper = new ReplayStepper();
  private readonly gameId = signal<number | null>(null);

  readonly replay = signal<ImportedGameReplay | null>(null);
  readonly currentPlyNumber = signal(0);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly totalPlies = computed(() => this.replay()?.plies.length ?? 0);

  readonly currentPly = computed<ImportedGamePly | null>(() => {
    const plyNumber = this.currentPlyNumber();
    return plyNumber > 0 ? this.replay()?.plies[plyNumber - 1] ?? null : null;
  });
  readonly currentFen = computed(() => {
    const game = this.replay();
    return this.currentPly()?.afterPosition.normalizedFen
      ?? game?.plies[0]?.beforePosition.normalizedFen
      ?? 'startpos';
  });
  readonly lastMove = computed<{ from: string; to: string } | null>(() => {
    const moveUci = this.currentPly()?.moveUci;
    return moveUci && moveUci.length >= 4
      ? { from: moveUci.slice(0, 2), to: moveUci.slice(2, 4) }
      : null;
  });
  readonly canGoBackward = computed(() => this.currentPlyNumber() > 0);
  readonly canGoForward = computed(() => this.currentPlyNumber() < this.totalPlies());
  readonly blackPerspective = computed(() => this.replay()?.userColor === 'BLACK');
  readonly gameTitle = computed(() => {
    const game = this.replay();
    if (!game) return 'Imported game';
    return `${game.white.username ?? 'White'} vs ${game.black.username ?? 'Black'}`;
  });

  private loadGeneration = 0;

  initialize(gameId: number): void {
    const generation = ++this.loadGeneration;
    if (!Number.isInteger(gameId) || gameId <= 0) {
      this.gameId.set(null);
      this.replay.set(null);
      this.stepper.setTotalPlies(0);
      this.setCurrentPly(0);
      this.error.set('Invalid imported game id.');
      this.loading.set(false);
      return;
    }
    this.gameId.set(gameId);
    void this.load(generation);
  }

  async load(generation = this.loadGeneration): Promise<void> {
    const gameId = this.gameId();
    if (!gameId) return;

    this.loading.set(true);
    this.error.set(null);
    this.replay.set(null);
    this.stepper.setTotalPlies(0);
    this.setCurrentPly(0);
    try {
      const replay = await firstValueFrom(this.api.getReplay(gameId));
      if (generation !== this.loadGeneration || gameId !== this.gameId()) return;
      this.replay.set(replay);
      this.stepper.setTotalPlies(replay.plies.length);
      this.setCurrentPly(this.stepper.goToStart());
    } catch (error) {
      if (generation === this.loadGeneration && gameId === this.gameId()) {
        this.error.set(readError(error, 'Could not load imported game replay.'));
      }
    } finally {
      if (generation === this.loadGeneration && gameId === this.gameId()) {
        this.loading.set(false);
      }
    }
  }

  selectPly(plyNumber: number): void {
    this.setCurrentPly(this.stepper.select(plyNumber));
  }

  goToStart(): void {
    this.setCurrentPly(this.stepper.goToStart());
  }

  goToPrevious(): void {
    this.setCurrentPly(this.stepper.goToPrevious());
  }

  goToNext(): void {
    this.setCurrentPly(this.stepper.goToNext());
  }

  goToEnd(): void {
    this.setCurrentPly(this.stepper.goToEnd());
  }

  handleKeyboard(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const tagName = target?.tagName?.toLowerCase();
    if (target?.isContentEditable || (tagName && ['input', 'textarea', 'select'].includes(tagName))) {
      return;
    }

    const actions: Record<string, () => void> = {
      ArrowLeft: () => this.goToPrevious(),
      ArrowRight: () => this.goToNext(),
      Home: () => this.goToStart(),
      End: () => this.goToEnd(),
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  }

  private setCurrentPly(plyNumber: number): void {
    this.currentPlyNumber.set(plyNumber);
  }
}

function readError(error: unknown, fallback: string): string {
  if (typeof error !== 'object' || error === null) return fallback;
  const value = error as { error?: { error?: string; message?: string }; message?: string };
  return value.error?.message ?? value.error?.error ?? value.message ?? fallback;
}
