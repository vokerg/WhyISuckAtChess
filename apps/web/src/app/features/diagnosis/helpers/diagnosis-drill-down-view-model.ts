import type {
  DiagnosisDrillDownResponse,
  DiagnosisDrillDownSupportRole,
} from '@why-i-suck-at-chess/contracts';
import { diagnosisUnavailableMessage } from './diagnosis-summary-view-model';

export function diagnosisFindingHref(findingId: number): string | null {
  return Number.isSafeInteger(findingId) && findingId > 0
    ? `/diagnosis/${findingId}`
    : null;
}

export function parseDiagnosisFindingId(raw: string | null): number | null {
  if (!raw || !/^[1-9][0-9]*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

export function diagnosisSupportRoleLabel(role: DiagnosisDrillDownSupportRole): string {
  switch (role) {
    case 'MECHANISM':
      return 'Supporting mechanism';
    case 'CONDITION_OR_OBSERVATION':
      return 'Condition or observation';
    case 'ADDITIONAL_SUPPORT':
      return 'Additional support';
  }
}

export function diagnosisDrillDownUnavailableMessage(
  reason: Extract<DiagnosisDrillDownResponse, { status: 'UNAVAILABLE' }>['reason'],
): string {
  if (reason === 'FINDING_NOT_FOUND') {
    return 'This finding is not in the current ranked diagnosis. Return to the summary to select a current weakness.';
  }
  return diagnosisUnavailableMessage(reason);
}
