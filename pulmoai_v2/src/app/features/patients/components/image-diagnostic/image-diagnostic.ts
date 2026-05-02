import { DatePipe } from '@angular/common';
import { Component, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ToastrService } from 'ngx-toastr';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';

import type { Examination, ImageExaminationType } from '@core/models';
import { ExaminationService } from '@core/services/examination.service';
import { LanguageService } from '@core/services/language.service';
import { AuthSrcDirective } from '@shared/directives/auth-src.directive';
import { AiReportCardComponent } from '../ai-report-card/ai-report-card';
import { StatusBadgeComponent } from '../status-badge/status-badge';

@Component({
  selector: 'app-image-diagnostic',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    TranslatePipe,
    ButtonModule,
    SelectModule,
    TextareaModule,
    AuthSrcDirective,
    AiReportCardComponent,
    StatusBadgeComponent,
  ],
  templateUrl: './image-diagnostic.html',
  styleUrl: './image-diagnostic.scss',
})
export class ImageDiagnostic {
  private readonly fb = inject(FormBuilder);
  private readonly examinationService = inject(ExaminationService);
  private readonly language = inject(LanguageService);
  private readonly toastr = inject(ToastrService);
  private readonly translate = inject(TranslateService);

  readonly patientId = input.required<string>();
  readonly examinations = input.required<Examination[]>();

  protected readonly typeOptions: { value: ImageExaminationType; labelKey: string }[] = [
    { value: 'xray', labelKey: 'examType.xray' },
    { value: 'ct', labelKey: 'examType.ct' },
    { value: 'mri', labelKey: 'examType.mri' },
  ];

  protected readonly selectedFile = signal<File | null>(null);
  protected readonly submitting = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    type: this.fb.nonNullable.control<ImageExaminationType>('xray', Validators.required),
    notes: ['', Validators.maxLength(2000)],
  });

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFile.set(input.files?.[0] ?? null);
  }

  protected clearFile(): void {
    this.selectedFile.set(null);
  }

  protected submit(): void {
    const file = this.selectedFile();
    if (!file || this.submitting() || this.form.invalid) return;
    this.submitting.set(true);
    const raw = this.form.getRawValue();
    this.examinationService
      .createFile({
        patientId: this.patientId(),
        type: raw.type,
        notes: raw.notes || null,
        file,
      })
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.selectedFile.set(null);
          this.form.reset({ type: 'xray', notes: '' });
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
}
