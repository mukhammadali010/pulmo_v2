import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import type { ExaminationStatus, ExaminationType } from '@core/models';
import { AdminService } from '@core/services/admin.service';
import { AuthService } from '@core/services/auth.service';
import { ExaminationService } from '@core/services/examination.service';
import { PatientService } from '@core/services/patient.service';

interface StatCard {
  labelKey: string;
  value: number;
  icon: string;
  accent: 'sky' | 'cyan' | 'amber' | 'emerald';
}

@Component({
  selector: 'app-home',
  imports: [DatePipe, RouterLink, TranslatePipe],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly patientService = inject(PatientService);
  private readonly examinationService = inject(ExaminationService);
  private readonly adminService = inject(AdminService);

  protected readonly patients = this.patientService.patients;
  protected readonly examinations = this.examinationService.examinations;
  protected readonly adminStats = this.adminService.stats;
  protected readonly isAdmin = computed(() => this.auth.user()?.role === 'admin');

  protected readonly greetingKey = computed(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'dashboard.greetingMorning';
    if (hour < 18) return 'dashboard.greetingAfternoon';
    return 'dashboard.greetingEvening';
  });

  protected readonly stats = computed<StatCard[]>(() => {
    if (this.isAdmin()) {
      const s = this.adminStats();
      return [
        {
          labelKey: 'admin.stats.totalDoctors',
          value: s?.totalDoctors ?? 0,
          icon: 'pi-id-card',
          accent: 'sky',
        },
        {
          labelKey: 'admin.stats.totalPatients',
          value: s?.totalPatients ?? 0,
          icon: 'pi-users',
          accent: 'cyan',
        },
        {
          labelKey: 'admin.stats.totalExaminations',
          value: s?.totalExaminations ?? 0,
          icon: 'pi-microchip-ai',
          accent: 'amber',
        },
        {
          labelKey: 'dashboard.stats.completed',
          value: s?.examinationsDone ?? 0,
          icon: 'pi-check-circle',
          accent: 'emerald',
        },
      ];
    }
    const exams = this.examinations();
    const pending = exams.filter((e) => e.status === 'pending' || e.status === 'analyzing').length;
    const completed = exams.filter((e) => e.status === 'done').length;
    return [
      {
        labelKey: 'dashboard.stats.patients',
        value: this.patients().length,
        icon: 'pi-users',
        accent: 'sky',
      },
      {
        labelKey: 'dashboard.stats.examinations',
        value: exams.length,
        icon: 'pi-microchip-ai',
        accent: 'cyan',
      },
      {
        labelKey: 'dashboard.stats.pending',
        value: pending,
        icon: 'pi-clock',
        accent: 'amber',
      },
      {
        labelKey: 'dashboard.stats.completed',
        value: completed,
        icon: 'pi-check-circle',
        accent: 'emerald',
      },
    ];
  });

  protected readonly recentExaminations = computed(() => {
    const map = new Map<string, string>();
    for (const p of this.patients()) map.set(p.id, p.fullName);
    return [...this.examinations()]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5)
      .map((e) => ({ ...e, patientName: map.get(e.patientId) ?? '—' }));
  });

  ngOnInit(): void {
    if (this.isAdmin()) {
      this.adminService.loadStats().subscribe();
      this.adminService.loadDoctors().subscribe();
    } else {
      if (this.patients().length === 0) {
        this.patientService.load().subscribe();
      }
      if (this.examinations().length === 0) {
        this.examinationService.load().subscribe();
      }
    }
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

  protected statusClasses(status: ExaminationStatus): string {
    return (
      {
        pending: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
        analyzing: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
        done: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
        failed: 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
      } as const
    )[status];
  }
}
