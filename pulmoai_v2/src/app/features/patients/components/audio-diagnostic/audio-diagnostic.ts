import { DatePipe } from '@angular/common';
import { Component, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ToastrService } from 'ngx-toastr';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';
import { inject } from '@angular/core';

import type { Examination } from '@core/models';
import { ExaminationService } from '@core/services/examination.service';
import { LanguageService } from '@core/services/language.service';
import { AuthSrcDirective } from '@shared/directives/auth-src.directive';
import { AiReportCardComponent } from '../ai-report-card/ai-report-card';
import { StatusBadgeComponent } from '../status-badge/status-badge';

@Component({
  selector: 'app-audio-diagnostic',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    TranslatePipe,
    ButtonModule,
    TextareaModule,
    AuthSrcDirective,
    AiReportCardComponent,
    StatusBadgeComponent,
  ],
  templateUrl: './audio-diagnostic.html',
  styleUrl: './audio-diagnostic.scss',
})
export class AudioDiagnostic {
  private readonly fb = inject(FormBuilder);
  private readonly examinationService = inject(ExaminationService);
  private readonly language = inject(LanguageService);
  private readonly toastr = inject(ToastrService);
  private readonly translate = inject(TranslateService);

  readonly patientId = input.required<string>();
  readonly examinations = input.required<Examination[]>();

  protected readonly selectedFile = signal<File | null>(null);
  protected readonly submitting = signal(false);

  protected readonly form = this.fb.nonNullable.group({
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
    if (!file || this.submitting()) return;
    this.submitting.set(true);
    this.examinationService
      .createFile({
        patientId: this.patientId(),
        type: 'audio',
        notes: this.form.value.notes || null,
        file,
      })
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.selectedFile.set(null);
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
}
