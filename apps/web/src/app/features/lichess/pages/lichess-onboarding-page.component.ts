import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  callbackDescription,
  credentialDescription,
  isActiveImport,
  safeImportError,
  type RatedMode,
} from '../helpers/lichess-onboarding-view-model';
import { LichessOnboardingStore } from '../state/lichess-onboarding.store';

@Component({
  selector: 'app-lichess-onboarding-page',
  standalone: true,
  imports: [RouterLink],
  providers: [LichessOnboardingStore],
  templateUrl: './lichess-onboarding-page.component.html',
  styleUrl: './lichess-onboarding-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LichessOnboardingPageComponent implements OnInit {
  protected readonly store = inject(LichessOnboardingStore);
  private readonly route = inject(ActivatedRoute);
  protected readonly callbackNotice = callbackDescription(
    this.route.snapshot.queryParamMap.get('lichessConnected'),
  );
  protected readonly credentialDescription = credentialDescription;
  protected readonly isActiveImport = isActiveImport;
  protected readonly safeImportError = safeImportError;

  ngOnInit(): void {
    void this.store.load();
  }

  protected setRatedMode(value: string): void {
    if (value === 'any' || value === 'rated' || value === 'casual') {
      this.store.ratedMode.set(value as RatedMode);
    }
  }
}
