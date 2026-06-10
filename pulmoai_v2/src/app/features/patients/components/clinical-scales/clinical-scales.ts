import { DatePipe } from '@angular/common';
import { Component, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ToastrService } from 'ngx-toastr';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';

import type {
  ClinicalScaleResult,
  ClinicalScaleType,
  Examination,
} from '@core/models';
import { ExaminationService } from '@core/services/examination.service';

interface ScaleOption {
  value: ClinicalScaleType;
  labelKey: string;
  iconKey: string;
}

interface OptionItem<T> {
  value: T;
  labelKey: string;
}

/** CAT 8 questions — each scored 0..5. Labels live in i18n under clinicalScales.cat.q.<key>. */
const CAT_KEYS = [
  'cough',
  'phlegm',
  'chestTightness',
  'breathlessness',
  'activityLimitation',
  'confidence',
  'sleep',
  'energy',
] as const;
type CatKey = (typeof CAT_KEYS)[number];

@Component({
  selector: 'app-clinical-scales',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    TranslatePipe,
    ButtonModule,
    InputNumberModule,
    SelectModule,
    TextareaModule,
  ],
  templateUrl: './clinical-scales.html',
  styleUrl: './clinical-scales.scss',
})
export class ClinicalScales {
  private readonly fb = inject(FormBuilder);
  private readonly examinationService = inject(ExaminationService);
  private readonly toastr = inject(ToastrService);
  private readonly translate = inject(TranslateService);

  readonly patientId = input.required<string>();
  readonly examinations = input.required<Examination[]>();
  readonly patientAge = input<number | null>(null);
  readonly latestParameters = input<Examination | null>(null);

  protected readonly submitting = signal(false);
  protected readonly selectedScale = signal<ClinicalScaleType>('crb_65');

  protected readonly scales: ScaleOption[] = [
    { value: 'crb_65', labelKey: 'clinicalScales.crb65.short', iconKey: 'pi-shield' },
    { value: 'cat', labelKey: 'clinicalScales.cat.short', iconKey: 'pi-heart' },
    { value: 'gina_severity', labelKey: 'clinicalScales.gina.short', iconKey: 'pi-bolt' },
    { value: 'mmrc', labelKey: 'clinicalScales.mmrc.short', iconKey: 'pi-arrow-up-right' },
    { value: 'gold_stage', labelKey: 'clinicalScales.gold.short', iconKey: 'pi-chart-line' },
  ];

  protected readonly catKeys = CAT_KEYS;
  protected readonly catScale: OptionItem<number>[] = [0, 1, 2, 3, 4, 5].map((n) => ({
    value: n,
    labelKey: `clinicalScales.cat.scale.${n}`,
  }));

  protected readonly mmrcOptions: OptionItem<number>[] = [0, 1, 2, 3, 4].map((n) => ({
    value: n,
    labelKey: `clinicalScales.mmrc.grades.${n}`,
  }));

  protected readonly confusionOptions: OptionItem<boolean>[] = [
    { value: false, labelKey: 'common.no' },
    { value: true, labelKey: 'common.yes' },
  ];

  // CRB-65 controls
  protected readonly crbForm = this.fb.group({
    confusion: this.fb.control<boolean>(false, { nonNullable: true }),
    respiratoryRate: this.fb.control<number | null>(null),
    systolicBp: this.fb.control<number | null>(null),
    diastolicBp: this.fb.control<number | null>(null),
  });

  // CAT — 8 numeric controls (0-5 each)
  protected readonly catForm = this.fb.group({
    cough: this.fb.control<number | null>(null),
    phlegm: this.fb.control<number | null>(null),
    chestTightness: this.fb.control<number | null>(null),
    breathlessness: this.fb.control<number | null>(null),
    activityLimitation: this.fb.control<number | null>(null),
    confidence: this.fb.control<number | null>(null),
    sleep: this.fb.control<number | null>(null),
    energy: this.fb.control<number | null>(null),
  });

  // GINA — 4 numeric vital signs
  protected readonly ginaForm = this.fb.group({
    pulse: this.fb.control<number | null>(null),
    pefPct: this.fb.control<number | null>(null),
    sao2: this.fb.control<number | null>(null),
    respiratoryRate: this.fb.control<number | null>(null),
  });

  // mMRC — single grade selection
  protected readonly mmrcForm = this.fb.group({
    grade: this.fb.control<number | null>(null),
  });

  // GOLD — FEV1% predicted + FEV1/FVC ratio
  protected readonly goldForm = this.fb.group({
    fev1PctPredicted: this.fb.control<number | null>(null),
    fev1FvcRatio: this.fb.control<number | null>(null),
  });

  protected readonly notesCtrl = this.fb.control<string>('', { nonNullable: true });

  protected readonly rrSource = signal<string | null>(null);
  protected readonly sao2Source = signal<string | null>(null);

  // ---- live preview (methods, not signals — Angular CD reruns these every
  // change-detection cycle so form-input edits update the preview live) ----

  protected previewScore(): number {
    switch (this.selectedScale()) {
      case 'crb_65':
        return this.crbPreview();
      case 'cat':
        return this.catPreview();
      case 'gina_severity':
        return this.ginaPreview();
      case 'mmrc':
        return this.mmrcPreview();
      case 'gold_stage':
        return this.goldPreview();
    }
  }

  protected previewMax(): number {
    const scale = this.selectedScale();
    if (scale === 'cat') return 40;
    if (scale === 'gina_severity') return 3;
    return 4; // crb_65, mmrc, gold_stage
  }

  protected previewSeverity(): { key: string; labelKey: string } {
    const s = this.previewScore();
    const scale = this.selectedScale();
    if (scale === 'crb_65') {
      if (s === 0) return { key: 'low', labelKey: 'clinicalScales.severity.low' };
      if (s <= 2) return { key: 'moderate', labelKey: 'clinicalScales.severity.moderate' };
      return { key: 'high', labelKey: 'clinicalScales.severity.high' };
    }
    if (scale === 'cat') {
      if (s < 10) return { key: 'low', labelKey: 'clinicalScales.cat.severity.low' };
      if (s <= 20) return { key: 'moderate', labelKey: 'clinicalScales.cat.severity.medium' };
      if (s <= 30) return { key: 'high', labelKey: 'clinicalScales.cat.severity.high' };
      return { key: 'high', labelKey: 'clinicalScales.cat.severity.veryHigh' };
    }
    if (scale === 'gina_severity') {
      if (s === 0) return { key: 'low', labelKey: 'clinicalScales.gina.severity.unknown' };
      if (s === 1) return { key: 'low', labelKey: 'clinicalScales.gina.severity.mild' };
      if (s === 2) return { key: 'moderate', labelKey: 'clinicalScales.gina.severity.moderate' };
      return { key: 'high', labelKey: 'clinicalScales.gina.severity.severe' };
    }
    if (scale === 'mmrc') {
      if (s <= 1) return { key: 'low', labelKey: 'clinicalScales.mmrc.severity.mild' };
      if (s === 2) return { key: 'moderate', labelKey: 'clinicalScales.mmrc.severity.moderate' };
      return { key: 'high', labelKey: 'clinicalScales.mmrc.severity.severe' };
    }
    // gold_stage
    if (s === 0) return { key: 'low', labelKey: 'clinicalScales.gold.severity.unknown' };
    if (s === 1) return { key: 'low', labelKey: 'clinicalScales.gold.severity.gold1' };
    if (s === 2) return { key: 'moderate', labelKey: 'clinicalScales.gold.severity.gold2' };
    if (s === 3) return { key: 'high', labelKey: 'clinicalScales.gold.severity.gold3' };
    return { key: 'high', labelKey: 'clinicalScales.gold.severity.gold4' };
  }

  // CRB-65 preview
  private crbPreview(): number {
    const v = this.crbForm.value;
    let s = 0;
    if (v.confusion) s += 1;
    if (v.respiratoryRate !== null && v.respiratoryRate !== undefined && v.respiratoryRate >= 30)
      s += 1;
    const sys = v.systolicBp;
    const dia = v.diastolicBp;
    if ((sys !== null && sys !== undefined && sys < 90) || (dia !== null && dia !== undefined && dia <= 60))
      s += 1;
    if (this.patientAge() !== null && this.patientAge()! >= 65) s += 1;
    return s;
  }

  // CAT preview — sum of all 8 answers (null treated as 0)
  private catPreview(): number {
    const v = this.catForm.value;
    let s = 0;
    for (const k of CAT_KEYS) {
      const n = v[k];
      if (typeof n === 'number') s += n;
    }
    return s;
  }

  // GINA preview — worst-of classifications
  private ginaPreview(): number {
    const v = this.ginaForm.value;
    const pulse = this.classifyPulse(v.pulse ?? null);
    const pef = this.classifyPef(v.pefPct ?? null);
    const sao2 = this.classifySao2(v.sao2 ?? null);
    const rr = this.classifyRr(v.respiratoryRate ?? null);
    const arr = [pulse, pef, sao2, rr];
    return arr.some((x) => x > 0) ? Math.max(...arr) : 0;
  }

  private classifyPulse(p: number | null): number {
    if (p === null) return 0;
    if (p > 120) return 3;
    if (p >= 100) return 2;
    return 1;
  }

  private classifyPef(p: number | null): number {
    if (p === null) return 0;
    if (p < 60) return 3;
    if (p <= 80) return 2;
    return 1;
  }

  private classifySao2(p: number | null): number {
    if (p === null) return 0;
    if (p < 90) return 3;
    if (p <= 95) return 2;
    return 1;
  }

  private classifyRr(p: number | null): number {
    if (p === null) return 0;
    if (p > 30) return 3;
    return 1;
  }

  // mMRC preview — selected grade IS the score
  private mmrcPreview(): number {
    return this.mmrcForm.value.grade ?? 0;
  }

  // GOLD preview — derive stage from FEV1 %
  private goldPreview(): number {
    const f = this.goldForm.value.fev1PctPredicted;
    if (f === null || f === undefined) return 0;
    if (f >= 80) return 1;
    if (f >= 50) return 2;
    if (f >= 30) return 3;
    return 4;
  }

  // ---- lifecycle / pre-fill -----------------------------------------------

  ngOnInit(): void {
    const latest = this.latestParameters();
    if (!latest?.parameters) return;
    const params = latest.parameters as Record<string, unknown>;
    if (typeof params['respiratoryRate'] === 'number') {
      this.crbForm.controls.respiratoryRate.setValue(params['respiratoryRate'] as number);
      this.ginaForm.controls.respiratoryRate.setValue(params['respiratoryRate'] as number);
      this.rrSource.set('clinicalScales.source.lastParameters');
    }
    if (typeof params['heartRate'] === 'number') {
      this.ginaForm.controls.pulse.setValue(params['heartRate'] as number);
    }
    if (typeof params['spo2'] === 'number') {
      this.ginaForm.controls.sao2.setValue(params['spo2'] as number);
      this.sao2Source.set('clinicalScales.source.lastParameters');
    }
    if (typeof params['fev1Fvc'] === 'number') {
      // Backend stores fev1Fvc as percent (e.g. 78). Convert to ratio for GOLD.
      this.goldForm.controls.fev1FvcRatio.setValue(
        (params['fev1Fvc'] as number) / 100,
      );
    }
  }

  // ---- presentation helpers -----------------------------------------------

  protected severityClass(severity: string): string {
    if (severity === 'low')
      return 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900';
    if (severity === 'moderate')
      return 'bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900';
    if (severity === 'high')
      return 'bg-red-100 text-red-900 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900';
    return 'bg-surface-100 text-surface-700 border-surface-200';
  }

  protected severityDot(severity: string): string {
    if (severity === 'low') return 'bg-emerald-500';
    if (severity === 'moderate') return 'bg-amber-500';
    if (severity === 'high') return 'bg-red-500';
    return 'bg-surface-400';
  }

  protected resultOf(exam: Examination): ClinicalScaleResult | null {
    const p = exam.parameters as unknown;
    if (!p || typeof p !== 'object') return null;
    const obj = p as Record<string, unknown>;
    if (typeof obj['scaleType'] !== 'string') return null;
    return obj as unknown as ClinicalScaleResult;
  }

  protected scaleTitleKey(scaleType: string): string {
    if (scaleType === 'crb_65') return 'clinicalScales.crb65.title';
    if (scaleType === 'cat') return 'clinicalScales.cat.title';
    if (scaleType === 'gina_severity') return 'clinicalScales.gina.title';
    if (scaleType === 'mmrc') return 'clinicalScales.mmrc.title';
    if (scaleType === 'gold_stage') return 'clinicalScales.gold.title';
    return 'clinicalScales.tabTitle';
  }

  protected scaleDescriptionKey(scaleType: string): string {
    if (scaleType === 'crb_65') return 'clinicalScales.crb65.description';
    if (scaleType === 'cat') return 'clinicalScales.cat.description';
    if (scaleType === 'gina_severity') return 'clinicalScales.gina.description';
    if (scaleType === 'mmrc') return 'clinicalScales.mmrc.description';
    if (scaleType === 'gold_stage') return 'clinicalScales.gold.description';
    return '';
  }

  protected scaleSubtitleKey(scaleType: string): string {
    if (scaleType === 'crb_65') return 'clinicalScales.crb65.subtitle';
    if (scaleType === 'cat') return 'clinicalScales.cat.subtitle';
    if (scaleType === 'gina_severity') return 'clinicalScales.gina.subtitle';
    if (scaleType === 'mmrc') return 'clinicalScales.mmrc.subtitle';
    if (scaleType === 'gold_stage') return 'clinicalScales.gold.subtitle';
    return '';
  }

  protected breakdownLabelKey(scaleType: string, key: string): string {
    if (scaleType === 'crb_65') return `clinicalScales.crb65.criteria.${key}`;
    if (scaleType === 'cat') return `clinicalScales.cat.q.${key}`;
    if (scaleType === 'gina_severity') return `clinicalScales.gina.criteria.${key}`;
    if (scaleType === 'mmrc') {
      const grade = key.replace('grade_', '');
      return `clinicalScales.mmrc.grades.${grade}`;
    }
    if (scaleType === 'gold_stage') return `clinicalScales.gold.criteria.${key}`;
    return key;
  }

  protected formatBreakdownValue(value: unknown, key: string, scaleType: string): string {
    if (value === null || value === undefined) return '—';
    if (key === 'confusion') {
      return this.translate.instant(value ? 'common.yes' : 'common.no');
    }
    if (key === 'blood_pressure' && typeof value === 'object') {
      const v = value as { systolic: number | null; diastolic: number | null };
      return `${v.systolic ?? '—'}/${v.diastolic ?? '—'} mmHg`;
    }
    if (scaleType === 'mmrc' && typeof value === 'boolean') {
      return value ? '✓' : '';
    }
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') {
      return this.translate.instant(value ? 'common.yes' : 'common.no');
    }
    return String(value);
  }

  protected selectScale(scale: ClinicalScaleType): void {
    this.selectedScale.set(scale);
  }

  // ---- submit / inputs builder -------------------------------------------

  private buildInputs(): Record<string, unknown> {
    const scale = this.selectedScale();
    if (scale === 'crb_65') {
      const v = this.crbForm.value;
      return {
        confusion: v.confusion ?? false,
        respiratoryRate: v.respiratoryRate ?? null,
        systolicBp: v.systolicBp ?? null,
        diastolicBp: v.diastolicBp ?? null,
        age: this.patientAge(),
      };
    }
    if (scale === 'cat') {
      return { ...this.catForm.value };
    }
    if (scale === 'gina_severity') {
      return { ...this.ginaForm.value };
    }
    if (scale === 'mmrc') {
      return { grade: this.mmrcForm.value.grade ?? null };
    }
    // gold_stage
    return { ...this.goldForm.value };
  }

  protected canSubmit(): boolean {
    const scale = this.selectedScale();
    if (scale === 'mmrc') return this.mmrcForm.value.grade !== null;
    if (scale === 'cat') {
      return CAT_KEYS.every((k) => typeof this.catForm.controls[k as CatKey].value === 'number');
    }
    if (scale === 'gold_stage') return this.goldForm.value.fev1PctPredicted !== null;
    if (scale === 'gina_severity') {
      const v = this.ginaForm.value;
      return [v.pulse, v.pefPct, v.sao2, v.respiratoryRate].some((x) => x !== null && x !== undefined);
    }
    return true; // CRB-65 always allows save (zero score is valid)
  }

  protected submit(): void {
    if (this.submitting() || !this.canSubmit()) return;
    this.submitting.set(true);
    this.examinationService
      .createClinicalScale({
        patientId: this.patientId(),
        scaleType: this.selectedScale(),
        inputs: this.buildInputs(),
        notes: this.notesCtrl.value || null,
      })
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.resetCurrentForm();
          this.notesCtrl.reset('');
          this.toastr.success(this.translate.instant('clinicalScales.saved'));
        },
        error: () => this.submitting.set(false),
      });
  }

  private resetCurrentForm(): void {
    const scale = this.selectedScale();
    if (scale === 'crb_65') {
      this.crbForm.reset({
        confusion: false,
        respiratoryRate: null,
        systolicBp: null,
        diastolicBp: null,
      });
      this.rrSource.set(null);
    } else if (scale === 'cat') {
      this.catForm.reset();
    } else if (scale === 'gina_severity') {
      this.ginaForm.reset();
      this.sao2Source.set(null);
    } else if (scale === 'mmrc') {
      this.mmrcForm.reset();
    } else if (scale === 'gold_stage') {
      this.goldForm.reset();
    }
  }

  protected remove(id: string): void {
    if (!confirm(this.translate.instant('patients.deleteConfirm'))) return;
    this.examinationService.remove(id).subscribe({
      next: () => this.toastr.success(this.translate.instant('examinations.deleted')),
    });
  }
}
