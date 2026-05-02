import type { UserRole } from './user.model';

export interface Doctor {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  avatarUrl: string | null;
  createdAt: string;
  patientCount: number;
  examinationCount: number;
}

export interface DoctorCreateRequest {
  email: string;
  password: string;
  fullName: string;
  role?: UserRole;
}

export interface DoctorUpdateRequest {
  fullName?: string;
  role?: UserRole;
  isActive?: boolean;
}

export interface AdminStats {
  totalDoctors: number;
  activeDoctors: number;
  totalPatients: number;
  totalExaminations: number;
  examinationsPending: number;
  examinationsDone: number;
}
