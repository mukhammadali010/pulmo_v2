import { Routes } from '@angular/router';

import { adminGuard } from '@core/guards/admin.guard';
import { authGuard } from '@core/guards/auth.guard';
import { guestGuard } from '@core/guards/guest.guard';
import { MainLayout } from '@layouts/main-layout/main-layout';

export const routes: Routes = [
  {
    path: 'auth',
    canMatch: [guestGuard],
    loadChildren: () => import('@features/auth/auth.routes').then((m) => m.AUTH_ROUTES),
  },
  {
    path: '',
    component: MainLayout,
    canMatch: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadChildren: () =>
          import('@features/dashboard/dashboard.routes').then((m) => m.DASHBOARD_ROUTES),
      },
      {
        path: 'patients',
        loadChildren: () =>
          import('@features/patients/patients.routes').then((m) => m.PATIENTS_ROUTES),
      },
      {
        path: 'examinations',
        loadChildren: () =>
          import('@features/examinations/examinations.routes').then((m) => m.EXAMINATIONS_ROUTES),
      },
      {
        path: 'final-diagnoses',
        loadChildren: () =>
          import('@features/final-diagnoses/final-diagnoses.routes').then(
            (m) => m.FINAL_DIAGNOSES_ROUTES,
          ),
      },
      {
        path: 'admin',
        canMatch: [adminGuard],
        loadChildren: () =>
          import('@features/admin/admin.routes').then((m) => m.ADMIN_ROUTES),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
