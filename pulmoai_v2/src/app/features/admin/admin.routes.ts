import { Routes } from '@angular/router';

export const ADMIN_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'doctors' },
  {
    path: 'doctors',
    loadComponent: () =>
      import('./pages/doctor-list/doctor-list').then((m) => m.DoctorList),
  },
];
