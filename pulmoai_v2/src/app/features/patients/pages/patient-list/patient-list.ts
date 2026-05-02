import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ToastrService } from 'ngx-toastr';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { TextareaModule } from 'primeng/textarea';

import type { Gender, Patient } from '@core/models';
import { PatientService } from '@core/services/patient.service';

@Component({
  selector: 'app-patient-list',
  imports: [
    DatePipe,
    FormsModule,
    ReactiveFormsModule,
    TranslatePipe,
    ButtonModule,
    DialogModule,
    IconFieldModule,
    InputIconModule,
    InputTextModule,
    SelectModule,
    TableModule,
    TextareaModule,
  ],
  templateUrl: './patient-list.html',
  styleUrl: './patient-list.scss',
})
export class PatientList implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly patientService = inject(PatientService);
  private readonly toastr = inject(ToastrService);
  private readonly translate = inject(TranslateService);
  private readonly router = inject(Router);

  protected readonly patients = this.patientService.patients;
  protected readonly loading = this.patientService.loading;
  protected readonly dialogVisible = signal(false);
  protected readonly submitting = signal(false);
  protected readonly searchTerm = signal('');

  protected readonly filteredPatients = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    if (!term) return this.patients();
    return this.patients().filter((p) => {
      const haystack = [p.fullName, p.phone ?? '', p.notes ?? ''].join(' ').toLowerCase();
      return haystack.includes(term);
    });
  });

  protected readonly genderOptions: { value: Gender; labelKey: string }[] = [
    { value: 'male', labelKey: 'gender.male' },
    { value: 'female', labelKey: 'gender.female' },
    { value: 'other', labelKey: 'gender.other' },
  ];

  protected readonly form = this.fb.nonNullable.group({
    fullName: ['', [Validators.required, Validators.maxLength(255)]],
    dateOfBirth: [''],
    gender: this.fb.control<Gender | null>(null),
    phone: [''],
    notes: [''],
  });

  ngOnInit(): void {
    this.patientService.load().subscribe();
  }

  protected initials(patient: Patient): string {
    if (!patient.fullName) return '?';
    return patient.fullName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('');
  }

  protected avatarGradient(patient: Patient): string {
    const palettes = [
      'from-sky-500 to-cyan-500',
      'from-cyan-500 to-teal-500',
      'from-teal-500 to-emerald-500',
      'from-indigo-500 to-sky-500',
      'from-violet-500 to-cyan-500',
    ];
    let hash = 0;
    for (let i = 0; i < patient.id.length; i++) {
      hash = (hash * 31 + patient.id.charCodeAt(i)) | 0;
    }
    return palettes[Math.abs(hash) % palettes.length];
  }

  protected onSearch(value: string): void {
    this.searchTerm.set(value);
  }

  protected openDialog(): void {
    this.form.reset({ fullName: '', dateOfBirth: '', gender: null, phone: '', notes: '' });
    this.dialogVisible.set(true);
  }

  protected openDetail(id: string): void {
    void this.router.navigate(['/patients', id]);
  }

  protected submit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    const raw = this.form.getRawValue();
    this.patientService
      .create({
        fullName: raw.fullName,
        dateOfBirth: raw.dateOfBirth || null,
        gender: raw.gender || null,
        phone: raw.phone || null,
        notes: raw.notes || null,
      })
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.dialogVisible.set(false);
          this.toastr.success(this.translate.instant('patients.saved'));
        },
        error: () => this.submitting.set(false),
      });
  }

  protected remove(id: string): void {
    if (!confirm(this.translate.instant('patients.deleteConfirm'))) return;
    this.patientService.remove(id).subscribe({
      next: () => this.toastr.success(this.translate.instant('patients.deleted')),
    });
  }
}
