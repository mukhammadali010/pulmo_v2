import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { TableModule } from 'primeng/table';

import type { ExaminationStatus, ExaminationType } from '@core/models';
import { ExaminationService } from '@core/services/examination.service';
import { PatientService } from '@core/services/patient.service';

@Component({
  selector: 'app-examination-list',
  imports: [
    DatePipe,
    FormsModule,
    TranslatePipe,
    IconFieldModule,
    InputIconModule,
    InputTextModule,
    TableModule,
  ],
  templateUrl: './examination-list.html',
  styleUrl: './examination-list.scss',
})
export class ExaminationList implements OnInit {
  private readonly examinationService = inject(ExaminationService);
  private readonly patientService = inject(PatientService);
  private readonly router = inject(Router);

  protected readonly examinations = this.examinationService.examinations;
  protected readonly loading = this.examinationService.loading;
  protected readonly patients = this.patientService.patients;
  protected readonly searchTerm = signal('');

  protected readonly patientNameById = computed(() => {
    const map = new Map<string, string>();
    for (const p of this.patients()) map.set(p.id, p.fullName);
    return map;
  });

  protected readonly filteredExaminations = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    const names = this.patientNameById();
    if (!term) return this.examinations();
    return this.examinations().filter((e) => {
      const name = names.get(e.patientId) ?? '';
      const haystack = [name, e.notes ?? '', e.type, e.status].join(' ').toLowerCase();
      return haystack.includes(term);
    });
  });

  ngOnInit(): void {
    this.examinationService.load().subscribe();
    if (this.patients().length === 0) {
      this.patientService.load().subscribe();
    }
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

  protected typeAccent(type: ExaminationType): string {
    if (type === 'audio') return 'from-violet-500 to-fuchsia-500';
    if (type === 'parameters') return 'from-amber-500 to-orange-500';
    if (type === 'clinical_scale') return 'from-indigo-500 to-violet-500';
    if (type === 'ct') return 'from-indigo-500 to-blue-500';
    if (type === 'mri') return 'from-teal-500 to-emerald-500';
    return 'from-sky-500 to-cyan-500';
  }

  protected statusSeverity(status: ExaminationStatus): 'info' | 'warn' | 'success' | 'danger' {
    return (
      {
        pending: 'info',
        analyzing: 'warn',
        done: 'success',
        failed: 'danger',
      } as const
    )[status];
  }

  protected onSearch(value: string): void {
    this.searchTerm.set(value);
  }

  protected initials(name: string): string {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || '?';
  }

  protected openPatient(patientId: string): void {
    void this.router.navigate(['/patients', patientId]);
  }
}
