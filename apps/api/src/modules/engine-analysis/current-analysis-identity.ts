import { DEFAULT_STOCKFISH_SETTINGS, STOCKFISH_ANALYSIS_VERSION, settingsHash } from './stockfish.adapter';

export interface DiagnosisAnalysisIdentity { analysisVersion: string; settingsHash: string }
export const CURRENT_DIAGNOSIS_ANALYSIS: DiagnosisAnalysisIdentity = {
  analysisVersion: STOCKFISH_ANALYSIS_VERSION, settingsHash: settingsHash(DEFAULT_STOCKFISH_SETTINGS),
};
