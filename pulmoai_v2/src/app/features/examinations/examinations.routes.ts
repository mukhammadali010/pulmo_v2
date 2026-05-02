import { Routes } from '@angular/router';

export const EXAMINATIONS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/examination-list/examination-list').then((m) => m.ExaminationList),
  },
];
