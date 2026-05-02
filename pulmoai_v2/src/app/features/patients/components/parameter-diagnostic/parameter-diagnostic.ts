import { DatePipe } from '@angular/common';
import { Component, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ToastrService } from 'ngx-toastr';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { TextareaModule } from 'primeng/textarea';

import type { Examination } from '@core/models';
import { ExaminationService } from '@core/services/examination.service';
import { LanguageService } from '@core/services/language.service';
import { AiReportCardComponent } from '../ai-report-card/ai-report-card';
import { StatusBadgeComponent } from '../status-badge/status-badge';

interface ParameterField {
  key: string;
  labelKey: string;
  unit: string;
  placeholder: string;
  min?: number;
  max?: number;
  step?: number;
}

@Component({
  selector: 'app-parameter-diagnostic',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    TranslatePipe,
    ButtonModule,
    InputNumberModule,
    TextareaModule,
    AiReportCardComponent,
    StatusBadgeComponent,
  ],
  templateUrl: './parameter-diagnostic.html',
  styleUrl: './parameter-diagnostic.scss',
})
export class ParameterDiagnostic {
  private readonly fb = inject(FormBuilder);
  private readonly examinationService = inject(ExaminationService);
  private readonly language = inject(LanguageService);
  private readonly toastr = inject(ToastrService);
  private readonly translate = inject(TranslateService);

  readonly patientId = input.required<string>();
  readonly examinations = input.required<Examination[]>();

  protected readonly submitting = signal(false);

  protected readonly fields: ParameterField[] = [
    { key: 'fev1', labelKey: 'parameters.fev1', unit: 'L', placeholder: '3.20 L', step: 0.01 },
    { key: 'fvc', labelKey: 'parameters.fvc', unit: 'L', placeholder: '4.10 L', step: 0.01 },
    { key: 'fev1Fvc', labelKey: 'parameters.fev1Fvc', unit: '%', placeholder: '78 %', step: 0.1 },
    { key: 'spo2', labelKey: 'parameters.spo2', unit: '%', placeholder: '98 %', min: 0, max: 100 },
    { key: 'heartRate', labelKey: 'parameters.heartRate', unit: 'bpm', placeholder: '72 bpm' },
    { key: 'respiratoryRate', labelKey: 'parameters.respiratoryRate', unit: '/min', placeholder: '16 /min' },
    { key: 'temperature', labelKey: 'parameters.temperature', unit: '°C', placeholder: '36.6 °C', step: 0.1 },
    { key: 'bmi', labelKey: 'parameters.bmi', unit: 'kg/m²', placeholder: '23.5 kg/m²', step: 0.1 },
  ];

  protected readonly form = this.fb.group({
    fev1: this.fb.control<number | null>(null),
    fvc: this.fb.control<number | null>(null),
    fev1Fvc: this.fb.control<number | null>(null),
    spo2: this.fb.control<number | null>(null),
    heartRate: this.fb.control<number | null>(null),
    respiratoryRate: this.fb.control<number | null>(null),
    temperature: this.fb.control<number | null>(null),
    bmi: this.fb.control<number | null>(null),
    notes: this.fb.control<string>(''),
  });

  protected submit(): void {
    if (this.submitting()) return;
    const raw = this.form.value;
    const parameters: Record<string, number> = {};
    for (const field of this.fields) {
      const value = raw[field.key as keyof typeof raw];
      if (typeof value === 'number' && !Number.isNaN(value)) {
        parameters[field.key] = value;
      }
    }
    if (Object.keys(parameters).length === 0) {
      this.toastr.warning(this.translate.instant('parameters.atLeastOne'));
      return;
    }

    this.submitting.set(true);
    this.examinationService
      .createParameters({
        patientId: this.patientId(),
        parameters,
        notes: raw.notes || null,
      })
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.form.reset();
          this.toastr.success(this.translate.instant('examinations.saved'));
        },
        error: () => this.submitting.set(false),
      });
  }

  protected remove(id: string): void {
    if (!confirm(this.translate.instant('patients.deleteConfirm'))) return;
    this.examinationService.remove(id).subscribe({
      next: () => this.toastr.success(this.translate.instant('examinations.deleted')),
    });
  }

  protected analyze(id: string): void {
    this.examinationService.analyze(id, this.language.current()).subscribe();
  }

  protected paramEntries(
    parameters: Record<string, unknown> | null,
  ): { key: string; value: unknown }[] {
    if (!parameters) return [];
    return Object.entries(parameters).map(([key, value]) => ({ key, value }));
  }

  protected fieldLabelKey(key: string): string {
    return this.fields.find((f) => f.key === key)?.labelKey ?? key;
  }

  protected fieldUnit(key: string): string {
    return this.fields.find((f) => f.key === key)?.unit ?? '';
  }
}
