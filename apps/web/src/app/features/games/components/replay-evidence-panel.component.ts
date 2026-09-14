import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import type { ImportedGamePly } from '@why-i-suck-at-chess/contracts';
import type {
  ReplayEvidenceCoverageSummary,
  ReplayEvidenceSelection,
} from '../state/game-replay.store';

@Component({
  selector: 'app-replay-evidence-panel',
  standalone: true,
  templateUrl: './replay-evidence-panel.component.html',
  styleUrl: './replay-evidence-panel.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReplayEvidencePanelComponent {
  @Input({ required: true }) events: ReplayEvidenceSelection[] = [];
  @Input({ required: true }) coverage: ReplayEvidenceCoverageSummary = {
    status: 'NO_RUNS',
    reason: null,
    completeRuns: 0,
    totalRuns: 0,
  };
  @Input() hasSelectedPly = false;
  @Input() missingEventKeys: string[] = [];
  @Input() annotations: ImportedGamePly['annotations'] = [];

  protected measurementEntries(selection: ReplayEvidenceSelection): [string, unknown][] {
    return selection.event.payload.kind === 'KNOWN'
      ? Object.entries(selection.event.payload.measurements)
      : [];
  }

  protected formatMeasurementKey(key: string): string {
    const spaced = key
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .trim();
    return spaced.length > 0 ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : key;
  }

  protected formatMeasurement(value: unknown): string {
    if (value === null) return 'null';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value) ?? String(value);
  }

  protected sourceText(selection: ReplayEvidenceSelection): string {
    const { startPly, endPly, positionId } = selection.event.source;
    const parts: string[] = [];
    if (startPly !== null && endPly !== null) {
      parts.push(startPly === endPly ? 'Ply ' + startPly : 'Plies ' + startPly + '–' + endPly);
    } else if (startPly !== null) {
      parts.push('From ply ' + startPly);
    } else if (endPly !== null) {
      parts.push('Through ply ' + endPly);
    }
    if (positionId !== null) parts.push('position ' + positionId);
    return parts.length > 0 ? parts.join(' · ') : 'Source position unavailable';
  }

  protected coverageText(): string {
    if (this.coverage.status === 'NO_RUNS') return 'No evidence runs available';
    return (
      this.coverage.completeRuns +
      '/' +
      this.coverage.totalRuns +
      ' detector runs complete · ' +
      this.coverage.status
    );
  }
}
