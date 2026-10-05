import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Display-only interpretations of persisted Phase 5 diagnosis read-model fields.
 * None of these entries attempt to explain an individual finding's evidence grade.
 */
export const diagnosisEvidenceGuideEntries = [
  {
    label: 'Rank and score',
    description:
      'Top-level ranks order current findings by a versioned deterministic priority policy. A score is not a probability, skill rating, or proof of a cause. Supporting findings have persisted scores but no independent top-level rank.',
  },
  {
    label: 'Evidence strength',
    description:
      'Insufficient, low, medium, and high are deterministic evidence grades, not statistical significance or certainty. Grades depend on eligible supporting evidence and coverage; comparisons are limited by their weaker group and may be downgraded for concentrated evidence.',
  },
  {
    label: 'Samples, games, and sessions',
    description:
      'Samples count eligible supporting observations or events; games and sessions count distinct sources of those observations. Several samples can come from one game, so these counts are not interchangeable.',
  },
  {
    label: 'Required coverage',
    description:
      'The percentage of evidence available among the items requiring that source modality. It is not the percentage of games with this weakness. “Not recorded” means coverage is unavailable, not zero.',
  },
  {
    label: 'Measured effect',
    description:
      'The persisted raw metric, value, unit, and direction when available. It is not a forecast, independently established causal effect, or new comparison calculated by this page.',
  },
  {
    label: 'Representative evidence',
    description:
      'Up to three source references illustrate each finding; they are not the complete sample or a comparison denominator. Game links open the referenced replay position when a valid ply is available.',
  },
] as const;

@Component({
  selector: 'app-diagnosis-evidence-guide',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="evidence-guide" aria-label="Interpreting diagnosis evidence">
      <details>
        <summary>How to read this diagnosis</summary>
        <dl>
          @for (entry of entries; track entry.label) {
            <div>
              <dt>{{ entry.label }}</dt>
              <dd>{{ entry.description }}</dd>
            </div>
          }
        </dl>
      </details>
    </section>
  `,
  styles: [`
    .evidence-guide {
      border: 1px solid rgba(61, 40, 27, 0.14);
      border-radius: 14px;
      background: rgba(255, 252, 247, 0.92);
      color: #604939;
    }

    summary {
      padding: 0.9rem 1.15rem;
      cursor: pointer;
      color: #7d4b18;
      font-weight: 750;
    }

    summary:focus-visible {
      outline: 3px solid #7d4b18;
      outline-offset: 3px;
    }

    dl {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.8rem;
      margin: 0;
      padding: 0 1.15rem 1.15rem;
    }

    dl div {
      min-width: 0;
      border-top: 1px solid rgba(61, 40, 27, 0.1);
      padding-top: 0.65rem;
    }

    dt {
      margin-bottom: 0.25rem;
      font-weight: 800;
      color: #3d281b;
    }

    dd {
      margin: 0;
      line-height: 1.55;
    }

    @media (max-width: 760px) {
      dl { grid-template-columns: 1fr; }
    }
  `],
})
export class DiagnosisEvidenceGuideComponent {
  protected readonly entries = diagnosisEvidenceGuideEntries;
}
