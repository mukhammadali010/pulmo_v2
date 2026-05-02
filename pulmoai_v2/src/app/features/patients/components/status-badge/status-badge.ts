import { Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import type { ExaminationStatus } from '@core/models';

@Component({
  selector: 'app-status-badge',
  imports: [TranslatePipe],
  template: `
    <span
      class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
      [class]="classes()"
    >
      <span class="h-1.5 w-1.5 rounded-full" [class]="dotClasses()"></span>
      {{ 'examinations.status.' + status() | translate }}
    </span>
  `,
})
export class StatusBadgeComponent {
  readonly status = input.required<ExaminationStatus>();

  protected readonly classes = computed(
    () =>
      ({
        pending: 'bg-surface-100 text-surface-700 dark:bg-surface-800 dark:text-surface-200',
        analyzing: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
        done: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
        failed: 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
      })[this.status()],
  );

  protected readonly dotClasses = computed(
    () =>
      ({
        pending: 'bg-surface-400',
        analyzing: 'bg-amber-500 animate-pulse',
        done: 'bg-emerald-500',
        failed: 'bg-rose-500',
      })[this.status()],
  );
}
