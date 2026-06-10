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

  /** Only `done` examinations are eligible. Imaging/audio/parameters require an
   * AI report; clinical_scale examinations are deterministic so their stored
   * `parameters` payload (score, severity, breakdown) is the authoritative input. */
  protected readonly eligibleExaminations = computed<Examination[]>(() =>
    this.examinationService
      .examinations()
      .filter(
        (e) => e.status === 'done' && (!!e.aiReport || e.type === 'clinical_scale'),
      ),
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
    if (type === 'clinical_scale') return 'clinicalScales.tabTitle';
    return 'examType.' + type;
  }

  protected typeIcon(type: ExaminationType): string {
    if (type === 'audio') return 'pi-microphone';
    if (type === 'parameters') return 'pi-chart-line';
    if (type === 'clinical_scale') return 'pi-calculator';
    return 'pi-image';
  }

  /** For clinical_scale exams the row preview can't quote ai_summary (none).
   * Project the structured result instead. Returns null for non-scale exams. */
  protected scalePreview(
    exam: Examination,
  ): { title: string; score: string; severity: string } | null {
    if (exam.type !== 'clinical_scale' || !exam.parameters) return null;
    const p = exam.parameters as Record<string, unknown>;
    const scaleType = String(p['scaleType'] ?? '');
    const titleKey = this.scaleTitleKey(scaleType);
    const score = `${p['score'] ?? '?'}/${p['scoreMax'] ?? '?'}`;
    return {
      title: this.translate.instant(titleKey),
      score,
      severity: String(p['severityLabel'] ?? p['severity'] ?? ''),
    };
  }

  protected scaleSeverityClass(exam: Examination): string {
    const sev = (exam.parameters as Record<string, unknown> | null)?.['severity'];
    if (sev === 'low')
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300';
    if (sev === 'moderate')
      return 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300';
    if (sev === 'high')
      return 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300';
    return 'bg-surface-100 text-surface-600';
  }

  private scaleTitleKey(scaleType: string): string {
    if (scaleType === 'crb_65') return 'clinicalScales.crb65.title';
    if (scaleType === 'cat') return 'clinicalScales.cat.title';
    if (scaleType === 'gina_severity') return 'clinicalScales.gina.title';
    if (scaleType === 'mmrc') return 'clinicalScales.mmrc.title';
    if (scaleType === 'gold_stage') return 'clinicalScales.gold.title';
    return 'clinicalScales.tabTitle';
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
