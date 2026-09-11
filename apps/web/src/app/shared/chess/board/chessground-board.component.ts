import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostBinding,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { Chess } from 'chess.js';
import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { Config } from '@lichess-org/chessground/config';
import type { Color, Key } from '@lichess-org/chessground/types';

export interface BoardEvidenceAnnotation {
  kind: string;
  label: string;
  severity?: 'INFO' | 'WARNING' | 'CRITICAL';
}

@Component({
  selector: 'app-chessground-board',
  standalone: true,
  template: `
    <div class="board-shell" [attr.data-evidence-count]="evidenceAnnotations.length">
      <div #board class="chessground-board"></div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      width: min(100%, 560px);
      min-width: 0;
      aspect-ratio: 1 / 1;
    }

    .board-shell {
      width: 100%;
      height: 100%;
      padding: 4px;
      border-radius: 12px;
      box-sizing: border-box;
      background: #3d281b;
      box-shadow: 0 18px 38px rgba(49, 31, 18, 0.25);
    }

    .chessground-board {
      width: 100%;
      height: 100%;
      overflow: hidden;
      border-radius: 8px;
    }

    :host ::ng-deep cg-board {
      background-color: #edd9b7;
      background-image: conic-gradient(
        #9d6b42 25%,
        #edd9b7 0 50%,
        #9d6b42 0 75%,
        #edd9b7 0
      );
      background-size: 25% 25%;
    }

    :host ::ng-deep cg-board square.last-move {
      background-color: rgba(245, 207, 87, 0.58);
    }

    :host ::ng-deep cg-board square.selected {
      background-color: rgba(47, 88, 54, 0.45);
    }

    :host ::ng-deep cg-board square.move-dest {
      background: radial-gradient(rgba(41, 72, 45, 0.55) 22%, transparent 24%);
    }

    :host ::ng-deep .orientation-white .ranks :nth-child(odd),
    :host ::ng-deep .orientation-white .files :nth-child(even),
    :host ::ng-deep .orientation-black .ranks :nth-child(even),
    :host ::ng-deep .orientation-black .files :nth-child(odd) {
      color: rgba(76, 47, 29, 0.86);
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChessgroundBoardComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() fen = '';
  @Input() side: 'WHITE' | 'BLACK' = 'WHITE';
  @Input() lastMove: { from: string; to: string } | null = null;
  @Input() arrows: Array<{ from: string; to: string; brush?: string }> = [];
  @Input() evidenceAnnotations: BoardEvidenceAnnotation[] = [];
  @Input() positionVersion = 0;
  @Input() movable = false;

  @ViewChild('board', { static: true }) boardElement!: ElementRef<HTMLElement>;
  @HostBinding('attr.data-side') get boardSide(): string {
    return this.side.toLowerCase();
  }

  private ground: Api | null = null;
  private game = new Chess();

  ngAfterViewInit(): void {
    this.game = this.createGame(this.fen);
    this.ground = Chessground(this.boardElement.nativeElement, this.config());
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.ground) return;
    if (changes['fen'] || changes['side'] || changes['positionVersion']) {
      this.game = this.createGame(this.fen);
      this.ground.set(this.config());
      return;
    }
    if (changes['lastMove'] || changes['arrows'] || changes['movable'] || changes['evidenceAnnotations']) {
      this.ground.set(this.config());
    }
  }

  ngOnDestroy(): void {
    this.ground?.destroy?.();
    this.ground = null;
  }

  private createGame(fen: string): Chess {
    try {
      return fen && fen !== 'startpos' ? new Chess(fen) : new Chess();
    } catch {
      return new Chess();
    }
  }

  private config(): Config {
    const turnColor: Color = this.game.turn() === 'w' ? 'white' : 'black';
    return {
      fen: this.game.fen(),
      orientation: this.side === 'WHITE' ? 'white' : 'black',
      coordinates: true,
      turnColor,
      highlight: { lastMove: true, check: true },
      lastMove: this.lastMove ? [this.lastMove.from as Key, this.lastMove.to as Key] : undefined,
      drawable: {
        enabled: true,
        visible: true,
        autoShapes: this.arrows
          .filter((arrow) => arrow.from && arrow.to)
          .map((arrow) => ({
            orig: arrow.from as Key,
            dest: arrow.to as Key,
            brush: arrow.brush ?? 'green',
          })) as any,
      },
      movable: {
        free: false,
        color: this.movable ? turnColor : undefined,
        dests: new Map(),
        showDests: false,
      },
      draggable: { enabled: false },
      selectable: { enabled: false },
      animation: { enabled: true, duration: 160 },
    };
  }
}
