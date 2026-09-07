import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: `
    <main class="shell">
      <p class="eyebrow">Why I Suck at Chess</p>
      <h1>Evidence first. Diagnosis later.</h1>
      <p>The application workspace is ready for the Lichess ingestion and analysis pipeline.</p>
      <router-outlet />
    </main>
  `,
})
export class AppComponent {}
