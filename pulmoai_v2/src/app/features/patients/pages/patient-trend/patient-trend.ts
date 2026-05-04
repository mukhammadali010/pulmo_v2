import { DatePipe, DecimalPipe, LowerCasePipe } from '@angular/common';
import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { forkJoin } from 'rxjs';

import type {
  Examination,
  FinalDiagnosisListItem,
  Patient,
} from '@core/models';
import { ExaminationService } from '@core/services/examination.service';
import { FinalDiagnosisService } from '@core/services/final-diagnosis.service';
import { PatientService } from '@core/services/patient.service';

type Urgency = 'green' | 'yellow' | 'red';
type TrendDirection = 'improving' | 'worsening' | 'stable' | 'unknown';

const SEVERITY_BY_URGENCY: Record<Urgency, number> = {
  green: 1,
  yellow: 2,
  red: 3,
};

const URGENCY_DOT_COLOR: Record<Urgency, string> = {
  green: '#10b981',
  yellow: '#f59e0b',
  red: '#ef4444',
};

interface SeverityPoint {
  index: number;
  date: string;
  score: number;
  urgency: Urgency;
  color: string;
  primaryDiagnosis: string | null;
  confidence: string | null;
}

interface ParameterPoint {
  date: string;
  value: number;
}

interface ParameterSeries {
  key: string;
  labelKey: string;
  points: ParameterPoint[];
  normalMin: number;
  yMin: number;
  yMax: number;
  better: 'up' | 'down';
  suffix: string;
}

const TIMELINE_W = 800;
const TIMELINE_H = 220;
const TIMELINE_PAD_LEFT = 56;
const TIMELINE_PAD_RIGHT = 24;
const TIMELINE_PAD_TOP = 22;
const TIMELINE_PAD_BOTTOM = 32;

const PARAM_W = 320;
const PARAM_H = 110;
const PARAM_PAD_X = 12;
const PARAM_PAD_Y = 12;

@Component({
  selector: 'app-patient-trend',
  imports: [DatePipe, DecimalPipe, LowerCasePipe, RouterLink, TranslatePipe],
  templateUrl: './patient-trend.html',
  styleUrl: './patient-trend.scss',
})
export class PatientTrend implements OnInit {
  private readonly patientService = inject(PatientService);
  private readonly examinationService = inject(ExaminationService);
  private readonly finalDiagnosisService = inject(FinalDiagnosisService);
  private readonly router = inject(Router);

  readonly id = input.required<string>();

  protected readonly patient = signal<Patient | null>(null);
  protected readonly loading = signal(true);

  protected readonly finalDiagnoses = this.finalDiagnosisService.items;
  protected readonly examinations = this.examinationService.examinations;

  protected readonly initials = computed(() => {
    const name = this.patient()?.fullName?.trim() ?? '';
    if (!name) return '?';
    return name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('');
  });

  /** Sorted (oldest → newest) final diagnoses with usable urgency. */
  protected readonly severityPoints = computed<SeverityPoint[]>(() =>
    this.finalDiagnoses()
      .filter(
        (f): f is FinalDiagnosisListItem & { urgency: Urgency } =>
          !!f.urgency && f.status === 'done',
      )
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((f, index) => ({
        index,
        date: f.createdAt,
        score: SEVERITY_BY_URGENCY[f.urgency],
        urgency: f.urgency,
        color: URGENCY_DOT_COLOR[f.urgency],
        primaryDiagnosis: f.primaryDiagnosis,
        confidence: f.confidence,
      })),
  );

  protected readonly trend = computed<TrendDirection>(() => {
    const pts = this.severityPoints();
    if (pts.length < 2) return 'unknown';
    const mid = Math.floor(pts.length / 2);
    const older = pts.slice(0, mid);
    const recent = pts.slice(pts.length - Math.max(mid, 1));
    const avg = (xs: SeverityPoint[]) => xs.reduce((s, p) => s + p.score, 0) / xs.length;
    const diff = avg(recent) - avg(older);
    if (diff <= -0.5) return 'improving';
    if (diff >= 0.5) return 'worsening';
    return 'stable';
  });

  protected readonly latestPoint = computed(() =>
    this.severityPoints()[this.severityPoints().length - 1] ?? null,
  );

  /** Highest urgency observed across all FDs (red > yellow > green). */
  protected readonly topUrgency = computed<Urgency | null>(() => {
    const pts = this.severityPoints();
    if (pts.length === 0) return null;
    if (pts.some((p) => p.urgency === 'red')) return 'red';
    if (pts.some((p) => p.urgency === 'yellow')) return 'yellow';
    return 'green';
  });

  /** Days between first and last final diagnosis (0 = same day). */
  protected readonly daySpan = computed<number | null>(() => {
    const pts = this.severityPoints();
    if (pts.length < 2) return null;
    const first = new Date(pts[0].date).getTime();
    const last = new Date(pts[pts.length - 1].date).getTime();
    if (isNaN(first) || isNaN(last)) return null;
    return Math.round((last - first) / (24 * 60 * 60 * 1000));
  });

  /** Counts and percentages by urgency. */
  protected readonly urgencyDistribution = computed(() => {
    const pts = this.severityPoints();
    const counts = { green: 0, yellow: 0, red: 0 };
    for (const p of pts) counts[p.urgency]++;
    const total = pts.length || 1;
    return {
      total: pts.length,
      green: { count: counts.green, pct: (counts.green / total) * 100 },
      yellow: { count: counts.yellow, pct: (counts.yellow / total) * 100 },
      red: { count: counts.red, pct: (counts.red / total) * 100 },
    };
  });

  // ---- Parameter series ----

  protected readonly parameterExaminations = computed<Examination[]>(() =>
    this.examinations().filter((e) => e.type === 'parameters' && e.status === 'done'),
  );

  protected readonly parameterSeries = computed<ParameterSeries[]>(() => {
    const exams = this.parameterExaminations()
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    const collect = (
      key: string,
      labelKey: string,
      normalMin: number,
      yMin: number,
      yMax: number,
      better: ParameterSeries['better'],
      suffix: string,
    ): ParameterSeries => {
      const points: ParameterPoint[] = [];
      for (const e of exams) {
        const raw = (e.parameters as Record<string, unknown> | null)?.[key];
        const num = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isFinite(num)) continue;
        points.push({ date: e.createdAt, value: num });
      }
      return { key, labelKey, points, normalMin, yMin, yMax, better, suffix };
    };

    return [
      collect('spo2', 'trend.spo2', 95, 80, 100, 'up', '%'),
      collect('fev1Fvc', 'trend.fev1Fvc', 70, 30, 100, 'up', '%'),
      collect('fev1', 'trend.fev1', 80, 0, 6, 'up', ' L'),
    ].filter((s) => s.points.length >= 2);
  });

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

  // ---- SVG geometry: timeline ----

  protected readonly timelineW = TIMELINE_W;
  protected readonly timelineH = TIMELINE_H;
  protected readonly timelinePadLeft = TIMELINE_PAD_LEFT;
  protected readonly timelinePadRight = TIMELINE_PAD_RIGHT;
  protected readonly timelinePadTop = TIMELINE_PAD_TOP;
  protected readonly timelinePadBottom = TIMELINE_PAD_BOTTOM;

  protected readonly severityY1 = this.scoreToY(1);
  protected readonly severityY2 = this.scoreToY(2);
  protected readonly severityY3 = this.scoreToY(3);

  protected readonly timelineXEnd = TIMELINE_W - TIMELINE_PAD_RIGHT;

  protected readonly severityPath = computed(() => {
    const pts = this.severityPoints();
    if (pts.length === 0) return '';
    return pts
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${this.timelineX(i, pts.length)} ${this.scoreToY(p.score)}`)
      .join(' ');
  });

  protected readonly severityArea = computed(() => {
    const pts = this.severityPoints();
    if (pts.length < 2) return '';
    const total = pts.length;
    const xStart = this.timelineX(0, total);
    const xEnd = this.timelineX(total - 1, total);
    const yBottom = this.scoreToY(1);
    const line = pts
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${this.timelineX(i, total)} ${this.scoreToY(p.score)}`)
      .join(' ');
    return `${line} L ${xEnd} ${yBottom} L ${xStart} ${yBottom} Z`;
  });

  protected readonly severityCoords = computed(() =>
    this.severityPoints().map((p, i, arr) => ({
      cx: this.timelineX(i, arr.length),
      cy: this.scoreToY(p.score),
      color: p.color,
      urgency: p.urgency,
      date: p.date,
      primaryDiagnosis: p.primaryDiagnosis,
      tooltip:
        (p.primaryDiagnosis ?? '') +
        (p.primaryDiagnosis ? ' — ' : '') +
        new Date(p.date).toLocaleDateString(),
    })),
  );

  /** Up to 4 evenly-spaced X-axis tick labels with their date strings. */
  protected readonly timelineTicks = computed(() => {
    const pts = this.severityPoints();
    if (pts.length === 0) return [];
    const step = Math.max(1, Math.ceil(pts.length / 4));
    const ticks: { x: number; date: string }[] = [];
    for (let i = 0; i < pts.length; i += step) {
      ticks.push({ x: this.timelineX(i, pts.length), date: pts[i].date });
    }
    const last = pts.length - 1;
    if (ticks[ticks.length - 1].x !== this.timelineX(last, pts.length)) {
      ticks.push({ x: this.timelineX(last, pts.length), date: pts[last].date });
    }
    return ticks;
  });

  // ---- SVG geometry: parameter sparklines ----

  protected readonly paramW = PARAM_W;
  protected readonly paramH = PARAM_H;

  protected paramPath(series: ParameterSeries): string {
    return this.paramCoords(series)
      .map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.cx} ${c.cy}`)
      .join(' ');
  }

  protected paramArea(series: ParameterSeries): string {
    const coords = this.paramCoords(series);
    if (coords.length < 2) return '';
    const yBottom = PARAM_H - PARAM_PAD_Y;
    const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.cx} ${c.cy}`).join(' ');
    return `${line} L ${coords[coords.length - 1].cx} ${yBottom} L ${coords[0].cx} ${yBottom} Z`;
  }

  protected paramCoords(series: ParameterSeries): { cx: number; cy: number; value: number }[] {
    const pts = series.points;
    return pts.map((p, i) => ({
      cx: this.paramX(i, pts.length),
      cy: this.paramY(p.value, series.yMin, series.yMax),
      value: p.value,
    }));
  }

  protected paramNormalY(series: ParameterSeries): number {
    return this.paramY(series.normalMin, series.yMin, series.yMax);
  }

  protected paramLatest(series: ParameterSeries): number {
    return series.points[series.points.length - 1].value;
  }

  protected paramFirst(series: ParameterSeries): number {
    return series.points[0].value;
  }

  protected paramDelta(series: ParameterSeries): number {
    return this.paramLatest(series) - this.paramFirst(series);
  }

  protected paramTrendIcon(series: ParameterSeries): string {
    const d = this.paramDelta(series);
    if (Math.abs(d) < 0.01) return 'pi-minus';
    return d > 0 ? 'pi-arrow-up' : 'pi-arrow-down';
  }

  protected paramTrendColor(series: ParameterSeries): string {
    const d = this.paramDelta(series);
    if (Math.abs(d) < 0.01) return 'text-surface-500';
    const better = (series.better === 'up' && d > 0) || (series.better === 'down' && d < 0);
    return better ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400';
  }

  protected paramAtNormal(series: ParameterSeries): boolean {
    const v = this.paramLatest(series);
    return series.better === 'up' ? v >= series.normalMin : v <= series.normalMin;
  }

  // ---- Visual mappers ----

  protected trendBadgeClass(): string {
    switch (this.trend()) {
      case 'improving':
        return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 ring-1 ring-emerald-200/60 dark:ring-emerald-800/60';
      case 'worsening':
        return 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300 ring-1 ring-red-200/60 dark:ring-red-800/60';
      case 'stable':
        return 'bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300 ring-1 ring-sky-200/60 dark:ring-sky-800/60';
      default:
        return 'bg-surface-50 text-surface-600 dark:bg-surface-900 dark:text-surface-300 ring-1 ring-surface-200/60 dark:ring-surface-800/60';
    }
  }

  protected trendIcon(): string {
    switch (this.trend()) {
      case 'improving':
        return 'pi-arrow-down-right';
      case 'worsening':
        return 'pi-arrow-up-right';
      case 'stable':
        return 'pi-minus';
      default:
        return 'pi-question-circle';
    }
  }

  protected urgencyBadgeClass(urgency: Urgency | null): string {
    if (urgency === 'red') return 'bg-red-500 text-white';
    if (urgency === 'yellow') return 'bg-amber-400 text-amber-950';
    if (urgency === 'green') return 'bg-emerald-500 text-white';
    return 'bg-surface-200 text-surface-700';
  }

  // ---- Coord helpers ----

  private timelineX(i: number, total: number): number {
    if (total <= 1) return (TIMELINE_PAD_LEFT + TIMELINE_W - TIMELINE_PAD_RIGHT) / 2;
    const span = TIMELINE_W - TIMELINE_PAD_LEFT - TIMELINE_PAD_RIGHT;
    return TIMELINE_PAD_LEFT + (span * i) / (total - 1);
  }

  private scoreToY(score: number): number {
    // score 1 (green) → bottom, score 3 (red) → top
    const span = TIMELINE_H - TIMELINE_PAD_TOP - TIMELINE_PAD_BOTTOM;
    return TIMELINE_PAD_TOP + span - ((score - 1) / 2) * span;
  }

  private paramX(i: number, total: number): number {
    if (total <= 1) return PARAM_W / 2;
    const span = PARAM_W - 2 * PARAM_PAD_X;
    return PARAM_PAD_X + (span * i) / (total - 1);
  }

  private paramY(value: number, yMin: number, yMax: number): number {
    const clamped = Math.max(yMin, Math.min(yMax, value));
    const span = PARAM_H - 2 * PARAM_PAD_Y;
    return PARAM_PAD_Y + span - ((clamped - yMin) / (yMax - yMin)) * span;
  }
}
