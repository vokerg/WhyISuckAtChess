export const CLOCK_ALIGNMENT_VERSION = 1;
export const TIMING_DERIVATION_VERSION = 1;

export const STANDARD_IMPORTED_GAME_SPEEDS = ['bullet', 'blitz', 'rapid'] as const;
export const STANDARD_IMPORTED_GAME_VARIANTS = ['chess', 'standard'] as const;

export type ClockAlignmentStatus = 'COMPLETE' | 'UNAVAILABLE' | 'UNALIGNED' | 'ANOMALOUS';
export type TimingDerivationStatus = 'AVAILABLE' | 'UNAVAILABLE' | 'INCONSISTENT' | 'UNSUPPORTED';
export type TimingCoverageStatus = 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';
export type ChessColor = 'WHITE' | 'BLACK';

export interface RawClockState {
  sourceOrdinal: number;
  valueCentiseconds: number;
}

export interface AlignedClockFact extends RawClockState {
  plyNumber: number;
  semantics: 'POST_MOVE_REMAINING';
  alignmentVersion: number;
}

export interface TerminalClockFact extends RawClockState {
  activeColor: ChessColor;
  semantics: 'TERMINAL_ACTIVE_TURN_REMAINING';
  alignmentVersion: number;
}

export interface ClockAlignmentResult {
  status: ClockAlignmentStatus;
  reason?: string;
  aligned: AlignedClockFact[];
  terminal?: TerminalClockFact;
}

export interface TimingContext {
  moveCount: number;
  variant?: string | null;
  speedCategory?: string | null;
  provider?: string | null;
  source?: string | null;
  status?: string | null;
  incrementSeconds?: number | null;
  playerClockModifierUnresolved?: boolean;
  allowsExternalClockAdjustments?: boolean;
}

export interface DerivedPlyTiming {
  plyNumber: number;
  derivationVersion: number;
  sourceClockAfterCentiseconds: number | null;
  clockBeforeMoveCentiseconds: number | null;
  effectiveIncrementCentiseconds: number | null;
  clockDeltaMoveTimeCentiseconds: number | null;
  beforeClockProvenance: 'PREVIOUS_SAME_SIDE_SOURCE' | 'UNAVAILABLE';
  incrementProvenance: 'GAME_CONTROL' | 'FINAL_MOVE_NO_INCREMENT' | 'UNAVAILABLE';
  derivationStatus: TimingDerivationStatus;
  reliabilityFlags: string[];
  unavailableReason: string | null;
}

const SPEED_SET = new Set<string>(STANDARD_IMPORTED_GAME_SPEEDS);
const VARIANT_SET = new Set<string>(STANDARD_IMPORTED_GAME_VARIANTS);
const DIRECT_MOVE_END_STATUSES = new Set(['mate', 'stalemate', 'variantend']);
const TERMINAL_EXTRA_STATUSES = new Set([
  'timeout',
  'outoftime',
  'resign',
  'draw',
  'aborted',
  'cheat',
  'nostart',
  'unknownfinish',
]);

function normalized(value: string | null | undefined): string | null {
  const result = value?.trim().toLowerCase();
  return result ? result : null;
}

export function isStandardImportedGameVariant(variant: string | null | undefined): boolean {
  const value = normalized(variant);
  return value === null || VARIANT_SET.has(value);
}

export function isStandardImportedGameSpeed(speedCategory: string | null | undefined): boolean {
  const value = normalized(speedCategory);
  return value !== null && SPEED_SET.has(value);
}

export function isTimingEligibleGame(input: Pick<TimingContext, 'variant' | 'speedCategory'>): boolean {
  return isStandardImportedGameVariant(input.variant) && isStandardImportedGameSpeed(input.speedCategory);
}

function isDirectMoveEndStatus(status: string | null | undefined): boolean {
  const value = normalized(status)?.replace(/[_\s-]/g, '');
  return typeof value === 'string' && DIRECT_MOVE_END_STATUSES.has(value);
}

function isClassifiableTerminalExtra(input: {
  provider?: string | null;
  status?: string | null;
}): boolean {
  if (normalized(input.provider) !== 'lichess') return false;
  const status = normalized(input.status)?.replace(/[_\s-]/g, '');
  return typeof status === 'string' && TERMINAL_EXTRA_STATUSES.has(status);
}

export function alignLichessClockStates(input: {
  moveCount: number;
  rawClockPresence: string;
  rawClockStates: RawClockState[];
  provider?: string | null;
  status?: string | null;
  terminalActiveColor?: ChessColor | null;
}): ClockAlignmentResult {
  const presence = normalized(input.rawClockPresence);
  if (presence === 'invalid') {
    return { status: 'UNAVAILABLE', reason: 'CLOCK_SAMPLE_INVALID', aligned: [] };
  }
  if (presence !== 'present') {
    return { status: 'UNAVAILABLE', reason: 'CLOCKS_ABSENT', aligned: [] };
  }

  const states = [...input.rawClockStates].sort((a, b) => a.sourceOrdinal - b.sourceOrdinal);
  if (states.length === input.moveCount) {
    return {
      status: 'COMPLETE',
      aligned: states.map((state, index) => ({
        ...state,
        plyNumber: index + 1,
        semantics: 'POST_MOVE_REMAINING' as const,
        alignmentVersion: CLOCK_ALIGNMENT_VERSION,
      })),
    };
  }

  if (
    states.length === input.moveCount + 1
    && input.terminalActiveColor
    && isClassifiableTerminalExtra({ provider: input.provider, status: input.status })
  ) {
    const terminal = states[states.length - 1];
    return {
      status: 'COMPLETE',
      aligned: states.slice(0, input.moveCount).map((state, index) => ({
        ...state,
        plyNumber: index + 1,
        semantics: 'POST_MOVE_REMAINING' as const,
        alignmentVersion: CLOCK_ALIGNMENT_VERSION,
      })),
      terminal: {
        ...terminal,
        activeColor: input.terminalActiveColor,
        semantics: 'TERMINAL_ACTIVE_TURN_REMAINING',
        alignmentVersion: CLOCK_ALIGNMENT_VERSION,
      },
    };
  }

  if (states.length > input.moveCount + 1) {
    return { status: 'ANOMALOUS', reason: 'CLOCK_SEQUENCE_TOO_LONG', aligned: [] };
  }

  if (states.length === input.moveCount + 1) {
    return { status: 'UNALIGNED', reason: 'TERMINAL_CLOCK_STATE_UNCLASSIFIED', aligned: [] };
  }

  return { status: 'UNALIGNED', reason: 'CLOCK_SEQUENCE_UNALIGNED', aligned: [] };
}

export function derivePlyTiming(
  context: TimingContext,
  alignment: ClockAlignmentResult,
): { rows: DerivedPlyTiming[]; coverageStatus: TimingCoverageStatus; availableCount: number } {
  const byPly = new Map(alignment.aligned.map((fact) => [fact.plyNumber, fact]));
  const eligible = isTimingEligibleGame(context);
  const reliabilityFlags = context.allowsExternalClockAdjustments
    ? ['POSSIBLE_EXTERNAL_CLOCK_ADJUSTMENT']
    : [];

  const rows: DerivedPlyTiming[] = [];
  for (let plyNumber = 1; plyNumber <= context.moveCount; plyNumber += 1) {
    const after = byPly.get(plyNumber)?.valueCentiseconds ?? null;
    const base = {
      plyNumber,
      derivationVersion: TIMING_DERIVATION_VERSION,
      sourceClockAfterCentiseconds: after,
      reliabilityFlags: [...reliabilityFlags],
    };

    if (!eligible) {
      rows.push({
        ...base,
        clockBeforeMoveCentiseconds: null,
        effectiveIncrementCentiseconds: null,
        clockDeltaMoveTimeCentiseconds: null,
        beforeClockProvenance: 'UNAVAILABLE',
        incrementProvenance: 'UNAVAILABLE',
        derivationStatus: 'UNSUPPORTED',
        unavailableReason: 'UNSUPPORTED_CLOCK_SEMANTICS',
      });
      continue;
    }

    if (after === null) {
      rows.push({
        ...base,
        clockBeforeMoveCentiseconds: null,
        effectiveIncrementCentiseconds: null,
        clockDeltaMoveTimeCentiseconds: null,
        beforeClockProvenance: 'UNAVAILABLE',
        incrementProvenance: 'UNAVAILABLE',
        derivationStatus: 'UNAVAILABLE',
        unavailableReason: alignment.reason ?? 'CLOCK_SEQUENCE_UNALIGNED',
      });
      continue;
    }

    if (plyNumber <= 2) {
      rows.push({
        ...base,
        clockBeforeMoveCentiseconds: null,
        effectiveIncrementCentiseconds: null,
        clockDeltaMoveTimeCentiseconds: null,
        beforeClockProvenance: 'UNAVAILABLE',
        incrementProvenance: 'UNAVAILABLE',
        derivationStatus: 'UNAVAILABLE',
        unavailableReason: 'FIRST_MOVE_BEFORE_CLOCK_UNAVAILABLE',
      });
      continue;
    }

    const before = byPly.get(plyNumber - 2)?.valueCentiseconds ?? null;
    if (before === null) {
      rows.push({
        ...base,
        clockBeforeMoveCentiseconds: null,
        effectiveIncrementCentiseconds: null,
        clockDeltaMoveTimeCentiseconds: null,
        beforeClockProvenance: 'UNAVAILABLE',
        incrementProvenance: 'UNAVAILABLE',
        derivationStatus: 'UNAVAILABLE',
        unavailableReason: 'CLOCK_SEQUENCE_UNALIGNED',
      });
      continue;
    }

    if (context.playerClockModifierUnresolved) {
      rows.push({
        ...base,
        clockBeforeMoveCentiseconds: before,
        effectiveIncrementCentiseconds: null,
        clockDeltaMoveTimeCentiseconds: null,
        beforeClockProvenance: 'PREVIOUS_SAME_SIDE_SOURCE',
        incrementProvenance: 'UNAVAILABLE',
        derivationStatus: 'UNSUPPORTED',
        unavailableReason: 'PLAYER_CLOCK_MODIFIER_UNRESOLVED',
      });
      continue;
    }

    if (context.incrementSeconds === null || context.incrementSeconds === undefined) {
      rows.push({
        ...base,
        clockBeforeMoveCentiseconds: before,
        effectiveIncrementCentiseconds: null,
        clockDeltaMoveTimeCentiseconds: null,
        beforeClockProvenance: 'PREVIOUS_SAME_SIDE_SOURCE',
        incrementProvenance: 'UNAVAILABLE',
        derivationStatus: 'UNAVAILABLE',
        unavailableReason: 'TIME_CONTROL_MISSING',
      });
      continue;
    }

    const finalMoveWithoutIncrement = plyNumber === context.moveCount && isDirectMoveEndStatus(context.status);
    const effectiveIncrementCentiseconds = finalMoveWithoutIncrement ? 0 : context.incrementSeconds * 100;
    const delta = before + effectiveIncrementCentiseconds - after;

    if (delta < 0) {
      rows.push({
        ...base,
        reliabilityFlags: [...new Set([...base.reliabilityFlags, 'POSSIBLE_EXTERNAL_CLOCK_ADJUSTMENT'])],
        clockBeforeMoveCentiseconds: before,
        effectiveIncrementCentiseconds,
        clockDeltaMoveTimeCentiseconds: null,
        beforeClockProvenance: 'PREVIOUS_SAME_SIDE_SOURCE',
        incrementProvenance: finalMoveWithoutIncrement ? 'FINAL_MOVE_NO_INCREMENT' : 'GAME_CONTROL',
        derivationStatus: 'INCONSISTENT',
        unavailableReason: 'NEGATIVE_CLOCK_DELTA',
      });
      continue;
    }

    rows.push({
      ...base,
      clockBeforeMoveCentiseconds: before,
      effectiveIncrementCentiseconds,
      clockDeltaMoveTimeCentiseconds: delta,
      beforeClockProvenance: 'PREVIOUS_SAME_SIDE_SOURCE',
      incrementProvenance: finalMoveWithoutIncrement ? 'FINAL_MOVE_NO_INCREMENT' : 'GAME_CONTROL',
      derivationStatus: 'AVAILABLE',
      unavailableReason: null,
    });
  }

  const availableCount = rows.filter((row) => row.derivationStatus === 'AVAILABLE').length;
  const expectedDerivableCount = Math.max(context.moveCount - 2, 0);
  const coverageStatus: TimingCoverageStatus = expectedDerivableCount === 0
    ? 'UNAVAILABLE'
    : availableCount === expectedDerivableCount
      ? 'COMPLETE'
      : availableCount > 0
        ? 'PARTIAL'
        : 'UNAVAILABLE';

  return { rows, coverageStatus, availableCount };
}
