import type {
  DiagnosisSummaryItem,
  DiagnosisSummaryRepresentativeEvidence,
  DiagnosisSummaryResponse,
} from '@why-i-suck-at-chess/contracts';

const DIAGNOSIS_LABELS: Readonly<Record<string, string>> = {
  'TIME-001': 'Frequent time-pressure exposure',
  'TIME-002': 'Move quality collapses under time pressure',
  'TIME-003': 'Playing too fast with time available',
  'TIME-004': 'Using too much time early',
  'TIME-005': 'Underperforming in a specific time control',
  'TIME-006': 'Performing differently with increment',
  'TIME-007': 'Opponent move speed affects your decisions',
  'RATING-001': 'Performance changes with opponent strength',
  'RATING-002': 'Rating context may affect the comparison',
  'SESSION-001': 'Move quality deteriorates later in sessions',
  'SESSION-002': 'Performance deteriorates after consecutive losses',
  'SESSION-003': 'Longer sessions have a measurable stopping point',
  CLOCK_MANAGEMENT_DRIVING_TACTICAL_COLLAPSE: 'Clock management is driving tactical collapse',
};

export function diagnosisTitle(item: DiagnosisSummaryItem): string {
  return DIAGNOSIS_LABELS[item.diagnosisId] ?? humanize(item.diagnosisId);
}

export function diagnosisClaimLabel(item: DiagnosisSummaryItem): string {
  return humanize(item.claimKey.replace(/^[^.]+\./, ''));
}

export function diagnosisUnavailableMessage(
  reason: Extract<DiagnosisSummaryResponse, { status: 'UNAVAILABLE' }>['reason'],
): string {
  switch (reason) {
    case 'NO_CURRENT_DIAGNOSIS':
      return 'No current diagnosis is available yet. Import and analyse enough games to build the first evidence-backed summary.';
    case 'HIERARCHY_INCOMPLETE':
      return 'The current diagnosis is still being consolidated into a stable hierarchy. Partial findings are not shown.';
    case 'RANKING_INCOMPLETE':
      return 'The current diagnosis does not yet have a complete persisted ranking. Partial ordering is not shown.';
    case 'RANKING_STALE':
      return 'The current diagnosis was produced by an older policy generation and must be recalculated before it is shown.';
  }
}

export function diagnosisScoreLabel(score: number): string {
  return score.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

export function diagnosisCoverageLabel(value: number | null): string {
  return value === null ? 'Not recorded' : `${Math.round(value * 100)}%`;
}

export function diagnosisEffectLabel(item: DiagnosisSummaryItem): string | null {
  if (!item.effect) return null;
  return [
    humanize(item.effect.metric),
    formatNumber(item.effect.value),
    humanize(item.effect.unit),
    `(${humanize(item.effect.direction).toLowerCase()})`,
  ].join(' · ');
}

export function diagnosisEvidenceHref(
  evidence: DiagnosisSummaryRepresentativeEvidence,
): string | null {
  return evidence.importedGameId === null ? null : `/games/${evidence.importedGameId}`;
}

export function diagnosisEvidenceLabel(
  evidence: DiagnosisSummaryRepresentativeEvidence,
): string {
  const location = evidence.sourcePlyStart === null
    ? null
    : evidence.sourcePlyEnd !== null && evidence.sourcePlyEnd !== evidence.sourcePlyStart
      ? `plies ${evidence.sourcePlyStart}–${evidence.sourcePlyEnd}`
      : `ply ${evidence.sourcePlyStart}`;
  const source = evidence.importedGameId === null
    ? humanize(evidence.referenceType)
    : `Game ${evidence.importedGameId}`;
  return location ? `${source} · ${location}` : source;
}

function humanize(value: string): string {
  const normalized = value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return normalized.replace(/^./, (letter) => letter.toUpperCase());
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}
