import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { TimeControlComparisonResponse } from '@why-i-suck-at-chess/contracts';
import { firstValueFrom } from 'rxjs';
import { TimeControlComparisonApiService } from '../data-access/time-control-comparison-api.service';
import {
  collectionMetaLabel,
  coverageStatusLabel,
  exactTimeControlLabel,
  formatInitialSeconds,
  numberLabel,
  percentageLabel,
  ratingCompositionLabel,
  scopeLabel,
  signedDeltaLabel,
} from '../helpers/time-control-comparison-view-model';

type ExactComparison = TimeControlComparisonResponse['exactControl']['comparisons'][number];
type IncrementStratum = TimeControlComparisonResponse['incrementEffect']['strata'][number];
type IncrementArm = IncrementStratum['increment'];

@Component({
  selector: 'app-time-control-comparison-page',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './time-control-comparison-page.component.html',
  styleUrl: './time-control-comparison-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TimeControlComparisonPageComponent implements OnInit {
  private readonly api = inject(TimeControlComparisonApiService);

  protected readonly comparison = signal<TimeControlComparisonResponse | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly exactLabel = exactTimeControlLabel;
  protected readonly initialLabel = formatInitialSeconds;
  protected readonly percent = percentageLabel;
  protected readonly number = numberLabel;
  protected readonly delta = signedDeltaLabel;
  protected readonly coverageLabel = coverageStatusLabel;
  protected readonly scopeFor = scopeLabel;
  protected readonly compositionLabel = ratingCompositionLabel;
  protected readonly collectionLabel = collectionMetaLabel;

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.comparison.set(await firstValueFrom(this.api.getComparisons()));
    } catch (error) {
      this.comparison.set(null);
      this.error.set(readError(error, 'Could not load time-control comparisons.'));
    } finally {
      this.loading.set(false);
    }
  }

  protected trackExact(_: number, item: ExactComparison): string {
    return `${item.target.exactTimeControlKey}:${item.comparator?.exactTimeControlKey ?? 'none'}`;
  }

  protected trackStratum(_: number, item: IncrementStratum): number {
    return item.initialSeconds;
  }

  protected incrementControls(arm: IncrementArm, initialSeconds: number): string {
    if (arm.exactControls.items.length === 0) return 'No exact controls returned';
    const labels = arm.exactControls.items.map((control) =>
      `${exactTimeControlLabel(initialSeconds, control.incrementSeconds)} (${control.games})`,
    );
    const suffix = arm.exactControls.truncated
      ? ` · ${arm.exactControls.returned} of ${arm.exactControls.total} controls shown`
      : '';
    return labels.join(', ') + suffix;
  }
}

function readError(error: unknown, fallback: string): string {
  if (typeof error !== 'object' || error === null) return fallback;
  const value = error as { error?: { error?: string; message?: string }; message?: string };
  return value.error?.message ?? value.error?.error ?? value.message ?? fallback;
}
