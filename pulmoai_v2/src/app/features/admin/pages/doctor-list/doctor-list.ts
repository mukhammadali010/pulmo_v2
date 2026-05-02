import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ToastrService } from 'ngx-toastr';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TableModule } from 'primeng/table';

import type { Doctor, UserRole } from '@core/models';
import { AdminService } from '@core/services/admin.service';
import { AuthService } from '@core/services/auth.service';

type DialogMode = 'create' | 'edit' | 'reset';

@Component({
  selector: 'app-doctor-list',
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
  ],
  templateUrl: './doctor-list.html',
  styleUrl: './doctor-list.scss',
})
export class DoctorList implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly adminService = inject(AdminService);
  private readonly auth = inject(AuthService);
  private readonly toastr = inject(ToastrService);
  private readonly translate = inject(TranslateService);

  protected readonly doctors = this.adminService.doctors;
  protected readonly loading = this.adminService.loading;
  protected readonly searchTerm = signal('');
  protected readonly submitting = signal(false);

  protected readonly dialogMode = signal<DialogMode | null>(null);
  protected readonly editingId = signal<string | null>(null);

  protected readonly roleOptions: { value: UserRole; labelKey: string }[] = [
    { value: 'doctor', labelKey: 'admin.doctors.roleDoctor' },
    { value: 'admin', labelKey: 'admin.doctors.roleAdmin' },
  ];

  protected readonly filteredDoctors = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    if (!term) return this.doctors();
    return this.doctors().filter((d) => {
      const haystack = [d.fullName, d.email].join(' ').toLowerCase();
      return haystack.includes(term);
    });
  });

  protected readonly form = this.fb.nonNullable.group({
    fullName: ['', [Validators.required, Validators.maxLength(255)]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
    role: this.fb.nonNullable.control<UserRole>('doctor', Validators.required),
  });

  protected readonly editForm = this.fb.nonNullable.group({
    fullName: ['', [Validators.required, Validators.maxLength(255)]],
    role: this.fb.nonNullable.control<UserRole>('doctor', Validators.required),
  });

  protected readonly resetForm = this.fb.nonNullable.group({
    newPassword: ['', [Validators.required, Validators.minLength(6)]],
  });

  ngOnInit(): void {
    this.adminService.loadDoctors().subscribe();
  }

  protected initials(doctor: Doctor): string {
    if (!doctor.fullName) return '?';
    return doctor.fullName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('');
  }

  protected avatarGradient(doctor: Doctor): string {
    const palettes = [
      'from-sky-500 to-cyan-500',
      'from-cyan-500 to-teal-500',
      'from-teal-500 to-emerald-500',
      'from-indigo-500 to-sky-500',
      'from-violet-500 to-cyan-500',
    ];
    let hash = 0;
    for (let i = 0; i < doctor.id.length; i++) {
      hash = (hash * 31 + doctor.id.charCodeAt(i)) | 0;
    }
    return palettes[Math.abs(hash) % palettes.length];
  }

  protected isSelf(doctor: Doctor): boolean {
    return this.auth.user()?.id === doctor.id;
  }

  protected onSearch(value: string): void {
    this.searchTerm.set(value);
  }

  protected openCreateDialog(): void {
    this.form.reset({ fullName: '', email: '', password: '', role: 'doctor' });
    this.dialogMode.set('create');
  }

  protected openEditDialog(doctor: Doctor): void {
    this.editingId.set(doctor.id);
    this.editForm.reset({ fullName: doctor.fullName, role: doctor.role });
    this.dialogMode.set('edit');
  }

  protected openResetDialog(doctor: Doctor): void {
    this.editingId.set(doctor.id);
    this.resetForm.reset({ newPassword: '' });
    this.dialogMode.set('reset');
  }

  protected closeDialog(): void {
    this.dialogMode.set(null);
    this.editingId.set(null);
  }

  protected submitCreate(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.adminService.create(this.form.getRawValue()).subscribe({
      next: () => {
        this.submitting.set(false);
        this.closeDialog();
        this.toastr.success(this.translate.instant('admin.doctors.saved'));
      },
      error: () => this.submitting.set(false),
    });
  }

  protected submitEdit(): void {
    const id = this.editingId();
    if (!id || this.editForm.invalid || this.submitting()) {
      this.editForm.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.adminService.update(id, this.editForm.getRawValue()).subscribe({
      next: () => {
        this.submitting.set(false);
        this.closeDialog();
        this.toastr.success(this.translate.instant('admin.doctors.updated'));
      },
      error: () => this.submitting.set(false),
    });
  }

  protected submitReset(): void {
    const id = this.editingId();
    if (!id || this.resetForm.invalid || this.submitting()) {
      this.resetForm.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.adminService.resetPassword(id, this.resetForm.getRawValue().newPassword).subscribe({
      next: () => {
        this.submitting.set(false);
        this.closeDialog();
        this.toastr.success(this.translate.instant('admin.doctors.passwordResetSuccess'));
      },
      error: () => this.submitting.set(false),
    });
  }

  protected toggleActive(doctor: Doctor): void {
    if (this.isSelf(doctor)) {
      this.toastr.error(this.translate.instant('admin.doctors.selfActionError'));
      return;
    }
    if (doctor.isActive) {
      if (!confirm(this.translate.instant('admin.doctors.deactivateConfirm'))) return;
      this.adminService.deactivate(doctor.id).subscribe({
        next: () => this.toastr.success(this.translate.instant('admin.doctors.deactivated')),
      });
    } else {
      this.adminService.update(doctor.id, { isActive: true }).subscribe({
        next: () => this.toastr.success(this.translate.instant('admin.doctors.activated')),
      });
    }
  }
}
