import { Routes } from '@angular/router';

export const PATIENTS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/patient-list/patient-list').then((m) => m.PatientList),
  },
  {
    path: ':id',
    loadComponent: () =>
      import('./pages/patient-detail/patient-detail').then((m) => m.PatientDetail),
  },
];
