import { DIAGNOSIS_RELATIONSHIP_GRAPH_VERSION } from './diagnosis-relationship.service';
import { EARLY_TIME_OVERUSE_POLICY_VERSION } from './early-time-overuse.service';
import { EXACT_TIME_CONTROL_UNDERPERFORMANCE_POLICY_VERSION } from './exact-time-control-underperformance.service';
import { INCREMENT_EFFECT_POLICY_VERSION } from './increment-effect.service';
import { LOSS_STREAK_DETERIORATION_POLICY_VERSION } from './loss-streak-deterioration.service';
import { OPPONENT_MOVE_SPEED_EFFECT_POLICY_VERSION } from './opponent-move-speed-effect.service';
import { OPPONENT_STRENGTH_EFFECT_POLICY_VERSION } from './opponent-strength-effect.service';
import { OVERLONG_SESSION_STOPPING_POINT_POLICY_VERSION } from './overlong-session-stopping-point.service';
import { PLAYED_TOO_FAST_POLICY_VERSION } from './played-too-fast.service';
import { RATING_CONTEXT_COMPOSITION_POLICY_VERSION } from './rating-context-composition.service';
import { SESSION_DETERIORATION_POLICY_VERSION } from './session-deterioration.service';
import { TIME_PRESSURE_EXPOSURE_POLICY_VERSION } from './time-pressure-exposure.service';
import { TIME_PRESSURE_QUALITY_POLICY_VERSION } from './time-pressure-quality-collapse.service';
import {
  DIAGNOSIS_SYNTHESIS_POLICY_VERSION,
  DIAGNOSIS_CONSOLIDATION_POLICY_VERSION,
  DIAGNOSIS_RANKING_POLICY_VERSION,
  DIAGNOSIS_EVENT_IDENTITY_VERSION,
} from '@why-i-suck-at-chess/chess-domain';
import { DIAGNOSIS_CANDIDATE_PROJECTION_VERSION } from './diagnosis-candidate.registry';
import { evidenceDetectors } from '../evidence/evidence.registry';
import { STOCKFISH_ANALYSIS_VERSION, DEFAULT_STOCKFISH_SETTINGS, settingsHash } from '../engine-analysis/stockfish.adapter';
import type { DiagnosisFindingVersionTuple } from './diagnosis-finding.types';

export const DIAGNOSIS_MATERIALIZATION_VERSION = 'diagnosis-materialization-v1';
export const diagnosisMaterializationVersions: DiagnosisFindingVersionTuple = {
  taxonomyVersion: 'diagnostic-taxonomy-v1',
  synthesisPolicyVersion: DIAGNOSIS_SYNTHESIS_POLICY_VERSION,
  calculationVersion: DIAGNOSIS_MATERIALIZATION_VERSION,
  policyVersions: {
    aggregatePolicies: [EARLY_TIME_OVERUSE_POLICY_VERSION, EXACT_TIME_CONTROL_UNDERPERFORMANCE_POLICY_VERSION, INCREMENT_EFFECT_POLICY_VERSION, LOSS_STREAK_DETERIORATION_POLICY_VERSION, OPPONENT_MOVE_SPEED_EFFECT_POLICY_VERSION, OPPONENT_STRENGTH_EFFECT_POLICY_VERSION, OVERLONG_SESSION_STOPPING_POINT_POLICY_VERSION, PLAYED_TOO_FAST_POLICY_VERSION, RATING_CONTEXT_COMPOSITION_POLICY_VERSION, SESSION_DETERIORATION_POLICY_VERSION, TIME_PRESSURE_EXPOSURE_POLICY_VERSION, TIME_PRESSURE_QUALITY_POLICY_VERSION],
    candidateProjection: DIAGNOSIS_CANDIDATE_PROJECTION_VERSION,
    relationships: DIAGNOSIS_RELATIONSHIP_GRAPH_VERSION,
    eventIdentity: DIAGNOSIS_EVENT_IDENTITY_VERSION,
    consolidation: DIAGNOSIS_CONSOLIDATION_POLICY_VERSION,
    ranking: DIAGNOSIS_RANKING_POLICY_VERSION,
    // Any aggregate implementation/policy change must advance calculationVersion.
    analysis: STOCKFISH_ANALYSIS_VERSION,
    settings: settingsHash(DEFAULT_STOCKFISH_SETTINGS),
    detectors: evidenceDetectors.map(({ key, version }) => ({ key, version })),
  },
};
