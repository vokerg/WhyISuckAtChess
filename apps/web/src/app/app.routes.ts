import type { Routes } from '@angular/router';
import { DiagnosisDrillDownPageComponent } from './features/diagnosis/pages/diagnosis-drill-down-page.component';
import { DiagnosisSummaryPageComponent } from './features/diagnosis/pages/diagnosis-summary-page.component';
import { GameReplayPageComponent } from './features/games/pages/game-replay-page.component';
import { ImportedGamesPageComponent } from './features/games/pages/imported-games-page.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'diagnosis' },
  { path: 'diagnosis', component: DiagnosisSummaryPageComponent },
  { path: 'diagnosis/:findingId', component: DiagnosisDrillDownPageComponent },
  { path: 'games', component: ImportedGamesPageComponent },
  { path: 'games/:gameId', component: GameReplayPageComponent },
  { path: '**', redirectTo: 'diagnosis' },
];
