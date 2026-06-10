export type ExaminationType =
  | 'xray'
  | 'ct'
  | 'mri'
  | 'audio'
  | 'parameters'
  | 'clinical_scale';
export type ExaminationStatus = 'pending' | 'analyzing' | 'done' | 'failed';

export const IMAGE_TYPES = ['xray', 'ct', 'mri'] as const;
export type ImageExaminationType = (typeof IMAGE_TYPES)[number];

/** Clinical scoring scales available in the calculator UI. */
export type ClinicalScaleType =
  | 'crb_65'
  | 'cat'
  | 'gina_severity'
  | 'mmrc'
  | 'gold_stage';

export type ClinicalScaleSeverity = 'low' | 'moderate' | 'high';

export interface ClinicalScaleBreakdownItem {
  key: string;
  labelEn: string;
  value: unknown;
  points: number;
  missing: boolean;
  threshold?: string;
}

/** Shape persisted in `examination.parameters` for clinical_scale type. */
export interface ClinicalScaleResult {
  scaleType: ClinicalScaleType;
  inputs: Record<string, unknown>;
  score: number;
  scoreMax: number;
  severity: ClinicalScaleSeverity;
  severityLabel: string;
  recommendation: string;
  breakdown: ClinicalScaleBreakdownItem[];
  reference: string;
}

export interface Examination {
  id: string;
  patientId: string;
  createdById: string;
  type: ExaminationType;
  status: ExaminationStatus;
  attachmentFilename: string | null;
  attachmentMime: string | null;
  attachmentUrl: string | null;
  /** For type='clinical_scale', this is a ClinicalScaleResult. For 'parameters' it's raw values. */
  parameters: Record<string, unknown> | null;
  notes: string | null;
  aiSummary: string | null;
  aiReport: string | null;
  createdAt: string;
}

export interface ExaminationFileCreateRequest {
  patientId: string;
  type: Exclude<ExaminationType, 'parameters' | 'clinical_scale'>;
  notes?: string | null;
  file: File;
}

export interface ExaminationParametersCreateRequest {
  patientId: string;
  parameters: Record<string, number | string | null>;
  notes?: string | null;
}

export interface ClinicalScaleCreateRequest {
  patientId: string;
  scaleType: ClinicalScaleType;
  inputs: Record<string, unknown>;
  notes?: string | null;
}
