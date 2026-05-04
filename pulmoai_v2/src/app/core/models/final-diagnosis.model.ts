import type { Examination, ExaminationStatus } from './examination.model';

export type FinalDiagnosisConfidence = 'low' | 'moderate' | 'high';
export type FinalDiagnosisUrgency = 'green' | 'yellow' | 'red';
export type ModalityName = 'image' | 'audio' | 'parameters';
export type ModalityVerdict = 'support' | 'contradict' | 'silent';
export type LobeRegion =
  | 'left_upper'
  | 'left_lower'
  | 'right_upper'
  | 'right_middle'
  | 'right_lower'
  | 'bilateral'
  | 'pleural'
  | 'mediastinal'
  | 'airways';
export type SeverityLevel = 'mild' | 'moderate' | 'severe';

export interface AffectedRegion {
  region: LobeRegion;
  finding: string;
  severity: SeverityLevel;
  modalities: ModalityName[];
}

export interface DifferentialItem {
  rank: number;
  diagnosis: string;
  probability: FinalDiagnosisConfidence;
  supports: ModalityName[];
  contradicts: ModalityName[];
}

export interface ModalityConsensus {
  verdict: ModalityVerdict;
  note: string;
}

export interface ModalityConsensusMap {
  image: ModalityConsensus;
  audio: ModalityConsensus;
  parameters: ModalityConsensus;
}

/** Shape of `aiPayload`: full structured AI response from Gemini. */
export interface FinalDiagnosisPayload {
  summary: string;
  primary_diagnosis: string;
  icd10: string | null;
  confidence: FinalDiagnosisConfidence;
  urgency: FinalDiagnosisUrgency;
  differential: DifferentialItem[];
  modality_consensus: ModalityConsensusMap;
  recommended_next_steps: string[];
  limitations: string[];
  affected_regions?: AffectedRegion[];
  report_markdown: string;
}

/** Compact list-row — what `GET /final-diagnoses` returns. */
export interface FinalDiagnosisListItem {
  id: string;
  patientId: string;
  createdById: string;
  status: ExaminationStatus;
  language: string;
  primaryDiagnosis: string | null;
  icd10: string | null;
  confidence: FinalDiagnosisConfidence | null;
  urgency: FinalDiagnosisUrgency | null;
  aiSummary: string | null;
  createdAt: string;
}

/** Full record — what `GET /final-diagnoses/{id}` returns. */
export interface FinalDiagnosis extends FinalDiagnosisListItem {
  clinicalContext: string | null;
  aiPayload: FinalDiagnosisPayload | null;
  aiReport: string | null;
  errorMessage: string | null;
  examinations: Examination[];
}

export interface FinalDiagnosisCreateRequest {
  patientId: string;
  examinationIds: string[];
  clinicalContext?: string | null;
  language?: 'uz' | 'ru' | 'en';
}
