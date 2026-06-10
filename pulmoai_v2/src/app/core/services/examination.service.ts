import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';

import type {
  ClinicalScaleCreateRequest,
  Examination,
  ExaminationFileCreateRequest,
  ExaminationParametersCreateRequest,
} from '@core/models';

@Injectable({ providedIn: 'root' })
export class ExaminationService {
  private readonly http = inject(HttpClient);

  private readonly _examinations = signal<Examination[]>([]);
  private readonly _loading = signal(false);

  readonly examinations = this._examinations.asReadonly();
  readonly loading = this._loading.asReadonly();

  load(patientId?: string): Observable<Examination[]> {
    this._loading.set(true);
    let params = new HttpParams();
    if (patientId) params = params.set('patient_id', patientId);
    return this.http.get<Examination[]>('/examinations', { params }).pipe(
      tap({
        next: (items) => {
          this._examinations.set(items);
          this._loading.set(false);
        },
        error: () => this._loading.set(false),
      }),
    );
  }

  getById(id: string): Observable<Examination> {
    return this.http.get<Examination>(`/examinations/${id}`);
  }

  createFile(payload: ExaminationFileCreateRequest): Observable<Examination> {
    const form = new FormData();
    form.append('patient_id', payload.patientId);
    form.append('type', payload.type);
    if (payload.notes) form.append('notes', payload.notes);
    form.append('file', payload.file);

    return this.http.post<Examination>('/examinations/file', form).pipe(
      tap((created) => this._examinations.update((list) => [created, ...list])),
    );
  }

  createParameters(payload: ExaminationParametersCreateRequest): Observable<Examination> {
    return this.http.post<Examination>('/examinations/parameters', payload).pipe(
      tap((created) => this._examinations.update((list) => [created, ...list])),
    );
  }

  createClinicalScale(payload: ClinicalScaleCreateRequest): Observable<Examination> {
    const body = {
      patientId: payload.patientId,
      scaleType: payload.scaleType,
      inputs: payload.inputs,
      notes: payload.notes ?? null,
    };
    return this.http.post<Examination>('/examinations/clinical-scale', body).pipe(
      tap((created) => this._examinations.update((list) => [created, ...list])),
    );
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`/examinations/${id}`).pipe(
      tap(() => this._examinations.update((list) => list.filter((e) => e.id !== id))),
    );
  }

  analyze(id: string, language: string): Observable<Examination> {
    return this.http
      .post<Examination>(`/examinations/${id}/analyze`, null, { params: { language } })
      .pipe(tap((updated) => this.replaceOne(updated)));
  }

  /** One-shot refresh of a single examination — used while polling an analyzing job. */
  refresh(id: string): Observable<Examination> {
    return this.getById(id).pipe(tap((fresh) => this.replaceOne(fresh)));
  }

  private replaceOne(updated: Examination): void {
    this._examinations.update((list) =>
      list.map((e) => (e.id === updated.id ? updated : e)),
    );
  }
}
