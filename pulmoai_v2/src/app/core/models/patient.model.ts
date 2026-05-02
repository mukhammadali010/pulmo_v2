export type Gender = 'male' | 'female' | 'other';

export interface Patient {
  id: string;
  fullName: string;
  dateOfBirth: string | null;
  gender: Gender | null;
  phone: string | null;
  notes: string | null;
  createdById: string;
}

export interface PatientCreateRequest {
  fullName: string;
  dateOfBirth?: string | null;
  gender?: Gender | null;
  phone?: string | null;
  notes?: string | null;
}

export type PatientUpdateRequest = Partial<PatientCreateRequest>;
