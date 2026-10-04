import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type {
  DiagnosisSummaryItem,
  DiagnosisSummaryRepresentativeEvidence,
  DiagnosisSummaryResponse,
} from '@why-i-suck-at-chess/contracts';
import { firstValueFrom } from 'rxjs';
import { DiagnosisSummaryApiService } from '../data-access/diagnosis-summary-api.service';
import { diagnosisFindingHref } from '../helpers/diagnosis-drill-down-view-model';
import {
  diagnosisClaimLabel,
  diagnosisCoverageLabel,
  diagnosisEffectLabel,
  diagnosisEvidenceHref,
  diagnosisEvidenceLabel,
  diagnosisScoreLabel,
  diagnosisTitle,
  diagnosisUnavailableMessage,
} from '../helpers/diagnosis-summary-view-model';

@Component({
  selector: 'app-diagnosis-summary-page',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './diagnosis-summary-page.component.html',
  styleUrl: './diagnosis-summary-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiagnosisSummaryPageComponent implements OnInit {
  private readonly api = inject(DiagnosisSummaryApiService);

  protected readonly summary = signal<DiagnosisSummaryResponse | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly available = computed(() => {
    const summary = this.summary();
    return summary?.status === 'AVAILABLE' ? summary : null;
  });

  protected readonly findingHrefFor = diagnosisFindingHref;
  protected readonly titleFor = diagnosisTitle;
  protected readonly claimFor = diagnosisClaimLabel;
  protected readonly coverageFor = diagnosisCoverageLabel;
  protected readonly effectFor = diagnosisEffectLabel;
  protected readonly evidenceHrefFor = diagnosisEvidenceHref;
  protected readonly evidenceLabelFor = diagnosisEvidenceLabel;
  protected readonly scoreFor = diagnosisScoreLabel;
  protected readonly unavailableMessageFor = diagnosisUnavailableMessage;

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.summary.set(await firstValueFrom(this.api.getSummary('overall')));
    } catch (error) {
      this.summary.set(null);
      this.error.set(readError(error, 'Could not load the diagnosis summary.'));
    } finally {
      this.loading.set(false);
    }
  }

  protected trackFinding(_: number, item: DiagnosisSummaryItem): number {
    return item.findingId;
  }

  protected trackEvidence(_: number, evidence: DiagnosisSummaryRepresentativeEvidence): string {
    return evidence.referenceKey;
  }
}

function readError(error: unknown, fallback: string): string {
  if (typeof error !== 'object' || error === null) return fallback;
  const value = error as { error?: { error?: string; message?: string }; message?: string };
  return value.error?.message ?? value.error?.error ?? value.message ?? fallback;
}
