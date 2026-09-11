import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  OnInit,
  inject,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { distinctUntilChanged, map } from 'rxjs';
import { ChessgroundBoardComponent } from '../../../shared/chess/board/chessground-board.component';
import { GameReplayStore } from '../state/game-replay.store';

@Component({
  selector: 'app-game-replay-page',
  standalone: true,
  imports: [ChessgroundBoardComponent, RouterLink],
  providers: [GameReplayStore],
  templateUrl: './game-replay-page.component.html',
  styleUrl: './game-replay-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GameReplayPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  protected readonly store = inject(GameReplayStore);

  ngOnInit(): void {
    this.route.paramMap
      .pipe(
        map((params) => Number(params.get('gameId'))),
        distinctUntilChanged(),
      )
      .subscribe((gameId) => this.store.initialize(gameId));
  }

  @HostListener('window:keydown', ['$event'])
  protected onKeyDown(event: KeyboardEvent): void {
    this.store.handleKeyboard(event);
  }

  protected formatClock(centiseconds: number | null): string {
    if (centiseconds === null) return 'Unavailable';
    const seconds = Math.max(0, centiseconds) / 100;
    if (seconds < 60) return `${seconds.toFixed(2)}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  }

  protected formatMove(plyNumber: number): string {
    return `${Math.ceil(plyNumber / 2)}${plyNumber % 2 === 1 ? '.' : '...'}`;
  }

  protected timingText(ply: NonNullable<ReturnType<GameReplayStore['currentPly']>>): string {
    if (ply.timing.status === 'AVAILABLE') {
      return `${this.formatClock(ply.timing.moveTimeCentiseconds)} think time`;
    }
    return `Unavailable${ply.timing.unavailableReason ? ` · ${ply.timing.unavailableReason}` : ''}`;
  }
}
