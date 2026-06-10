import { DatePipe } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { TabsModule } from 'primeng/tabs';
import { forkJoin } from 'rxjs';

import type { Patient } from '@core/models';
import { ExaminationService } from '@core/services/examination.service';
import { FinalDiagnosisService } from '@core/services/final-diagnosis.service';
import { PatientService } from '@core/services/patient.service';
import { AudioDiagnostic } from '../../components/audio-diagnostic/audio-diagnostic';
import { ClinicalScales } from '../../components/clinical-scales/clinical-scales';
import { ImageDiagnostic } from '../../components/image-diagnostic/image-diagnostic';
import { ParameterDiagnostic } from '../../components/parameter-diagnostic/parameter-diagnostic';
import { ResultsTimeline } from '../../components/results-timeline/results-timeline';

const POLL_INTERVAL_MS = 3000;

@Component({
  selector: 'app-patient-detail',
  imports: [
    DatePipe,
    RouterLink,
    TranslatePipe,
    ButtonModule,
    TabsModule,
    AudioDiagnostic,
    ClinicalScales,
    ImageDiagnostic,
    ParameterDiagnostic,
    ResultsTimeline,
  ],
  templateUrl: './patient-detail.html',
  styleUrl: './patient-detail.scss',
})
export class PatientDetail implements OnInit, OnDestroy {
  private readonly patientService = inject(PatientService);
  private readonly examinationService = inject(ExaminationService);
  private readonly finalDiagnosisService = inject(FinalDiagnosisService);
  private readonly router = inject(Router);

  /** Bound from the route via withComponentInputBinding. */
  readonly id = input.required<string>();

  protected readonly patient = signal<Patient | null>(null);
  protected readonly loading = signal(true);

  protected readonly examinations = this.examinationService.examinations;
  protected readonly finalDiagnoses = this.finalDiagnosisService.items;

  protected readonly audio = computed(() => this.examinations().filter((e) => e.type === 'audio'));
  protected readonly images = computed(() =>
    this.examinations().filter((e) => e.type === 'xray' || e.type === 'ct' || e.type === 'mri'),
  );
  protected readonly parameters = computed(() =>
    this.examinations().filter((e) => e.type === 'parameters'),
  );
  protected readonly clinicalScales = computed(() =>
    this.examinations().filter((e) => e.type === 'clinical_scale'),
  );

  /** Latest parameters examination — used to pre-fill respiratoryRate in the
   * CRB-65 calculator so the doctor doesn't have to re-enter it. */
  protected readonly latestParametersExam = computed(() => {
    const list = this.parameters();
    if (list.length === 0) return null;
    return [...list].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )[0];
  });

  private readonly analyzingIds = computed(() =>
    this.examinations()
      .filter((e) => e.status === 'analyzing')
      .map((e) => e.id),
  );

  private pollTimer: ReturnType<typeof setInterval> | null = null;

  protected readonly initials = computed(() => {
    const name = this.patient()?.fullName?.trim() ?? '';
    if (!name) return '?';
    return name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('');
  });

  protected readonly age = computed(() => {
    const dob = this.patient()?.dateOfBirth;
    if (!dob) return null;
    const birth = new Date(dob);
    const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    const monthDiff = now.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) age--;
    return age;
  });

  constructor() {
    effect(() => {
      const ids = this.analyzingIds();
      if (ids.length > 0 && this.pollTimer === null) {
        this.pollTimer = setInterval(() => {
          for (const id of this.analyzingIds()) {
            this.examinationService.refresh(id).subscribe();
          }
        }, POLL_INTERVAL_MS);
      } else if (ids.length === 0 && this.pollTimer !== null) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
    });
  }

  ngOnInit(): void {
    forkJoin({
      patient: this.patientService.getById(this.id()),
      _exams: this.examinationService.load(this.id()),
      _finals: this.finalDiagnosisService.load(this.id()),
    }).subscribe({
      next: ({ patient }) => {
        this.patient.set(patient);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        void this.router.navigate(['/patients']);
      },
    });
  }

  ngOnDestroy(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  protected urgencyClass(urgency: string | null | undefined): string {
    if (urgency === 'red') return 'bg-red-500 text-white';
    if (urgency === 'yellow') return 'bg-amber-400 text-amber-950';
    if (urgency === 'green') return 'bg-emerald-500 text-white';
    return 'bg-surface-200 text-surface-700';
  }

  protected confidenceClass(confidence: string | null | undefined): string {
    if (confidence === 'high')
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300';
    if (confidence === 'moderate')
      return 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300';
    if (confidence === 'low')
      return 'bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-400';
    return 'bg-surface-100 text-surface-600';
  }
}
