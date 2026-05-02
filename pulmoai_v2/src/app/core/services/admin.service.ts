import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';

import type {
  AdminStats,
  Doctor,
  DoctorCreateRequest,
  DoctorUpdateRequest,
  UserRole,
} from '@core/models';

interface ListDoctorsParams {
  search?: string;
  role?: UserRole;
  isActive?: boolean;
}

@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly http = inject(HttpClient);

  private readonly _doctors = signal<Doctor[]>([]);
  private readonly _loading = signal(false);
  private readonly _stats = signal<AdminStats | null>(null);

  readonly doctors = this._doctors.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly stats = this._stats.asReadonly();

  loadDoctors(filter: ListDoctorsParams = {}): Observable<Doctor[]> {
    this._loading.set(true);
    let params = new HttpParams();
    if (filter.search) params = params.set('search', filter.search);
    if (filter.role) params = params.set('role', filter.role);
    if (filter.isActive !== undefined) params = params.set('is_active', String(filter.isActive));
    return this.http.get<Doctor[]>('/admin/users', { params }).pipe(
      tap({
        next: (list) => {
          this._doctors.set(list);
          this._loading.set(false);
        },
        error: () => this._loading.set(false),
      }),
    );
  }

  loadStats(): Observable<AdminStats> {
    return this.http.get<AdminStats>('/admin/stats').pipe(
      tap((stats) => this._stats.set(stats)),
    );
  }

  create(payload: DoctorCreateRequest): Observable<Doctor> {
    return this.http
      .post<Doctor>('/admin/users', payload)
      .pipe(tap((doctor) => this._doctors.update((list) => [{ ...doctor, patientCount: 0, examinationCount: 0 }, ...list])));
  }

  update(id: string, payload: DoctorUpdateRequest): Observable<Doctor> {
    return this.http.patch<Doctor>(`/admin/users/${id}`, payload).pipe(
      tap((updated) =>
        this._doctors.update((list) =>
          list.map((d) => (d.id === id ? { ...d, ...updated } : d)),
        ),
      ),
    );
  }

  resetPassword(id: string, newPassword: string): Observable<void> {
    return this.http.post<void>(`/admin/users/${id}/reset-password`, {
      newPassword,
    });
  }

  deactivate(id: string): Observable<Doctor> {
    return this.http.delete<Doctor>(`/admin/users/${id}`).pipe(
      tap((updated) =>
        this._doctors.update((list) =>
          list.map((d) => (d.id === id ? { ...d, ...updated } : d)),
        ),
      ),
    );
  }
}
