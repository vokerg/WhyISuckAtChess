import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ImportedGameListItem } from '@why-i-suck-at-chess/contracts';
import { firstValueFrom } from 'rxjs';
import { ImportedGamesApiService } from '../data-access/imported-games-api.service';

@Component({
  selector: 'app-imported-games-page',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './imported-games-page.component.html',
  styleUrl: './imported-games-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImportedGamesPageComponent implements OnInit {
  private readonly api = inject(ImportedGamesApiService);
  protected readonly games = signal<ImportedGameListItem[]>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  ngOnInit(): void {
    void this.load();
  }

  protected async load(cursor?: string | null): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const page = await firstValueFrom(this.api.list({ limit: 25, cursor: cursor ?? undefined }));
      this.games.update((games) => cursor ? [...games, ...page.items] : page.items);
      this.nextCursor.set(page.pageInfo.nextCursor);
    } catch (error) {
      this.error.set(readError(error, 'Could not load imported games.'));
    } finally {
      this.loading.set(false);
    }
  }

  protected loadMore(): void {
    const cursor = this.nextCursor();
    if (cursor && !this.loading()) void this.load(cursor);
  }

  protected resultLabel(game: ImportedGameListItem): string {
    return game.resultForUser ?? 'Result unavailable';
  }
}

function readError(error: unknown, fallback: string): string {
  if (typeof error !== 'object' || error === null) return fallback;
  const value = error as { error?: { error?: string; message?: string }; message?: string };
  return value.error?.message ?? value.error?.error ?? value.message ?? fallback;
}
