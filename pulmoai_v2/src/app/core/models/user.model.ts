export interface User {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  avatarUrl?: string;
}

export type UserRole = 'admin' | 'doctor' | 'user';
