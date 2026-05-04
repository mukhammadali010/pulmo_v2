import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { MessageModule } from 'primeng/message';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';
import { switchMap } from 'rxjs';

import type { Examination, ExaminationType, Patient } from '@core/models';
import { ExaminationService } from '@core/services/examination.service';
import { FinalDiagnosisService } from '@core/services/final-diagnosis.service';
import { PatientService } from '@core/services/patient.service';

const MAX_SELECTED = 5;

@Component({
  selector: 'app-final-diagnosis-create',
  imports: [
    DatePipe,
    FormsModule,
    RouterLink,
    TranslatePipe,
    ButtonModule,
    CheckboxModule,
    MessageModule,
    SelectModule,
    TextareaModule,
  ],
  templateUrl: './final-diagnosis-create.html',
  styleUrl: './final-diagnosis-create.scss',
})
export class FinalDiagnosisCreate implements OnInit {
  private readonly patientService = inject(PatientService);
  private readonly examinationService = inject(ExaminationService);
  private readonly finalService = inject(FinalDiagnosisService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly translate = inject(TranslateService);

  protected readonly patientId = signal<string | null>(null);
  protected readonly patient = signal<Patient | null>(null);
  protected readonly loading = signal(true);
  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly selectedIds = signal<Set<string>>(new Set());
  protected readonly clinicalContext = signal('');
  protected readonly language = signal<'uz' | 'ru' | 'en'>('uz');

  protected readonly languageOptions = [
    { value: 'uz', labelKey: 'language.uz' },
    { value: 'ru', labelKey: 'language.ru' },
    { value: 'en', labelKey: 'language.en' },
  ];

  /** Only `done` examinations are eligible — synthesis needs the AI report. */
  protected readonly eligibleExaminations = computed<Examination[]>(() =>
    this.examinationService
      .examinations()
      .filter((e) => e.status === 'done' && !!e.aiReport),
  );

  protected readonly selectedCount = computed(() => this.selectedIds().size);

  protected readonly canSubmit = computed(() => {
    const count = this.selectedCount();
    return count >= 1 && count <= MAX_SELECTED && !this.submitting();
  });

  ngOnInit(): void {
    const patientId = this.route.snapshot.queryParamMap.get('patientId');
    if (!patientId) {
      void this.router.navigate(['/patients']);
      return;
    }
    this.patientId.set(patientId);
    this.language.set(this.resolveInitialLanguage());

    this.patientService.getById(patientId).subscribe({
      next: (p) => this.patient.set(p),
      error: () => void this.router.navigate(['/patients']),
    });

    this.examinationService.load(patientId).subscribe({
      next: () => this.loading.set(false),
      error: () => this.loading.set(false),
    });
  }

  protected toggle(id: string): void {
    this.selectedIds.update((set) => {
      const next = new Set(set);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < MAX_SELECTED) {
        next.add(id);
      }
      return next;
    });
  }

  protected isSelected(id: string): boolean {
    return this.selectedIds().has(id);
  }

  protected typeLabelKey(type: ExaminationType): string {
    if (type === 'audio') return 'examinations.audioDiagnostic';
    if (type === 'parameters') return 'examinations.parameterDiagnostic';
    return 'examType.' + type;
  }

  protected typeIcon(type: ExaminationType): string {
    if (type === 'audio') return 'pi-microphone';
    if (type === 'parameters') return 'pi-chart-line';
    return 'pi-image';
  }

  protected submit(): void {
    const patientId = this.patientId();
    if (!patientId || !this.canSubmit()) return;

    this.submitting.set(true);
    this.errorMessage.set(null);

    this.finalService
      .create({
        patientId,
        examinationIds: Array.from(this.selectedIds()),
        clinicalContext: this.clinicalContext().trim() || null,
        language: this.language(),
      })
      .pipe(switchMap((created) => this.finalService.analyze(created.id)))
      .subscribe({
        next: (final) => {
          this.submitting.set(false);
          void this.router.navigate(['/final-diagnoses', final.id]);
        },
        error: (err) => {
          this.submitting.set(false);
          this.errorMessage.set(err?.error?.detail ?? this.translate.instant('errors.unknown'));
        },
      });
  }

  protected cancel(): void {
    const patientId = this.patientId();
    void this.router.navigate(patientId ? ['/patients', patientId] : ['/patients']);
  }

  private resolveInitialLanguage(): 'uz' | 'ru' | 'en' {
    const current = this.translate.currentLang ?? this.translate.defaultLang ?? 'uz';
    return (['uz', 'ru', 'en'] as const).includes(current as 'uz' | 'ru' | 'en')
      ? (current as 'uz' | 'ru' | 'en')
      : 'uz';
  }
}
