export type ExaminationType = 'xray' | 'ct' | 'mri' | 'audio' | 'parameters';
export type ExaminationStatus = 'pending' | 'analyzing' | 'done' | 'failed';

export const IMAGE_TYPES = ['xray', 'ct', 'mri'] as const;
export type ImageExaminationType = (typeof IMAGE_TYPES)[number];

export interface Examination {
  id: string;
  patientId: string;
  createdById: string;
  type: ExaminationType;
  status: ExaminationStatus;
  attachmentFilename: string | null;
  attachmentMime: string | null;
  attachmentUrl: string | null;
  parameters: Record<string, number | string | null> | null;
  notes: string | null;
  aiSummary: string | null;
  aiReport: string | null;
  createdAt: string;
}

export interface ExaminationFileCreateRequest {
  patientId: string;
  type: Exclude<ExaminationType, 'parameters'>;
  notes?: string | null;
  file: File;
}

export interface ExaminationParametersCreateRequest {
  patientId: string;
  parameters: Record<string, number | string | null>;
  notes?: string | null;
}
