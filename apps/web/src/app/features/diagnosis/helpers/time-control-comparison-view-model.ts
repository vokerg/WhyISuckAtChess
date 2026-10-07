type RatingDisclosure = {
  status: 'AVAILABLE' | 'UNAVAILABLE';
  reason: string | null;
  materialCompositionWarning: boolean | null;
};

type CollectionMeta = {
  total: number;
  returned: number;
  truncated: boolean;
};

export function formatInitialSeconds(initialSeconds: number): string {
  if (initialSeconds < 60) return `${initialSeconds}s`;
  const minutes = initialSeconds / 60;
  return Number.isInteger(minutes) ? String(minutes) : String(Number(minutes.toFixed(1)));
}

export function exactTimeControlLabel(initialSeconds: number, incrementSeconds: number): string {
  return `${formatInitialSeconds(initialSeconds)}+${incrementSeconds}`;
}

export function percentageLabel(value: number | null): string {
  if (value === null) return '—';
  return `${trimNumber(value)}%`;
}

export function numberLabel(value: number | null, suffix = ''): string {
  if (value === null) return '—';
  return `${trimNumber(value)}${suffix}`;
}

export function signedDeltaLabel(value: number | null, suffix: string): string {
  if (value === null) return '—';
  if (value === 0) return `0 ${suffix}`;
  const sign = value > 0 ? '+' : '−';
  return `${sign}${trimNumber(Math.abs(value))} ${suffix}`;
}

export function coverageStatusLabel(status: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE'): string {
  if (status === 'COMPLETE') return 'Complete coverage';
  if (status === 'PARTIAL') return 'Partial coverage';
  return 'Coverage unavailable';
}

export function scopeLabel(scope: { from: string | null; to: string | null }): string {
  if (!scope.from && !scope.to) return 'All available imported history';
  if (scope.from && scope.to) return `${scope.from} ≤ game start < ${scope.to}`;
  if (scope.from) return `Game start ≥ ${scope.from}`;
  return `Game start < ${scope.to}`;
}

export function ratingCompositionLabel(disclosure: RatingDisclosure): string {
  if (disclosure.status === 'UNAVAILABLE') {
    return disclosure.reason
      ? `Opponent-rating composition unavailable: ${disclosure.reason}.`
      : 'Opponent-rating composition unavailable.';
  }
  if (disclosure.materialCompositionWarning === true) {
    return 'Material opponent-strength composition difference detected; interpret the raw comparison with caution.';
  }
  if (disclosure.materialCompositionWarning === false) {
    return 'No material opponent-strength composition warning was detected.';
  }
  return 'Opponent-rating composition was available without a material-warning result.';
}

export function collectionMetaLabel(meta: CollectionMeta, noun: string): string {
  const base = `${meta.returned} of ${meta.total} ${noun}`;
  return meta.truncated ? `${base} shown (response capped)` : `${base} shown`;
}

function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(1)));
}
