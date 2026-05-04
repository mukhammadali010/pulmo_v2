import { Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import type { AffectedRegion, LobeRegion, SeverityLevel } from '@core/models';

const LOBE_IDS: LobeRegion[] = [
  'right_upper',
  'right_middle',
  'right_lower',
  'left_upper',
  'left_lower',
];

/** Region IDs that are NOT one of the five core lobes — listed below the diagram. */
const NON_LOBE_REGIONS: LobeRegion[] = [
  'bilateral',
  'pleural',
  'mediastinal',
  'airways',
];

@Component({
  selector: 'app-lung-diagram',
  imports: [TranslatePipe],
  templateUrl: './lung-diagram.html',
  styleUrl: './lung-diagram.scss',
})
export class LungDiagram {
  readonly regions = input<AffectedRegion[]>([]);

  protected readonly lobeIds = LOBE_IDS;
  protected readonly nonLobeRegionIds = NON_LOBE_REGIONS;

  /** Bilateral findings highlight every lobe at the bilateral severity. */
  protected readonly bilateralSeverity = computed<SeverityLevel | null>(() => {
    const r = this.regions().find((x) => x.region === 'bilateral');
    return r?.severity ?? null;
  });

  /** Findings grouped by region (lobes only — non-lobe regions are listed separately). */
  protected readonly findingsByRegion = computed<Map<LobeRegion, AffectedRegion[]>>(() => {
    const map = new Map<LobeRegion, AffectedRegion[]>();
    for (const r of this.regions()) {
      const list = map.get(r.region) ?? [];
      list.push(r);
      map.set(r.region, list);
    }
    return map;
  });

  /** Non-lobe findings (bilateral, pleural, mediastinal, airways) for the side panel. */
  protected readonly otherFindings = computed<AffectedRegion[]>(() =>
    this.regions().filter((r) => NON_LOBE_REGIONS.includes(r.region)),
  );

  /** Lobe-specific findings (5 core lobes). */
  protected readonly lobeFindings = computed<AffectedRegion[]>(() =>
    this.regions().filter((r) => !NON_LOBE_REGIONS.includes(r.region)),
  );

  /** Effective severity to render this lobe at — direct hit OR bilateral wash. */
  protected severityFor(lobe: LobeRegion): SeverityLevel | null {
    const direct = this.findingsByRegion().get(lobe);
    if (direct && direct.length > 0) {
      return this.maxSeverity(direct.map((r) => r.severity));
    }
    return this.bilateralSeverity();
  }

  /** SVG fill for a lobe: subtle when unaffected, urgency-tinted when affected. */
  protected lobeFill(lobe: LobeRegion): string {
    const sev = this.severityFor(lobe);
    if (!sev) return 'fill-surface-200 dark:fill-surface-800';
    if (sev === 'severe') return 'fill-red-500/70';
    if (sev === 'moderate') return 'fill-amber-500/70';
    return 'fill-yellow-400/70';
  }

  /** Outline stroke for a lobe (slightly heavier when affected). */
  protected lobeStroke(lobe: LobeRegion): string {
    const sev = this.severityFor(lobe);
    if (!sev) return 'stroke-surface-400 dark:stroke-surface-600';
    if (sev === 'severe') return 'stroke-red-600 dark:stroke-red-300';
    if (sev === 'moderate') return 'stroke-amber-600 dark:stroke-amber-300';
    return 'stroke-yellow-500 dark:stroke-yellow-300';
  }

  protected lobeStrokeWidth(lobe: LobeRegion): number {
    return this.severityFor(lobe) ? 2 : 1.2;
  }

  protected lobeTooltip(lobe: LobeRegion): string {
    const findings = this.findingsByRegion().get(lobe) ?? [];
    if (findings.length === 0) {
      return this.bilateralSeverity() ? 'bilateral' : '';
    }
    return findings.map((f) => `${f.finding} (${f.severity})`).join('; ');
  }

  protected severityChipClass(severity: SeverityLevel): string {
    if (severity === 'severe')
      return 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300';
    if (severity === 'moderate')
      return 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300';
    return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300';
  }

  protected modalityIcon(modality: string): string {
    if (modality === 'audio') return 'pi-microphone';
    if (modality === 'parameters') return 'pi-chart-line';
    return 'pi-image';
  }

  private maxSeverity(severities: SeverityLevel[]): SeverityLevel {
    if (severities.includes('severe')) return 'severe';
    if (severities.includes('moderate')) return 'moderate';
    return 'mild';
  }
}
