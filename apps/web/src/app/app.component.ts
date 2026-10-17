import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <a class="skip-link" href="#main-content">Skip to content</a>
    <header class="site-header">
      <div class="site-header-inner">
        <a class="brand" routerLink="/diagnosis" aria-label="Why I Suck at Chess home">
          <span class="brand-piece" aria-hidden="true">♞</span>
          <span>Why I Suck at Chess</span>
        </a>
        <nav class="site-nav" aria-label="Main navigation">
          <a routerLink="/diagnosis" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }" ariaCurrentWhenActive="page">Diagnosis</a>
          <a routerLink="/games" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: false }" ariaCurrentWhenActive="page">Games</a>
          <a routerLink="/diagnosis/time-controls" routerLinkActive="active" ariaCurrentWhenActive="page">Time controls</a>
          <a routerLink="/settings/lichess" routerLinkActive="active" ariaCurrentWhenActive="page">Lichess</a>
        </nav>
      </div>
    </header>
    <router-outlet />
  `,
  styles: [`
    :host { display: block; min-height: 100vh; }
    .skip-link {
      position: absolute; top: -8rem; left: 1rem; z-index: 100;
      padding: .6rem .9rem; background: #fff; color: #214333;
    }
    .skip-link:focus { top: .75rem; }
    .site-header { background: #fff; border-bottom: 1px solid #e0e5de; }
    .site-header-inner {
      max-width: 1180px; margin: auto; padding: 0 1rem;
      min-height: 68px; display: flex; align-items: center;
      justify-content: space-between; flex-wrap: wrap; gap: .4rem 1.75rem;
    }
    .brand {
      display: inline-flex; gap: .6rem; align-items: center;
      color: #2b302b; text-decoration: none; font-weight: 750;
      letter-spacing: -.025em; white-space: nowrap;
    }
    .brand-piece { font-size: 1.6rem; font-weight: 400; color: #315a47; line-height: 1; }
    .site-nav { display: flex; align-items: center; flex-wrap: wrap; gap: .1rem .3rem; }
    .site-nav a {
      display: inline-block; padding: .55rem .8rem; border-radius: 6px;
      text-decoration: none; color: #59675e; font-size: .91rem; font-weight: 550;
    }
    .site-nav a:hover { background: #f4f6f3; color: #2b302b; }
    .site-nav a.active { background: #eaf1eb; color: #214333; font-weight: 750; }
    @media (max-width: 680px) {
      .site-header-inner { padding: .85rem 1rem .65rem; }
      .site-nav { width: 100%; overflow-x: auto; flex-wrap: nowrap; }
      .site-nav a { white-space: nowrap; padding: .4rem .65rem; }
    }
  `],
})
export class AppComponent {}
