import { DatePipe } from '@angular/common';
import {
  Component,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { MarkdownComponent } from 'ngx-markdown';
import { ToastrService } from 'ngx-toastr';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';

import type {
  FinalDiagnosis,
  ModalityName,
  ModalityVerdict,
} from '@core/models';
import { FinalDiagnosisService } from '@core/services/final-diagnosis.service';

const POLL_INTERVAL_MS = 3000;
const MODALITY_ORDER: ModalityName[] = ['image', 'audio', 'parameters'];

@Component({
  selector: 'app-final-diagnosis-detail',
  imports: [
    DatePipe,
    TranslatePipe,
    MarkdownComponent,
    ButtonModule,
    MessageModule,
  ],
  templateUrl: './final-diagnosis-detail.html',
  styleUrl: './final-diagnosis-detail.scss',
})
export class FinalDiagnosisDetail implements OnInit, OnDestroy {
  private readonly finalService = inject(FinalDiagnosisService);
  private readonly router = inject(Router);
  private readonly toastr = inject(ToastrService);

  readonly id = input.required<string>();

  protected readonly final = signal<FinalDiagnosis | null>(null);
  protected readonly loading = signal(true);
  protected readonly reportExpanded = signal(false);

  protected readonly modalityOrder = MODALITY_ORDER;

  private pollTimer: ReturnType<typeof setInterval> | null = null;

  protected readonly isAnalyzing = computed(() => this.final()?.status === 'analyzing');
  protected readonly isFailed = computed(() => this.final()?.status === 'failed');
  protected readonly isDone = computed(() => this.final()?.status === 'done');

  protected readonly payload = computed(() => this.final()?.aiPayload ?? null);

  constructor() {
    effect(() => {
      if (this.isAnalyzing() && this.pollTimer === null) {
        this.pollTimer = setInterval(() => {
          this.finalService.refresh(this.id()).subscribe({
            next: (fresh) => this.final.set(fresh),
          });
        }, POLL_INTERVAL_MS);
      } else if (!this.isAnalyzing() && this.pollTimer !== null) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
    });
  }

  ngOnInit(): void {
    this.finalService.getById(this.id()).subscribe({
      next: (final) => {
        this.final.set(final);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toastr.error('Not found');
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
    if (confidence === 'high') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300';
    if (confidence === 'moderate') return 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300';
    if (confidence === 'low') return 'bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-400';
    return 'bg-surface-100 text-surface-600';
  }

  protected verdictClass(verdict: ModalityVerdict): string {
    if (verdict === 'support') return 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100';
    if (verdict === 'contradict') return 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100';
    return 'border-surface-200 bg-surface-50 text-surface-600 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-400';
  }

  protected verdictIcon(verdict: ModalityVerdict): string {
    if (verdict === 'support') return 'pi-check-circle';
    if (verdict === 'contradict') return 'pi-exclamation-triangle';
    return 'pi-minus-circle';
  }

  protected modalityIcon(modality: ModalityName): string {
    if (modality === 'image') return 'pi-image';
    if (modality === 'audio') return 'pi-microphone';
    return 'pi-chart-line';
  }

  protected typeLabelKey(type: string): string {
    if (type === 'audio') return 'examinations.audioDiagnostic';
    if (type === 'parameters') return 'examinations.parameterDiagnostic';
    return 'examType.' + type;
  }

  protected toggleReport(): void {
    this.reportExpanded.update((v) => !v);
  }

  protected backToPatient(): void {
    const f = this.final();
    if (f?.patientId) {
      void this.router.navigate(['/patients', f.patientId]);
    } else {
      void this.router.navigate(['/patients']);
    }
  }
}
