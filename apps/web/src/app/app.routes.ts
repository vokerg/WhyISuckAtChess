import type { Routes } from '@angular/router';
import { GameReplayPageComponent } from './features/games/pages/game-replay-page.component';
import { ImportedGamesPageComponent } from './features/games/pages/imported-games-page.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'games' },
  { path: 'games', component: ImportedGamesPageComponent },
  { path: 'games/:gameId', component: GameReplayPageComponent },
  { path: '**', redirectTo: 'games' },
];
