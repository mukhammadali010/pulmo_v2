import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';

import type {
  FinalDiagnosis,
  FinalDiagnosisCreateRequest,
  FinalDiagnosisListItem,
} from '@core/models';

@Injectable({ providedIn: 'root' })
export class FinalDiagnosisService {
  private readonly http = inject(HttpClient);

  private readonly _items = signal<FinalDiagnosisListItem[]>([]);
  private readonly _loading = signal(false);

  readonly items = this._items.asReadonly();
  readonly loading = this._loading.asReadonly();

  load(patientId?: string): Observable<FinalDiagnosisListItem[]> {
    this._loading.set(true);
    let params = new HttpParams();
    if (patientId) params = params.set('patient_id', patientId);
    return this.http.get<FinalDiagnosisListItem[]>('/final-diagnoses', { params }).pipe(
      tap({
        next: (items) => {
          this._items.set(items);
          this._loading.set(false);
        },
        error: () => this._loading.set(false),
      }),
    );
  }

  getById(id: string): Observable<FinalDiagnosis> {
    return this.http.get<FinalDiagnosis>(`/final-diagnoses/${id}`);
  }

  create(payload: FinalDiagnosisCreateRequest): Observable<FinalDiagnosis> {
    return this.http.post<FinalDiagnosis>('/final-diagnoses', payload).pipe(
      tap((created) =>
        this._items.update((list) => [this.toListItem(created), ...list]),
      ),
    );
  }

  analyze(id: string): Observable<FinalDiagnosis> {
    return this.http
      .post<FinalDiagnosis>(`/final-diagnoses/${id}/analyze`, null)
      .pipe(tap((updated) => this.replaceOne(updated)));
  }

  /** One-shot refresh — used while polling an analyzing job. */
  refresh(id: string): Observable<FinalDiagnosis> {
    return this.getById(id).pipe(tap((fresh) => this.replaceOne(fresh)));
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`/final-diagnoses/${id}`).pipe(
      tap(() => this._items.update((list) => list.filter((f) => f.id !== id))),
    );
  }

  private replaceOne(updated: FinalDiagnosis): void {
    const compact = this.toListItem(updated);
    this._items.update((list) =>
      list.map((f) => (f.id === updated.id ? compact : f)),
    );
  }

  private toListItem(full: FinalDiagnosis): FinalDiagnosisListItem {
    const {
      id,
      patientId,
      createdById,
      status,
      language,
      primaryDiagnosis,
      icd10,
      confidence,
      urgency,
      aiSummary,
      createdAt,
    } = full;
    return {
      id,
      patientId,
      createdById,
      status,
      language,
      primaryDiagnosis,
      icd10,
      confidence,
      urgency,
      aiSummary,
      createdAt,
    };
  }
}
