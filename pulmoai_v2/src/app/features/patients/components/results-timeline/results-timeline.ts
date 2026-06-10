import { DatePipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import type { Examination, ExaminationType } from '@core/models';
import { AiReportCardComponent } from '../ai-report-card/ai-report-card';
import { StatusBadgeComponent } from '../status-badge/status-badge';

const TYPE_ICON: Record<ExaminationType, string> = {
  audio: 'pi-microphone',
  xray: 'pi-image',
  ct: 'pi-image',
  mri: 'pi-image',
  parameters: 'pi-chart-line',
  clinical_scale: 'pi-calculator',
};

@Component({
  selector: 'app-results-timeline',
  imports: [DatePipe, TranslatePipe, AiReportCardComponent, StatusBadgeComponent],
  templateUrl: './results-timeline.html',
  styleUrl: './results-timeline.scss',
})
export class ResultsTimeline {
  readonly examinations = input.required<Examination[]>();

  protected readonly sorted = computed(() =>
    [...this.examinations()].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    ),
  );

  protected iconFor(type: ExaminationType): string {
    return TYPE_ICON[type];
  }

  protected typeLabelKey(type: ExaminationType): string {
    if (type === 'audio') return 'examinations.audioDiagnostic';
    if (type === 'parameters') return 'examinations.parameterDiagnostic';
    if (type === 'clinical_scale') return 'clinicalScales.tabTitle';
    return 'examType.' + type;
  }
}
