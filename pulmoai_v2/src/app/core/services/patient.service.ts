import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';

import type { Patient, PatientCreateRequest, PatientUpdateRequest } from '@core/models';

@Injectable({ providedIn: 'root' })
export class PatientService {
  private readonly http = inject(HttpClient);

  private readonly _patients = signal<Patient[]>([]);
  private readonly _loading = signal(false);

  readonly patients = this._patients.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly count = computed(() => this._patients().length);

  load(): Observable<Patient[]> {
    this._loading.set(true);
    return this.http.get<Patient[]>('/patients').pipe(
      tap({
        next: (patients) => {
          this._patients.set(patients);
          this._loading.set(false);
        },
        error: () => this._loading.set(false),
      }),
    );
  }

  getById(id: string): Observable<Patient> {
    return this.http.get<Patient>(`/patients/${id}`);
  }

  create(payload: PatientCreateRequest): Observable<Patient> {
    return this.http
      .post<Patient>('/patients', payload)
      .pipe(tap((patient) => this._patients.update((list) => [patient, ...list])));
  }

  update(id: string, payload: PatientUpdateRequest): Observable<Patient> {
    return this.http
      .patch<Patient>(`/patients/${id}`, payload)
      .pipe(
        tap((updated) =>
          this._patients.update((list) => list.map((p) => (p.id === id ? updated : p))),
        ),
      );
  }

  remove(id: string): Observable<void> {
    return this.http
      .delete<void>(`/patients/${id}`)
      .pipe(tap(() => this._patients.update((list) => list.filter((p) => p.id !== id))));
  }
}
