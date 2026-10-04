import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type {
  DiagnosisDrillDownResponse,
  DiagnosisSummaryRepresentativeEvidence,
} from '@why-i-suck-at-chess/contracts';
import { distinctUntilChanged, firstValueFrom, map } from 'rxjs';
import { DiagnosisDrillDownApiService } from '../data-access/diagnosis-drill-down-api.service';
import {
  diagnosisDrillDownUnavailableMessage,
  diagnosisSupportRoleLabel,
  parseDiagnosisFindingId,
} from '../helpers/diagnosis-drill-down-view-model';
import {
  diagnosisClaimLabel,
  diagnosisCoverageLabel,
  diagnosisEffectLabel,
  diagnosisEvidenceHref,
  diagnosisEvidenceLabel,
  diagnosisEvidenceQueryParams,
  diagnosisScoreLabel,
  diagnosisTitle,
} from '../helpers/diagnosis-summary-view-model';

@Component({
  selector: 'app-diagnosis-drill-down-page',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './diagnosis-drill-down-page.component.html',
  styleUrls: [
    './diagnosis-summary-page.component.css',
    './diagnosis-drill-down-page.component.css',
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiagnosisDrillDownPageComponent implements OnInit {
  private readonly api = inject(DiagnosisDrillDownApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private requestId = 0;

  protected readonly selectedFindingId = signal<number | null>(null);
  protected readonly detail = signal<DiagnosisDrillDownResponse | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly available = computed(() => {
    const response = this.detail();
    return response?.status === 'AVAILABLE' ? response : null;
  });

  protected readonly titleFor = diagnosisTitle;
  protected readonly claimFor = diagnosisClaimLabel;
  protected readonly coverageFor = diagnosisCoverageLabel;
  protected readonly effectFor = diagnosisEffectLabel;
  protected readonly evidenceHrefFor = diagnosisEvidenceHref;
  protected readonly evidenceQueryFor = diagnosisEvidenceQueryParams;
  protected readonly evidenceLabelFor = diagnosisEvidenceLabel;
  protected readonly scoreFor = diagnosisScoreLabel;
  protected readonly roleFor = diagnosisSupportRoleLabel;
  protected readonly unavailableMessageFor = diagnosisDrillDownUnavailableMessage;

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => { this.requestId += 1; });
    this.route.paramMap.pipe(
      map((params) => parseDiagnosisFindingId(params.get('findingId'))),
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((findingId) => {
      this.selectedFindingId.set(findingId);
      void this.load();
    });
  }

  protected async load(): Promise<void> {
    const requestId = ++this.requestId;
    const findingId = this.selectedFindingId();
    this.detail.set(null);
    this.error.set(null);

    if (findingId === null) {
      this.loading.set(false);
      this.error.set('Invalid finding ID. Open a finding from the current diagnosis summary.');
      return;
    }

    this.loading.set(true);
    try {
      const response = await firstValueFrom(this.api.getFinding(findingId));
      if (requestId === this.requestId) this.detail.set(response);
    } catch (error) {
      if (requestId === this.requestId) {
        this.error.set(readError(error, 'Could not load the selected diagnosis.'));
      }
    } finally {
      if (requestId === this.requestId) this.loading.set(false);
    }
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
